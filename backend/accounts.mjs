import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { yuanString } from './cny-prices.mjs';

const derive = promisify(scrypt);
const tokenHash = (value) => createHash('sha256').update(value).digest('hex');
const randomToken = () => randomBytes(32).toString('base64url');
const fail = (status, message) => Object.assign(new Error(message), { status });
const now = () => new Date().toISOString();
const sessionTtl = 7 * 86400;
export const supportSessionTtl = 30 * 86400;
const supportResetTtl = 15 * 60 * 1000;
const supportToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function supportMessage(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000) throw fail(400, '请填写 1–2000 字的消息');
  return value.trim();
}

async function revokeAccess(q, id) {
  await q('DELETE FROM gateway_user_session WHERE owner=?', [id]);
  await q('DELETE FROM gateway_user_key WHERE owner=?', [id]);
}


function username(value) {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,47}$/.test(name)) throw fail(400, '用户名需为 3–48 位字母、数字、点、下划线或短横线');
  return name;
}
function keyName(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 80)
    throw fail(400, '请输入 1–80 字的 Key 名称');
  return value.trim();
}
async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256)
    throw fail(400, '密码长度应为 12–256 位');
  const salt = randomBytes(16).toString('hex');
  const hash = await derive(password, salt, 32);
  return salt + ':' + hash.toString('hex');
}
async function verify(password, stored) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const [salt, hex] = (stored || 'unregistered:' + '00'.repeat(32)).split(':');
  return timingSafeEqual(await derive(password, salt, 32), Buffer.from(hex, 'hex'));
}
const publicUser = (row) => ({ id: row.id, username: row.username });

export async function accountTables(q, postgres) {
  await q(`CREATE TABLE IF NOT EXISTS gateway_user (
    id TEXT PRIMARY KEY, space TEXT NOT NULL, username TEXT NOT NULL, pass TEXT NOT NULL, recovery TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1, created TEXT NOT NULL, UNIQUE(space,username))`);
  await q(`CREATE TABLE IF NOT EXISTS gateway_user_session (
    digest TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES gateway_user(id), expires TEXT NOT NULL)`);
  await q(`CREATE INDEX IF NOT EXISTS gateway_session_owner ON gateway_user_session(owner)`);
  await q(`CREATE INDEX IF NOT EXISTS gateway_session_expiry ON gateway_user_session(expires)`);
  await q(`CREATE TABLE IF NOT EXISTS gateway_user_key (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES gateway_user(id), name TEXT NOT NULL,
    digest TEXT NOT NULL UNIQUE, preview TEXT NOT NULL, created TEXT NOT NULL)`);
  if (postgres) {
    await q("ALTER TABLE gateway_user_key ADD COLUMN IF NOT EXISTS model_group TEXT NOT NULL DEFAULT 'default'");
  } else if (!(await q('PRAGMA table_info(gateway_user_key)')).some(column => column.name === 'model_group')) {
    await q("ALTER TABLE gateway_user_key ADD COLUMN model_group TEXT NOT NULL DEFAULT 'default'");
  }
  if (postgres) {
    await q('ALTER TABLE gateway_user_key ADD COLUMN IF NOT EXISTS sealed_secret TEXT');
  } else if (!(await q('PRAGMA table_info(gateway_user_key)')).some(column => column.name === 'sealed_secret')) {
    await q('ALTER TABLE gateway_user_key ADD COLUMN sealed_secret TEXT');
  }
  await q(`CREATE INDEX IF NOT EXISTS gateway_user_key_owner ON gateway_user_key(owner)`);
  await q(`CREATE TABLE IF NOT EXISTS gateway_support_thread (
    id TEXT PRIMARY KEY, space TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, updated TEXT NOT NULL,
    expires TEXT NOT NULL, last_sender TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0,
    reset_owner TEXT, reset_version TEXT, reset_until TEXT)`);
  // Existing browser-only conversations cannot be attributed to an account safely.
  const supportColumns = postgres ? [] : await q('PRAGMA table_info(gateway_support_thread)');
  for (const [field, definition] of [
    ['owner', 'TEXT REFERENCES gateway_user(id)'], ['resolved', 'TEXT'], ['read_seq', 'INTEGER NOT NULL DEFAULT 0']
  ]) {
    if (postgres || !supportColumns.some(column => column.name === field))
      await q(`ALTER TABLE gateway_support_thread ADD COLUMN ${postgres ? 'IF NOT EXISTS ' : ''}${field} ${definition}`);
  }
  await q('CREATE UNIQUE INDEX IF NOT EXISTS gateway_support_account ON gateway_support_thread(space, owner) WHERE owner IS NOT NULL');
  await q('CREATE INDEX IF NOT EXISTS gateway_support_thread_recent ON gateway_support_thread(space, updated)');
  await q(`CREATE TABLE IF NOT EXISTS gateway_support_message (
    thread TEXT NOT NULL REFERENCES gateway_support_thread(id), seq INTEGER NOT NULL, sender TEXT NOT NULL,
    text TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(thread, seq))`);
}

export function accountStore(tx, space, lock = '', userKeyCodec) {
  async function issueKey() {
    const secret = 'gw_live_' + randomToken();
    return {
      secret,
      digest: tokenHash(secret),
      preview: secret.slice(0, 12) + '…' + secret.slice(-4),
      sealed: userKeyCodec ? await userKeyCodec.seal(secret) : null
    };
  }
  async function newSession(q, user) {
    const token = randomToken();
    await q('DELETE FROM gateway_user_session WHERE expires<=?', [now()]);
    await q('INSERT INTO gateway_user_session(digest,owner,expires) VALUES(?,?,?)', [
      tokenHash(token),
      user.id,
      new Date(Date.now() + sessionTtl * 1000).toISOString()
    ]);
    return { user: publicUser(user), token, ttl: sessionTtl };
  }
  const lookup = 'SELECT id,username,pass,enabled,recovery FROM gateway_user WHERE space=? AND username=?';
  const supportByToken = 'SELECT * FROM gateway_support_thread WHERE space=? AND owner IS NULL AND digest=? AND expires>?';
  const supportByOwner = 'SELECT * FROM gateway_support_thread WHERE space=? AND owner=?';
  const supportById = 'SELECT * FROM gateway_support_thread WHERE space=? AND id=?';
  async function supportThread(q, { owner, token }, forUpdate = false) {
    const suffix = forUpdate ? lock : '';
    if (owner) return (await q(supportByOwner + suffix, [space, owner]))[0];
    if (!supportToken(token)) return undefined;
    return (await q(supportByToken + suffix, [space, tokenHash(token), now()]))[0];
  }
  const supportStatus = thread => !thread.owner && thread.expires <= now() ? 'expired'
    : thread.resolved ? 'resolved' : thread.last_sender === 'user' ? 'pending' : 'replied';
  async function supportDetails(q, thread, { summary = false, admin = false } = {}) {
    const status = supportStatus(thread);
    // The recovery digest acts as a credential version, so any completed reset invalidates other grants.
    const reset = status !== 'expired' && thread.reset_until > now() && (await q(
      'SELECT username FROM gateway_user WHERE space=? AND id=? AND recovery=? AND enabled=1',
      [space, thread.reset_owner, thread.reset_version]
    ))[0];
    const result = { id: thread.id, status, scope: thread.owner ? 'account' : 'guest',
      latestSeq: thread.message_count, unread: thread.last_sender === 'admin' && thread.message_count > thread.read_seq,
      reset: reset ? { username: reset.username, expires: thread.reset_until } : null };
    if (summary) return { ...result, reset: Boolean(result.reset) };
    const messages = (await q(
      'SELECT seq,sender,text,created FROM gateway_support_message WHERE thread=? ORDER BY seq DESC LIMIT 100', [thread.id]
    )).reverse();
    const member = admin && thread.owner && (await q('SELECT username FROM gateway_user WHERE space=? AND id=?', [space, thread.owner]))[0];
    return { ...result, messages, ...(member ? { username: member.username } : {}) };
  }
  async function addSupportMessage(q, id, sender, text) {
    const created = now();
    const [thread] = await q(
      'UPDATE gateway_support_thread SET message_count=message_count+1,updated=?,last_sender=?,resolved=NULL WHERE space=? AND id=? RETURNING *',
      [created, sender, space, id]
    );
    if (!thread) throw fail(404, '会话不存在');
    await q('INSERT INTO gateway_support_message(thread,seq,sender,text,created) VALUES(?,?,?,?,?)',
      [id, thread.message_count, sender, text, created]);
    return supportDetails(q, thread, { admin: sender === 'admin' });
  }

  return {
    support: {
      read(viewer, summary = false) {
        if (!viewer.owner && !supportToken(viewer.token)) return null;
        return tx(async q => {
          const thread = await supportThread(q, viewer);
          return thread ? supportDetails(q, thread, { summary }) : null;
        });
      },
      send(viewer, value) {
        const text = supportMessage(value);
        return tx(async q => {
          let thread = await supportThread(q, viewer, true);
          let issued;
          if (!thread) {
            const id = randomUUID();
            const token = randomToken();
            await q(`INSERT INTO gateway_support_thread(id,space,digest,updated,expires,last_sender,owner) VALUES(?,?,?,?,?,?,?)
              ON CONFLICT DO NOTHING`, [id, space, tokenHash(token), now(), new Date(Date.now() + supportSessionTtl * 1000).toISOString(), 'user', viewer.owner || null]);
            issued = viewer.owner ? undefined : token;
            thread = await supportThread(q, { owner: viewer.owner, token: issued }, true);
          }
          if (!thread) throw fail(409, '暂时无法打开会话，请重试');
          return { data: await addSupportMessage(q, thread.id, 'user', text), issued };
        });
      },
      markRead(viewer, seq) {
        if (!Number.isSafeInteger(seq) || seq < 0) throw fail(400, '无效的消息序号');
        return tx(async q => {
          const thread = await supportThread(q, viewer, true);
          if (thread && seq > thread.read_seq)
            await q('UPDATE gateway_support_thread SET read_seq=? WHERE space=? AND id=?', [Math.min(seq, thread.message_count), space, thread.id]);
        });
      },
      endGuest(viewer) {
        if (viewer.owner) throw fail(403, '仅访客可以结束浏览器会话');
        return tx(async q => {
          const thread = await supportThread(q, viewer, true);
          if (thread) await q('UPDATE gateway_support_thread SET expires=?,reset_owner=NULL,reset_version=NULL,reset_until=NULL WHERE space=? AND id=?',
            [now(), space, thread.id]);
        });
      },
      list() {
        return tx(async q => (await q(`SELECT t.id,t.updated,t.expires,t.owner,t.resolved,t.last_sender,m.text AS preview,u.username
          FROM gateway_support_thread t JOIN gateway_support_message m ON m.thread=t.id AND m.seq=t.message_count
          LEFT JOIN gateway_user u ON u.id=t.owner AND u.space=t.space
          WHERE t.space=? ORDER BY t.updated DESC,t.id LIMIT 100`, [space])).map(row => ({
          id: row.id, updated: row.updated, username: row.username, preview: row.preview,
          status: supportStatus(row), scope: row.owner ? 'account' : 'guest'
        })));
      },
      detail(id) {
        return tx(async q => {
          const [thread] = await q(supportById, [space, id]);
          if (!thread) throw fail(404, '会话不存在');
          return supportDetails(q, thread, { admin: true });
        });
      },
      reply(id, value) {
        const text = supportMessage(value);
        return tx(async q => {
          const [thread] = await q(supportById + lock, [space, id]);
          if (!thread) throw fail(404, '会话不存在');
          if (supportStatus(thread) === 'expired') throw fail(409, '该访客会话已结束或过期');
          return addSupportMessage(q, id, 'admin', text);
        });
      },
      resolve(id) {
        return tx(async q => {
          const [thread] = await q(supportById + lock, [space, id]);
          if (!thread) throw fail(404, '会话不存在');
          if (supportStatus(thread) === 'expired') throw fail(409, '该访客会话已结束或过期');
          const resolved = now();
          await q('UPDATE gateway_support_thread SET resolved=?,updated=? WHERE space=? AND id=?', [resolved, resolved, space, id]);
          return supportDetails(q, { ...thread, resolved }, { admin: true });
        });
      },
      authorizeReset(id, name) {
        const requested = username(name);
        return tx(async q => {
          const [thread] = await q(supportById + lock, [space, id]);
          if (!thread) throw fail(404, '会话不存在');
          if (supportStatus(thread) === 'expired') throw fail(409, '该访客会话已结束或过期');
          const [user] = await q(lookup, [space, requested]);
          if (!user || !user.enabled) throw fail(404, '没有找到已启用的普通用户');
          if (thread.owner && thread.owner !== user.id) throw fail(403, '只能为该会话所属的账号授权重置');
          const deadline = Date.now() + supportResetTtl;
          const expires = new Date(thread.owner ? deadline : Math.min(Date.parse(thread.expires), deadline)).toISOString();
          await q('UPDATE gateway_support_thread SET reset_owner=?,reset_version=?,reset_until=? WHERE space=? AND id=?',
            [user.id, user.recovery, expires, space, id]);
          return { owner: user.id, reset: { username: user.username, expires } };
        });
      },
      async reset(viewer, password) {
        if (!viewer.owner && !supportToken(viewer.token)) throw fail(403, '重置授权无效或已过期');
        const pass = await hashPassword(password);
        const recoveryCode = randomToken();
        return tx(async q => {
          const thread = await supportThread(q, viewer, true);
          if (!thread?.reset_owner || !thread.reset_until || thread.reset_until <= now() || (viewer.owner && thread.reset_owner !== viewer.owner))
            throw fail(403, '重置授权无效或已过期');
          const [user] = await q(`UPDATE gateway_user SET pass=?,recovery=? WHERE space=? AND id=? AND recovery=? AND enabled=1
            RETURNING id`, [pass, tokenHash(recoveryCode), space, thread.reset_owner, thread.reset_version]);
          if (!user) throw fail(403, '重置授权无效或已过期');
          await revokeAccess(q, user.id);
          await q('UPDATE gateway_support_thread SET reset_owner=NULL,reset_version=NULL,reset_until=NULL WHERE space=? AND id=?',
            [space, thread.id]);
          return { owner: user.id, threadId: thread.id, recoveryCode };
        });
      }
    },
    async register(body) {
      const name = username(body.username),
        pass = await hashPassword(body.password);
      const user = { id: randomUUID(), username: name },
        recoveryCode = randomToken();
      return tx(async (q) => {
        const rows = await q(
          `INSERT INTO gateway_user(id,space,username,pass,recovery,created) VALUES(?,?,?,?,?,?)
          ON CONFLICT(space,username) DO NOTHING RETURNING id`,
          [user.id, space, name, pass, tokenHash(recoveryCode), now()]
        );
        if (!rows.length) throw fail(409, '用户名已被使用');
        return { ...(await newSession(q, user)), recoveryCode };
      });
    },
    async login(body) {
      const name = username(body.username);
      const [record] = await tx((q) => q(lookup, [space, name]));
      const valid = await verify(body.password, record?.pass);
      if (!valid || !record?.enabled) throw fail(401, '用户名或密码错误，或账户已停用');
      return tx(async (q) => {
        const [current] = await q(lookup + lock, [space, name]);
        if (!current?.enabled || current.pass !== record.pass) throw fail(401, '登录信息已失效');
        return newSession(q, current);
      });
    },
    async recover(body) {
      const name = username(body.username);
      if (typeof body.recoveryCode !== 'string' || body.recoveryCode.length > 128) throw fail(400, '请填写恢复码');
      const pass = await hashPassword(body.password),
        recoveryCode = randomToken();
      return tx(async (q) => {
        const [user] = await q(
          `UPDATE gateway_user SET pass=?,recovery=? WHERE space=? AND username=? AND recovery=? AND enabled=1
          RETURNING id,username`,
          [pass, tokenHash(recoveryCode), space, name, tokenHash(body.recoveryCode.trim())]
        );
        if (!user) throw fail(403, '用户名或恢复码无效');
        await revokeAccess(q, user.id);
        return { ...(await newSession(q, user)), recoveryCode };
      });
    },
    session(token) {
      if (!token || token.length > 128) return null;
      return tx(
        async (q) =>
          (
            await q(
              `SELECT u.id,u.username FROM gateway_user_session s JOIN gateway_user u ON u.id=s.owner
        WHERE s.digest=? AND u.space=? AND u.enabled=1 AND s.expires>?`,
              [tokenHash(token), space, now()]
            )
          )[0]
      );
    },
    logout(token) {
      return tx((q) => q('DELETE FROM gateway_user_session WHERE digest=?', [tokenHash(token || '')]));
    },
    keys(owner) {
      return tx(async q => {
        const rows = await q('SELECT id,name,preview,created,model_group AS "modelGroup",sealed_secret IS NOT NULL AS "secretAvailable" FROM gateway_user_key WHERE owner=? ORDER BY created DESC', [owner]);
        return rows.map(row => ({ ...row, secretAvailable: Boolean(row.secretAvailable) }));
      });
    },
    hasGroupKeys(group) {
      return tx(async q => Boolean((await q(
        'SELECT 1 FROM gateway_user_key k JOIN gateway_user u ON u.id=k.owner WHERE u.space=? AND k.model_group=? LIMIT 1',
        [space, group]
      )).length));
    },
    async keySecret(owner, id) {
      const [row] = await tx(q => q('SELECT sealed_secret FROM gateway_user_key WHERE owner=? AND id=?', [owner, id]));
      if (!row) throw fail(404, '没有找到该 Key');
      const secret = row.sealed_secret && await userKeyCodec?.open(row.sealed_secret);
      if (!secret) throw fail(409, '这把密钥的完整值无法读取，请更换密钥');
      return secret;
    },
    async createKey(owner, label, modelGroup = 'default') {
      const name = keyName(label);
      const {secret, digest, preview, sealed} = await issueKey();
      return tx(async (q) => {
        const [active] = await q('SELECT id FROM gateway_user WHERE id=? AND space=? AND enabled=1' + lock, [owner, space]);
        if (!active) throw fail(403, '账号已停用');
        const [count] = await q('SELECT COUNT(*) AS n FROM gateway_user_key WHERE owner=?', [owner]);
        if (Number(count.n) >= 20) throw fail(409, '每个用户最多可保留 20 个有效 Key');
        const id = randomUUID(), created = now();
        await q('INSERT INTO gateway_user_key(id,owner,name,digest,preview,created,model_group,sealed_secret) VALUES(?,?,?,?,?,?,?,?)',
          [id, owner, name, digest, preview, created, modelGroup, sealed]);
        return { id, name, preview, created, modelGroup, secretAvailable: Boolean(sealed), secret };
      });
    },
    renameKey(owner, id, label) {
      const name = keyName(label);
      return tx(async q => {
        const [row] = await q('UPDATE gateway_user_key SET name=? WHERE owner=? AND id=? RETURNING id', [name, owner, id]);
        if (!row) throw fail(404, '没有找到该 Key');
      });
    },
    async rotateKey(owner, id) {
      const {secret, digest, preview, sealed} = await issueKey();
      return tx(async q => {
        const [row] = await q('UPDATE gateway_user_key SET digest=?,preview=?,sealed_secret=? WHERE owner=? AND id=? RETURNING id,name,preview,created,model_group AS "modelGroup"',
          [digest, preview, sealed, owner, id]);
        if (!row) throw fail(404, '没有找到该 Key');
        return { ...row, secretAvailable: Boolean(sealed), secret };
      });
    },
    removeKey(owner, id) {
      return tx(async (q) => {
        const rows = await q('DELETE FROM gateway_user_key WHERE owner=? AND id=? RETURNING id', [owner, id]);
        if (!rows.length) throw fail(404, '没有找到该 Key');
      });
    },
    apiKey(token) {
      return tx(
        async (q) =>
          (
            await q(
              `SELECT k.id,k.owner,k.model_group AS "modelGroup",u.username FROM gateway_user_key k JOIN gateway_user u ON u.id=k.owner
        WHERE k.digest=? AND u.space=? AND u.enabled=1`,
              [tokenHash(token), space]
            )
          )[0]
      );
    },
    userMap(accountIds) {
      const ids = [...new Set(accountIds.filter(Boolean))];
      if (!ids.length) return Promise.resolve(new Map());
      return tx(async (q) => {
        const placeholders = ids.map(() => '?').join(',');
        const rows = await q(
          `SELECT id, username FROM gateway_user WHERE space=? AND id IN (${placeholders})`,
          [space, ...ids]
        );
        return new Map(rows.map(r => [r.id, r.username]));
      });
    },
    list(after) {
      return tx(async (q) => {
        const rows = await q(`SELECT u.id,u.username,u.enabled,u.created,CAST(COALESCE(w.balance,0) AS TEXT) AS units
          FROM gateway_user u LEFT JOIN gateway_cny_wallet w ON w.space=u.space AND w.owner=('user/' || u.id)
          WHERE u.space=? AND u.username>? ORDER BY u.username LIMIT 51`, [space, after]);
        return rows.map(({units,...user}) => ({...user,balance:yuanString(units)}));
      });
    },
    setEnabled(id, enabled) {
      return tx(async (q) => {
        const [row] = await q(
          'UPDATE gateway_user SET enabled=? WHERE space=? AND id=? RETURNING id,username,enabled',
          [enabled ? 1 : 0, space, id]
        );
        if (!row) throw fail(404, '没有找到该用户');
        if (!enabled) await q('DELETE FROM gateway_user_session WHERE owner=?', [id]);
        return row;
      });
    }
  };
}

import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { accountStore, accountTables } from './accounts.mjs';
import { MAX_TOPUP_FEN, PRICE_VERSION, YUAN, parseYuan, yuanString } from './cny-prices.mjs';

export function paymentError(status, message) {
  return Object.assign(new Error(message), { status });
}

export const CHECKOUT_CHANNEL = 'wechat';
const settingsTable = channel => channel === 'wechat' ? 'gateway_wechat_settings' : 'gateway_alipay_settings';

// PostgreSQL uses row locks. Local SQLite serializes writers across connections using BEGIN IMMEDIATE.
export async function openWalletStore(pool, file, space = 'default', userKeyCodec) {
  let db;
  let localQueue = Promise.resolve();
  if (!pool) {
    const { DatabaseSync } = await import('node:sqlite');
    await mkdir(dirname(file), { recursive: true });
    db = new DatabaseSync(file);
    db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
  }
  function transaction(work) {
    if (pool)
      return (async () => {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const query = async (sql, args = []) => {
            let n = 0;
            return (
              await client.query(
                sql.replace(/\?/g, () => '$' + ++n),
                args
              )
            ).rows;
          };
          const result = await work(query);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
      })();
    const result = localQueue.then(async () => {
      db.exec('BEGIN IMMEDIATE');
      try {
        const value = await work((sql, args = []) => db.prepare(sql).all(...args));
        db.exec('COMMIT');
        return value;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    });
    localQueue = result.catch(() => {});
    return result;
  }

  await transaction(async (q) => {
    if (pool) await q("SELECT pg_advisory_xact_lock(658473210)");
    await accountTables(q, Boolean(pool));
    for (const channel of ['wechat', 'alipay']) {
      const table = settingsTable(channel);
      await q('CREATE TABLE IF NOT EXISTS ' + table + ' (space TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, mime TEXT, image TEXT)');
      await q('INSERT INTO ' + table + '(space) VALUES(?) ON CONFLICT DO NOTHING', [space]);
    }
    await q(`CREATE TABLE IF NOT EXISTS gateway_cny_wallet (
      space TEXT NOT NULL, owner TEXT NOT NULL, balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0), closed INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(space,owner))`);
    await q(`CREATE TABLE IF NOT EXISTS gateway_cny_order (
      id TEXT PRIMARY KEY, space TEXT NOT NULL, owner TEXT NOT NULL, fen INTEGER CHECK(fen > 0),
      created TEXT NOT NULL, paid TEXT, receipt TEXT UNIQUE, channel TEXT NOT NULL)`);
    // Orders written before the channel was recorded were exclusively WeChat orders.
    if (pool) {
      await q("ALTER TABLE gateway_cny_order ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'wechat'");
    } else if (!(await q('PRAGMA table_info(gateway_cny_order)')).some(column => column.name === 'channel')) {
      await q("ALTER TABLE gateway_cny_order ADD COLUMN channel TEXT NOT NULL DEFAULT 'wechat'");
    }
    if (pool) {
      await q('ALTER TABLE gateway_cny_order ALTER COLUMN fen DROP NOT NULL');
    } else if ((await q('PRAGMA table_info(gateway_cny_order)')).find(column => column.name === 'fen')?.notnull) {
      await q('ALTER TABLE gateway_cny_order RENAME TO gateway_cny_order_before_nullable_amount');
      await q('CREATE TABLE gateway_cny_order (id TEXT PRIMARY KEY, space TEXT NOT NULL, owner TEXT NOT NULL, fen INTEGER CHECK(fen > 0), created TEXT NOT NULL, paid TEXT, receipt TEXT UNIQUE, channel TEXT NOT NULL)');
      await q('INSERT INTO gateway_cny_order(id,space,owner,fen,created,paid,receipt,channel) SELECT id,space,owner,fen,created,paid,receipt,channel FROM gateway_cny_order_before_nullable_amount');
      await q('DROP TABLE gateway_cny_order_before_nullable_amount');
    }
    if (pool) {
      await q('ALTER TABLE gateway_cny_order ADD COLUMN IF NOT EXISTS deleted TEXT');
    } else if (!(await q('PRAGMA table_info(gateway_cny_order)')).some(column => column.name === 'deleted')) {
      await q('ALTER TABLE gateway_cny_order ADD COLUMN deleted TEXT');
    }
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS gateway_cny_active_open_order
      ON gateway_cny_order(space,owner,channel) WHERE paid IS NULL AND deleted IS NULL AND fen IS NULL`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS gateway_cny_active_fixed_order
      ON gateway_cny_order(space,owner,fen,channel) WHERE paid IS NULL AND deleted IS NULL`);
    await q('DROP INDEX IF EXISTS gateway_cny_open_pending');
    await q('DROP INDEX IF EXISTS gateway_cny_channel_pending');
    await q('DROP INDEX IF EXISTS gateway_cny_pending');
    await q(`CREATE TABLE IF NOT EXISTS gateway_cny_charge (
      id TEXT PRIMARY KEY, space TEXT NOT NULL, owner TEXT NOT NULL, model TEXT NOT NULL, version TEXT NOT NULL,
      created TEXT NOT NULL, review_after TEXT NOT NULL, held BIGINT NOT NULL, actual BIGINT, charged BIGINT,
      state TEXT NOT NULL, detail TEXT)`);
    await q(`CREATE UNIQUE INDEX IF NOT EXISTS gateway_cny_active
      ON gateway_cny_charge(space,owner) WHERE state IN ('active','review')`);
    await q('CREATE INDEX IF NOT EXISTS gateway_cny_orders_owner ON gateway_cny_order(space,owner,created)');
    await q('CREATE INDEX IF NOT EXISTS gateway_cny_charges_owner ON gateway_cny_charge(space,owner,created)');
  });

  const lock = pool ? ' FOR UPDATE' : '';
  const now = () => new Date().toISOString();
  async function wallet(q, owner, allowClosed = false) {
    await q('INSERT INTO gateway_cny_wallet(space,owner) VALUES(?,?) ON CONFLICT DO NOTHING', [space, owner]);
    const [row] = await q(
      'SELECT CAST(balance AS TEXT) AS balance,closed FROM gateway_cny_wallet WHERE space=? AND owner=?' + lock,
      [space, owner]
    );
    if (row.closed && !allowClosed) throw paymentError(409, '这个钱包已关闭');
    return BigInt(row.balance);
  }
  const orders = 'SELECT id,fen,created,paid,channel FROM gateway_cny_order WHERE space=? AND owner=? AND deleted IS NULL';
  async function channelState(q, fileConfigured, forUpdate = false, channel = CHECKOUT_CHANNEL) {
    const [row] = await q('SELECT enabled,mime FROM ' + settingsTable(channel) + ' WHERE space=?' + (forUpdate ? lock : ''), [space]);
    const configured = Boolean(row.mime || fileConfigured);
    return { configured, enabled: Boolean(row.enabled && configured), uploaded: Boolean(row.mime) };
  }
  return {
    accounts: accountStore(transaction, space, lock, userKeyCodec),
    checkout(fileConfigured, channel = CHECKOUT_CHANNEL) {
      return transaction(q => channelState(q, fileConfigured, false, channel));
    },
    saveQr(mime, bytes, channel = CHECKOUT_CHANNEL) {
      return transaction(q => q('UPDATE ' + settingsTable(channel) + ' SET enabled=1,mime=?,image=? WHERE space=?', [mime, bytes.toString('base64'), space]));
    },
    setCheckout(enabled, fileConfigured, channel = CHECKOUT_CHANNEL) {
      return transaction(async q => {
        const state = await channelState(q, fileConfigured, true, channel);
        if (enabled && !state.configured) throw paymentError(400, '请先上传收款码');
        await q('UPDATE ' + settingsTable(channel) + ' SET enabled=? WHERE space=?', [enabled ? 1 : 0, space]);
      });
    },
    qr(fileImage, admin = false, channel = CHECKOUT_CHANNEL) {
      return transaction(async q => {
        const [row] = await q('SELECT enabled,mime,image FROM ' + settingsTable(channel) + ' WHERE space=?', [space]);
        if (!row.enabled && !admin) return null;
        return row.mime ? { type: row.mime, bytes: Buffer.from(row.image, 'base64') } : fileImage;
      });
    },
    receiptOrders(orderId, channel = CHECKOUT_CHANNEL, filter = 'pending') {
      return transaction(async q => {
        let condition = 'o.space=? AND o.channel=?';
        const params = [space, channel];
        if (orderId) {
          condition += ' AND o.id=?';
          params.push(orderId);
        } else if (filter === 'all') {
          // all orders: pending, paid, cancelled
        } else if (filter === 'paid') {
          condition += ' AND o.paid IS NOT NULL';
        } else if (filter === 'cancelled') {
          condition += ' AND o.deleted IS NOT NULL';
        } else {
          // default: pending orders awaiting verification
          condition += ' AND o.paid IS NULL AND o.deleted IS NULL';
        }
        return q(
          `SELECT o.id,o.fen,o.created,o.paid,o.deleted,o.owner,u.username
           FROM gateway_cny_order o
           LEFT JOIN gateway_user u ON u.id = o.owner
           WHERE ${condition}
           ORDER BY o.created DESC LIMIT 100`,
          params
        );
      });
    },
    cancelOrder(owner, id) {
      return transaction(async (q) => {
        const [order] = await q(
          'SELECT paid,receipt,deleted FROM gateway_cny_order WHERE space=? AND owner=? AND id=?',
          [space, owner, id]
        );
        if (!order) throw paymentError(404, '没有找到该订单');
        if (order.paid || order.receipt) throw paymentError(409, '已入账的订单不可取消');
        if (order.deleted) return { id, cancelled: true, repeated: true };
        await q('UPDATE gateway_cny_order SET deleted=? WHERE space=? AND owner=? AND id=?', [now(), space, owner, id]);
        return { id, cancelled: true };
      });
    },
    removeOrder(id, channel) {
      return transaction(async q => {
        const [removed] = await q(`UPDATE gateway_cny_order SET deleted=? WHERE space=? AND channel=? AND id=?
          AND paid IS NULL AND receipt IS NULL AND deleted IS NULL RETURNING id`, [now(), space, channel, id]);
        if (removed) return true;
        const [order] = await q('SELECT paid,receipt FROM gateway_cny_order WHERE space=? AND channel=? AND id=?', [space, channel, id]);
        if (!order) throw paymentError(404, '没有找到该订单');
        if (order.paid || order.receipt) throw paymentError(409, '已入账或已关联交易凭证的订单需保留对账记录');
        return false;
      });
    },
    retire(owner) {
      return transaction(async (q) => {
        const balance = await wallet(q, owner, true);
        const [pending] = await q(orders + ' AND paid IS NULL LIMIT 1', [space, owner]);
        if (balance || pending) throw paymentError(409, '此 Key 有余额或待核对订单，可暂停使用，请在完成对账后删除');
        await q('UPDATE gateway_cny_wallet SET closed=1 WHERE space=? AND owner=?', [space, owner]);
      });
    },
    async summary(owner, includeCancelled = false) {
      return transaction(async (q) => {
        const balance = await wallet(q, owner);
        const history = await q(
          `SELECT id,model,created,state,CAST(charged AS TEXT) AS units FROM gateway_cny_charge
          WHERE space=? AND owner=? ORDER BY created DESC LIMIT 20`,
          [space, owner]
        );
        const orderSql = includeCancelled
          ? 'SELECT id,fen,created,paid,channel,deleted FROM gateway_cny_order WHERE space=? AND owner=?'
          : orders;
        return {
          balance: yuanString(balance),
          orders: await q(orderSql + ' ORDER BY created DESC LIMIT 30', [space, owner]),
          charges: history.map(({ units, ...row }) => ({ ...row, amount: units === null ? null : yuanString(units) }))
        };
      });
    },
    async create(owner, fen, channel = CHECKOUT_CHANNEL, fileConfigured = false) {
      if (channel !== CHECKOUT_CHANNEL) throw paymentError(400, '目前新充值仅支持微信支付');
      if (fen != null) throw paymentError(400, '微信订单金额以实收为准，无需提交金额');
      return transaction(async (q) => {
        if (!(await channelState(q, fileConfigured, true)).enabled) throw paymentError(503, '微信收款尚未开放');
        await wallet(q, owner);
        const [pending] = await q(orders + ' AND fen IS NULL AND channel=? AND paid IS NULL', [space, owner, channel]);
        if (pending) return pending;
        const id = randomBytes(6).toString('hex').toUpperCase();
        const created = now();
        await q('INSERT INTO gateway_cny_order(id,space,owner,fen,created,channel) VALUES(?,?,?,?,?,?)', [
          id,
          space,
          owner,
          null,
          created,
          channel
        ]);
        return { id, fen: null, created, paid: null, channel };
      });
    },
    async confirm(channel, { orderId, amount, transactionId }) {
      if (channel !== 'alipay' && channel !== 'wechat') throw paymentError(400, '未知的收款渠道');
      const id = String(orderId || '')
        .trim()
        .toUpperCase();
      const number = typeof transactionId === 'string' ? transactionId.trim() : '';
      const units = parseYuan(amount);
      const actualFen = units ? units / (YUAN / 100n) : 0n;
      if (!/^[A-F0-9]{12}$/.test(id) || !/^\d{12,64}$/.test(number) || !units || actualFen > BigInt(MAX_TOPUP_FEN)) {
        throw paymentError(400, '请核对网站订单号、实收金额（元）和支付平台交易号');
      }
      // Legacy WeChat receipts are bare numbers. Keep the existing unique constraint and
      // namespace new receipts, as different providers can issue the same number.
      const receipt = channel === 'wechat' ? number : `alipay:${number}`;
      try {
        return await transaction(async (q) => {
          const [order] = await q(
            'SELECT owner,fen,paid,receipt,channel,deleted FROM gateway_cny_order WHERE space=? AND id=?' + lock,
            [space, id]
          );
          if (!order) throw paymentError(404, '没有找到该订单');
          if (order.channel !== channel) throw paymentError(409, '收款渠道与原订单不符');
          if (order.fen !== null && units !== BigInt(order.fen) * (YUAN / 100n)) throw paymentError(409, '实收金额与订单不符');
          if (order.paid && order.receipt !== receipt) throw paymentError(409, '该订单已使用其他交易单号入账');
          if (!order.paid) {
            // A verified late receipt can settle a deleted order if its wallet is still open.
            if (order.deleted) await wallet(q, order.owner);
            await q('UPDATE gateway_cny_order SET paid=?,receipt=?,fen=?,deleted=NULL WHERE id=?', [now(), receipt, Number(actualFen), id]);
            await q('UPDATE gateway_cny_wallet SET balance=balance+? WHERE space=? AND owner=?', [
              units.toString(),
              space,
              order.owner
            ]);
          }
          return { orderId: id, channel, amount: yuanString(units), credited: true, repeated: Boolean(order.paid) };
        });
      } catch (error) {
        if (error.code === '23505' || error.errcode === 2067) throw paymentError(409, '该渠道的交易号已用于其他订单');
        throw error;
      }
    },
    async begin(owner, model, deadlineMs, version = PRICE_VERSION, minimum = 0n) {
      return transaction(async (q) => {
        const balance = await wallet(q, owner);
        if (balance <= 0n) throw paymentError(402, '余额不足，请充值！');
        const [active] = await q(
          "SELECT state FROM gateway_cny_charge WHERE space=? AND owner=? AND state IN ('active','review')",
          [space, owner]
        );
        if (active)
          throw paymentError(
            409,
            active.state === 'review' ? '有一笔用量待管理员核对' : '该预付费 Key 有请求正在结算，请稍后重试'
          );
        if (balance < minimum) throw paymentError(402, '余额不足以覆盖本次预计用量，请减少输入或输出上限，或先充值');
        const id = randomUUID();
        await q(
          `INSERT INTO gateway_cny_charge(id,space,owner,model,version,created,review_after,held,state)
          VALUES(?,?,?,?,?,?,?,?,'active')`,
          [
            id,
            space,
            owner,
            model,
            version,
            now(),
            new Date(Date.now() + deadlineMs).toISOString(),
            balance.toString()
          ]
        );
        return id;
      });
    },
    async settle(id, actual, detail, manual = false) {
      return transaction(async (q) => {
        const [charge] = await q(
          'SELECT owner,state,review_after,CAST(held AS TEXT) AS held,CAST(charged AS TEXT) AS charged FROM gateway_cny_charge WHERE id=? AND space=?' +
            lock,
          [id, space]
        );
        if (!charge) throw paymentError(404, '找不到该笔调用');
        if (charge.state === 'settled') return yuanString(charge.charged);
        if (manual && charge.state === 'active' && charge.review_after > now())
          throw paymentError(409, '该调用尚未结束');
        if (actual === null) {
          await q("UPDATE gateway_cny_charge SET state='review',detail=? WHERE id=?", [JSON.stringify(detail), id]);
          return null;
        }
        const held = BigInt(charge.held);
        const debit = actual < held ? actual : held;
        await q('UPDATE gateway_cny_wallet SET balance=balance-? WHERE space=? AND owner=?', [
          debit.toString(),
          space,
          charge.owner
        ]);
        await q("UPDATE gateway_cny_charge SET state='settled',actual=?,charged=?,detail=? WHERE id=?", [
          actual.toString(),
          debit.toString(),
          JSON.stringify(detail),
          id
        ]);
        return yuanString(debit);
      });
    },
    chargeStates(ids) {
      if (!ids.length) return [];
      return transaction(async (q) => {
        const rows = await q(`SELECT id,state,version,CAST(charged AS TEXT) AS charged FROM gateway_cny_charge
          WHERE space=? AND id IN (${ids.map(() => '?').join(',')})`, [space, ...ids]);
        return rows.map(({ charged, ...row }) => ({ ...row, chargedCny: charged === null ? null : yuanString(charged) }));
      });
    },
    reviews() {
      return transaction((q) =>
        q(
          `SELECT id,owner,model,created,detail FROM gateway_cny_charge
        WHERE space=? AND (state='review' OR (state='active' AND review_after<=?)) ORDER BY created LIMIT 100`,
          [space, now()]
        )
      );
    },
    close() {
      db?.close();
    }
  };
}

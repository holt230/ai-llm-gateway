import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CNY_PRICES, parseYuan, usageCharge, yuanString } from './cny-prices.mjs';

assert.equal(
  yuanString(usageCharge(CNY_PRICES['gpt-6.2-sol'], { inputTokens: 272001, outputTokens: 1, cacheReadTokens: 1 }, 0)),
  '0.2720038'
);
assert.equal(usageCharge(CNY_PRICES['gpt-image-2'], null, 2), parseYuan('0.125', 3));
assert.equal(parseYuan('0.001'), null);
assert.equal(parseYuan('1e3'), null);
const temp = await mkdtemp(join(tmpdir(), 'gateway-wallet-'));
const token = 'test-only-wechat-shortcut-token-with-at-least-32-characters';
const legacyToken = 'test-only-previous-alipay-shortcut-token';
const alipayReceipt = '2026111922001400000000000001';
const alice = 'test-wallet-alice',
  bob = 'test-wallet-bob',
  admin = 'test-wallet-admin';
const configFile = join(temp, 'config.json'),
  qrFile = join(temp, 'qr.png');
// Upgrade a schema with mandatory amounts, preserving old unique indexes and raw receipts.
const legacyDb = new DatabaseSync(join(temp, 'wallet.db'));
legacyDb.exec(`
  CREATE TABLE gateway_cny_wallet (space TEXT, owner TEXT, balance BIGINT DEFAULT 0, closed INTEGER DEFAULT 0, PRIMARY KEY(space,owner));
  CREATE TABLE gateway_cny_order (id TEXT PRIMARY KEY,space TEXT,owner TEXT,fen INTEGER NOT NULL CHECK(fen > 0),created TEXT,paid TEXT,receipt TEXT UNIQUE,channel TEXT NOT NULL);
  CREATE UNIQUE INDEX gateway_cny_channel_pending ON gateway_cny_order(space,owner,fen,channel) WHERE paid IS NULL;
  INSERT INTO gateway_cny_wallet VALUES('default','legacy-owner',59000000000,0);
  INSERT INTO gateway_cny_order VALUES('AAAAAAAA0001','default','legacy-owner',590,'2026-11-01','2026-11-01','2026111922001400000000000001','wechat');
  INSERT INTO gateway_cny_order VALUES('AAAAAAAA0002','default','legacy-owner',590,'2026-11-02',NULL,NULL,'wechat');
  INSERT INTO gateway_cny_order VALUES('AAAAAAAA0003','default','legacy-owner',590,'2026-11-03',NULL,NULL,'alipay');
`);
const legacySupport = { id: '00000000-0000-0000-0000-000000000001', token: 'A'.repeat(43), created: '2000-01-01T00:00:00.000Z' };
legacyDb.exec(`
  CREATE TABLE gateway_support_thread (id TEXT PRIMARY KEY, space TEXT NOT NULL, digest TEXT NOT NULL UNIQUE,
    updated TEXT NOT NULL, expires TEXT NOT NULL, last_sender TEXT NOT NULL, message_count INTEGER NOT NULL DEFAULT 0,
    reset_owner TEXT, reset_version TEXT, reset_until TEXT);
  CREATE TABLE gateway_support_message (thread TEXT NOT NULL REFERENCES gateway_support_thread(id), seq INTEGER NOT NULL,
    sender TEXT NOT NULL, text TEXT NOT NULL, created TEXT NOT NULL, PRIMARY KEY(thread, seq));
`);
legacyDb.prepare('INSERT INTO gateway_support_thread(id,space,digest,updated,expires,last_sender,message_count) VALUES(?,?,?,?,?,?,?)')
  .run(legacySupport.id, 'default', createHash('sha256').update(legacySupport.token).digest('hex'), legacySupport.created,
    new Date(Date.now() + 86400000).toISOString(), 'user', 1);
legacyDb.prepare('INSERT INTO gateway_support_message(thread,seq,sender,text,created) VALUES(?,?,?,?,?)')
  .run(legacySupport.id, 1, 'user', 'Legacy guest: keep private', legacySupport.created);
legacyDb.close();
let upstreamCalls = 0;
let lastUpstreamBody;
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  upstreamCalls += 1;
  lastUpstreamBody = body;
  if (body.input === 'error') {
    res.writeHead(503);
    res.end();
    return;
  }
  if (body.stream) {
    assert.equal(body.stream_options.include_usage, true);
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[]}\n\n');
    await delay(75);
    res.end(
      'data: {"usage":{"prompt_tokens":1000,"prompt_tokens_details":{"cached_tokens":200},"completion_tokens":40}}\n\ndata: [DONE]\n\n'
    );
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body.input === 'missing' ? {} : { usage: { input_tokens: 1000, output_tokens: 100 } }));
  }
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const config = {
  auth: {
    internalApiKeys: [
      { id: 'admin', role: 'admin', key: admin, perMinute: 0 },
      { id: 'alice', role: 'service', key: alice, prepaid: true, perMinute: 0 },
      { id: 'legacy', role: 'service', key: 'legacy-test-key', walletId: 'legacy-owner', prepaid: true, perMinute: 0 },
      { id: 'bob', role: 'service', key: bob, prepaid: true, perMinute: 0 }
    ]
  },
  providers: {
    tests: { type: 'openai-compatible', apiKey: 'test', baseUrl: 'http://127.0.0.1:' + upstream.address().port }
  },
  models: {
    demo: { upstreamModel: 'gpt-6.2-sol', provider: 'tests', endpoints: ['chat', 'responses'], saasEnabled: true },
    internal: { upstreamModel: 'gpt-6.2-sol', provider: 'tests', endpoints: ['responses'] }
  },
  routing: { defaultModel: 'demo' }
};
await writeFile(configFile, JSON.stringify(config));
await writeFile(
  qrFile,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW0cAAAAASUVORK5CYII=', 'base64')
);
let child,
  base,
  output = '';
async function start(env = {}) {
  const portProbe = createServer().listen(0, '127.0.0.1');
  await once(portProbe, 'listening');
  const port = portProbe.address().port;
  await new Promise((resolve) => portProbe.close(resolve));
  base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['backend/server.mjs'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      AI_GW_PERSISTENCE: 'file',
      AI_GW_GATEWAY_CONFIG: configFile,
      AI_GW_SUPER_ADMIN_USERNAME: 'platform-operator',
      AI_GW_SUPER_ADMIN_PASSWORD: 'unified-login-operator-test-password',
      AI_GW_WECHAT_QR_FILE: qrFile,
      AI_GW_ALIPAY_RECEIPT_TOKEN: legacyToken,
      AI_GW_WECHAT_RECEIPT_TOKEN: token,
      AI_GW_GATEWAY_REQUEST_LOG: join(temp, 'req.log'),
      AI_GW_GATEWAY_AUDIT_LOG: join(temp, 'audit.log'),
      AI_GW_WALLET_FILE: join(temp, 'wallet.db'),
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (d) => {
      output += d;
    });
  await wait(async () => {
    try {
      return (await fetch(base + '/health')).ok;
    } catch {
      return false;
    }
  });
}
async function stop() {
  if (child && child.exitCode === null) {
    const done = once(child, 'exit');
    child.kill('SIGTERM');
    await done;
  }
}
async function wait(check) {
  for (let i = 0; i < 100; i++) {
    const result = await check();
    if (result) return result;
    await delay(25);
  }
  throw new Error('Timed out: ' + output);
}
function api(path, key, body, headers = {}) {
  return fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: 'Bearer ' + key, 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
}
async function ok(response) {
  const r = await response;
  const data = await r.json();
  assert.equal(r.ok, true, JSON.stringify(data));
  return data;
}
const account = (key) => ok(api('/payments/account', key));
const order = (key) => ok(api('/payments/orders', key, {}));
const confirm = (id, receipt, amount = '5.90', key = token) =>
  api('/payments/wechat/confirm', key, { channel: 'wechat', orderId: id, amount, transactionId: receipt });
const confirmAlipay = (orderId, transactionId, key = legacyToken) =>
  api('/payments/alipay/confirm', key, { orderId, amount: '5.90', transactionId });
const shortcutConfirm = (channel, key, orderId, amount, transactionId) =>
  api(`/payments/${channel}/confirm`, key, { channel, orderId, amount, transactionId }, { Accept: 'text/plain' });
try {
  await start({ AI_GW_ALIPAY_QR_FILE: qrFile, AI_GW_WECHAT_QR_FILE: '' });
  assert.equal((await ok(fetch(base + '/payments/info'))).enabled, false);
  assert.equal((await fetch(base + '/payments/alipay/qr')).status, 404);
  assert.equal((await api('/payments/orders', alice, {})).status, 503);
  await stop();
  await start();
  assert.equal((await ok(fetch(base + '/payments/info'))).channel, 'wechat');
  assert.equal((await fetch(base + '/payments/wechat/qr')).headers.get('content-type'), 'image/png');
  assert.equal((await api('/payments/orders', alice, { channel: 'alipay' })).status, 400);
  assert.equal((await api('/payments/orders', alice, { fen: 590 })).status, 400);
  const historical = await account('legacy-test-key');
  assert.equal(historical.balance, '5.90');
  assert.deepEqual(historical.orders.map((o) => o.channel).sort(), ['alipay', 'wechat', 'wechat']);
  const current = await order('legacy-test-key');
  assert.equal(current.channel, 'wechat');
  assert.equal(current.fen, null);
  assert.notEqual(current.id, 'AAAAAAAA0002');
  assert.equal((await confirm(current.id, alipayReceipt, '5.90', legacyToken)).status, 403);
  assert.equal((await confirmAlipay(current.id, alipayReceipt)).status, 409);
  assert.equal((await confirmAlipay('AAAAAAAA0002', alipayReceipt)).status, 409);
  assert.equal((await ok(confirm('AAAAAAAA0001', alipayReceipt))).repeated, true);
  const alipayShortcut = await shortcutConfirm('alipay', legacyToken, 'AAAAAAAA0003', '5.90', alipayReceipt);
  assert.equal(alipayShortcut.status, 200);
  assert.match(await alipayShortcut.text(), /入账成功/);
  assert.equal((await ok(confirmAlipay('AAAAAAAA0003', alipayReceipt))).repeated, true);
  assert.equal((await confirm('AAAAAAAA0002', '2345678901234567', '5.91')).status, 409);
  assert.equal((await ok(confirm('AAAAAAAA0002', '2345678901234567'))).channel, 'wechat');
  const wechatShortcut = await shortcutConfirm('wechat', token, current.id, '1.23', '9345678901234567');
  assert.equal(wechatShortcut.status, 200);
  assert.match(wechatShortcut.headers.get('content-type'), /^text\/plain/);
  assert.match(await wechatShortcut.text(), /入账成功[\s\S]*¥1\.23/);
  const repeatShortcut = await shortcutConfirm('wechat', token, current.id, '1.23', '9345678901234567');
  assert.equal(repeatShortcut.status, 200);
  assert.match(await repeatShortcut.text(), /未重复加余额/);
  const wrongChannel = await shortcutConfirm('alipay', legacyToken, current.id, '1.23', '9345678901234567');
  assert.equal(wrongChannel.status, 409);
  assert.match(await wrongChannel.text(), /本次未入账.*收款渠道/);
  assert.equal((await account('legacy-test-key')).balance, '18.93');
  assert.equal((await api('/v1/responses', alice, { model: 'demo', input: 'hi' })).status, 402);
  const [a, b] = await Promise.all([order(alice), order(bob)]);
  assert.equal(a.channel, 'wechat');
  assert.notEqual(a.id, b.id);
  assert.equal((await order(alice)).id, a.id);
  assert.equal((await confirm(a.id, '123456789012', '5.90', alice)).status, 403);
  assert.equal((await confirm(a.id, '123456789012', '5.001')).status, 400);
  const confirmations = await Promise.all([ok(confirm(a.id, '123456789012')), ok(confirm(a.id, '123456789012'))]);
  assert.deepEqual(confirmations.map((r) => r.repeated).sort(), [false, true]);
  assert.equal((await confirm(b.id, '123456789012')).status, 409);
  assert.equal((await account(alice)).balance, '5.90');
  assert.equal((await account(bob)).balance, '0.00');
  assert.deepEqual(
    (await account(alice)).orders.map((o) => o.id),
    [a.id]
  );
  await ok(api('/v1/responses', alice, { model: 'demo', input: 'hi' }));
  await wait(async () => (await account(alice)).balance === '5.89925');
  const streaming = await api('/v1/chat/completions', alice, { model: 'demo', stream: true, messages: [] });
  assert.equal(streaming.status, 200);
  assert.equal((await api('/v1/responses', alice, { model: 'demo', input: 'hi' })).status, 409);
  await streaming.text();
  await wait(async () => (await account(alice)).balance === '5.898745');
  assert.equal((await api('/v1/responses', alice, { model: 'demo', input: 'error' })).status, 503);
  await ok(api('/v1/responses', alice, { model: 'demo', input: 'missing' }));
  const review = await wait(async () => (await ok(api('/admin/payments/reviews', admin))).data[0]);
  assert.equal((await api('/v1/responses', alice, { model: 'demo', input: 'hi' })).status, 409);
  await ok(api('/admin/payments/reviews', admin, { id: review.id, amount: '0', reason: 'Test: no verified usage' }));
  await stop();
  await start();
  assert.equal((await ok(confirm(a.id, '123456789012'))).repeated, true);
  assert.equal((await account(alice)).balance, '5.898745');
  async function userApi(path, cookie, body, method) {
    return fetch(base + '/account-api/' + path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  const credentials = { username: 'customer_1', password: 'a-long-test-password' };
  assert.deepEqual(await ok(userApi('session')), { role: null, user: null });
  assert.equal((await userApi('register', null, { ...credentials, username: 'PLATFORM-OPERATOR' })).status, 409);
  const reg = await userApi('register', null, credentials);
  const cookie = reg.headers.get('set-cookie').split(';')[0];
  assert.match(reg.headers.get('set-cookie'), /HttpOnly/);
  const { user, recoveryCode, role } = await ok(reg);
  assert.equal(role, 'user');
  assert.equal((await ok(userApi('session', cookie))).role, 'user');
  assert.ok(recoveryCode.length >= 32);
  assert.equal((await userApi('register', null, credentials)).status, 409);
  const second = await userApi('register', null, { ...credentials, username: 'customer_2', role: 'admin' });
  const otherCookie = second.headers.get('set-cookie').split(';')[0];
  const other = await ok(second);
  assert.equal(other.role, 'user');
  assert.notEqual(user.id, other.user.id);
  const firstKey = await ok(userApi('keys', cookie, { name: 'laptop' }));
  assert.equal(firstKey.name, 'laptop');
  const secondKey = await ok(userApi('keys', cookie, { name: 'server' }));
  const otherKey = await ok(userApi('keys', otherCookie, { name: 'laptop' }));
  const me = await ok(userApi('me', cookie));
  assert.deepEqual(
    me.models.map((m) => m.id),
    ['demo']
  );
  assert.equal(JSON.stringify(me).includes(firstKey.secret), false);
  assert.equal((await userApi('keys/' + firstKey.id, otherCookie, null, 'DELETE')).status, 404);
  assert.equal((await api('/admin/users', firstKey.secret)).ok, false);
  assert.equal((await api('/v1/responses', firstKey.secret, { model: 'internal' })).status, 403);
  assert.deepEqual(
    (await ok(api('/v1/models', firstKey.secret))).data.map((m) => m.id),
    ['demo']
  );
  const wrongOrigin = await fetch(base + '/account-api/keys', {
    method: 'POST',
    headers: { cookie, origin: 'https://not-the-gateway.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'foreign origin' })
  });
  assert.equal(wrongOrigin.status, 403);
  const crossResource = await api('/v1/responses', firstKey.secret, {
    model: 'demo',
    previous_response_id: 'unowned',
    input: 'hi'
  });
  assert.equal(crossResource.status, 400);
  assert.equal((await userApi('orders', cookie, { fen: 590, channel: 'wechat' })).status, 400);
  const customerOrder = await ok(userApi('orders', cookie, { channel: 'wechat', owner: other.user.id }));
  assert.equal(customerOrder.channel, 'wechat');
  assert.equal(customerOrder.fen, null);
  assert.equal((await ok(userApi('keys/' + firstKey.id + '/secret', cookie))).secret, firstKey.secret);
  assert.equal((await userApi('keys/' + firstKey.id + '/secret', otherCookie)).status, 404);
  assert.equal((await userApi('keys/' + firstKey.id + '/rotate', otherCookie, {})).status, 404);
  await ok(confirm(customerOrder.id, '92345678901234'));
  assert.equal((await account(firstKey.secret)).balance, '5.90');
  assert.equal((await account(secondKey.secret)).balance, '5.90');
  assert.equal((await account(otherKey.secret)).balance, '0.00');
  assert.equal((await ok(userApi('wallet', otherCookie))).orders.length, 0);
  await ok(api('/v1/responses', firstKey.secret, { model: 'demo', input: 'hi' }));
  await wait(async () => (await account(secondKey.secret)).balance === '5.89925');
  const setStatus = (enabled) =>
    fetch(base + '/admin/users/' + user.id, {
      method: 'PUT',
      headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled })
    });
  await ok(setStatus(false));
  assert.equal((await userApi('me', cookie)).status, 401);
  assert.equal((await api('/v1/models', firstKey.secret)).status, 401);
  await ok(setStatus(true));
  assert.equal((await userApi('me', cookie)).status, 401);
  const newLogin = await userApi('login', null, credentials);
  const session = newLogin.headers.get('set-cookie').split(';')[0];
  await ok(newLogin);
  await stop();
  await start();
  assert.equal((await ok(userApi('me', session))).user.id, user.id);
  assert.equal((await ok(userApi('wallet', session))).balance, '5.89925');
  const replacedKey = await ok(userApi('keys/' + firstKey.id + '/rotate', session, {}));
  assert.equal(replacedKey.id, firstKey.id);
  assert.equal(replacedKey.modelGroup, firstKey.modelGroup);
  assert.notEqual(replacedKey.secret, firstKey.secret);
  assert.equal((await api('/v1/models', firstKey.secret)).status, 401);
  assert.equal((await ok(userApi('keys/' + firstKey.id + '/secret', session))).secret, replacedKey.secret);
  await ok(userApi('keys/' + firstKey.id, session, null, 'DELETE'));
  assert.equal((await api('/v1/models', firstKey.secret)).status, 401);
  await ok(
    userApi('recover', null, { username: credentials.username, password: 'new-long-test-password', recoveryCode })
  );
  assert.equal((await userApi('me', session)).status, 401);
  assert.equal((await api('/v1/models', secondKey.secret)).status, 401);
  assert.equal((await userApi('login', null, credentials)).status, 401);
  assert.equal((await userApi('recover', null, { ...credentials, recoveryCode })).status, 403);
  const adminLogin = await userApi('login', otherCookie, {
    username: 'platform-operator',
    password: 'unified-login-operator-test-password'
  });
  const adminCookie = adminLogin.headers
    .getSetCookie()
    .find((value) => value.startsWith('jl_admin_session='))
    .split(';')[0];
  assert.equal((await ok(adminLogin)).role, 'admin');
  assert.equal((await ok(userApi('session', adminCookie))).role, 'admin');
  assert.equal((await userApi('me', otherCookie)).status, 401);
  assert.equal((await fetch(base + '/admin/users', { headers: { cookie: adminCookie } })).status, 200);
  const switchToUser = await userApi('login', adminCookie, {
    ...credentials,
    password: 'new-long-test-password',
    role: 'admin'
  });
  const userCookie = switchToUser.headers
    .getSetCookie()
    .find((value) => value.startsWith('jl_user_session='))
    .split(';')[0];
  assert.equal((await ok(switchToUser)).role, 'user');
  assert.equal((await fetch(base + '/admin/users', { headers: { cookie: adminCookie } })).status, 401);
  assert.equal((await fetch(base + '/admin/users', { headers: { cookie: userCookie } })).ok, false);
  async function configure(path, data) {
    return ok(
      fetch(base + '/admin/' + path, {
        method: 'PUT',
        headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' },
        body: JSON.stringify(data)
      })
    );
  }
  await configure('providers/alternate', { type: 'mock', name: 'Alternate', modelGroup: '快速' });
  await configure('models/shared-group-demo', {
    provider: 'tests',
    upstreamModel: 'gpt-6.2-sol',
    endpoints: ['responses'],
    saasEnabled: true,
    fallbacks: [{ provider: 'alternate', upstreamModel: 'gpt-6.2-sol' }]
  });
  await configure('models/alternate-only', {
    provider: 'alternate',
    upstreamModel: 'gpt-6.2-sol',
    endpoints: ['responses'],
    saasEnabled: true
  });
  const listing = (await ok(userApi('me', userCookie))).models;
  assert.deepEqual(listing.find((m) => m.id === 'shared-group-demo').groups, ['default', '快速']);
  const standardKey = await ok(userApi('keys', userCookie, { name: 'standard' }));
  const alternateKey = await ok(userApi('keys', userCookie, { name: 'alternate', modelGroup: '快速' }));
  assert.equal(alternateKey.modelGroup, '快速');
  assert.equal((await userApi('keys', userCookie, { name: 'blocked', modelGroup: 'private' })).status, 400);
  assert.equal((await api('/v1/models/alternate-only', standardKey.secret)).status, 404);
  assert.equal((await api('/v1/responses', standardKey.secret, { model: 'alternate-only', input: 'hi' })).status, 403);
  assert.deepEqual((await ok(api('/v1/models', alternateKey.secret))).data.map((m) => m.id).sort(), [
    'alternate-only',
    'shared-group-demo'
  ]);
  assert.equal(
    (await api('/v1/responses', standardKey.secret, { model: 'shared-group-demo', input: 'error' })).status,
    503
  );
  const alternateCall = await ok(
    api('/v1/responses', alternateKey.secret, { model: 'shared-group-demo', input: 'error' })
  );
  assert.equal(alternateCall.model, 'shared-group-demo');
  assert.deepEqual((await ok(api('/v1/codex/models', alternateKey.secret))).models.map((m) => m.slug).sort(), [
    'alternate-only',
    'shared-group-demo'
  ]);
  assert.ok(!(await ok(api('/v1/codex/models', standardKey.secret))).models.some((m) => m.slug === 'alternate-only'));

  const deleteOperation = (path, params) => fetch(base + '/admin/' + path + '?' + new URLSearchParams(params), {
    method: 'DELETE', headers: { authorization: 'Bearer ' + admin }
  });
  const emptyGroups = await ok(api('/admin/model-groups', admin, { name: '待删除分组' }));
  const deletedGroupId = emptyGroups.data.find(group => group.name === '待删除分组').id;
  const remainingGroups = await ok(deleteOperation('model-groups', { id: deletedGroupId }));
  assert.ok(!remainingGroups.data.some(group => group.id === deletedGroupId));
  assert.equal((await deleteOperation('model-groups', { id: 'default' })).status, 409);
  assert.equal((await fetch(base + '/admin/providers/stale-group', {
    method: 'PUT', headers: { authorization: 'Bearer ' + admin, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'mock', modelGroup: deletedGroupId })
  })).status, 409);
  const removedPrice = 'gpt-image-2.5';
  const customPrice = 'unused-operator-price';
  await configure('cny-pricing', { model: customPrice, price: { image: 0.5 } });
  for (const model of [removedPrice, customPrice]) {
    assert.ok((await ok(fetch(base + '/payments/info'))).prices[model]);
    const remainingPrices = await ok(deleteOperation('cny-pricing', { model }));
    assert.equal(remainingPrices.prices[model], undefined);
    assert.equal((await ok(fetch(base + '/payments/info'))).prices[model], undefined);
  }

  // The same saved rate drives the public calculator and the real wallet ledger.
  const groupName = '运营测试组';
  const groupList = await ok(api('/admin/model-groups', admin, { name: groupName }));
  const managedGroup = groupList.data.find(group => group.name === groupName);
  assert.deepEqual(managedGroup.channels, []);
  assert.equal(managedGroup.modelCount, 0);
  assert.ok(!(await ok(userApi('me', userCookie))).models.some(model => model.groups.includes(managedGroup.id)));
  const model = 'operator-price-test';
  const unitPrice = { standard: { input: 2, output: 5, read: 0.1, write: null } };
  const pricingResult = await configure('cny-pricing', { model, price: unitPrice });
  assert.notEqual(pricingResult.version, '2026-11-19');
  assert.deepEqual((await ok(fetch(base + '/payments/info'))).prices[model], unitPrice);
  assert.equal((await fetch(base + '/admin/cny-pricing', { headers: { cookie: userCookie } })).ok, false);
  await configure('providers/operator-test', { type: 'mock', name: 'Operator test', modelGroup: managedGroup.id });
  await configure('models/' + model, {
    provider: 'operator-test', upstreamModel: model, endpoints: ['responses'], saasEnabled: true
  });
  assert.equal((await deleteOperation('model-groups', { id: managedGroup.id })).status, 409);
  assert.equal((await deleteOperation('cny-pricing', { model })).status, 409);
  assert.equal((await deleteOperation('cny-pricing', { model: 'gpt-6.2-sol' })).status, 409);
  const publishedGroups = await ok(api('/admin/model-groups', admin));
  assert.equal(publishedGroups.data.find(group => group.id === managedGroup.id).modelCount, 1);
  const managedKey = await ok(userApi('keys', userCookie, { modelGroup: managedGroup.id }));
  assert.equal(managedKey.name, groupName + ' Key');
  await configure('model-groups', { id: managedGroup.id, name: '已改名测试组' });
  assert.equal((await ok(userApi('session', userCookie))).groupLabels[managedGroup.id], '已改名测试组');
  assert.equal((await api('/v1/responses', standardKey.secret, { model, input: 'test' })).status, 403);
  const balanceBefore = Number((await account(managedKey.secret)).balance);
  const firstCall = await api('/v1/responses', managedKey.secret, { model, input: 'test' });
  const firstRequest = firstCall.headers.get('x-request-id');
  await ok(firstCall);
  const logPath = 'requests?q=' + firstRequest + '&status=success&limit=1';
  const firstLog = await wait(async () => (await ok(userApi(logPath, userCookie))).data[0]);
  assert.equal(firstLog.chargedCny, '0.000084');
  assert.equal(firstLog.priceVersion, pricingResult.version);
  assert.equal(firstLog.provider, undefined);
  assert.equal(firstLog.username, undefined);
  assert.equal(Number((await account(managedKey.secret)).balance), Number((balanceBefore - 0.000084).toFixed(10)));
  const outsider = await userApi('register', null, { username: 'operations_outsider', password: 'another-test-password' });
  const outsiderCookie = outsider.headers.get('set-cookie').split(';')[0];
  await ok(outsider);
  assert.deepEqual((await ok(userApi(logPath, outsiderCookie))).data, []);
  const keyPath = 'keys/' + managedKey.id;
  assert.equal((await userApi(keyPath, outsiderCookie, { name: 'Other user' }, 'PUT')).status, 404);
  assert.equal((await userApi(keyPath, userCookie, { name: '   ' }, 'PUT')).status, 400);
  assert.equal((await userApi(keyPath, userCookie, { name: 'a'.repeat(81) }, 'PUT')).status, 400);
  assert.equal((await fetch(base + '/account-api/' + keyPath, {
    method: 'PUT', headers: { cookie: userCookie, 'content-type': 'application/json', origin: 'https://untrusted.invalid' },
    body: JSON.stringify({ name: 'Untrusted origin' })
  })).status, 403);
  await ok(userApi(keyPath, userCookie, { name: '  工作电脑  ', modelGroup: 'default' }, 'PUT'));
  const renamed = (await ok(userApi('me', userCookie))).keys.find(key => key.id === managedKey.id);
  assert.equal(renamed.name, '工作电脑');
  assert.equal(renamed.modelGroup, managedKey.modelGroup);
  assert.equal(renamed.preview, managedKey.preview);
  assert.equal((await ok(userApi(keyPath + '/secret', userCookie))).secret, managedKey.secret);
  const newPrice = { standard: { ...unitPrice.standard, output: 12 } };
  const changedPrice = await configure('cny-pricing', { model, price: newPrice });
  assert.notEqual(pricingResult.version, changedPrice.version);
  await ok(api('/v1/responses', managedKey.secret, { model, input: 'test' }));
  const charges = await wait(async () => {
    const result = await ok(api('/admin/requests?q=' + model + '&status=success', admin));
    return result.data.length === 2 && result.data;
  });
  assert.deepEqual(charges.map(row => row.chargedCny), ['0.000168', '0.000084']);
  assert.equal(charges[0].provider, 'operator-test');
  assert.equal(charges[0].username, credentials.username);
  await configure('providers/operator-test', { modelGroup: 'default' });
  const keyConflict = await deleteOperation('model-groups', { id: managedGroup.id });
  assert.equal(keyConflict.status, 409);
  assert.match((await keyConflict.json()).error, /用户 Key/);
  await configure('providers/operator-test', { modelGroup: managedGroup.id });
  await ok(userApi('keys/' + managedKey.id, userCookie, null, 'DELETE'));
  assert.equal((await ok(userApi(logPath, userCookie))).total, 1);

  await ok(userApi('logout', userCookie, {}));
  assert.equal((await ok(userApi('session', userCookie))).role, null);
  // Complete the operator flow without a receipt shortcut or an environment-provided QR.
  await stop();
  // Simulate a log written before the gateway recorded usernames.
  const logFile = join(temp, 'req.log');
  const historicalLogs = (await readFile(logFile, 'utf8')).trimEnd().split('\n').map(line => {
    const entry = JSON.parse(line);
    if (entry.requestId === firstRequest) delete entry.username;
    return JSON.stringify(entry);
  });
  await writeFile(logFile, historicalLogs.join('\n') + '\n');
  await start({ AI_GW_WECHAT_QR_FILE: '', AI_GW_WECHAT_RECEIPT_TOKEN: '' });
  assert.equal((await ok(api('/admin/model-groups', admin))).data.find(group => group.id === managedGroup.id).name, '已改名测试组');
  const restartedPrices = (await ok(fetch(base + '/payments/info'))).prices;
  assert.deepEqual(restartedPrices[model], newPrice);
  assert.equal(restartedPrices[removedPrice], undefined);
  assert.equal(restartedPrices[customPrice], undefined);
  assert.ok(!(await ok(api('/admin/model-groups', admin))).data.some(group => group.id === deletedGroupId));
  const historicalRequestPage = await ok(api('/admin/requests?q=' + encodeURIComponent(credentials.username) + '&status=success', admin));
  const historicalCall = historicalRequestPage.data.find(row => row.requestId === firstRequest);
  assert.equal(historicalCall?.username, credentials.username);
  assert.equal(historicalCall?.chargedCny, '0.000084');
  console.log('SaaS operations passed: group lifecycle, price deletion and persistence, configured charges, and scoped logs');
  const channelPath = '/admin/payments/wechat/';
  const channelApi = (path, method, key, payload) =>
    fetch(base + channelPath + path, {
      method,
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': Buffer.isBuffer(payload) ? 'image/png' : 'application/json'
      },
      body: Buffer.isBuffer(payload) ? payload : payload ? JSON.stringify(payload) : undefined
    });
  assert.equal((await ok(api(channelPath + 'settings', admin))).configured, false);
  const qr = await readFile(qrFile);
  assert.equal((await channelApi('qr', 'PUT', alice, qr)).status, 403);
  assert.equal((await channelApi('qr', 'PUT', admin, Buffer.from('not an image'))).status, 400);
  await ok(channelApi('qr', 'PUT', admin, qr));
  assert.equal((await ok(api(channelPath + 'settings', admin))).shortcutConfigured, false);
  assert.deepEqual(Buffer.from(await (await fetch(base + '/payments/wechat/qr')).arrayBuffer()), qr);
  await stop();
  await start({ AI_GW_WECHAT_QR_FILE: '', AI_GW_WECHAT_RECEIPT_TOKEN: '' });
  assert.ok((await ok(fetch(base + '/payments/info'))).enabled);
  for (const fen of [0, -5, 0.5, '5917', 5917]) {
    assert.equal((await api('/payments/orders', bob, { fen })).status, 400);
  }
  const manualOrder = await ok(api('/payments/orders', bob, {}));
  assert.equal(manualOrder.fen, null);
  assert.equal((await ok(api('/payments/orders', bob, {}))).id, manualOrder.id);
  const awaiting = (await ok(api(channelPath + 'orders?id=' + manualOrder.id, admin))).orders;
  assert.equal(awaiting.length, 1);
  assert.equal(awaiting[0].paid, null);
  await ok(channelApi('settings', 'PUT', admin, { enabled: false }));
  assert.equal((await api('/payments/orders', bob, {})).status, 503);
  assert.equal((await fetch(base + '/payments/wechat/qr')).status, 404);
  assert.equal((await api(channelPath + 'qr', admin)).status, 200);
  const evidence = { orderId: manualOrder.id, amount: '59.17', transactionId: '2026111922001400009876543210' };
  assert.equal((await channelApi('confirm', 'POST', bob, evidence)).status, 403);
  assert.equal((await channelApi('confirm', 'POST', admin, { ...evidence, amount: '5.901' })).status, 400);
  const verified = await Promise.all([
    ok(channelApi('confirm', 'POST', admin, evidence)),
    ok(channelApi('confirm', 'POST', admin, evidence))
  ]);
  assert.deepEqual(verified.map((item) => item.repeated).sort(), [false, true]);
  assert.equal((await account(bob)).balance, '59.17');
  assert.equal((await channelApi('confirm', 'POST', admin, { ...evidence, amount: '5.90' })).status, 409);
  assert.ok((await ok(api(channelPath + 'orders?id=' + manualOrder.id, admin))).orders[0].paid);
  await ok(channelApi('settings', 'PUT', admin, { enabled: true }));
  assert.ok((await ok(fetch(base + '/payments/info'))).enabled);
  assert.equal((await channelApi('orders?id=' + manualOrder.id, 'DELETE', admin)).status, 409);
  const staleOrder = await order(bob);
  const staleLookup = 'orders?id=' + staleOrder.id;
  assert.equal((await channelApi(staleLookup, 'DELETE', bob)).status, 403);
  assert.equal((await fetch(base + '/admin/payments/alipay/' + staleLookup, {
    method: 'DELETE', headers: { authorization: 'Bearer ' + admin }
  })).status, 404);
  await ok(channelApi(staleLookup, 'DELETE', admin));
  await ok(channelApi(staleLookup, 'DELETE', admin));
  assert.equal((await account(bob)).balance, '59.17');
  assert.ok(!(await account(bob)).orders.some(row => row.id === staleOrder.id));
  assert.ok(!(await ok(api(channelPath + 'orders', admin))).orders.some(row => row.id === staleOrder.id));
  assert.ok((await ok(api(channelPath + staleLookup, admin))).orders[0].deleted);
  assert.notEqual((await order(bob)).id, staleOrder.id);
  const lateEvidence = { orderId: staleOrder.id, amount: '1.00', transactionId: '2026111922001400009876543211' };
  assert.equal((await ok(channelApi('confirm', 'POST', admin, lateEvidence))).repeated, false);
  assert.equal((await ok(channelApi('confirm', 'POST', admin, lateEvidence))).repeated, true);
  assert.equal((await account(bob)).balance, '60.17');
  assert.ok((await account(bob)).orders.find(row => row.id === staleOrder.id).paid);
  console.log(
    'WeChat console passed: upload, persistence, pause, deletion, late payments and no double credit'
  );
  for (const name of ['WechatReceipt', 'AlipayReceipt']) {
    const shortcut = await fetch(base + `/shortcuts/${name}.shortcut`);
    assert.equal(shortcut.status, 200);
    assert.equal(shortcut.headers.get('content-disposition'), `attachment; filename="${name}.shortcut"`);
    assert.equal(shortcut.headers.get('cache-control'), 'no-store');
    assert.equal(Buffer.from(await shortcut.arrayBuffer()).subarray(0, 4).toString(), 'AEA1');
  }
  console.log(
    'SaaS tests passed: registration, session persistence, shared user wallet, tenant isolation, model access, suspension, revocation and recovery'
  );
  console.log('model groups passed: grouped catalog, key scope, same-alias routing and failover isolation');
  console.log('wallet HTTP tests passed: ownership, concurrent receipts, CNY rates, streaming, review, persistence');

  const supportCredentials = { username: 'support_recovery_user', password: 'support-test-original-password' };
  const registration = await userApi('register', null, supportCredentials);
  const oldSession = registration.headers.getSetCookie()[0].split(';')[0];
  const registered = await ok(registration);
  const oldKey = await ok(userApi('keys', oldSession, { modelGroup: managedGroup.id }));
  const beforeReset = await ok(userApi('wallet', oldSession));
  const startConversation = await userApi('support', null, { message: 'Fixture: account recovery requested' });
  const supportCookie = startConversation.headers.getSetCookie()[0];
  assert.match(supportCookie, /HttpOnly; SameSite=Lax/);
  const visitor = supportCookie.split(';')[0];
  const { data: startedThread } = await ok(startConversation);
  const threadId = startedThread.id;
  assert.equal(startedThread.reset, null);
  assert.equal((await ok(userApi('support', null))).data, null);
  assert.equal((await fetch(base + '/admin/support')).status, 401);
  assert.equal((await userApi('support/reset', visitor, { password: 'not-authorized-password' })).status, 403);
  assert.equal((await ok(api('/admin/support', admin))).data[0].id, threadId);
  await ok(api('/admin/support/' + threadId, admin, { message: 'Fixture: reply from support' }));
  assert.deepEqual((await ok(userApi('support', visitor))).data.messages.map(m => m.sender), ['user', 'admin']);
  const legacyVisitor = 'jl_support=' + legacySupport.token;
  assert.equal((await ok(userApi('support', legacyVisitor))).data.id, legacySupport.id);
  assert.equal((await ok(userApi('support', oldSession + '; ' + legacyVisitor))).data, null);
  const sharedBrowserA = oldSession + '; ' + visitor;
  assert.equal((await ok(userApi('support', sharedBrowserA))).data, null);
  const aCreated = await userApi('support', sharedBrowserA, { message: 'Private to account A' });
  assert.equal(aCreated.headers.getSetCookie().length, 0);
  const { data: threadA } = await ok(aCreated);
  assert.equal(threadA.scope, 'account');
  assert.notEqual(threadA.id, threadId);
  assert.equal((await ok(userApi('support', oldSession))).data.id, threadA.id);
  const bCredentials = { username: 'support_second_user', password: 'support-second-user-password' };
  const bRegistered = await userApi('register', null, bCredentials);
  const sessionB = bRegistered.headers.getSetCookie()[0].split(';')[0];
  await ok(bRegistered);
  const sharedBrowserB = sessionB + '; ' + visitor;
  assert.equal((await ok(userApi('support?summary=true', sharedBrowserB))).data, null);
  const { data: threadB } = await ok(userApi('support', sharedBrowserB, { message: 'Private to account B' }));
  assert.notEqual(threadB.id, threadA.id);
  assert.notEqual(threadB.id, threadId);
  assert.equal((await ok(userApi('support', visitor))).data.id, threadId);
  const operator = await userApi('login', null, { username: 'platform-operator', password: 'unified-login-operator-test-password' });
  const operatorCookie = operator.headers.getSetCookie().find(value => value.startsWith('jl_admin_session=')).split(';')[0];
  assert.equal((await ok(operator)).role, 'admin');
  const consoleCall = (path, body) => fetch(base + path, {
    method: body ? 'POST' : 'GET', headers: { cookie: operatorCookie, origin: base, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const { data: inbox } = await ok(consoleCall('/admin/support'));
  assert.equal(inbox.find(row => row.id === threadA.id).username, supportCredentials.username);
  const { data: replied } = await ok(consoleCall('/admin/support/' + threadA.id, { message: 'Console reply to account A' }));
  assert.equal(replied.status, 'replied');
  const { data: unread } = await ok(userApi('support?summary=true', sharedBrowserA));
  assert.equal(unread.unread, true);
  assert.equal(unread.messages, undefined);
  assert.equal((await ok(userApi('support', sharedBrowserA))).data.messages[1].text, 'Console reply to account A');
  assert.equal((await ok(userApi('support', sharedBrowserB))).data.messages.length, 1);
  await ok(userApi('support/read', sharedBrowserA, { seq: unread.latestSeq }));
  assert.equal((await ok(userApi('support?summary=true', sharedBrowserA))).data.unread, false);
  assert.equal((await consoleCall('/admin/support/' + threadA.id + '/reset', { username: bCredentials.username })).status, 403);
  const { data: resolved } = await ok(consoleCall('/admin/support/' + threadA.id + '/resolve', {}));
  assert.equal(resolved.status, 'resolved');
  assert.equal((await ok(userApi('support', sharedBrowserA))).data.status, 'resolved');
  assert.equal((await ok(userApi('support', sharedBrowserA, { message: 'Follow-up from A' }))).data.status, 'pending');
  assert.equal((await userApi('support/end', sharedBrowserA, {})).status, 403);
  const ended = await userApi('support/end', legacyVisitor, {});
  assert.match(ended.headers.getSetCookie()[0], /Max-Age=0/);
  await ok(ended);
  assert.equal((await ok(userApi('support', legacyVisitor))).data, null);
  assert.equal((await consoleCall('/admin/support/' + legacySupport.id, { message: 'Cannot reply to an ended guest thread' })).status, 409);
  console.log('Support ownership tests passed: legacy guest isolation, account switching, console replies, unread and resolution');

  const approver = '/admin/support/' + threadId + '/reset';
  assert.equal((await fetch(base + approver, {
    method: 'POST', headers: { cookie: oldSession, 'content-type': 'application/json' }, body: JSON.stringify(supportCredentials)
  })).status, 401);
  assert.equal((await fetch(base + approver, {
    method: 'POST', headers: { Authorization: 'Bearer ' + admin, origin: 'https://untrusted.invalid', 'content-type': 'application/json' },
    body: JSON.stringify({ username: supportCredentials.username })
  })).status, 403);
  await ok(api(approver, admin, { username: supportCredentials.username }));
  assert.equal((await ok(userApi('support', visitor))).data.reset.username, supportCredentials.username);
  const supportDb = new DatabaseSync(join(temp, 'wallet.db'));
  supportDb.prepare('UPDATE gateway_support_thread SET reset_until=? WHERE id=?').run('2000-01-01T00:00:00.000Z', threadId);
  supportDb.close();
  assert.equal((await ok(userApi('support', visitor))).data.reset, null);
  assert.equal((await userApi('support/reset', visitor, { password: 'expired-reset-test-password' })).status, 403);
  await ok(api(approver, admin, { username: supportCredentials.username }));
  const newSupportPassword = 'support-new-password-only-for-tests';
  assert.equal((await userApi('support/reset', null, { password: newSupportPassword })).status, 403);
  const attempts = await Promise.all([1, 2].map(() => userApi('support/reset', visitor, { password: newSupportPassword })));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 403]);
  const afterRecovery = await ok(attempts.find(r => r.ok));
  assert.ok(afterRecovery.recoveryCode && afterRecovery.recoveryCode !== registered.recoveryCode);
  assert.equal((await ok(userApi('support', visitor))).data.reset, null);
  assert.equal((await ok(userApi('session', oldSession))).role, null);
  assert.equal((await api('/v1/models', oldKey.secret)).status, 401);
  assert.equal((await userApi('login', null, supportCredentials)).status, 401);
  const nextSession = await userApi('login', null, { ...supportCredentials, password: newSupportPassword });
  assert.equal((await ok(nextSession)).user.id, registered.user.id);
  assert.equal((await ok(userApi('wallet', nextSession.headers.getSetCookie()[0].split(';')[0]))).balance, beforeReset.balance);
  console.log('Support HTTP tests passed: private replies, admin authorization, expiry, single use, revocation and balance preservation');

  const budgetKey = await ok(api('/admin/api-keys', admin, { name: 'Budget fixture', role: 'service', prepaid: true }));
  const budgetOrder = await order(budgetKey.secret);
  await ok(channelApi('confirm', 'POST', admin, { orderId: budgetOrder.id, amount: '0.01', transactionId: '20261120123456789001' }));
  const priorCalls = upstreamCalls;
  assert.equal((await api('/v1/responses', budgetKey.secret, { model: 'demo', input: 'small request' })).status, 402);
  assert.equal((await api('/v1/responses', budgetKey.secret, { model: 'demo', input: 'small request', max_output_tokens: 32769 })).status, 400);
  assert.equal((await api('/v1/responses', budgetKey.secret, { model: 'demo', input: 'small request', tools: [{ type: 'web_search' }] })).status, 422);
  assert.equal(upstreamCalls, priorCalls);
  assert.equal((await account(budgetKey.secret)).balance, '0.01');
  await ok(api('/v1/responses', budgetKey.secret, { model: 'demo', input: 'small request', max_output_tokens: 128 }));
  assert.equal(lastUpstreamBody.max_output_tokens, 128);
  await wait(async () => (await account(budgetKey.secret)).balance === '0.00925');
  await ok(api('/v1/chat/completions', alice, { model: 'demo', messages: [] }));
  assert.equal(lastUpstreamBody.max_completion_tokens, 4096);
  console.log('Prepaid budget tests passed: insufficient balance stops before upstream; explicit and default output limits forwarded');


} finally {
  await stop();
  await new Promise((resolve) => upstream.close(resolve));
  await rm(temp, { recursive: true, force: true });
}

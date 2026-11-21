import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempDir = await mkdtemp(join(tmpdir(), 'jetlinkapi-security-test-'));
const port = 19_901 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const configPath = join(tempDir, 'gateway.config.json');
const requestLogPath = join(tempDir, 'requests.jsonl');
const auditLogPath = join(tempDir, 'audit.jsonl');
const allowedOrigin = 'http://console.jetlinks.local';
const runtimePublicBaseUrl = 'https://runtime-gateway.jetlinks.local';
const backendOnly = process.argv.includes('--backend-only');

const config = {
  server: { host: '127.0.0.1', port },
  publicBaseUrl: 'https://ai-gw.jetlinks.cn',
  auth: {
    internalApiKeys: [
      { id: 'admin-dev', key: 'dev-internal-key', role: 'admin' },
      {
        id: 'admin-security',
        name: 'Security Admin',
        key: 'admin-test-key',
        role: 'admin',
        enabled: true,
        perMinute: 1000,
        allowedModels: ['*'],
        allowedEndpoints: ['*']
      },
      {
        id: 'service-security',
        name: 'Security Service',
        key: 'service-test-key',
        role: 'service',
        enabled: true,
        perMinute: 1000,
        allowedModels: ['jetlink-chat'],
        allowedEndpoints: ['chat']
      }
    ]
  },
  providers: {
    mock: { name: 'Mock Provider', type: 'mock' }
  },
  models: {
    'jetlink-chat': {
      provider: 'mock',
      upstreamModel: 'gpt-security',
      enabled: true,
      endpoints: ['chat']
    }
  },
  routing: {
    defaultModel: 'jetlink-chat',
    failoverStatusCodes: [429, 500, 502, 503, 504],
    failoverOnNetworkError: true
  },
  pricing: { currency: 'USD', models: {} },
  limits: {
    maxInFlightRequests: 20,
    maxInFlightPerApiKey: 10,
    maxInFlightPerProvider: 10,
    maxInFlightPerModel: 10,
    maxQueuedRequests: 0,
    queueTimeoutMs: 100,
    gracefulShutdownTimeoutMs: 5000
  },
  security: {
    maxBodyBytes: 128,
    corsOrigins: [allowedOrigin]
  }
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const child = spawn(process.execPath, ['backend/server.mjs'], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    NODE_ENV: 'production',
    AI_GW_PERSISTENCE: 'file',
    AI_GW_GATEWAY_CONFIG: configPath,
    AI_GW_GATEWAY_REQUEST_LOG: requestLogPath,
    AI_GW_GATEWAY_AUDIT_LOG: auditLogPath,
    AI_GW_API_KEY_PEPPER: 'security-test-pepper',
    AI_GW_SUPER_ADMIN_USERNAME: 'admin',
    AI_GW_SUPER_ADMIN_PASSWORD: 'Security-Test-Password-2026',
    AI_GW_SUPER_ADMIN_NAME: 'Security Admin',
    AI_GW_PUBLIC_BASE_URL: runtimePublicBaseUrl,
    AI_GW_ADMIN_LOGIN_PER_MINUTE: '5',
    AI_GW_SERVE_FRONTEND: backendOnly ? 'false' : 'true'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', (chunk) => {
  output += chunk.toString();
});
child.stderr.on('data', (chunk) => {
  output += chunk.toString();
});

try {
  await waitForReady();

  const publicHealth = await raw('/health', { origin: allowedOrigin });
  assert.equal(publicHealth.status, 200);
  assert.equal(publicHealth.headers.get('access-control-allow-origin'), allowedOrigin);
  assert.match(publicHealth.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
  assert.equal(publicHealth.headers.get('x-frame-options'), 'DENY');
  assert.equal(publicHealth.headers.get('x-content-type-options'), 'nosniff');
  assert.match(publicHealth.headers.get('permissions-policy') || '', /geolocation=\(\)/);
  assert.deepEqual(await publicHealth.json(), { ok: true });

  const blockedCors = await raw('/health', { origin: 'http://evil.example' });
  assert.equal(blockedCors.status, 200);
  assert.equal(blockedCors.headers.get('access-control-allow-origin'), null);

  const runtimeCors = await raw('/health', { origin: runtimePublicBaseUrl });
  assert.equal(runtimeCors.status, 200);
  assert.equal(runtimeCors.headers.get('access-control-allow-origin'), runtimePublicBaseUrl);

  const appConfig = await json('/app-config');
  assert.equal(appConfig.publicBaseUrl, runtimePublicBaseUrl);
  assert.equal(JSON.stringify(appConfig).includes('internalApiKeys'), false);
  assert.equal(JSON.stringify(appConfig).includes('providers'), false);

  const publicReady = await raw('/ready');
  assert.equal(publicReady.status, 200);
  assert.deepEqual(await publicReady.json(), { ok: true });

  const healthWithConflictingCredentials = await raw('/health', {
    apiKey: 'admin-test-key',
    headers: { 'x-api-key': 'service-test-key' }
  });
  assert.equal(healthWithConflictingCredentials.status, 400);

  const publicMetrics = await raw('/metrics');
  assert.equal(publicMetrics.status, 401);

  const serviceMetrics = await raw('/metrics', { apiKey: 'service-test-key' });
  assert.equal(serviceMetrics.status, 403);

  const adminMetrics = await raw('/metrics', { apiKey: 'admin-test-key' });
  assert.equal(adminMetrics.status, 200);
  assert.match(await adminMetrics.text(), /jetlinkapi_gateway_requests_total/);

  const noAuthAdmin = await raw('/admin/models');
  assert.equal(noAuthAdmin.status, 401);

  const disabledDevKey = await raw('/admin/models', { apiKey: 'dev-internal-key' });
  assert.equal(disabledDevKey.status, 401);

  const serviceCannotAdmin = await raw('/admin/models', { apiKey: 'service-test-key' });
  assert.equal(serviceCannotAdmin.status, 403);

  const conflictingCredentialHeaders = await raw('/admin/models', {
    apiKey: 'admin-test-key',
    headers: { 'x-api-key': 'service-test-key' }
  });
  assert.equal(conflictingCredentialHeaders.status, 400);

  const repeatedBearerHeader = await raw('/admin/models', {
    headers: { authorization: 'Bearer admin-test-key, Bearer service-test-key' }
  });
  assert.equal(repeatedBearerHeader.status, 400);

  const repeatedApiKeyHeader = await raw('/admin/models', {
    headers: { 'x-api-key': 'admin-test-key,service-test-key' }
  });
  assert.equal(repeatedApiKeyHeader.status, 400);

  const adminModels = await json('/admin/models', { apiKey: 'admin-test-key' });
  assert.equal(adminModels.data['jetlink-chat'].upstreamModel, 'gpt-security');

  const adminConfig = await json('/admin/config', { apiKey: 'admin-test-key' });
  assert.equal(adminConfig.publicBaseUrl, runtimePublicBaseUrl);
  assert.equal(adminConfig.auth.superAdmin.passwordConfigured, true);
  assert.equal(JSON.stringify(adminConfig).includes('passwordHash'), false);

  const publicModels = await json('/v1/models', { apiKey: 'service-test-key' });
  assert.deepEqual(publicModels.data.map((item) => item.id), ['jetlink-chat']);
  const publicModelsText = JSON.stringify(publicModels);
  assert.equal(publicModelsText.includes('provider'), false);
  assert.equal(publicModelsText.includes('upstream_model'), false);
  assert.equal(publicModelsText.includes('routes'), false);
  assert.equal(publicModelsText.includes('gpt-security'), false);
  assert.equal(publicModelsText.includes('mock'), false);

  const publicModelDetail = await json('/v1/models/jetlink-chat', { apiKey: 'service-test-key' });
  const publicModelDetailText = JSON.stringify(publicModelDetail);
  assert.equal(publicModelDetail.id, 'jetlink-chat');
  assert.equal(publicModelDetailText.includes('provider'), false);
  assert.equal(publicModelDetailText.includes('upstream_model'), false);
  assert.equal(publicModelDetailText.includes('routes'), false);
  assert.equal(publicModelDetailText.includes('gpt-security'), false);

  const serviceProxy = await raw('/v1/chat/completions', {
    apiKey: 'service-test-key',
    method: 'POST',
    body: { model: 'jetlink-chat', messages: [{ role: 'user', content: 'x' }] }
  });
  assert.equal(serviceProxy.status, 200);
  assert.equal(serviceProxy.headers.get('x-jetlink-model-alias'), 'jetlink-chat');
  assert.equal(serviceProxy.headers.get('x-jetlink-upstream-model'), null);
  assert.equal(serviceProxy.headers.get('x-jetlink-provider'), null);
  assert.equal(serviceProxy.headers.get('x-jetlink-route-attempts'), null);
  const serviceProxyBody = await serviceProxy.json();
  const serviceProxyText = JSON.stringify(serviceProxyBody);
  assert.equal(serviceProxyBody.model, 'jetlink-chat');
  assert.equal(serviceProxyBody.upstream_model, undefined);
  assert.equal(serviceProxyText.includes('gpt-security'), false);
  assert.equal(serviceProxyText.includes('mock'), false);

  const directUpstreamModel = await raw('/v1/chat/completions', {
    apiKey: 'service-test-key',
    method: 'POST',
    body: { model: 'gpt-security', messages: [{ role: 'user', content: 'x' }] }
  });
  assert.equal(directUpstreamModel.ok, false);
  const directUpstreamModelText = await directUpstreamModel.text();
  assert.equal(directUpstreamModelText.includes('provider'), false);
  assert.equal(directUpstreamModelText.includes('mock'), false);

  const safeKeys = await json('/admin/api-keys', { apiKey: 'admin-test-key' });
  const serializedKeys = JSON.stringify(safeKeys);
  assert.equal(serializedKeys.includes('admin-test-key'), false);
  assert.equal(serializedKeys.includes('service-test-key'), false);
  assert.equal(serializedKeys.includes('keyHash'), false);
  assert.equal(serializedKeys.includes('keyCiphertext'), false);

  const serviceKeySecret = await json('/admin/api-keys/service-security/secret', { apiKey: 'admin-test-key' });
  assert.equal(serviceKeySecret.secret, 'service-test-key');
  assert.equal(JSON.stringify(serviceKeySecret.key).includes('service-test-key'), false);

  const oversizedBody = await raw('/admin/providers/oversized', {
    apiKey: 'admin-test-key',
    method: 'PUT',
    body: {
      name: 'x'.repeat(220),
      type: 'mock'
    }
  });
  assert.equal(oversizedBody.status, 413);

  const failedLogin = await raw('/admin/session', {
    method: 'POST',
    body: { username: 'admin', password: 'wrong' }
  });
  assert.equal(failedLogin.status, 401);

  const login = await raw('/admin/session', {
    method: 'POST',
    body: { username: 'admin', password: 'Security-Test-Password-2026' }
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.get('set-cookie') || '';
  assert.match(sessionCookie, /jl_admin_session=/);
  assert.match(sessionCookie, /HttpOnly/);
  assert.match(sessionCookie, /SameSite=Lax/);
  assert.equal(sessionCookie.includes('Security-Test-Password-2026'), false);

  const cookieModels = await raw('/admin/models', { cookie: sessionCookie });
  assert.equal(cookieModels.status, 200);

  const wrongPasswordChange = await raw('/admin/session/password', {
    cookie: sessionCookie,
    method: 'PUT',
    body: {
      currentPassword: 'wrong',
      newPassword: 'Security-Test-Password-Changed-2026'
    }
  });
  assert.equal(wrongPasswordChange.status, 401);

  const passwordChange = await raw('/admin/session/password', {
    cookie: sessionCookie,
    method: 'PUT',
    body: {
      currentPassword: 'Security-Test-Password-2026',
      newPassword: 'Security-Test-Password-Changed-2026'
    }
  });
  assert.equal(passwordChange.status, 200);
  const persistedConfig = await readFile(configPath, 'utf8');
  assert.match(persistedConfig, /"passwordHash": "scrypt:v1:/);
  assert.equal(persistedConfig.includes('Security-Test-Password-Changed-2026'), false);

  const cookieAndApiKey = await raw('/v1/chat/completions', {
    cookie: sessionCookie,
    apiKey: 'service-test-key',
    method: 'POST',
    body: {
      model: 'jetlink-chat',
      messages: [{ role: 'user', content: 'ambiguous principal' }]
    }
  });
  assert.equal(cookieAndApiKey.status, 400);

  const cookieProxy = await raw('/v1/chat/completions', {
    cookie: sessionCookie,
    method: 'POST',
    body: {
      model: 'jetlink-chat',
      messages: [{ role: 'user', content: 'security smoke' }]
    }
  });
  assert.equal(cookieProxy.status, 200);

  const logout = await raw('/admin/session', { cookie: sessionCookie, method: 'DELETE' });
  assert.equal(logout.status, 200);
  const afterLogout = await raw('/admin/models', { cookie: sessionCookie });
  assert.equal(afterLogout.status, 401);

  const oldPasswordLogin = await raw('/admin/session', {
    method: 'POST',
    body: { username: 'admin', password: 'Security-Test-Password-2026' }
  });
  assert.equal(oldPasswordLogin.status, 401);

  const newPasswordLogin = await raw('/admin/session', {
    method: 'POST',
    body: { username: 'admin', password: 'Security-Test-Password-Changed-2026' }
  });
  assert.equal(newPasswordLogin.status, 200);

  const spoofedLoginAttempt = await raw('/admin/session', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.10', 'x-real-ip': '198.51.100.10', 'cf-connecting-ip': '198.51.100.10' },
    body: { username: 'admin', password: 'wrong' }
  });
  assert.equal(spoofedLoginAttempt.status, 401);

  const spoofedLoginLimit = await raw('/admin/session', {
    method: 'POST',
    headers: { 'x-forwarded-for': '198.51.100.11', 'x-real-ip': '198.51.100.11', 'cf-connecting-ip': '198.51.100.11' },
    body: { username: 'admin', password: 'wrong' }
  });
  assert.equal(spoofedLoginLimit.status, 429);

  if (!backendOnly) {
    await assertBuiltFrontendDoesNotExposeDefaults();
  }

  console.log(backendOnly ? 'backend security smoke tests passed' : 'security smoke tests passed');
} finally {
  child.kill('SIGTERM');
  await delay(100);
  await rm(tempDir, { recursive: true, force: true });
}

async function assertBuiltFrontendDoesNotExposeDefaults() {
  const distDir = join(rootDir, 'dist');
  const assetsDir = join(distDir, 'assets');
  const forbiddenPasswords = [
    ['Jet', 'LinkAPI@2026'].join(''),
    'JetLinksAPI@2026'
  ];
  const files = [
    join(distDir, 'index.html'),
    ...(await readdir(assetsDir)).filter((name) => name.endsWith('.js')).map((name) => join(assetsDir, name))
  ];
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    assert.equal(content.includes('dev-internal-key'), false, `${file} exposes the development admin key`);
    for (const password of forbiddenPasswords) {
      assert.equal(content.includes(password), false, `${file} exposes a development admin password`);
    }
  }
}

async function waitForReady() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Gateway exited early with code ${child.exitCode}\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/ready`);
      if (response.status === 200 || response.status === 503) {
        return;
      }
    } catch {
      // The server may still be binding the port.
    }
    await delay(100);
  }
  throw new Error(`Gateway did not become ready\n${output}`);
}

async function json(path, options = {}) {
  const response = await raw(path, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed with ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function raw(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  if (options.cookie) {
    headers.cookie = options.cookie;
  }
  if (options.origin) {
    headers.origin = options.origin;
  }
  let body;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body
  });
}

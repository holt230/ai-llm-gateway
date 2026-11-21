import { createServer } from 'node:http';
import { stat, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';
import { CNY_PRICES, OPENAI_STANDARD_REFERENCE, PRICE_DATE, normalizeCnyPrice, parseYuan, prepaidBudget, standardApiDiscount, usageCharge } from './cny-prices.mjs';
import { CHECKOUT_CHANNEL, openWalletStore } from './manual-wallet.mjs';
import { supportSessionTtl } from './accounts.mjs';

const SUPPORT_COOKIE = 'jl_support';

const { Pool } = pg;

function envValue(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== '') {
      return value;
    }
  }
  return '';
}

function aiGwEnv(name) {
  return envValue(`AI_GW_${name}`);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = resolve(__dirname, 'gateway.config.json');
const EXAMPLE_CONFIG_PATH = resolve(__dirname, 'gateway.config.example.json');
const DIST_DIR = resolve(__dirname, '..', 'dist');
const CONFIG_FILE = aiGwEnv('GATEWAY_CONFIG');
const REQUEST_LOG_FILE = aiGwEnv('GATEWAY_REQUEST_LOG');
const AUDIT_LOG_FILE = aiGwEnv('GATEWAY_AUDIT_LOG');
const CONFIG_PATH = CONFIG_FILE
  ? resolve(process.cwd(), CONFIG_FILE)
  : DEFAULT_CONFIG_PATH;
const DATA_DIR = resolve(__dirname, 'data');
const REQUEST_LOG_PATH = REQUEST_LOG_FILE
  ? resolve(process.cwd(), REQUEST_LOG_FILE)
  : resolve(DATA_DIR, 'requests.jsonl');
const AUDIT_LOG_PATH = AUDIT_LOG_FILE
  ? resolve(process.cwd(), AUDIT_LOG_FILE)
  : resolve(DATA_DIR, 'audit.jsonl');
const API_KEY_HASH_PEPPER = aiGwEnv('API_KEY_PEPPER') || 'jetlinkapi-local-pepper';
const PROVIDER_SECRET_KEY = aiGwEnv('PROVIDER_SECRET_KEY') || aiGwEnv('SECRET_KEY') || API_KEY_HASH_PEPPER;
const SERVE_FRONTEND = aiGwEnv('SERVE_FRONTEND') === 'true';
const DATABASE_URL = aiGwEnv('DATABASE_URL') || process.env.DATABASE_URL || '';
const STORAGE_DRIVER = String(aiGwEnv('PERSISTENCE') || (DATABASE_URL ? 'postgres' : 'file')).trim().toLowerCase();
const POSTGRES_CONFIG_ID = aiGwEnv('CONFIG_ID') || 'default';
const ADMIN_SESSION_COOKIE = 'jl_admin_session';
const ADMIN_SESSION_TTL_MS = Number(aiGwEnv('ADMIN_SESSION_TTL_MS') || 8 * 60 * 60 * 1000);
const ADMIN_SESSION_RATE_LIMIT = Number(aiGwEnv('ADMIN_SESSION_PER_MINUTE') || 600);
const ADMIN_LOGIN_RATE_LIMIT = Number(aiGwEnv('ADMIN_LOGIN_PER_MINUTE') || 10);
const SUPER_ADMIN_USERNAME = envValue('AI_GW_SUPER_ADMIN_USERNAME', 'VITE_AI_GW_SUPER_ADMIN_USERNAME') || 'admin';
const SUPER_ADMIN_NAME = envValue('AI_GW_SUPER_ADMIN_NAME', 'VITE_AI_GW_SUPER_ADMIN_NAME') || '超级管理员';
const SUPER_ADMIN_PASSWORD = aiGwEnv('SUPER_ADMIN_PASSWORD');
const DEFAULT_PUBLIC_BASE_URL = 'https://1024012.xyz';

if (!['file', 'postgres'].includes(STORAGE_DRIVER)) {
  throw new Error('AI_GW_PERSISTENCE must be "file" or "postgres".');
}
if (STORAGE_DRIVER === 'postgres' && !DATABASE_URL) {
  throw new Error('AI_GW_DATABASE_URL or DATABASE_URL is required when AI_GW_PERSISTENCE=postgres.');
}

const postgresPool = STORAGE_DRIVER === 'postgres'
  ? new Pool({
    connectionString: DATABASE_URL,
    max: Number(aiGwEnv('DATABASE_POOL_MAX') || 10),
    idleTimeoutMillis: Number(aiGwEnv('DATABASE_IDLE_TIMEOUT_MS') || 30_000),
    connectionTimeoutMillis: Number(aiGwEnv('DATABASE_CONNECT_TIMEOUT_MS') || 10_000),
    application_name: aiGwEnv('DATABASE_APPLICATION_NAME') || 'jetlinksapi-gateway'
  })
  : null;

const UPSTREAM_CLIENT_HEADERS = ['accept', 'openai-beta', 'anthropic-version', 'anthropic-beta'];

const PUBLIC_UPSTREAM_RESPONSE_HEADERS = new Set([
  'content-disposition',
  'content-type'
]);

const DEFAULT_FAILOVER_STATUS_CODES = [429, 500, 502, 503, 504];
const PRICING_BILLING_UNITS = new Set(['token', 'image', 'request']);
const DEFAULT_MAX_MULTIPART_PARTS = 128;
const DEFAULT_MAX_MULTIPART_FILES = 32;

const STATIC_MIME_TYPES = {
  '.shortcut': 'application/octet-stream',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http: https:"
].join('; ');

const requestLogs = [];
const auditLogs = [];
const rateBuckets = new Map();
const adminSessions = new Map();
const adminLoginBuckets = new Map();
const concurrencyState = {
  inFlightByScope: new Map(),
  queue: [],
  accepted: 0,
  completed: 0,
  rejected: 0,
  queued: 0,
  queueTimeouts: 0,
  maxObservedInFlight: 0,
  shuttingDown: false
};

const receiptToken = aiGwEnv('ALIPAY_RECEIPT_TOKEN');
const wechatReceiptToken = aiGwEnv('WECHAT_RECEIPT_TOKEN');
const qrFiles = { alipay: aiGwEnv('ALIPAY_QR_FILE'), wechat: aiGwEnv('WECHAT_QR_FILE') };
const walletFile = aiGwEnv('WALLET_FILE') || resolve(DATA_DIR, 'wallet.sqlite');
const maxQrBytes = 4 * 1024 * 1024;
function paymentQr(bytes) {
  if (bytes.length > maxQrBytes) throw httpError(413, '收款码图片超过 4 MB');
  const png = bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex'))
    && bytes.toString('ascii', 12, 16) === 'IHDR';
  const jpeg = bytes.length > 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!png && !jpeg) throw httpError(400, '请上传 PNG 或 JPEG 收款码图片');
  return {bytes, type: png ? 'image/png' : 'image/jpeg'};
}
const paymentImages = {};
for (const [channel, path] of Object.entries(qrFiles)) {
  if (!path) continue;
  if ((await stat(path)).size > maxQrBytes) throw new Error('收款码图片超过 4 MB');
  paymentImages[channel] = paymentQr(await readFile(path));
}

let userKeySecret;
async function loadUserKeySecret() {
  const configured = aiGwEnv('USER_KEY_SECRET');
  if (configured) return createHash('sha256').update(configured).digest();
  const path = walletFile + '.key';
  try {
    return await readFile(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(dirname(path), { recursive: true });
  const key = randomBytes(32);
  try {
    await writeFile(path, key, { flag: 'wx', mode: 0o600 });
    return key;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return readFile(path);
  }
}
async function getUserKeySecret() {
  userKeySecret ??= loadUserKeySecret().then(key => {
    if (key.length !== 32) throw new Error('Invalid wallet key encryption configuration');
    return key;
  }).catch(error => {
    userKeySecret = undefined;
    throw error;
  });
  return userKeySecret;
}
const userKeyCodec = {
  seal: async value => encryptSecret(value, await getUserKeySecret()),
  open: async value => decryptSecret(value, await getUserKeySecret())
};

let walletPromise;
function walletStore() {
  walletPromise ??= openWalletStore(postgresPool, walletFile, POSTGRES_CONFIG_ID, userKeyCodec).catch((error) => {
    walletPromise = undefined;
    throw error;
  });
  return walletPromise;
}

let pendingConfigSave = Promise.resolve();
const deletingGroups = new Set();
const deletingCnyPrices = new Set();
let configState = await loadConfig();
let config = configState.config;
await ensureSuperAdminPasswordPersisted();
await loadRecentRequestLogs();
await loadRecentAuditLogs();

function defaultConfig() {
  return {
    server: { host: '0.0.0.0', port: 8787 },
    publicBaseUrl: normalizePublicBaseUrl(publicBaseUrlFromEnv(), DEFAULT_PUBLIC_BASE_URL),
    auth: {
      superAdmin: {
        username: SUPER_ADMIN_USERNAME,
        name: SUPER_ADMIN_NAME
      },
      internalApiKeys: []
    },
    providers: {},
    models: {},
    modelGroups: {},
    cnyPricing: { version: PRICE_DATE, prices: {} },
    routing: {
      defaultModel: '',
      failoverStatusCodes: DEFAULT_FAILOVER_STATUS_CODES,
      failoverOnNetworkError: true
    },
    pricing: {
      currency: 'USD',
      models: {}
    },
    limits: {
      maxInFlightRequests: 200,
      maxInFlightPerApiKey: 50,
      maxInFlightPerProvider: 100,
      maxInFlightPerModel: 100,
      maxQueuedRequests: 1000,
      queueTimeoutMs: 5000,
      gracefulShutdownTimeoutMs: 30_000
    },
    security: {
      maxBodyBytes: 26_214_400,
      maxMultipartParts: DEFAULT_MAX_MULTIPART_PARTS,
      maxMultipartFiles: DEFAULT_MAX_MULTIPART_FILES,
      corsOrigins: parseCsv(process.env.AI_GW_CORS_ORIGINS, ['*'])
    }
  };
}

function parseCsv(value, fallback = []) {
  if (!value) {
    return fallback;
  }
  const items = String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensurePostgresStorage() {
  if (!postgresPool) {
    return;
  }
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS jetlink_gateway_config (
      id text PRIMARY KEY,
      config jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS jetlink_gateway_request_logs (
      id bigserial PRIMARY KEY,
      request_id text,
      time timestamptz NOT NULL DEFAULT now(),
      entry jsonb NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jetlink_gateway_request_logs_time
      ON jetlink_gateway_request_logs (time DESC);

    CREATE INDEX IF NOT EXISTS idx_jetlink_gateway_request_logs_request_id
      ON jetlink_gateway_request_logs (request_id);

    CREATE TABLE IF NOT EXISTS jetlink_gateway_audit_logs (
      id text PRIMARY KEY,
      time timestamptz NOT NULL DEFAULT now(),
      entry jsonb NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_jetlink_gateway_audit_logs_time
      ON jetlink_gateway_audit_logs (time DESC);
  `);
}

function postgresLocation(table, id = '') {
  return `postgresql:${table}${id ? `/${id}` : ''}`;
}

async function loadConfig() {
  if (postgresPool) {
    await ensurePostgresStorage();
    const result = await postgresPool.query('SELECT config FROM jetlink_gateway_config WHERE id = $1', [POSTGRES_CONFIG_ID]);
    if (result.rows.length) {
      const storedConfig = result.rows[0].config;
      return {
        config: normalizeConfig(storedConfig),
        configuredPublicBaseUrl: configuredPublicBaseUrlFrom(storedConfig),
        path: postgresLocation('jetlink_gateway_config', POSTGRES_CONFIG_ID),
        persistent: true,
        driver: 'postgres'
      };
    }
    return {
      config: normalizeConfig(defaultConfig()),
      configuredPublicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
      path: postgresLocation('jetlink_gateway_config', POSTGRES_CONFIG_ID),
      persistent: false,
      driver: 'postgres'
    };
  }
  if (await fileExists(CONFIG_PATH)) {
    const raw = await readFile(CONFIG_PATH, 'utf8');
    const storedConfig = JSON.parse(raw);
    return {
      config: normalizeConfig(storedConfig),
      configuredPublicBaseUrl: configuredPublicBaseUrlFrom(storedConfig),
      path: CONFIG_PATH,
      persistent: true,
      driver: 'file'
    };
  }
  if (await fileExists(EXAMPLE_CONFIG_PATH)) {
    const raw = await readFile(EXAMPLE_CONFIG_PATH, 'utf8');
    const storedConfig = JSON.parse(raw);
    return {
      config: normalizeConfig(storedConfig),
      configuredPublicBaseUrl: configuredPublicBaseUrlFrom(storedConfig),
      path: CONFIG_PATH,
      persistent: false,
      driver: 'file'
    };
  }
  return {
    config: normalizeConfig(defaultConfig()),
    configuredPublicBaseUrl: DEFAULT_PUBLIC_BASE_URL,
    path: CONFIG_PATH,
    persistent: false,
    driver: 'file'
  };
}

function publicBaseUrlFromEnv() {
  return normalizePublicBaseUrl(
    process.env.AI_GW_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.VITE_AI_GW_PUBLIC_BASE_URL || '',
    ''
  );
}

function configuredPublicBaseUrlFrom(source = {}) {
  return normalizePublicBaseUrl(source.publicBaseUrl, DEFAULT_PUBLIC_BASE_URL);
}

function normalizeConfig(input) {
  const base = defaultConfig();
  const next = {
    ...base,
    ...input,
    publicBaseUrl: normalizePublicBaseUrl(publicBaseUrlFromEnv() || input.publicBaseUrl || base.publicBaseUrl, DEFAULT_PUBLIC_BASE_URL),
    server: { ...base.server, ...(input.server || {}) },
    auth: normalizeAuthConfig({ ...base.auth, ...(input.auth || {}) }),
    providers: normalizeStoredProviders(input.providers || base.providers),
    models: input.models || base.models,
    routing: normalizeRoutingConfig({ ...base.routing, ...(input.routing || {}) }),
    pricing: normalizePricingConfig({ ...base.pricing, ...(input.pricing || {}) }),
    limits: normalizeLimitsConfig({ ...base.limits, ...(input.limits || {}) }),
    security: normalizeSecurityConfig({ ...base.security, ...(input.security || {}) })
  };
  // Ignore the built-in development key saved by older installations.
  let keys = (next.auth.internalApiKeys || [])
    .filter((key) => key.id !== 'admin-dev')
    .map((key) => ({
      ...normalizeStoredInternalKey(key),
      allowedModels: normalizeAccessList(key.allowedModels, ['*'], 'allowedModels'),
      allowedEndpoints: normalizeEndpoints(key.allowedEndpoints, ['*'])
    }));
  const bootstrapAdminKey = process.env.AI_GW_BOOTSTRAP_ADMIN_KEY;
  if (bootstrapAdminKey) {
    const existing = keys.find((key) => key.id === 'bootstrap-admin');
    const bootstrap = {
      ...(existing || {}),
      id: 'bootstrap-admin',
      name: 'Bootstrap Admin',
      role: 'admin',
      enabled: true,
      perMinute: normalizeRateLimit(process.env.AI_GW_BOOTSTRAP_ADMIN_PER_MINUTE, existing?.perMinute ?? 600),
      allowedModels: existing?.allowedModels || ['*'],
      allowedEndpoints: existing?.allowedEndpoints || ['*'],
      keyHash: hashToken(bootstrapAdminKey),
      keyPreview: maskSecret(bootstrapAdminKey)
    };
    keys = [bootstrap, ...keys.filter((key) => key.id !== 'bootstrap-admin')];
  }
  next.auth = { ...next.auth, internalApiKeys: keys };
  return next;
}

function normalizeAuthConfig(value = {}) {
  return {
    ...value,
    superAdmin: normalizeSuperAdminConfig(value.superAdmin || {})
  };
}

function normalizeSuperAdminConfig(value = {}) {
  const passwordHash = cleanString(value.passwordHash, '') || (SUPER_ADMIN_PASSWORD ? hashAdminPassword(SUPER_ADMIN_PASSWORD) : '');
  return {
    ...value,
    username: cleanString(value.username, SUPER_ADMIN_USERNAME) || 'admin',
    name: cleanString(value.name, SUPER_ADMIN_NAME) || '超级管理员',
    passwordHash,
    passwordUpdatedAt: value.passwordUpdatedAt || (passwordHash ? new Date().toISOString() : undefined)
  };
}

async function ensureSuperAdminPasswordPersisted() {
  if (!config.auth?.superAdmin?.passwordHash) {
    return;
  }
  if (SUPER_ADMIN_PASSWORD || !configState.persistent || !config.auth.superAdmin.passwordUpdatedAt) {
    config.auth = {
      ...(config.auth || {}),
      superAdmin: {
        ...(config.auth?.superAdmin || {}),
        passwordUpdatedAt: config.auth?.superAdmin?.passwordUpdatedAt || new Date().toISOString()
      }
    };
    await saveConfig();
  }
}

function queueConfigSave(write) {
  const saved = pendingConfigSave.then(write);
  pendingConfigSave = saved.catch(() => {});
  return saved;
}

function saveConfig() {
  return queueConfigSave(() => persistConfig(JSON.stringify(serializeConfigForDisk(config), null, 2)));
}

function saveOperationsConfig(field, update) {
  return queueConfigSave(async () => {
    const value = await update(config[field]);
    const next = { ...config, [field]: value };
    await persistConfig(JSON.stringify(serializeConfigForDisk(next), null, 2));
    config[field] = value;
  });
}

async function persistConfig(snapshot) {
  if (postgresPool) {
    await postgresPool.query(
      `
        INSERT INTO jetlink_gateway_config (id, config, created_at, updated_at)
        VALUES ($1, $2::jsonb, now(), now())
        ON CONFLICT (id)
        DO UPDATE SET config = EXCLUDED.config, updated_at = now()
      `,
      [POSTGRES_CONFIG_ID, snapshot]
    );
    configState.persistent = true;
    return true;
  }
  await mkdir(dirname(configState.path), { recursive: true });
  await writeFile(configState.path, snapshot + "\n", "utf8");
  configState.persistent = true;
  return true;
}

function serializeConfigForDisk(source) {
  const persistedPublicBaseUrl = publicBaseUrlFromEnv()
    ? configState.configuredPublicBaseUrl || DEFAULT_PUBLIC_BASE_URL
    : source.publicBaseUrl;
  configState.configuredPublicBaseUrl = persistedPublicBaseUrl;
  return {
    ...source,
    publicBaseUrl: persistedPublicBaseUrl,
    providers: Object.fromEntries(
      Object.entries(source.providers || {}).map(([id, provider]) => [id, serializeProviderForDisk(provider)])
    ),
    auth: {
      ...source.auth,
      internalApiKeys: (source.auth?.internalApiKeys || []).map((item) => {
        const { key, ...rest } = item;
        const secret = storedInternalApiKey(item);
        const keyHash = rest.keyHash || (secret ? hashToken(secret) : undefined);
        const keyPreview = rest.keyPreview || (secret ? maskSecret(secret) : undefined);
        const keyCiphertext = rest.keyCiphertext || (secret ? encryptSecret(secret) : undefined);
        return {
          ...rest,
          keyHash,
          keyPreview,
          keyCiphertext
        };
      })
    }
  };
}

function serializeProviderForDisk(provider) {
  const { apiKey, apiKeySecret, ...rest } = provider || {};
  const next = { ...rest };
  const secret = cleanString(apiKey || apiKeySecret, '');
  if (secret && !next.apiKeyCiphertext) {
    next.apiKeyCiphertext = encryptSecret(secret);
    next.apiKeyPreview = maskSecret(secret);
  }
  if (looksLikeRawApiKey(next.apiKeyEnv) && !next.apiKeyCiphertext) {
    next.apiKeyCiphertext = encryptSecret(next.apiKeyEnv);
    next.apiKeyPreview = maskSecret(next.apiKeyEnv);
    delete next.apiKeyEnv;
  }
  return next;
}

function publicRuntimeConfig() {
  return {
    name: 'Wormhole AI Gateway',
    publicBaseUrl: config.publicBaseUrl,
    endpoints: {
      models: '/v1/models',
      chat: '/v1/chat/completions',
      responses: '/v1/responses',
      embeddings: '/v1/embeddings',
      images: '/v1/images/generations'
    }
  };
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, status, text, extraHeaders = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...extraHeaders
  });
  res.end(text);
}

async function sendStaticFile(res, filePath, cacheControl = 'public, max-age=300') {
  const data = await readFile(filePath);
  res.writeHead(200, {
    'content-type': STATIC_MIME_TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'cache-control': cacheControl
  });
  res.end(data);
}

async function serveFrontend(req, res, url) {
  if (!SERVE_FRONTEND || !['GET', 'HEAD'].includes(req.method)) {
    return false;
  }
  const rawPath = decodeURIComponent(url.pathname);
  const requested = rawPath === '/' ? '/index.html' : rawPath;
  const target = resolve(DIST_DIR, `.${requested}`);
  if (!target.startsWith(DIST_DIR)) {
    sendJson(res, 403, { error: 'Forbidden.' });
    return true;
  }
  try {
    const info = await stat(target);
    if (info.isFile()) {
      await sendStaticFile(res, target, requested.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-store');
      return true;
    }
  } catch {
    // Fall back to the SPA entry below.
  }
  const indexPath = resolve(DIST_DIR, 'index.html');
  if (await fileExists(indexPath)) {
    await sendStaticFile(res, indexPath, 'no-store');
    return true;
  }
  return false;
}

function getCorsOrigin(req) {
  const origins = config.security?.corsOrigins || [];
  const requestOrigin = req.headers.origin;
  if (origins.includes('*')) {
    return '*';
  }
  if (requestOrigin && origins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return '';
}

function isHttpsRequest(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return forwardedProto === 'https' || req.socket?.encrypted === true;
}

function setSecurityHeaders(req, res) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('x-download-options', 'noopen');
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
  res.setHeader('content-security-policy', CONTENT_SECURITY_POLICY);
  if (isHttpsRequest(req)) {
    res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
  }
}

function accountOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return '';
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) return '';
    if (url.host === req.headers.host || (config.security?.corsOrigins || []).includes(origin)) return origin;
    if (process.env.NODE_ENV !== 'production' && isLoopbackRequest(req) && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)) return origin;
  } catch { /* Invalid browser origin. */ }
  return '';
}

function setCors(req, res) {
  const sessionRoute = req.url?.startsWith('/account-api/') || req.url?.startsWith('/admin/');
  const trustedOrigin = (sessionRoute || req.url?.startsWith('/v1/')) ? accountOrigin(req) : '';
  const origin = trustedOrigin || (sessionRoute ? '' : getCorsOrigin(req));
  if (trustedOrigin) res.setHeader('access-control-allow-credentials', 'true');
  if (origin) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'authorization,content-type,x-api-key,x-request-id');
  res.setHeader('access-control-expose-headers', 'x-request-id,x-jetlink-model-alias');
  setSecurityHeaders(req, res);
  res.setHeader('cache-control', 'no-store');
}

function headerValues(req, headerName) {
  const values = [];
  const target = headerName.toLowerCase();
  const rawHeaders = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (String(rawHeaders[index] || '').toLowerCase() === target) {
      values.push(String(rawHeaders[index + 1] || ''));
    }
  }
  if (values.length) {
    return values;
  }
  const fallback = req.headers[target];
  if (Array.isArray(fallback)) {
    return fallback.map((value) => String(value || ''));
  }
  return fallback === undefined ? [] : [String(fallback || '')];
}

function credentialError(message) {
  return { ok: false, status: 400, error: message };
}

function extractCredential(req) {
  const authorizationValues = headerValues(req, 'authorization').map((value) => value.trim()).filter(Boolean);
  const apiKeyValues = headerValues(req, 'x-api-key').map((value) => value.trim()).filter(Boolean);
  if (authorizationValues.length > 1 || apiKeyValues.length > 1) {
    return credentialError('Multiple authentication credentials are not allowed.');
  }

  const authorization = authorizationValues[0] || '';
  const apiKey = apiKeyValues[0] || '';
  let bearerToken = '';
  if (authorization) {
    if (authorization.includes(',')) {
      return credentialError('Multiple authentication credentials are not allowed.');
    }
    const bearer = authorization.match(/^Bearer\s+([^\s,]+)\s*$/i);
    if (!bearer) {
      return credentialError('Invalid Authorization header. Use Authorization: Bearer <api-key>.');
    }
    bearerToken = bearer[1].trim();
  }

  if (apiKey && /[\s,]/.test(apiKey)) {
    return credentialError('Invalid x-api-key header.');
  }
  if (bearerToken && apiKey) {
    return credentialError('Multiple authentication credentials are not allowed.');
  }

  return {
    ok: true,
    token: bearerToken || apiKey,
    presented: Boolean(authorization || apiKey)
  };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = decodeURIComponent(value);
    }
  }
  return cookies;
}

function adminSessionCookie(req, token, maxAgeSeconds) {
  const parts = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isHttpsRequest(req)) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function clearAdminSessionCookie(req) {
  return adminSessionCookie(req, '', 0);
}

function hashSessionToken(token) {
  return createHash('sha256').update(String(token || '')).digest('hex');
}

function safeTextEqual(left, right) {
  const leftHash = createHash('sha256').update(String(left || '')).digest();
  const rightHash = createHash('sha256').update(String(right || '')).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function hashAdminPassword(password) {
  const raw = String(password || '');
  if (!raw) {
    return '';
  }
  const salt = randomBytes(16).toString('base64url');
  const hash = scryptSync(raw, salt, 64).toString('base64url');
  return `scrypt:v1:${salt}:${hash}`;
}

function verifyAdminPasswordHash(password, passwordHash) {
  const stored = cleanString(passwordHash, '');
  if (!stored) {
    return false;
  }
  try {
    const [algorithm, version, salt, expected] = stored.split(':');
    if (algorithm !== 'scrypt' || version !== 'v1' || !salt || !expected) {
      return false;
    }
    const actual = scryptSync(String(password || ''), salt, 64).toString('base64url');
    return safeTextEqual(actual, expected);
  } catch {
    return false;
  }
}

function superAdminConfig() {
  return config.auth?.superAdmin || {};
}

function superAdminUsername() {
  return cleanString(superAdminConfig().username, SUPER_ADMIN_USERNAME) || 'admin';
}

function superAdminName() {
  return cleanString(superAdminConfig().name, SUPER_ADMIN_NAME) || '超级管理员';
}

function verifySuperAdminPassword(password) {
  const passwordHash = superAdminConfig().passwordHash;
  if (passwordHash) {
    return verifyAdminPasswordHash(password, passwordHash);
  }
  return Boolean(SUPER_ADMIN_PASSWORD) && safeTextEqual(password, SUPER_ADMIN_PASSWORD);
}

function assertAdminPasswordPolicy(password) {
  const raw = String(password || '');
  if (raw.length < 12) {
    throw httpError(400, 'New password must be at least 12 characters.');
  }
  if (raw.length > 256) {
    throw httpError(400, 'New password is too long.');
  }
}

function superAdminUserPayload() {
  return {
    name: superAdminName(),
    username: superAdminUsername()
  };
}

function clientAddress(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function isLoopbackRequest(req) {
  const address = clientAddress(req);
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requireObserverAccess(req, res) {
  const credential = extractCredential(req);
  if (!credential.ok) {
    sendJson(res, credential.status, { error: credential.error });
    return false;
  }
  const hasSessionCookie = Boolean(parseCookies(req)[ADMIN_SESSION_COOKIE]);
  if (isLoopbackRequest(req) && !credential.presented && !hasSessionCookie) {
    return true;
  }
  const auth = authenticate(req, { admin: true });
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return false;
  }
  return true;
}

function checkAdminLoginRateLimit(req) {
  if (!ADMIN_LOGIN_RATE_LIMIT) {
    return { ok: true };
  }
  const now = Date.now();
  const windowMs = 60_000;
  const bucket = `${clientAddress(req)}|${Math.floor(now / windowMs)}`;
  const used = adminLoginBuckets.get(bucket) || 0;
  if (used >= ADMIN_LOGIN_RATE_LIMIT) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
    return { ok: false, retryAfterSeconds };
  }
  adminLoginBuckets.set(bucket, used + 1);
  if (adminLoginBuckets.size > 5000) {
    for (const key of adminLoginBuckets.keys()) {
      const [, windowId] = key.split('|');
      if (Number(windowId) < Math.floor(now / windowMs) - 2) {
        adminLoginBuckets.delete(key);
      }
    }
  }
  return { ok: true };
}

function adminSessionKey() {
  return {
    id: 'console-session',
    name: superAdminName(),
    role: 'admin',
    enabled: true,
    perMinute: ADMIN_SESSION_RATE_LIMIT,
    allowedModels: ['*'],
    allowedEndpoints: ['*']
  };
}

function pruneAdminSessions() {
  const now = Date.now();
  for (const [hash, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) {
      adminSessions.delete(hash);
    }
  }
}

function createAdminSession() {
  pruneAdminSessions();
  const token = randomBytes(32).toString('base64url');
  const hash = hashSessionToken(token);
  const now = Date.now();
  adminSessions.set(hash, {
    createdAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_MS,
    lastUsedAt: now
  });
  return token;
}

function authenticateAdminSession(req) {
  pruneAdminSessions();
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!token) {
    return { ok: false };
  }
  const session = adminSessions.get(hashSessionToken(token));
  if (!session || session.expiresAt <= Date.now()) {
    return { ok: false };
  }
  session.lastUsedAt = Date.now();
  return { ok: true, key: adminSessionKey(), session };
}

function authenticate(req, { admin = false, allowAdminSession = false } = {}) {
  const credential = extractCredential(req);
  if (!credential.ok) {
    return credential;
  }
  if (admin || allowAdminSession) {
    const sessionAuth = authenticateAdminSession(req);
    if (sessionAuth.ok) {
      if (credential.presented) {
        return { ok: false, status: 400, error: 'Multiple authentication credentials are not allowed.' };
      }
      const rate = checkRateLimit(sessionAuth.key);
      if (!rate.ok) {
        return { ok: false, status: 429, error: `Rate limit exceeded. Retry after ${rate.retryAfterSeconds}s.` };
      }
      return sessionAuth;
    }
  }
  const token = credential.token;
  if (!token) {
    return { ok: false, status: 401, error: 'Missing API key.' };
  }
  const key = (config.auth?.internalApiKeys || []).find((item) => item.enabled !== false && matchesInternalKey(item, token));
  if (!key) {
    return { ok: false, status: 401, error: 'Invalid API key.' };
  }
  if (admin && key.role !== 'admin') {
    return { ok: false, status: 403, error: 'Admin API key required.' };
  }
  const rate = checkRateLimit(key);
  if (!rate.ok) {
    return { ok: false, status: 429, error: `Rate limit exceeded. Retry after ${rate.retryAfterSeconds}s.` };
  }
  key.lastUsedAt = new Date().toISOString();
  return { ok: true, key };
}

async function authenticateProxy(req, options = {}) {
  const credential = extractCredential(req);
  if (!credential.ok || !credential.token?.startsWith('gw_live_')) return authenticate(req, options);
  if (options.allowAdminSession && authenticateAdminSession(req).ok) return {ok:false,status:400,error:'Multiple authentication credentials are not allowed.'};
  const record = await (await walletStore()).accounts.apiKey(credential.token);
  if (!record) return {ok:false,status:401,error:'Invalid API key.'};
  const rate = checkRateLimit({id: 'account-' + record.owner, perMinute: 60});
  if (!rate.ok) return {ok:false,status:429,error:'User rate limit exceeded.'};
  return {ok:true,key:{id:record.id,accountId:record.owner,username:record.username,modelGroup:record.modelGroup,walletId:'user/'+record.owner,role:'service',prepaid:true}};
}

function checkRateLimit(key) {
  const limit = Number(key.perMinute || 0);
  if (!limit) {
    return { ok: true };
  }
  const now = Date.now();
  const windowMs = 60_000;
  const bucketKey = `${key.id}:${Math.floor(now / windowMs)}`;
  const used = rateBuckets.get(bucketKey) || 0;
  if (used >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now % windowMs)) / 1000));
    return { ok: false, retryAfterSeconds };
  }
  rateBuckets.set(bucketKey, used + 1);
  if (rateBuckets.size > 5000) {
    for (const existing of rateBuckets.keys()) {
      const bucket = existing.slice(existing.lastIndexOf(':') + 1);
      if (Number(bucket) < Math.floor(now / windowMs) - 2) {
        rateBuckets.delete(existing);
      }
    }
  }
  return { ok: true };
}

async function readRawBody(req, limit = Infinity) {
  const maxBytes = Math.min(limit, Number(config.security?.maxBodyBytes || 26_214_400));
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error(`Request body too large. Max ${maxBytes} bytes.`);
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJsonBody(req) {
  return parseJsonBodyBuffer(await readRawBody(req));
}

function parseJsonBodyBuffer(buffer) {
  const raw = buffer.toString('utf8');
  if (!raw) {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.status = 400;
    throw error;
  }
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requestHeaderValue(req, name) {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return value ? String(value) : '';
}

function isMultipartFormData(contentType = '') {
  return /^multipart\/form-data\b/i.test(contentType);
}

function isBlobLike(value) {
  return Boolean(value)
    && typeof value === 'object'
    && typeof value.arrayBuffer === 'function'
    && typeof value.size === 'number'
    && typeof value.type === 'string';
}

function appendPlainField(target, name, value) {
  if (target[name] === undefined) {
    target[name] = value;
  } else if (Array.isArray(target[name])) {
    target[name].push(value);
  } else {
    target[name] = [target[name], value];
  }
}

function firstPlainField(fields, name) {
  const value = fields?.[name];
  return Array.isArray(value) ? value[0] : value;
}

function appendFormDataValue(target, name, value) {
  if (isBlobLike(value)) {
    const filename = cleanString(value.name, 'blob') || 'blob';
    target.append(name, value, filename);
  } else {
    target.append(name, String(value));
  }
}

function summarizeMultipartFormData(formData) {
  const fields = {};
  let parts = 0;
  let files = 0;
  for (const [name, value] of formData.entries()) {
    parts += 1;
    if (parts > Number(config.security?.maxMultipartParts || DEFAULT_MAX_MULTIPART_PARTS)) {
      throw httpError(413, `Multipart request has too many parts. Max ${config.security?.maxMultipartParts || DEFAULT_MAX_MULTIPART_PARTS}.`);
    }
    if (isBlobLike(value)) {
      files += 1;
      if (files > Number(config.security?.maxMultipartFiles || DEFAULT_MAX_MULTIPART_FILES)) {
        throw httpError(413, `Multipart request has too many files. Max ${config.security?.maxMultipartFiles || DEFAULT_MAX_MULTIPART_FILES}.`);
      }
      continue;
    }
    appendPlainField(fields, name, String(value));
  }
  return { fields, parts, files };
}

function cloneMultipartFormData(formData, upstreamModel) {
  const next = new FormData();
  let modelWritten = false;
  for (const [name, value] of formData.entries()) {
    if (name === 'model') {
      if (!modelWritten) {
        next.append('model', upstreamModel);
        modelWritten = true;
      }
      continue;
    }
    appendFormDataValue(next, name, value);
  }
  if (!modelWritten) {
    next.append('model', upstreamModel);
  }
  return next;
}

async function parseMultipartProxyBody(buffer, contentType) {
  try {
    const request = new Request('http://jetlinksapi.local/v1/proxy', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: buffer
    });
    const formData = await request.formData();
    const { fields, parts, files } = summarizeMultipartFormData(formData);
    return {
      kind: 'multipart',
      model: cleanString(firstPlainField(fields, 'model'), ''),
      stream: firstPlainField(fields, 'stream') === 'true',
      requestBody: fields,
      summary: { parts, files },
      buildUpstreamBody: (upstreamModel) => cloneMultipartFormData(formData, upstreamModel)
    };
  } catch (error) {
    if (error.status) {
      throw error;
    }
    throw httpError(400, 'Request body must be valid multipart/form-data.');
  }
}

function parseJsonProxyBody(buffer) {
  const body = parseJsonBodyBuffer(buffer);
  return {
    kind: 'json',
    model: body.model,
    stream: body.stream === true,
    requestBody: body,
    buildUpstreamBody: (upstreamModel) => JSON.stringify({ ...body, model: upstreamModel })
  };
}

async function readProxyBody(req) {
  const contentType = requestHeaderValue(req, 'content-type');
  const raw = await readRawBody(req);
  if (isMultipartFormData(contentType)) {
    return parseMultipartProxyBody(raw, contentType);
  }
  return parseJsonProxyBody(raw);
}

function assertConfigId(value, label) {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)) {
    throw httpError(400, `Invalid ${label}. Use letters, numbers, dot, underscore, colon, or hyphen.`);
  }
  return id;
}

function cleanString(value, fallback = '') {
  if (value === undefined || value === null) {
    return fallback;
  }
  return String(value).trim();
}

function normalizePublicBaseUrl(value, fallback = DEFAULT_PUBLIC_BASE_URL) {
  const raw = cleanString(value, '');
  const candidate = raw || fallback;
  if (!candidate) {
    return '';
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw httpError(400, 'publicBaseUrl must be a valid http(s) URL.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw httpError(400, 'publicBaseUrl must use http or https.');
  }
  parsed.hash = '';
  parsed.search = '';
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  return parsed.toString().replace(/\/+$/, '');
}

function maskSecret(value) {
  if (!value) {
    return '';
  }
  const raw = String(value);
  if (raw.length <= 10) {
    return `${raw.slice(0, 2)}***${raw.slice(-2)}`;
  }
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
}

function providerSecretEncryptionKey() {
  return createHash('sha256').update(String(PROVIDER_SECRET_KEY)).digest();
}

function encryptSecret(value, key = providerSecretEncryptionKey()) {
  const raw = cleanString(value, '');
  if (!raw) {
    return undefined;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value, key = providerSecretEncryptionKey()) {
  const raw = cleanString(value, '');
  if (!raw) {
    return '';
  }
  try {
    const [version, ivText, tagText, encryptedText] = raw.split(':');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
      return '';
    }
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final()
    ]).toString('utf8');
  } catch {
    return '';
  }
}

function looksLikeRawApiKey(value) {
  const raw = cleanString(value, '');
  return raw.startsWith('sk-') || raw.startsWith('sk_');
}

function storedProviderApiKey(provider) {
  if (!provider) {
    return '';
  }
  if (provider.apiKey) {
    return cleanString(provider.apiKey, '');
  }
  if (provider.apiKeySecret) {
    return cleanString(provider.apiKeySecret, '');
  }
  const decrypted = decryptSecret(provider.apiKeyCiphertext);
  if (decrypted) {
    return decrypted;
  }
  if (looksLikeRawApiKey(provider.apiKeyEnv)) {
    return cleanString(provider.apiKeyEnv, '');
  }
  return '';
}

function storedInternalApiKey(item) {
  if (!item) {
    return '';
  }
  if (item.key) {
    return cleanString(item.key, '');
  }
  return decryptSecret(item.keyCiphertext);
}

function normalizeStoredProviders(providers) {
  const next = {};
  for (const [id, provider] of Object.entries(providers || {})) {
    next[id] = normalizeStoredProvider(provider);
  }
  return next;
}

function normalizeStoredInternalKey(item = {}) {
  const next = { ...item };
  const secret = storedInternalApiKey(next);
  if (secret) {
    next.keyCiphertext = next.keyCiphertext || encryptSecret(secret);
    next.keyHash = next.keyHash || hashToken(secret);
    next.keyPreview = next.keyPreview || maskSecret(secret);
    delete next.key;
  }
  // Keep legacy keys stable across restarts, and preserve the wallet through secret rotation.
  if (!next.walletId && next.keyHash) next.walletId = createHash('sha256').update(next.id + ':' + next.keyHash).digest('hex');
  return next;
}

function normalizeStoredProvider(provider = {}) {
  const next = { ...provider };
  const legacySecret = storedProviderApiKey(next);
  if (legacySecret) {
    next.apiKeyCiphertext = next.apiKeyCiphertext || encryptSecret(legacySecret);
    next.apiKeyPreview = next.apiKeyPreview || maskSecret(legacySecret);
    delete next.apiKey;
    delete next.apiKeySecret;
    if (looksLikeRawApiKey(next.apiKeyEnv)) {
      delete next.apiKeyEnv;
    }
  }
  return next;
}

function hashToken(token) {
  return createHash('sha256')
    .update(`${API_KEY_HASH_PEPPER}:${token}`)
    .digest('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'hex');
  const right = Buffer.from(String(b || ''), 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

function matchesInternalKey(item, token) {
  if (item.keyHash && safeEqual(item.keyHash, hashToken(token))) {
    return true;
  }
  const secret = storedInternalApiKey(item);
  if (secret && safeTextEqual(secret, token)) {
    return true;
  }
  return Boolean(item.key && item.key === token);
}

function generateInternalKey() {
  return `jl_${randomBytes(24).toString('base64url')}`;
}

function generateConfigId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
}

function normalizeRateLimit(value, fallback = 60) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const perMinute = Number(value);
  if (!Number.isInteger(perMinute) || perMinute < 0 || perMinute > 1_000_000) {
    throw httpError(400, 'perMinute must be an integer between 0 and 1000000.');
  }
  return perMinute;
}

function normalizeTimeout(value, fallback = 120_000) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const timeoutMs = Number(value);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 600_000) {
    throw httpError(400, 'timeoutMs must be an integer between 1000 and 600000.');
  }
  return timeoutMs;
}

function normalizeEndpoints(value, fallback = ['chat']) {
  const allowed = new Set(['*', 'chat', 'responses', 'messages', 'embeddings', 'rerank', 'images', 'audio', 'models', 'generic']);
  const endpoints = Array.isArray(value) && value.length ? value.map((item) => String(item).trim()) : fallback;
  const unique = [...new Set(endpoints.filter(Boolean))];
  const invalid = unique.find((item) => !allowed.has(item));
  if (invalid) {
    throw httpError(400, `Unsupported endpoint type: ${invalid}`);
  }
  return unique.length ? unique : fallback;
}

function normalizeStatusCodes(value, fallback = DEFAULT_FAILOVER_STATUS_CODES) {
  const source = Array.isArray(value) && value.length ? value : fallback;
  const unique = [...new Set(source.map((item) => Number(item)))];
  const invalid = unique.find((item) => !Number.isInteger(item) || item < 400 || item > 599);
  if (invalid) {
    throw httpError(400, `Invalid failover status code: ${invalid}`);
  }
  return unique;
}

function normalizeRoutingConfig(value = {}) {
  return {
    defaultModel: cleanString(value.defaultModel, ''),
    failoverStatusCodes: normalizeStatusCodes(value.failoverStatusCodes, DEFAULT_FAILOVER_STATUS_CODES),
    failoverOnNetworkError: value.failoverOnNetworkError !== false
  };
}

function normalizeRoutingInput(body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'Routing body must be a JSON object.');
  }
  const next = normalizeRoutingConfig({ ...existing, ...body });
  if (next.defaultModel && !config.models?.[next.defaultModel]) {
    throw httpError(400, `Unknown default model alias: ${next.defaultModel}`);
  }
  return next;
}

function normalizePrice(value, fallback = 0) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) {
    throw httpError(400, 'Price must be a non-negative number.');
  }
  return price;
}

function normalizePricingEntry(value = {}) {
  if (!isPlainObject(value)) {
    throw httpError(400, 'Pricing entry must be a JSON object.');
  }
  const requestedUnit = cleanString(value.billingUnit ?? value.unit ?? value.type, '').toLowerCase();
  let billingUnit = PRICING_BILLING_UNITS.has(requestedUnit) ? requestedUnit : '';
  if (!billingUnit) {
    if (value.imageUnitPrice !== undefined || value.perImage !== undefined || value.image !== undefined) {
      billingUnit = 'image';
    } else if (value.requestUnitPrice !== undefined || value.perRequest !== undefined || value.request !== undefined) {
      billingUnit = 'request';
    } else {
      billingUnit = 'token';
    }
  }
  return {
    billingUnit,
    inputPerMillionTokens: normalizePrice(value.inputPerMillionTokens ?? value.input, 0),
    outputPerMillionTokens: normalizePrice(value.outputPerMillionTokens ?? value.output, 0),
    imageUnitPrice: normalizePrice(value.imageUnitPrice ?? value.perImage ?? value.image, 0),
    requestUnitPrice: normalizePrice(value.requestUnitPrice ?? value.perRequest ?? value.request, 0),
    unitLabel: cleanString(value.unitLabel, billingUnit === 'image' ? 'image' : billingUnit),
    currency: cleanString(value.currency, ''),
    officialProvider: cleanString(value.officialProvider ?? value.provider, ''),
    officialModel: cleanString(value.officialModel ?? value.model, ''),
    source: cleanString(value.source, ''),
    note: cleanString(value.note, '')
  };
}

function normalizePricingConfig(value = {}) {
  if (!isPlainObject(value)) {
    throw httpError(400, 'Pricing config must be a JSON object.');
  }
  const models = {};
  for (const [alias, pricing] of Object.entries(value.models || {})) {
    const id = assertConfigId(alias, 'pricing model alias');
    models[id] = normalizePricingEntry(pricing);
  }
  return {
    currency: cleanString(value.currency, 'USD') || 'USD',
    models
  };
}

function normalizePricingInput(body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'Pricing body must be a JSON object.');
  }
  return normalizePricingConfig({
    currency: body.currency ?? existing.currency,
    models: body.models ?? existing.models ?? {}
  });
}

function normalizeNonNegativeInteger(value, fallback, label, max = 1_000_000) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const next = Number(value);
  if (!Number.isInteger(next) || next < 0 || next > max) {
    throw httpError(400, `${label} must be an integer between 0 and ${max}.`);
  }
  return next;
}

function normalizeLimitsConfig(value = {}) {
  if (!isPlainObject(value)) {
    throw httpError(400, 'limits must be a JSON object.');
  }
  return {
    maxInFlightRequests: normalizeNonNegativeInteger(value.maxInFlightRequests, 200, 'maxInFlightRequests'),
    maxInFlightPerApiKey: normalizeNonNegativeInteger(value.maxInFlightPerApiKey, 50, 'maxInFlightPerApiKey'),
    maxInFlightPerProvider: normalizeNonNegativeInteger(value.maxInFlightPerProvider, 100, 'maxInFlightPerProvider'),
    maxInFlightPerModel: normalizeNonNegativeInteger(value.maxInFlightPerModel, 100, 'maxInFlightPerModel'),
    maxQueuedRequests: normalizeNonNegativeInteger(value.maxQueuedRequests, 1000, 'maxQueuedRequests'),
    queueTimeoutMs: normalizeNonNegativeInteger(value.queueTimeoutMs, 5000, 'queueTimeoutMs', 600_000),
    gracefulShutdownTimeoutMs: normalizeNonNegativeInteger(value.gracefulShutdownTimeoutMs, 30_000, 'gracefulShutdownTimeoutMs', 600_000)
  };
}

function normalizeLimitsInput(body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'Limits body must be a JSON object.');
  }
  return normalizeLimitsConfig({ ...existing, ...body });
}

function normalizeSecurityConfig(value = {}) {
  const maxBodyBytes = Number(value.maxBodyBytes || 26_214_400);
  const maxMultipartParts = normalizeNonNegativeInteger(
    value.maxMultipartParts,
    DEFAULT_MAX_MULTIPART_PARTS,
    'security.maxMultipartParts',
    1000
  );
  const maxMultipartFiles = normalizeNonNegativeInteger(
    value.maxMultipartFiles,
    DEFAULT_MAX_MULTIPART_FILES,
    'security.maxMultipartFiles',
    200
  );
  const configuredCorsOrigins = Array.isArray(value.corsOrigins)
    ? value.corsOrigins.map((item) => String(item).trim()).filter(Boolean)
    : parseCsv(value.corsOrigins, ['*']);
  const envCorsOrigins = parseCsv(process.env.AI_GW_CORS_ORIGINS, null);
  const envPublicBaseUrl = publicBaseUrlFromEnv();
  let corsOrigins = envCorsOrigins || configuredCorsOrigins;
  if (!envCorsOrigins && envPublicBaseUrl) {
    corsOrigins = corsOrigins.includes('*')
      ? [envPublicBaseUrl]
      : [...corsOrigins, envPublicBaseUrl];
  }
  return {
    ...value,
    maxBodyBytes: Number.isFinite(maxBodyBytes) && maxBodyBytes > 0 ? maxBodyBytes : 26_214_400,
    maxMultipartParts,
    maxMultipartFiles,
    corsOrigins: corsOrigins.length ? [...new Set(corsOrigins)] : ['*']
  };
}

function normalizeAccessList(value, fallback = ['*'], label = 'access list') {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (!Array.isArray(value)) {
    throw httpError(400, `${label} must be an array.`);
  }
  const unique = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (!unique.length) {
    return fallback;
  }
  const invalid = unique.find((item) => item !== '*' && !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(item));
  if (invalid) {
    throw httpError(400, `Invalid ${label} value: ${invalid}`);
  }
  return unique;
}

function normalizeRouteCandidateInput(route, label) {
  if (!isPlainObject(route)) {
    throw httpError(400, `${label} must be a JSON object.`);
  }
  const provider = cleanString(route.provider);
  const upstreamModel = cleanString(route.upstreamModel);
  if (!provider || !config.providers?.[provider]) {
    throw httpError(400, `Unknown provider in ${label}: ${provider}`);
  }
  if (!upstreamModel) {
    throw httpError(400, `upstreamModel is required in ${label}.`);
  }
  return {
    provider,
    upstreamModel,
    enabled: route.enabled !== false,
    label: cleanString(route.label, label)
  };
}

function normalizeModelInput(alias, body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'Model body must be a JSON object.');
  }

  let primary;
  let fallbacks;
  if (body.routes !== undefined) {
    if (!Array.isArray(body.routes) || !body.routes.length) {
      throw httpError(400, 'routes must be a non-empty array.');
    }
    const routes = body.routes.map((route, index) => normalizeRouteCandidateInput(route, index === 0 ? 'primary route' : `fallback route ${index}`));
    primary = routes[0];
    fallbacks = routes.slice(1);
  } else {
    primary = normalizeRouteCandidateInput(
      {
        provider: body.provider ?? existing.provider,
        upstreamModel: body.upstreamModel ?? existing.upstreamModel,
        label: 'primary route',
        enabled: true
      },
      'primary route'
    );
    fallbacks = body.fallbacks !== undefined
      ? (Array.isArray(body.fallbacks) ? body.fallbacks : []).map((route, index) => normalizeRouteCandidateInput(route, `fallback route ${index + 1}`))
      : (existing.fallbacks || []).map((route, index) => normalizeRouteCandidateInput(route, `fallback route ${index + 1}`));
    if (body.fallbacks !== undefined && !Array.isArray(body.fallbacks)) {
      throw httpError(400, 'fallbacks must be an array.');
    }
  }

  const model = {
    description: cleanString(body.description, existing.description || ''),
    provider: primary.provider,
    upstreamModel: primary.upstreamModel,
    enabled: body.enabled !== undefined ? body.enabled !== false : existing.enabled !== false,
    maxConcurrency: normalizeNonNegativeInteger(body.maxConcurrency, existing.maxConcurrency ?? 0, 'maxConcurrency'),
    saasEnabled: body.saasEnabled === undefined ? existing.saasEnabled === true : body.saasEnabled === true,
    endpoints: normalizeEndpoints(body.endpoints, existing.endpoints || ['chat'])
  };
  if (fallbacks.length) {
    model.fallbacks = fallbacks;
  }
  if (model.saasEnabled) {
    const priceId = cnyPriceId(alias, model.upstreamModel);
    if (!priceId) throw httpError(400, '向用户开放模型前，请选择已在售价管理中配置单价的型号');
    if (model.enabled && deletingCnyPrices.has(priceId)) throw httpError(409, '此售价正在删除，请稍后重试');
  }
  return model;
}

function moveModelAliasReferences(previousAlias, nextAlias) {
  if (!previousAlias || previousAlias === nextAlias) {
    return { defaultModelMoved: false, apiKeysUpdated: 0, pricingMoved: false };
  }

  let defaultModelMoved = false;
  let apiKeysUpdated = 0;
  let pricingMoved = false;

  if (config.routing?.defaultModel === previousAlias) {
    config.routing = {
      ...(config.routing || {}),
      defaultModel: nextAlias
    };
    defaultModelMoved = true;
  }

  const keys = config.auth?.internalApiKeys || [];
  config.auth = {
    ...(config.auth || {}),
    internalApiKeys: keys.map((key) => {
      if (!Array.isArray(key.allowedModels) || !key.allowedModels.includes(previousAlias)) {
        return key;
      }
      apiKeysUpdated += 1;
      return {
        ...key,
        allowedModels: [...new Set(key.allowedModels.map((item) => (item === previousAlias ? nextAlias : item)))]
      };
    })
  };

  if (config.pricing?.models?.[previousAlias]) {
    config.pricing = {
      ...(config.pricing || {}),
      models: {
        ...(config.pricing?.models || {})
      }
    };
    if (!config.pricing.models[nextAlias]) {
      config.pricing.models[nextAlias] = config.pricing.models[previousAlias];
      pricingMoved = true;
    }
    delete config.pricing.models[previousAlias];
  }

  return { defaultModelMoved, apiKeysUpdated, pricingMoved };
}

function modelAliasReferenceSummary(alias) {
  const references = [];
  if (config.routing?.defaultModel === alias) {
    references.push('routing.defaultModel');
  }
  for (const key of config.auth?.internalApiKeys || []) {
    if (Array.isArray(key.allowedModels) && key.allowedModels.includes(alias)) {
      references.push(`auth.internalApiKeys.${key.id || 'unknown'}.allowedModels`);
    }
  }
  return references;
}

function normalizeHeaders(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!isPlainObject(value)) {
    throw httpError(400, 'headers must be a JSON object.');
  }
  const headers = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!name || headerValue === undefined || headerValue === null) {
      continue;
    }
    headers[name] = String(headerValue);
  }
  return Object.keys(headers).length ? headers : undefined;
}

function normalizeProviderInput(id, body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'Provider body must be a JSON object.');
  }

  const type = cleanString(body.type, existing.type || 'openai-compatible');
  if (!['mock', 'openai-compatible'].includes(type)) {
    throw httpError(400, 'Provider type must be mock or openai-compatible.');
  }

  const modelGroup = body.modelGroup === undefined ? existing.modelGroup || 'default' : body.modelGroup;
  if (typeof modelGroup !== 'string' || !/^[\p{L}\p{N}_. -]{1,48}$/u.test(modelGroup.trim())) {
    throw httpError(400, '渠道分组名称须为 1–48 位文字、数字、空格、点、短横线或下划线');
  }
  const groupId = modelGroup.trim();
  if (deletingGroups.has(groupId) || (
    /^grp-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(groupId) &&
    groupId !== config.providers?.[id]?.modelGroup && !Object.hasOwn(config.modelGroups || {}, groupId)
  )) throw httpError(409, '所选分组已变更，请刷新分组列表后重试');
  const provider = {
    ...existing,
    modelGroup: groupId,
    name: cleanString(body.name, existing.name || id),
    type,
    enabled: body.enabled !== undefined ? body.enabled !== false : existing.enabled !== false,
    maxConcurrency: normalizeNonNegativeInteger(body.maxConcurrency, existing.maxConcurrency ?? 0, 'maxConcurrency')
  };

  if (type === 'mock') {
    delete provider.baseUrl;
    delete provider.apiKeyEnv;
    delete provider.apiKey;
    delete provider.apiKeySecret;
    delete provider.apiKeyCiphertext;
    delete provider.apiKeyPreview;
    delete provider.headers;
    return provider;
  }

  const baseUrl = cleanString(body.baseUrl, existing.baseUrl || '');
  if (!baseUrl) {
    throw httpError(400, 'baseUrl is required for openai-compatible providers.');
  }
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('bad protocol');
    }
  } catch {
    throw httpError(400, 'baseUrl must be a valid http or https URL.');
  }

  let apiKeyEnv = cleanString(body.apiKeyEnv, existing.apiKeyEnv || '');
  let submittedApiKey = cleanString(body.apiKey, '');
  if (!submittedApiKey && looksLikeRawApiKey(apiKeyEnv)) {
    submittedApiKey = apiKeyEnv;
    apiKeyEnv = '';
  }

  provider.baseUrl = baseUrl.replace(/\/+$/, '');
  if (apiKeyEnv) {
    provider.apiKeyEnv = apiKeyEnv;
  } else {
    delete provider.apiKeyEnv;
  }
  if (body.clearApiKey === true) {
    delete provider.apiKey;
    delete provider.apiKeySecret;
    delete provider.apiKeyCiphertext;
    delete provider.apiKeyPreview;
  }
  if (submittedApiKey) {
    provider.apiKeyCiphertext = encryptSecret(submittedApiKey);
    provider.apiKeyPreview = maskSecret(submittedApiKey);
    delete provider.apiKey;
    delete provider.apiKeySecret;
  }
  if (!provider.apiKeyEnv && !storedProviderApiKey(provider)) {
    throw httpError(400, 'apiKey or apiKeyEnv is required for openai-compatible providers.');
  }
  provider.headers = normalizeHeaders(body.headers !== undefined ? body.headers : existing.headers);
  provider.timeoutMs = normalizeTimeout(body.timeoutMs, existing.timeoutMs ?? 120_000);
  return provider;
}

function normalizeInternalApiKeyInput(id, body, existing = {}) {
  if (!isPlainObject(body)) {
    throw httpError(400, 'API key body must be a JSON object.');
  }
  if (body.key !== undefined) {
    throw httpError(400, 'Raw internal key updates are not accepted. Use rotate: true or POST /admin/api-keys.');
  }

  const role = cleanString(body.role, existing.role || 'service');
  if (!['admin', 'service'].includes(role)) {
    throw httpError(400, 'role must be admin or service.');
  }

  const now = new Date().toISOString();
  const shouldRotate = body.rotate === true;
  const { key, ...existingWithoutSecret } = existing;
  const existingSecret = storedInternalApiKey(existing);
  const secret = shouldRotate || (!existing.keyHash && !existingSecret) ? generateInternalKey() : undefined;
  const effectiveSecret = secret || existingSecret;
  const keyHash = secret ? hashToken(secret) : existing.keyHash || (effectiveSecret ? hashToken(effectiveSecret) : undefined);
  const keyPreview = secret ? maskSecret(secret) : existing.keyPreview || (effectiveSecret ? maskSecret(effectiveSecret) : undefined);
  const keyCiphertext = secret ? encryptSecret(secret) : existing.keyCiphertext || (effectiveSecret ? encryptSecret(effectiveSecret) : undefined);
  const record = {
    ...existingWithoutSecret,
    id,
    walletId: existing.walletId || randomUUID(),
    walletManaged: existing.walletManaged === true || existing.prepaid === true || body.prepaid === true,
    prepaid: role === 'service' && (body.prepaid === undefined ? existing.prepaid === true : body.prepaid === true),
    name: cleanString(body.name, existing.name || id),
    keyHash,
    keyPreview,
    keyCiphertext,
    role,
    enabled: body.enabled !== undefined ? body.enabled !== false : existing.enabled !== false,
    perMinute: normalizeRateLimit(body.perMinute, existing.perMinute ?? 60),
    maxConcurrency: normalizeNonNegativeInteger(body.maxConcurrency, existing.maxConcurrency ?? 0, 'maxConcurrency'),
    allowedModels: normalizeAccessList(body.allowedModels, existing.allowedModels || ['*'], 'allowedModels'),
    allowedEndpoints: normalizeEndpoints(body.allowedEndpoints, existing.allowedEndpoints || ['*']),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
  return { record, secret };
}

function assertAdminKeyAvailable(nextKeys) {
  const hasEnabledAdmin = nextKeys.some((key) => key.enabled !== false && key.role === 'admin');
  if (!hasEnabledAdmin) {
    throw httpError(400, 'At least one enabled admin API key is required.');
  }
}

function isSystemInternalKey(key) {
  return key?.system === true || key?.hidden === true;
}

async function loadRecentRequestLogs() {
  if (postgresPool) {
    const result = await postgresPool.query(
      `
        SELECT entry
        FROM jetlink_gateway_request_logs
        ORDER BY time DESC, id DESC
        LIMIT 500
      `
    );
    for (const row of result.rows) {
      requestLogs.push(row.entry);
    }
    return;
  }
  try {
    const raw = await readFile(REQUEST_LOG_PATH, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean).slice(-500).reverse();
    for (const line of lines) {
      try {
        requestLogs.push(JSON.parse(line));
      } catch {
        // Ignore malformed historical lines so one bad write does not block startup.
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to load request log ${REQUEST_LOG_PATH}: ${error.message}`);
    }
  }
}

async function persistRequestLog(entry) {
  if (postgresPool) {
    await postgresPool.query(
      `
        INSERT INTO jetlink_gateway_request_logs (request_id, time, entry)
        VALUES ($1, $2, $3::jsonb)
      `,
      [entry.requestId || entry.id || null, entry.time || new Date().toISOString(), JSON.stringify(entry)]
    );
    return;
  }
  await mkdir(dirname(REQUEST_LOG_PATH), { recursive: true });
  await appendFile(REQUEST_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

async function loadRecentAuditLogs() {
  if (postgresPool) {
    const result = await postgresPool.query(
      `
        SELECT entry
        FROM jetlink_gateway_audit_logs
        ORDER BY time DESC
        LIMIT 500
      `
    );
    for (const row of result.rows) {
      auditLogs.push(row.entry);
    }
    return;
  }
  try {
    const raw = await readFile(AUDIT_LOG_PATH, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean).slice(-500).reverse();
    for (const line of lines) {
      try {
        auditLogs.push(JSON.parse(line));
      } catch {
        // Ignore malformed historical lines so one bad write does not block startup.
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn(`Unable to load audit log ${AUDIT_LOG_PATH}: ${error.message}`);
    }
  }
}

async function persistAuditLog(entry) {
  if (postgresPool) {
    await postgresPool.query(
      `
        INSERT INTO jetlink_gateway_audit_logs (id, time, entry)
        VALUES ($1, $2, $3::jsonb)
        ON CONFLICT (id)
        DO UPDATE SET time = EXCLUDED.time, entry = EXCLUDED.entry
      `,
      [entry.id || randomUUID(), entry.time || new Date().toISOString(), JSON.stringify(entry)]
    );
    return;
  }
  await mkdir(dirname(AUDIT_LOG_PATH), { recursive: true });
  await appendFile(AUDIT_LOG_PATH, `${JSON.stringify(entry)}\n`, 'utf8');
}

function pushAuditLog(entry) {
  auditLogs.unshift(entry);
  if (auditLogs.length > 500) {
    auditLogs.pop();
  }
  persistAuditLog(entry).catch((error) => {
    console.warn(`Unable to persist audit log: ${error.message}`);
  });
}

function auditAdminAction(auth, action, resource, target, details = {}) {
  pushAuditLog({
    id: randomUUID(),
    time: new Date().toISOString(),
    actorKeyId: auth.key.id,
    action,
    resource,
    target,
    details
  });
}

function classifyEndpoint(pathname) {
  if (pathname.includes('/chat/completions')) return 'chat';
  if (pathname.includes('/responses')) return 'responses';
  if (pathname.includes('/messages')) return 'messages';
  if (pathname.includes('/embeddings')) return 'embeddings';
  if (pathname.includes('/rerank')) return 'rerank';
  if (pathname.includes('/images/')) return 'images';
  if (pathname.includes('/audio/')) return 'audio';
  if (pathname.includes('/models')) return 'models';
  return 'generic';
}

function keyAllows(value, allowed = ['*']) {
  const list = Array.isArray(allowed) && allowed.length ? allowed : ['*'];
  return list.includes('*') || list.includes(value);
}

function authorizeProxyAccess(key, modelAlias, endpointKind) {
  if (key.role === 'admin') {
    return { ok: true };
  }
  if (!keyAllows(modelAlias, key.allowedModels)) {
    return { ok: false, status: 403, error: `API key ${key.id} is not allowed to use model alias ${modelAlias}.` };
  }
  if (!keyAllows(endpointKind, key.allowedEndpoints)) {
    return { ok: false, status: 403, error: `API key ${key.id} is not allowed to use endpoint type ${endpointKind}.` };
  }
  return { ok: true };
}

function modelVisibleToKey(key, alias, model) {
  if (key.accountId && (!model.saasEnabled || !availableRoutes(model,true,key.modelGroup).length)) return false;
  if (key.role === 'admin') {
    return true;
  }
  if (!keyAllows(alias, key.allowedModels)) {
    return false;
  }
  const modelEndpoints = model.endpoints || ['*'];
  const keyEndpoints = key.allowedEndpoints || ['*'];
  return modelEndpoints.includes('*') || keyEndpoints.includes('*') || modelEndpoints.some((endpoint) => keyEndpoints.includes(endpoint));
}

const PREPAID_PROXY_PATHS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses', '/v1/embeddings',
  '/v1/images/generations', '/v1/images/edits', '/v1/images/variations']);
const DEFAULT_PREPAID_OUTPUT_TOKENS = 4096;
const MAX_PREPAID_OUTPUT_TOKENS = 32768;
const PREPAID_MEDIA_TYPES = new Set(['image', 'image_url', 'input_image', 'input_audio', 'audio', 'audio_url', 'video', 'input_video',
  'file', 'input_file', 'document']);

function prepaidAdmission(tariff, endpointKind, proxyBody) {
  if (tariff.image) return prepaidBudget(tariff, 0, 0);
  if (proxyBody.kind !== 'json') throw httpError(422, '预付费 Token 接口暂不支持附件上传');
  const body = proxyBody.requestBody;
  if ((Array.isArray(body.modalities) && body.modalities.includes('audio')) || body.audio || accountRequestReferencesSharedResource(body) ||
    (Array.isArray(body.tools) && body.tools.some(tool => tool?.type && !['function', 'custom'].includes(tool.type)))) {
    throw httpError(422, '预付费暂不支持无法估算用量的托管工具、音频或外部上下文');
  }
  const queue = [body];
  let frames = 0;
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== 'object') continue;
    if (PREPAID_MEDIA_TYPES.has(value.type)) throw httpError(422, '预付费 Token 接口暂不支持图片、音频或文件输入');
    if (!Array.isArray(value)) frames += 1;
    for (const child of Object.values(value)) if (child && typeof child === 'object') queue.push(child);
  }

  let output = 0;
  if (endpointKind !== 'embeddings') {
    const field = endpointKind === 'responses' ? 'max_output_tokens'
      : endpointKind === 'chat' && body.max_tokens === undefined ? 'max_completion_tokens' : 'max_tokens';
    if (endpointKind === 'chat' && body.max_tokens !== undefined && body.max_completion_tokens !== undefined)
      throw httpError(400, '请只指定一个输出上限字段');
    const perChoice = body[field] === undefined ? DEFAULT_PREPAID_OUTPUT_TOKENS : body[field];
    if (!Number.isSafeInteger(perChoice) || perChoice < 1 || perChoice > MAX_PREPAID_OUTPUT_TOKENS)
      throw httpError(400, `预付费输出上限需为 1–${MAX_PREPAID_OUTPUT_TOKENS} Token`);
    const choices = endpointKind === 'chat' && body.n !== undefined ? body.n : 1;
    if (!Number.isSafeInteger(choices) || choices < 1 || choices * perChoice > MAX_PREPAID_OUTPUT_TOKENS)
      throw httpError(400, `预付费单次请求的总输出上限不得超过 ${MAX_PREPAID_OUTPUT_TOKENS} Token`);
    body[field] = perChoice;
    output = choices * perChoice;
  }
  // Quote conservatively from request bytes plus framing. Actual settlement still uses reported usage.
  const input = Buffer.byteLength(JSON.stringify(body), 'utf8') + 256 + frames * 16;
  return prepaidBudget(tariff, input, output);
}

function accountRequestReferencesSharedResource(body) {
  const queue = [body];
  while (queue.length) {
    const value = queue.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.file_id || value.file_ids || value.vector_store_ids || value.previous_response_id
      || value.conversation || value.prompt?.id || value.container || value.background || value.type === 'item_reference'
      || value.type === 'file_search' || value.type === 'code_interpreter') return true;
    for (const [key, child] of Object.entries(value)) {
      if (['parameters', 'input_schema', 'schema', 'metadata'].includes(key)) continue;
      if (child && typeof child === 'object') queue.push(child);
    }
  }
  return false;
}

function configuredRouteCandidates(mapping) {
  const rawCandidates = [];
  if (Array.isArray(mapping.routes) && mapping.routes.length) {
    for (const route of mapping.routes) {
      rawCandidates.push(route);
    }
  } else {
    rawCandidates.push({
      provider: mapping.provider,
      upstreamModel: mapping.upstreamModel,
      enabled: true,
      label: 'primary route'
    });
    for (const fallback of mapping.fallbacks || []) {
      rawCandidates.push(fallback);
    }
  }

  const candidates = [];
  const seen = new Set();
  for (const [index, candidate] of rawCandidates.entries()) {
    if (!candidate || candidate.enabled === false) {
      continue;
    }
    const providerId = cleanString(candidate.provider);
    const upstreamModel = cleanString(candidate.upstreamModel);
    if (!providerId || !upstreamModel) {
      continue;
    }
    const dedupeKey = `${providerId}:${upstreamModel}`;
    if (seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);
    candidates.push({
      provider: providerId,
      upstreamModel,
      label: cleanString(candidate.label, index === 0 ? 'primary route' : `fallback route ${index}`)
    });
  }
  return candidates;
}

function providerConfigured(provider) {
  return provider?.type === 'mock' || Boolean(provider && upstreamApiKey(provider));
}

function availableRoutes(mapping, publicOnly = false, group) {
  return configuredRouteCandidates(mapping)
    .map((candidate) => ({
      ...candidate,
      providerConfig: config.providers?.[candidate.provider]
    }))
    .filter(
      ({ providerConfig }) =>
        providerConfig &&
        providerConfig.enabled !== false &&
        (!publicOnly || providerConfigured(providerConfig)) &&
        (group === undefined || (providerConfig.modelGroup || 'default') === group)
    );
}

function cnyPrice(id) {
  const overrides = config.cnyPricing?.prices || {};
  if (Object.hasOwn(overrides, id)) return overrides[id];
  return Object.hasOwn(CNY_PRICES, id) ? CNY_PRICES[id] : undefined;
}

function cnyPriceId(alias, upstreamModel) {
  return [alias, upstreamModel].find(id => id && cnyPrice(id));
}

function cnyPrices() {
  const prices = { ...CNY_PRICES };
  for (const [id, price] of Object.entries(config.cnyPricing?.prices || {})) {
    if (price === null) delete prices[id];
    else prices[id] = price;
  }
  return prices;
}

function publishedCnyPrices(usableOnly = false) {
  const prices = cnyPrices();
  for (const [alias, model] of Object.entries(config.models)) {
    const id = cnyPriceId(alias, model.upstreamModel);
    if (model.saasEnabled && model.enabled !== false && id) prices[alias] = cnyPrice(id);
  }
  if (!usableOnly) return prices;
  const usable = new Set(publicModelList({ accountId: true, role: 'service' }).map((m) => m.id));
  const filtered = {};
  for (const [alias, price] of Object.entries(prices)) {
    if (usable.has(alias)) filtered[alias] = price;
  }
  return filtered;
}

function managedGroups() {
  const groups = new Map([['default', { id: 'default', name: null, channels: [], modelCount: 0 }]]);
  for (const [id, group] of Object.entries(config.modelGroups || {})) {
    groups.set(id, { id, name: group.name, channels: [], modelCount: 0 });
  }
  for (const [id, channel] of Object.entries(config.providers)) {
    const group = channel.modelGroup || 'default';
    if (!groups.has(group)) groups.set(group, { id: group, name: group, channels: [], modelCount: 0 });
    groups.get(group).channels.push({ id, name: channel.name || id });
  }
  for (const model of publicModelList({ accountId: true, role: 'service' })) {
    for (const id of model.groups) groups.get(id).modelCount++;
  }
  return [...groups.values()];
}

function modelGroups(mapping) {
  return [
    ...new Set(availableRoutes(mapping, true).map(({ providerConfig }) => providerConfig.modelGroup || 'default'))
  ].sort();
}

function resolveModel(alias, endpointKind, accountKey) {
  const modelAlias = alias || config.routing?.defaultModel;
  if (!modelAlias) {
    return { ok: false, status: 400, error: 'Missing model and no default model configured.' };
  }
  const mapping = config.models?.[modelAlias];
  if (!mapping || mapping.enabled === false) {
    return { ok: false, status: 400, error: `Unknown or disabled model alias: ${modelAlias}` };
  }
  const endpoints = mapping.endpoints || ['*'];
  if (!endpoints.includes('*') && !endpoints.includes(endpointKind)) {
    return {
      ok: false,
      status: 400,
      error: `Model alias ${modelAlias} does not allow endpoint type ${endpointKind}.`
    };
  }
  const candidates = availableRoutes(mapping, Boolean(accountKey), accountKey?.modelGroup);
  if (!candidates.length) {
    return { ok: false, status: 502, error: `Provider unavailable for model alias: ${modelAlias}` };
  }
  return { ok: true, alias: modelAlias, mapping, candidates };
}

function buildUpstreamUrl(provider, pathname, search) {
  const baseUrl = String(provider.baseUrl || '').replace(/\/+$/, '');
  if (!baseUrl) {
    throw new Error(`Provider ${provider.name || ''} is missing baseUrl.`);
  }
  let upstreamPath = pathname;
  if (baseUrl.endsWith('/v1') && pathname.startsWith('/v1/')) {
    upstreamPath = pathname.slice(3);
  }
  return `${baseUrl}${upstreamPath}${search || ''}`;
}

function buildUpstreamHeaders(req, provider, requestId, options = {}) {
  const bodyKind = options.bodyKind || 'json';
  const headers = new Headers();
  for (const name of UPSTREAM_CLIENT_HEADERS) {
    const value = req.headers[name];
    if (value !== undefined) {
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
  }
  if (bodyKind === 'json') {
    headers.set('content-type', 'application/json');
  }
  headers.set('x-request-id', requestId);
  const apiKey = upstreamApiKey(provider);
  if (apiKey) {
    headers.set('authorization', `Bearer ${apiKey}`);
  }
  for (const [name, value] of Object.entries(provider.headers || {})) {
    headers.set(name, value);
  }
  return headers;
}

function upstreamApiKey(provider) {
  return storedProviderApiKey(provider) || (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
}

async function upstreamErrorDetail(upstream) {
  try {
    const text = cleanString(await upstream.text(), '').replace(/\s+/g, ' ').slice(0, 500);
    if (!text) {
      return '';
    }
    if ((upstream.headers.get('content-type') || '').includes('json')) {
      try {
        const body = JSON.parse(text);
        const error = isPlainObject(body.error) ? body.error : {};
        const code = cleanString(body.code || body.Code || body.errorCode || error.code, '');
        const message = cleanString(body.message || body.Message || body.msg || error.message, '');
        return [code, message].filter(Boolean).join(': ') || text;
      } catch {
        return text;
      }
    }
    return text;
  } catch {
    return '';
  }
}

function failoverStatusSet() {
  return new Set(normalizeStatusCodes(config.routing?.failoverStatusCodes, DEFAULT_FAILOVER_STATUS_CODES));
}

function shouldFailoverStatus(status) {
  return failoverStatusSet().has(Number(status));
}

function statusFromProxyError(error) {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 504;
  }
  return error.status || 502;
}

function shouldFailoverError(error) {
  return config.routing?.failoverOnNetworkError !== false && statusFromProxyError(error) >= 500;
}

function setProxyResponseHeaders(res, upstream, requestId, alias) {
  res.statusCode = upstream.status;
  for (const [name, value] of upstream.headers.entries()) {
    const lower = name.toLowerCase();
    if (PUBLIC_UPSTREAM_RESPONSE_HEADERS.has(lower)) {
      res.setHeader(name, value);
    }
  }
  res.setHeader('x-request-id', requestId);
  res.setHeader('x-jetlink-model-alias', alias);
}

function scopeKey(scope) {
  return `${scope.type}:${scope.id || 'default'}`;
}

function activeCountFor(scope) {
  return concurrencyState.inFlightByScope.get(scopeKey(scope)) || 0;
}

function totalInFlight() {
  return activeCountFor({ type: 'global', id: 'all' });
}

function canAcquireScopes(scopes) {
  return scopes.every((scope) => !scope.limit || activeCountFor(scope) < scope.limit);
}

function incrementScopes(scopes) {
  for (const scope of scopes) {
    if (!scope.limit) {
      continue;
    }
    const key = scopeKey(scope);
    concurrencyState.inFlightByScope.set(key, (concurrencyState.inFlightByScope.get(key) || 0) + 1);
  }
  concurrencyState.accepted += 1;
  concurrencyState.maxObservedInFlight = Math.max(concurrencyState.maxObservedInFlight, totalInFlight());
}

function decrementScopes(scopes) {
  for (const scope of scopes) {
    if (!scope.limit) {
      continue;
    }
    const key = scopeKey(scope);
    const next = Math.max(0, (concurrencyState.inFlightByScope.get(key) || 0) - 1);
    if (next) {
      concurrencyState.inFlightByScope.set(key, next);
    } else {
      concurrencyState.inFlightByScope.delete(key);
    }
  }
  concurrencyState.completed += 1;
  drainConcurrencyQueue();
}

function concurrencyError(message, retryAfterSeconds = 1, retryable = false) {
  const error = httpError(429, message);
  error.retryAfterSeconds = retryAfterSeconds;
  error.retryable = retryable;
  return error;
}

function acquireConcurrency(scopes, meta = {}) {
  const { signal } = meta;
  signal?.throwIfAborted();
  const limitedScopes = scopes.filter((scope) => Number(scope.limit || 0) > 0);
  if (concurrencyState.shuttingDown) {
    throw httpError(503, 'Gateway is shutting down and not accepting new proxy requests.');
  }
  if (!limitedScopes.length) {
    return Promise.resolve(() => undefined);
  }
  if (canAcquireScopes(limitedScopes)) {
    incrementScopes(limitedScopes);
    let released = false;
    return Promise.resolve(() => {
      if (!released) {
        released = true;
        decrementScopes(limitedScopes);
      }
    });
  }

  const queueLimit = Number(config.limits?.maxQueuedRequests ?? 1000);
  if (!queueLimit || concurrencyState.queue.length >= queueLimit) {
    concurrencyState.rejected += 1;
    throw concurrencyError('Gateway concurrency limit exceeded.', 1, Boolean(meta.retryable));
  }

  concurrencyState.queued += 1;
  const queueTimeoutMs = Number(config.limits?.queueTimeoutMs ?? 5000);
  return new Promise((resolve, reject) => {
    const entry = {
      scopes: limitedScopes,
      queuedAt: Date.now(),
      resolve,
      cleanup: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      }
    };
    const removeEntry = () => {
      concurrencyState.queue.splice(concurrencyState.queue.indexOf(entry), 1);
      entry.cleanup();
    };
    const onAbort = () => {
      removeEntry();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      removeEntry();
      concurrencyState.queueTimeouts += 1;
      concurrencyState.rejected += 1;
      reject(concurrencyError('Gateway concurrency queue timeout.', Math.max(1, Math.ceil(queueTimeoutMs / 1000)), Boolean(meta.retryable)));
    }, queueTimeoutMs);
    concurrencyState.queue.push(entry);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function drainConcurrencyQueue() {
  for (let index = 0; index < concurrencyState.queue.length; index += 1) {
    const entry = concurrencyState.queue[index];
    if (!canAcquireScopes(entry.scopes)) {
      continue;
    }
    concurrencyState.queue.splice(index, 1);
    index -= 1;
    entry.cleanup();
    incrementScopes(entry.scopes);
    let released = false;
    entry.resolve(() => {
      if (!released) {
        released = true;
        decrementScopes(entry.scopes);
      }
    });
  }
}

function concurrencySnapshot() {
  const byScope = {};
  for (const [key, value] of concurrencyState.inFlightByScope.entries()) {
    byScope[key] = value;
  }
  return {
    shuttingDown: concurrencyState.shuttingDown,
    inFlight: totalInFlight(),
    queueLength: concurrencyState.queue.length,
    accepted: concurrencyState.accepted,
    completed: concurrencyState.completed,
    rejected: concurrencyState.rejected,
    queued: concurrencyState.queued,
    queueTimeouts: concurrencyState.queueTimeouts,
    maxObservedInFlight: concurrencyState.maxObservedInFlight,
    byScope
  };
}

function requestConcurrencyScopes(auth, modelAlias, mapping) {
  return [
    { type: 'global', id: 'all', limit: config.limits?.maxInFlightRequests },
    { type: 'apiKey', id: auth.key.id, limit: auth.key.maxConcurrency ?? config.limits?.maxInFlightPerApiKey },
    { type: 'model', id: modelAlias, limit: mapping.maxConcurrency ?? config.limits?.maxInFlightPerModel }
  ];
}

function providerConcurrencyScopes(candidate) {
  return [
    {
      type: 'provider',
      id: candidate.provider,
      limit: candidate.providerConfig?.maxConcurrency ?? config.limits?.maxInFlightPerProvider
    }
  ];
}

function mockUsageForEndpoint(endpointKind, stream = false) {
  if (stream) {
    return undefined;
  }
  if (endpointKind === 'embeddings') {
    return { inputTokens: 8, outputTokens: 0, totalTokens: 8 };
  }
  if (endpointKind === 'messages') {
    return { inputTokens: 12, outputTokens: 12, totalTokens: 24 };
  }
  if (endpointKind === 'responses') {
    return { inputTokens: 12, outputTokens: 12, totalTokens: 24 };
  }
  return { inputTokens: 12, outputTokens: 12, totalTokens: 24 };
}

function normalizeUsagePayload(usage) {
  if (!isPlainObject(usage)) {
    return undefined;
  }
  if ([usage.prompt_tokens, usage.input_tokens, usage.inputTokens, usage.completion_tokens,
    usage.output_tokens, usage.outputTokens].every(value => value == null)) return undefined;
  const read = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0);
  const write = Number(usage.cache_creation_input_tokens ?? 0);
  const anthropic = usage.cache_read_input_tokens !== undefined || usage.cache_creation_input_tokens !== undefined;
  const countedInput = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0);
  const inputTokens = countedInput + (anthropic ? read + write : 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  if (![inputTokens, outputTokens, totalTokens].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens,
    ...(read ? { cacheReadTokens: read } : {}), ...(write ? { cacheWriteTokens: write } : {}) };
}

function extractUsageFromPayload(payload) {
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const direct = normalizeUsagePayload(payload.usage ?? payload.response?.usage);
  if (direct) {
    return direct;
  }
  if (Array.isArray(payload.output)) {
    for (const item of payload.output) {
      const nested = normalizeUsagePayload(item?.usage);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

function parseJsonPayload(buffer, contentType = '') {
  if (!contentType.toLowerCase().includes('json')) {
    return undefined;
  }
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch {
    return undefined;
  }
}

function sanitizeProxyPayload(value, alias) {
  if (Array.isArray(value)) {
    for (const item of value) {
      sanitizeProxyPayload(item, alias);
    }
    return value;
  }
  if (!isPlainObject(value)) {
    return value;
  }
  for (const key of Object.keys(value)) {
    if (key === 'model') {
      value[key] = alias;
      continue;
    }
    if (['upstream_model', 'upstreamModel', 'provider', 'routes', 'attempts'].includes(key)) {
      delete value[key];
      continue;
    }
    sanitizeProxyPayload(value[key], alias);
  }
  return value;
}

function isBillableStatus(status) {
  const code = Number(status || 0);
  return code >= 200 && code < 400;
}

function normalizeBillableCount(value, fallback = 0) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) {
    return fallback;
  }
  return Math.floor(count);
}

function requestedImageCount(body) {
  return Math.max(1, normalizeBillableCount(body?.n ?? body?.parameters?.n ?? body?.input?.n, 1));
}

function countArrayImages(value) {
  return Array.isArray(value) ? value.length : 0;
}

function countGeneratedImages(payload) {
  if (!isPlainObject(payload)) {
    return 0;
  }
  const candidates = [
    payload.data,
    payload.images,
    payload.results,
    payload.output?.data,
    payload.output?.images,
    payload.output?.results,
    payload.result?.data,
    payload.result?.images,
    payload.result?.results
  ];
  for (const candidate of candidates) {
    const count = countArrayImages(candidate);
    if (count > 0) {
      return count;
    }
  }
  if (payload.url || payload.image_url || payload.b64_json || payload.output?.url || payload.output?.image_url || payload.output?.b64_json) {
    return 1;
  }
  return 0;
}

function buildBillableUsage({ endpointKind, requestBody, responsePayload, status, usage }) {
  const ok = isBillableStatus(status);
  const inputTokens = normalizeBillableCount(usage?.inputTokens, 0);
  const outputTokens = normalizeBillableCount(usage?.outputTokens, 0);
  const totalTokens = normalizeBillableCount(usage?.totalTokens, inputTokens + outputTokens);
  let images = 0;
  if (ok && endpointKind === 'images') {
    images = countGeneratedImages(responsePayload) || requestedImageCount(requestBody);
  }
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    images,
    requests: ok ? 1 : 0
  };
}

function billableUsageFromLog(log) {
  const fallback = buildBillableUsage({
    endpointKind: classifyEndpoint(log.endpoint || ''),
    requestBody: undefined,
    responsePayload: undefined,
    status: log.status,
    usage: log.usage
  });
  const stored = isPlainObject(log.billableUsage) ? log.billableUsage : {};
  return {
    inputTokens: normalizeBillableCount(stored.inputTokens, fallback.inputTokens),
    outputTokens: normalizeBillableCount(stored.outputTokens, fallback.outputTokens),
    totalTokens: normalizeBillableCount(stored.totalTokens, fallback.totalTokens),
    images: normalizeBillableCount(stored.images, fallback.images),
    requests: normalizeBillableCount(stored.requests, fallback.requests)
  };
}

function estimateCost(modelAlias, usage, billableUsage, status) {
  const pricing = config.pricing?.models?.[modelAlias];
  if (!pricing) {
    return undefined;
  }
  const currency = pricing.currency || config.pricing?.currency || 'USD';
  const billingUnit = PRICING_BILLING_UNITS.has(pricing.billingUnit) ? pricing.billingUnit : 'token';
  const billable = billableUsage || buildBillableUsage({ endpointKind: '', status, usage });
  const inputTokens = normalizeBillableCount(usage?.inputTokens ?? billable.inputTokens, 0);
  const outputTokens = normalizeBillableCount(usage?.outputTokens ?? billable.outputTokens, 0);
  const totalTokens = normalizeBillableCount(usage?.totalTokens ?? billable.totalTokens, inputTokens + outputTokens);
  const units = {
    inputTokens,
    outputTokens,
    totalTokens,
    images: normalizeBillableCount(billable.images, 0),
    requests: normalizeBillableCount(billable.requests, 0)
  };

  if (billingUnit === 'image') {
    const imageCost = units.images * Number(pricing.imageUnitPrice || 0);
    return {
      currency,
      billingUnit,
      unitLabel: pricing.unitLabel || 'image',
      inputCost: 0,
      outputCost: 0,
      imageCost: Number(imageCost.toFixed(10)),
      requestCost: 0,
      totalCost: Number(imageCost.toFixed(10)),
      units
    };
  }

  if (billingUnit === 'request') {
    const requestCost = units.requests * Number(pricing.requestUnitPrice || 0);
    return {
      currency,
      billingUnit,
      unitLabel: pricing.unitLabel || 'request',
      inputCost: 0,
      outputCost: 0,
      imageCost: 0,
      requestCost: Number(requestCost.toFixed(10)),
      totalCost: Number(requestCost.toFixed(10)),
      units
    };
  }

  if (!usage) {
    return undefined;
  }
  const inputCost = (usage.inputTokens / 1_000_000) * Number(pricing.inputPerMillionTokens || 0);
  const outputCost = (usage.outputTokens / 1_000_000) * Number(pricing.outputPerMillionTokens || 0);
  return {
    currency,
    billingUnit,
    unitLabel: pricing.unitLabel || 'token',
    inputCost: Number(inputCost.toFixed(10)),
    outputCost: Number(outputCost.toFixed(10)),
    imageCost: 0,
    requestCost: 0,
    totalCost: Number((inputCost + outputCost).toFixed(10)),
    units
  };
}

function applyUsageAccounting(logEntry, modelAlias, usage, billableUsage) {
  if (usage) {
    logEntry.usage = usage;
  }
  if (billableUsage) {
    logEntry.billableUsage = billableUsage;
  }
  logEntry.estimatedCost = estimateCost(modelAlias, usage, billableUsage, logEntry.status) ?? null;
}

function estimatedCostFromLog(log) {
  if (log.estimatedCost !== undefined) {
    return log.estimatedCost ?? undefined;
  }
  return estimateCost(log.modelAlias, log.usage, billableUsageFromLog(log), log.status);
}

function enrichLogWithBilling(log) {
  return {
    ...log,
    billableUsage: billableUsageFromLog(log),
    estimatedCost: estimatedCostFromLog(log)
  };
}

function sanitizeSseEvent(lines, alias, onPayload) {
  const data = lines.filter((line) => line === 'data' || line.startsWith('data:'));
  if (!data.length) return lines.join('\n');
  let payload;
  try {
    payload = JSON.parse(data.map((line) => line.slice(5).replace(/^ /, '')).join('\n'));
  } catch {
    return lines.join('\n');
  }
  onPayload(payload);
  const fields = lines.filter((line) => line !== 'data' && !line.startsWith('data:'));
  fields.push(`data: ${JSON.stringify(sanitizeProxyPayload(payload, alias))}`);
  return fields.join('\n');
}

function createProxyStreamSanitizer(alias, onPayload) {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let eventLines = [];
  let eventLength = 0;
  const maxEventLength = 26_214_400;

  const processText = (text, flush = false) => {
    pending += text;
    if (flush && pending.endsWith('\r')) pending += '\n';
    // Retain a trailing CR until the next chunk can complete a CRLF.
    const lines = pending.split(/\r\n|\n|\r(?=[\s\S])/);
    pending = lines.pop() || '';
    let output = '';
    for (const line of lines) {
      if (line === '') {
        output += eventLines.length ? `${sanitizeSseEvent(eventLines, alias, onPayload)}\n\n` : '\n';
        eventLines = [];
        eventLength = 0;
      } else {
        eventLines.push(line);
        eventLength += line.length + 1;
        if (eventLength > maxEventLength) {
          throw new Error('Upstream SSE event exceeded the size limit.');
        }
      }
    }
    if (eventLength + pending.length > maxEventLength) {
      throw new Error('Upstream SSE event exceeded the size limit.');
    }
    if (flush) {
      if (pending) eventLines.push(pending);
      if (eventLines.length) output += sanitizeSseEvent(eventLines, alias, onPayload);
    }
    return output;
  };

  return new Transform({
    transform(chunk, encoding, callback) {
      try {
        callback(null, processText(decoder.write(chunk)));
      } catch (error) {
        callback(error);
      }
    },
    flush(callback) {
      try {
        callback(null, processText(decoder.end(), true));
      } catch (error) {
        callback(error);
      }
    }
  });
}

async function handleProxy(req, res, url, auth) {
  const started = Date.now();
  const requestId = req.headers['x-request-id'] || randomUUID();
  const endpointKind = classifyEndpoint(url.pathname);
  const clientAbort = new AbortController();
  const { signal } = clientAbort;
  const onClose = () => {
    if (!res.writableFinished) {
      clientAbort.abort(httpError(499, 'Client disconnected.'));
    }
  };
  res.once('close', onClose);
  let requestRelease = () => undefined;
  let debitId;
  let tariff;
  let actualImages;
  let startedResponse = false;
  let logEntry = {
    requestId,
    time: new Date().toISOString(),
    apiKeyId: auth.key.id,
    ...(auth.key.accountId && { accountId: auth.key.accountId, username: auth.key.username, modelGroup: auth.key.modelGroup }),
    endpoint: url.pathname,
    status: 500,
    durationMs: 0,
    estimatedCost: null
  };

  try {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      logEntry.status = 405;
      sendJson(res, 405, { error: 'Only POST/PUT/PATCH proxy requests are supported for /v1/*.' });
      return;
    }

    const proxyBody = await readProxyBody(req);
    logEntry.modelAlias = proxyBody.model || config.routing?.defaultModel;
    if (auth.key.accountId) {
      const alias = proxyBody.model || config.routing?.defaultModel;
      if (!config.models?.[alias] || !modelVisibleToKey(auth.key, alias, config.models[alias])) throw httpError(403, '该 Key 的分组未开放此模型');
      if (req.method !== 'POST' || !PREPAID_PROXY_PATHS.has(url.pathname)) throw httpError(403, '此接口未向注册用户开放');
      if (accountRequestReferencesSharedResource(proxyBody.requestBody)) throw httpError(400, '公共渠道仅支持在请求内提交上下文和文件');
      if (endpointKind === 'responses' || endpointKind === 'chat') proxyBody.requestBody.store = false;
    }
    const resolved = resolveModel(proxyBody.model, endpointKind, auth.key.accountId ? auth.key : undefined);
    if (!resolved.ok) {
      logEntry.status = resolved.status;
      logEntry.modelAlias = proxyBody.model;
      sendJson(res, resolved.status, { error: resolved.error, request_id: requestId });
      return;
    }

    const { alias, mapping, candidates } = resolved;
    const authorization = authorizeProxyAccess(auth.key, alias, endpointKind);
    if (!authorization.ok) {
      logEntry.status = authorization.status;
      logEntry.modelAlias = alias;
      sendJson(res, authorization.status, { error: authorization.error, request_id: requestId });
      return;
    }

    const attempts = [];
    logEntry = {
      ...logEntry,
      modelAlias: alias,
      upstreamModel: candidates[0].upstreamModel,
      provider: candidates[0].provider,
      attempts
    };
    requestRelease = await acquireConcurrency(requestConcurrencyScopes(auth, alias, mapping), { signal });

    if (auth.key.prepaid) {
      if (req.method !== 'POST' || !PREPAID_PROXY_PATHS.has(url.pathname)) throw httpError(403, '此接口未开放预付费调用');
      const priceModel = cnyPriceId(alias, mapping.upstreamModel);
      tariff = cnyPrice(priceModel);
      const version = config.cnyPricing?.version || PRICE_DATE;
      if (!tariff || Boolean(tariff.image) !== (endpointKind === 'images')) {
        throw httpError(422, '该模型或接口尚未配置售价');
      }
      if (tariff.image && proxyBody.stream) throw httpError(422, '按次计费的图像模型目前仅支持非流式返回');
      if (endpointKind === 'chat' && proxyBody.kind === 'json' && proxyBody.stream) {
        proxyBody.requestBody.stream_options = { ...proxyBody.requestBody.stream_options, include_usage: true };
      }
      const maxDuration = candidates.reduce((ms, c) => ms + normalizeTimeout(c.providerConfig.timeoutMs,120000)
        + Number(config.limits?.queueTimeoutMs || 0), 60000);
      const required = prepaidAdmission(tariff, endpointKind, proxyBody);
      debitId = await (await walletStore()).begin(auth.key.walletId, priceModel, maxDuration, version, required);
      logEntry.billingId = debitId;
      logEntry.priceVersion = version;
    }

    let lastFailure = null;
    for (const [index, candidate] of candidates.entries()) {
      const provider = candidate.providerConfig;
      let providerRelease = () => undefined;
      let upstreamTimeout;
      let streamedUsage;
      const attempt = {
        provider: candidate.provider,
        upstreamModel: candidate.upstreamModel,
        route: candidate.label,
        status: 500,
        durationMs: 0
      };
      const attemptStarted = Date.now();
      const hasNextCandidate = index < candidates.length - 1;

      try {
        logEntry.provider = candidate.provider;
        logEntry.upstreamModel = candidate.upstreamModel;
        providerRelease = await acquireConcurrency(providerConcurrencyScopes(candidate), {
          signal,
          retryable: true
        });
        signal.throwIfAborted();

        if (provider.type === 'mock') {
          startedResponse = true;
          await handleMockProvider(req, res, {
            requestId,
            endpointKind,
            path: url.pathname,
            body: proxyBody.requestBody,
            alias
          });
          attempt.status = 200;
          logEntry.status = 200;
          const usage = mockUsageForEndpoint(endpointKind, proxyBody.stream);
          applyUsageAccounting(logEntry, alias, usage, buildBillableUsage({
            endpointKind,
            requestBody: proxyBody.requestBody,
            status: logEntry.status,
            usage
          }));
          return;
        }

        if (provider.type !== 'openai-compatible') {
          throw httpError(502, `Unsupported provider type: ${provider.type}`);
        }

        const apiKey = upstreamApiKey(provider);
        if (!apiKey) {
          throw httpError(502, `Provider API key missing. Set ${provider.apiKeyEnv || 'provider.apiKey'} for ${candidate.provider}.`);
        }

        upstreamTimeout = AbortSignal.timeout(normalizeTimeout(provider.timeoutMs, 120_000));
        const upstream = await fetch(buildUpstreamUrl(provider, url.pathname, url.search), {
          method: req.method,
          headers: buildUpstreamHeaders(req, provider, requestId, { bodyKind: proxyBody.kind }),
          body: proxyBody.buildUpstreamBody(candidate.upstreamModel),
          redirect: 'error',
          signal: AbortSignal.any([signal, upstreamTimeout])
        });

        attempt.status = upstream.status;
        const canFailover = hasNextCandidate && shouldFailoverStatus(upstream.status);
        if (canFailover) {
          attempt.retryable = true;
          lastFailure = {
            status: upstream.status,
            provider: candidate.provider,
            upstreamModel: candidate.upstreamModel,
            error: `Upstream ${candidate.provider} returned HTTP ${upstream.status}`
          };
          await upstream.body?.cancel().catch(() => undefined);
          continue;
        }

        logEntry.status = upstream.status;
        if (!upstream.ok) {
          if (upstream.body) {
            const payload = Buffer.from(await upstream.arrayBuffer());
            const contentType = upstream.headers.get('content-type') || '';
            const detail = parseJsonPayload(payload, contentType);
            logEntry.error = cleanString(detail?.error?.message || detail?.message || detail?.error, `Upstream returned HTTP ${upstream.status}`);
          } else {
            logEntry.error = `Upstream returned HTTP ${upstream.status}`;
          }
          sendJson(res, upstream.status, {
            error: 'Upstream request failed.',
            request_id: requestId
          }, { 'x-request-id': requestId, 'x-jetlink-model-alias': alias });
          return;
        }

        startedResponse = true;
        setProxyResponseHeaders(res, upstream, requestId, alias);
        if (upstream.body) {
          const contentType = upstream.headers.get('content-type') || '';
          const isSse = contentType.toLowerCase().includes('text/event-stream');
          if (isSse || (proxyBody.stream && !contentType.toLowerCase().includes('json'))) {
            const stream = Readable.fromWeb(upstream.body);
            if (isSse) {
              const sanitizer = createProxyStreamSanitizer(alias, (payload) => {
                if (payload?.type === 'message_start') {
                  streamedUsage = normalizeUsagePayload(payload.message?.usage);
                } else if (payload?.type === 'message_delta' && streamedUsage && payload.usage?.output_tokens !== undefined) {
                  streamedUsage.outputTokens = Number(payload.usage.output_tokens);
                  streamedUsage.totalTokens = streamedUsage.inputTokens + streamedUsage.outputTokens;
                } else {
                  const reportedUsage = extractUsageFromPayload(payload);
                  if (reportedUsage) streamedUsage = reportedUsage;
                }
              });
              res.setHeader('x-accel-buffering', 'no');
              res.flushHeaders();
              await pipeline(stream, sanitizer, res);
            } else {
              await pipeline(stream, res);
            }
            applyUsageAccounting(logEntry, alias, streamedUsage, buildBillableUsage({
              endpointKind,
              requestBody: proxyBody.requestBody,
              status: logEntry.status,
              usage: streamedUsage
            }));
          } else {
            const payload = Buffer.from(await upstream.arrayBuffer());
            const responsePayload = parseJsonPayload(payload, contentType);
            if (tariff?.image) actualImages = countGeneratedImages(responsePayload);
            const usage = extractUsageFromPayload(responsePayload);
            applyUsageAccounting(logEntry, alias, usage, buildBillableUsage({
              endpointKind,
              requestBody: proxyBody.requestBody,
              responsePayload,
              status: logEntry.status,
              usage
            }));
            res.end(responsePayload === undefined ? payload : JSON.stringify(sanitizeProxyPayload(responsePayload, alias)));
          }
        } else {
          applyUsageAccounting(logEntry, alias, undefined, buildBillableUsage({
            endpointKind,
            requestBody: proxyBody.requestBody,
            status: logEntry.status
          }));
          res.end();
        }
        return;
      } catch (error) {
        const clientDisconnected = signal.aborted
          && (!res.headersSent || error.code === 'ERR_STREAM_PREMATURE_CLOSE' || error === signal.reason || error.name === 'AbortError');
        attempt.status = upstreamTimeout?.aborted ? 504 : clientDisconnected ? 499 : statusFromProxyError(error);
        attempt.error = error.message;
        const canFailover = !signal.aborted && !res.headersSent && !res.destroyed
          && hasNextCandidate && (error.retryable || shouldFailoverError(error));
        attempt.retryable = canFailover;
        lastFailure = {
          status: attempt.status,
          provider: candidate.provider,
          upstreamModel: candidate.upstreamModel,
          error: error.message
        };
        if (!canFailover) {
          logEntry.status = attempt.status;
          logEntry.error = error.message;
          if (streamedUsage) {
            applyUsageAccounting(logEntry, alias, streamedUsage, buildBillableUsage({
              endpointKind,
              requestBody: proxyBody.requestBody,
              status: logEntry.status,
              usage: streamedUsage
            }));
          }
          if (res.destroyed || signal.aborted) return;
          if (res.headersSent) {
            res.destroy();
            return;
          }
          res.removeHeader('content-disposition');
          sendJson(res, attempt.status, {
            error: 'Upstream request failed.',
            request_id: requestId,
            retry_after: error.retryAfterSeconds
          }, { 'x-request-id': requestId, 'x-jetlink-model-alias': alias });
          return;
        }
      } finally {
        providerRelease();
        attempt.durationMs = Date.now() - attemptStarted;
        attempts.push(attempt);
      }
    }

    const status = lastFailure?.status || 502;
    logEntry.status = status;
    logEntry.error = lastFailure?.error || 'No upstream route completed.';
    sendJson(res, status, {
      error: 'Upstream request failed.',
      request_id: requestId
    }, { 'x-request-id': requestId, 'x-jetlink-model-alias': logEntry.modelAlias || '' });
  } catch (error) {
    logEntry.error = error.message;
    const status = signal.aborted ? 499 : error.status || 500;
    logEntry.status = status;
    if (res.destroyed || signal.aborted) return;
    if (!res.headersSent) {
      sendJson(res, status, {
        error: status >= 500 ? 'Internal gateway error.' : error.message,
        request_id: requestId
      });
    } else {
      res.destroy();
    }
  } finally {
    res.removeListener('close', onClose);
    logEntry.durationMs = Date.now() - started;
    requestRelease();
    if (debitId) {
      try {
        const charge = startedResponse ? usageCharge(tariff, logEntry.usage, actualImages) : 0n;
        logEntry.chargedCny = await (await walletStore()).settle(debitId, charge, {
          requestId, status: logEntry.status, usage: logEntry.usage, images: actualImages
        });
      } catch (error) {
        console.error('Wallet settlement pending', debitId, error.message);
      }
    }
    pushRequestLog(logEntry);
  }
}

async function handleMockProvider(req, res, context) {
  const { requestId, endpointKind, body, alias } = context;
  const headers = {
    'x-request-id': requestId,
    'x-jetlink-model-alias': alias
  };

  if (body.stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...headers
    });
    const chunks = ['Wormhole AI ', 'stream ', `response for ${alias}.`];
    for (const chunk of chunks) {
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${requestId}`,
          object: 'chat.completion.chunk',
          model: alias,
          choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }]
        })}\n\n`
      );
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 15));
    }
    res.write(
      `data: ${JSON.stringify({
        id: `chatcmpl-${requestId}`,
        object: 'chat.completion.chunk',
        model: alias,
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
      })}\n\n`
    );
    res.write('data: [DONE]\n\n');
    res.end();
    return;
  }

  if (endpointKind === 'embeddings') {
    sendJson(res, 200, {
      object: 'list',
      model: alias,
      data: [
        {
          object: 'embedding',
          index: 0,
          embedding: Array.from({ length: 16 }, (_, index) => Number((Math.sin(index + 1) * 0.1).toFixed(6)))
        }
      ],
      usage: { prompt_tokens: 8, total_tokens: 8 }
    }, headers);
    return;
  }

  if (endpointKind === 'responses') {
    sendJson(res, 200, {
      id: `resp-${requestId}`,
      object: 'response',
      model: alias,
      output_text: `Wormhole AI response for ${alias}.`,
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `Wormhole AI response for ${alias}.` }]
        }
      ],
      usage: { input_tokens: 12, output_tokens: 12, total_tokens: 24 }
    }, headers);
    return;
  }

  if (endpointKind === 'messages') {
    sendJson(res, 200, {
      id: `msg-${requestId}`,
      type: 'message',
      role: 'assistant',
      model: alias,
      content: [{ type: 'text', text: `Wormhole AI message for ${alias}.` }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 12 }
    }, headers);
    return;
  }

  sendJson(res, 200, {
    id: `chatcmpl-${requestId}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: alias,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: `Wormhole AI response for ${alias}.`
        },
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 12, completion_tokens: 12, total_tokens: 24 }
  }, headers);
}

function pushRequestLog(entry) {
  requestLogs.unshift(entry);
  if (requestLogs.length > 500) {
    requestLogs.pop();
  }
  persistRequestLog(entry).catch((error) => {
    console.warn(`Unable to persist request log: ${error.message}`);
  });
}

async function requestLogPage(params, keyFilter, customer = false) {
  const search = (params.get('q') || '').trim().toLowerCase().slice(0, 128);
  const userFilter = (params.get('user') || params.get('username') || '').trim().toLowerCase().slice(0, 128);
  const status = params.get('status');
  const limit = Math.max(1, Math.min(500, Number.parseInt(params.get('limit'), 10) || 100));

  const missingAccountIds = !customer ? [...new Set(requestLogs.filter(e => e.accountId && !e.username).map(e => e.accountId))] : [];
  let userMap = new Map();
  if (missingAccountIds.length) {
    try {
      userMap = await (await walletStore()).accounts.userMap(missingAccountIds);
      for (const entry of requestLogs) {
        if (entry.accountId && !entry.username && userMap.has(entry.accountId)) {
          entry.username = userMap.get(entry.accountId);
        }
      }
    } catch (e) {
      console.warn('Unable to populate usernames for logs:', e.message);
    }
  }

  const filtered = requestLogs.filter((entry) => {
    if (keyFilter && !keyFilter(entry)) return false;
    const success = entry.status >= 200 && entry.status < 300;
    if ((status === 'success' && !success) || (status === 'failed' && success)) return false;
    if (userFilter && !customer) {
      const match = [entry.username, entry.accountId].some(v => typeof v === 'string' && v.toLowerCase().includes(userFilter));
      if (!match) return false;
    }
    return !search || [entry.requestId, entry.modelAlias, entry.apiKeyId, entry.endpoint,
      ...(customer ? [] : [entry.provider, entry.accountId, entry.username, entry.modelGroup])].some((value) =>
      typeof value === 'string' && value.toLowerCase().includes(search));
  });
  const page = Math.max(1, Math.min(Math.ceil(filtered.length / limit), Number.parseInt(params.get('page'), 10) || 1));
  const entries = filtered.slice((page - 1) * limit, page * limit);
  const pending = entries.filter(log => log.billingId && log.chargedCny == null).map(log => log.billingId);
  const states = new Map((pending.length ? await (await walletStore()).chargeStates(pending) : []).map(row => [row.id, row]));
  const data = entries.map((entry) => {
    const state = states.get(entry.billingId);
    const log = {
      ...entry,
      username: entry.username || (entry.accountId ? userMap.get(entry.accountId) : undefined),
      chargedCny: state?.chargedCny ?? entry.chargedCny,
      billingState: state?.state ?? (entry.billingId ? (entry.chargedCny == null ? 'active' : 'settled') : undefined),
      priceVersion: entry.priceVersion || state?.version
    };
    if (!customer) return enrichLogWithBilling(log);
    const { requestId, time, apiKeyId, endpoint, status, durationMs, modelAlias, usage, chargedCny, billingState, priceVersion } = log;
    return { requestId, time, apiKeyId, endpoint, status, durationMs, modelAlias, usage, chargedCny, billingState, priceVersion };
  });
  return { data, total: filtered.length, page, limit };
}

function publicModelList(key) {
  return Object.entries(config.models || {})
    .filter(([, model]) => model.enabled !== false)
    .filter(([alias, model]) => !key || modelVisibleToKey(key, alias, model))
    .map(([alias, model]) => publicModelDescriptor(alias, model, key));
}

function publicModelDescriptor(alias, model, key) {
  return {
    id: alias,
    object: 'model',
    created: 0,
    owned_by: 'wormhole-ai',
    ...(key?.accountId ? {groups:key.modelGroup ? [key.modelGroup] : modelGroups(model)} : {}),
    endpoints: model.endpoints || ['*'],
    description: model.description || ''
  };
}

function safeInternalKey(key) {
  const { key: rawKey, keyHash, keyCiphertext, system, hidden, ...rest } = key;
  const keyPreview = key.keyPreview || maskSecret(rawKey);
  return {
    ...rest,
    key: keyPreview,
    keyPreview,
    secretAvailable: Boolean(storedInternalApiKey(key))
  };
}

function safeSuperAdmin(superAdmin = {}) {
  return {
    username: cleanString(superAdmin.username, superAdminUsername()),
    name: cleanString(superAdmin.name, superAdminName()),
    passwordConfigured: Boolean(superAdmin.passwordHash),
    passwordUpdatedAt: superAdmin.passwordUpdatedAt
  };
}

function safeProvider(provider) {
  const { apiKey, apiKeySecret, apiKeyCiphertext, ...rest } = provider || {};
  const directApiKey = storedProviderApiKey(provider);
  const apiKeyEnv = looksLikeRawApiKey(provider?.apiKeyEnv) ? undefined : provider?.apiKeyEnv;
  return {
    ...rest,
    apiKeyEnv,
    apiKeyPreview: provider?.apiKeyPreview || maskSecret(directApiKey) || undefined,
    apiKeyConfigured: Boolean(upstreamApiKey(provider))
  };
}

function safeConfig() {
  const providers = {};
  for (const [id, provider] of Object.entries(config.providers || {})) {
    providers[id] = safeProvider(provider);
  }
  const requestLogLocation = postgresPool ? postgresLocation('jetlink_gateway_request_logs') : REQUEST_LOG_PATH;
  const auditLogLocation = postgresPool ? postgresLocation('jetlink_gateway_audit_logs') : AUDIT_LOG_PATH;
  return {
    ...config,
    providers,
    auth: {
      ...config.auth,
      superAdmin: safeSuperAdmin(config.auth?.superAdmin),
      internalApiKeys: (config.auth?.internalApiKeys || []).map(safeInternalKey)
    },
    configFile: configState.path,
    persistent: configState.persistent,
    storage: configState.driver || STORAGE_DRIVER,
    requestLogFile: requestLogLocation,
    auditLogFile: auditLogLocation
  };
}

function buildUsageSummary(logs = requestLogs) {
  const pricedLogs = logs.map(enrichLogWithBilling);
  const summary = {
    total: pricedLogs.length,
    ok: 0,
    error: 0,
    byProvider: {},
    byModel: {},
    byUpstreamModel: {},
    byApiKey: {},
    byEndpoint: {},
    byStatus: {},
    failoverRequests: 0,
    tokens: { input: 0, output: 0, total: 0 },
    billable: { images: 0, requests: 0 },
    estimatedCost: {},
    avgDurationMs: 0
  };
  let durationTotal = 0;
  for (const log of pricedLogs) {
    const status = Number(log.status || 0);
    if (status && status < 400) {
      summary.ok += 1;
    } else {
      summary.error += 1;
    }
    durationTotal += Number(log.durationMs || 0);
    const provider = log.provider || 'unknown';
    const model = log.modelAlias || 'unknown';
    const upstreamModel = log.upstreamModel || 'unknown';
    const apiKey = log.apiKeyId || 'unknown';
    const endpoint = log.endpoint || 'unknown';
    summary.byProvider[provider] = (summary.byProvider[provider] || 0) + 1;
    summary.byModel[model] = (summary.byModel[model] || 0) + 1;
    summary.byUpstreamModel[upstreamModel] = (summary.byUpstreamModel[upstreamModel] || 0) + 1;
    summary.byApiKey[apiKey] = (summary.byApiKey[apiKey] || 0) + 1;
    summary.byEndpoint[endpoint] = (summary.byEndpoint[endpoint] || 0) + 1;
    summary.byStatus[status || 'unknown'] = (summary.byStatus[status || 'unknown'] || 0) + 1;
    if (Array.isArray(log.attempts) && log.attempts.length > 1) {
      summary.failoverRequests += 1;
    }
    if (log.usage) {
      summary.tokens.input += Number(log.usage.inputTokens || 0);
      summary.tokens.output += Number(log.usage.outputTokens || 0);
      summary.tokens.total += Number(log.usage.totalTokens || 0);
    }
    if (log.billableUsage) {
      summary.billable.images += Number(log.billableUsage.images || 0);
      summary.billable.requests += Number(log.billableUsage.requests || 0);
    }
    if (log.estimatedCost) {
      const currency = log.estimatedCost.currency || 'USD';
      summary.estimatedCost[currency] = Number(((summary.estimatedCost[currency] || 0) + Number(log.estimatedCost.totalCost || 0)).toFixed(10));
    }
  }
  summary.avgDurationMs = pricedLogs.length ? Math.round(durationTotal / pricedLogs.length) : 0;
  return summary;
}

function configIssue(level, code, message, target, details = {}) {
  return { level, code, message, target, details };
}

function validateGatewayConfig(source = config) {
  const errors = [];
  const warnings = [];
  const providers = source.providers || {};
  const models = source.models || {};
  const keys = source.auth?.internalApiKeys || [];
  const enabledKeys = keys.filter((key) => key.enabled !== false);
  const enabledModels = Object.entries(models).filter(([, model]) => model.enabled !== false);
  const enabledProviders = Object.entries(providers).filter(([, provider]) => provider.enabled !== false);

  if (!enabledKeys.some((key) => key.role === 'admin')) {
    errors.push(configIssue('error', 'admin_key_missing', 'At least one enabled admin API key is required.', 'auth.internalApiKeys'));
  }
  if (!enabledKeys.some((key) => key.role === 'service')) {
    warnings.push(configIssue('warning', 'service_key_missing', 'No enabled service API key is configured for internal business callers.', 'auth.internalApiKeys'));
  }
  if (!enabledProviders.length) {
    warnings.push(configIssue('warning', 'provider_missing', 'No provider channel is configured yet.', 'providers'));
  }
  if (!enabledModels.length) {
    warnings.push(configIssue('warning', 'model_missing', 'No enabled model alias is configured yet.', 'models'));
  }
  if ((source.security?.corsOrigins || []).includes('*')) {
    warnings.push(configIssue('warning', 'cors_wildcard', 'CORS allows every origin. Set security.corsOrigins or AI_GW_CORS_ORIGINS for production.', 'security.corsOrigins'));
  }
  if (!source.auth?.superAdmin?.passwordHash && !SUPER_ADMIN_PASSWORD) {
    errors.push(configIssue('error', 'super_admin_password_missing', 'Super admin password is not initialized. Set AI_GW_SUPER_ADMIN_PASSWORD once or update it from the console.', 'auth.superAdmin.passwordHash'));
  }

  for (const [id, provider] of Object.entries(providers)) {
    const target = `providers.${id}`;
    if (!['mock', 'openai-compatible'].includes(provider.type)) {
      errors.push(configIssue('error', 'provider_type_invalid', `Unsupported provider type: ${provider.type}`, target));
    }
    if (provider.type === 'openai-compatible') {
      if (!provider.baseUrl) {
        errors.push(configIssue('error', 'provider_base_url_missing', 'OpenAI-compatible provider requires baseUrl.', target));
      }
      if (provider.enabled !== false && !providerConfigured(provider)) {
        warnings.push(configIssue('warning', 'provider_secret_missing', 'Provider API key is not configured. Set apiKey or apiKeyEnv.', target));
      }
    }
  }

  for (const [alias, model] of Object.entries(models)) {
    const target = `models.${alias}`;
    const candidates = configuredRouteCandidates(model);
    if (!candidates.length) {
      errors.push(configIssue('error', 'model_route_missing', 'Model alias has no route candidates.', target));
      continue;
    }
    let configuredRoutes = 0;
    for (const candidate of candidates) {
      const provider = providers[candidate.provider];
      if (!provider) {
        errors.push(configIssue('error', 'model_provider_missing', `Route provider does not exist: ${candidate.provider}`, target, candidate));
        continue;
      }
      if (provider.enabled === false) {
        warnings.push(configIssue('warning', 'model_provider_disabled', `Route provider is disabled: ${candidate.provider}`, target, candidate));
        continue;
      }
      if (providerConfigured(provider)) {
        configuredRoutes += 1;
      } else if (model.enabled !== false) {
        warnings.push(configIssue('warning', 'model_provider_secret_missing', `Route provider is not fully configured: ${candidate.provider}`, target, candidate));
      }
    }
    if (model.enabled !== false && configuredRoutes === 0) {
      errors.push(configIssue('error', 'model_route_unavailable', 'Enabled model alias has no configured route.', target));
    }
  }

  const defaultModel = source.routing?.defaultModel;
  if (!defaultModel) {
    warnings.push(configIssue('warning', 'default_model_missing', 'routing.defaultModel is not configured yet.', 'routing.defaultModel'));
  } else if (!models[defaultModel] || models[defaultModel].enabled === false) {
    errors.push(configIssue('error', 'default_model_invalid', `Default model is missing or disabled: ${defaultModel}`, 'routing.defaultModel'));
  }

  for (const key of keys) {
    const target = `auth.internalApiKeys.${key.id || 'unknown'}`;
    const allowedModels = key.allowedModels || ['*'];
    for (const alias of allowedModels) {
      if (alias !== '*' && !models[alias]) {
        warnings.push(configIssue('warning', 'api_key_allowed_model_unknown', `API key references unknown model alias: ${alias}`, target));
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      providers: Object.keys(providers).length,
      enabledProviders: enabledProviders.length,
      models: Object.keys(models).length,
      enabledModels: enabledModels.length,
      apiKeys: keys.length,
      enabledApiKeys: enabledKeys.length,
      defaultModel
    }
  };
}

async function buildDiagnostics() {
  const providers = {};
  for (const [id, provider] of Object.entries(config.providers || {})) {
    providers[id] = await checkProviderHealth(id, provider, false);
  }
  return {
    time: new Date().toISOString(),
    name: 'Wormhole AI Gateway',
    publicBaseUrl: config.publicBaseUrl,
    configFile: configState.path,
    persistent: configState.persistent,
    storage: configState.driver || STORAGE_DRIVER,
    validation: validateGatewayConfig(),
    providers,
    concurrency: concurrencySnapshot(),
    limits: config.limits,
    usage: buildUsageSummary(requestLogs.slice(0, 500)),
    logs: {
      requests: postgresPool ? postgresLocation('jetlink_gateway_request_logs') : REQUEST_LOG_PATH,
      audit: postgresPool ? postgresLocation('jetlink_gateway_audit_logs') : AUDIT_LOG_PATH
    }
  };
}

function prometheusMetrics() {
  const usage = buildUsageSummary();
  const lines = [
    '# HELP jetlinkapi_gateway_requests_total Recent in-memory proxy requests by status.',
    '# TYPE jetlinkapi_gateway_requests_total counter'
  ];
  for (const [status, value] of Object.entries(usage.byStatus)) {
    lines.push(`jetlinkapi_gateway_requests_total{status="${status}"} ${value}`);
  }
  lines.push('# HELP jetlinkapi_gateway_models Configured model aliases.');
  lines.push('# TYPE jetlinkapi_gateway_models gauge');
  lines.push(`jetlinkapi_gateway_models ${Object.keys(config.models || {}).length}`);
  lines.push('# HELP jetlinkapi_gateway_providers Configured providers.');
  lines.push('# TYPE jetlinkapi_gateway_providers gauge');
  lines.push(`jetlinkapi_gateway_providers ${Object.keys(config.providers || {}).length}`);
  lines.push('# HELP jetlinkapi_gateway_recent_request_duration_ms Recent average proxy duration.');
  lines.push('# TYPE jetlinkapi_gateway_recent_request_duration_ms gauge');
  lines.push(`jetlinkapi_gateway_recent_request_duration_ms ${usage.avgDurationMs}`);
  const concurrency = concurrencySnapshot();
  lines.push('# HELP jetlinkapi_gateway_inflight_requests Current in-flight proxy requests.');
  lines.push('# TYPE jetlinkapi_gateway_inflight_requests gauge');
  lines.push(`jetlinkapi_gateway_inflight_requests ${concurrency.inFlight}`);
  lines.push('# HELP jetlinkapi_gateway_queued_requests Current queued proxy requests.');
  lines.push('# TYPE jetlinkapi_gateway_queued_requests gauge');
  lines.push(`jetlinkapi_gateway_queued_requests ${concurrency.queueLength}`);
  lines.push('# HELP jetlinkapi_gateway_concurrency_rejections_total Process-local concurrency rejections.');
  lines.push('# TYPE jetlinkapi_gateway_concurrency_rejections_total counter');
  lines.push(`jetlinkapi_gateway_concurrency_rejections_total ${concurrency.rejected}`);
  return `${lines.join('\n')}\n`;
}

async function discoverProviderModels(provider) {
  if (provider.type !== 'openai-compatible' || !provider.baseUrl || !providerConfigured(provider)) {
    throw httpError(400, '此通道需配置兼容接口地址和上游凭据才能获取模型');
  }
  const signal = AbortSignal.timeout(Math.min(normalizeTimeout(provider.timeoutMs, 30_000), 30_000));
  try {
    const response = await fetch(buildUpstreamUrl(provider, '/v1/models', ''), {
      headers: buildUpstreamHeaders({ headers: {} }, provider, randomUUID()),
      redirect: 'error',
      signal
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw httpError(502, '上游模型列表请求失败，HTTP ' + response.status);
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body || []) {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) throw httpError(502, '上游模型列表超过 2 MB');
      chunks.push(chunk);
    }
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const rows = Array.isArray(payload?.data) ? payload.data : payload?.models;
    if (!Array.isArray(rows)) throw httpError(502, '上游响应没有有效的模型列表');
    const ids = rows.map(row => row?.id ?? row?.slug).filter(id =>
      typeof id === 'string' && id.trim() === id && id.length > 0 && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id));
    return [...new Set(ids)];
  } catch (error) {
    if (error.status) throw error;
    if (signal.aborted) throw httpError(504, '获取上游模型列表超时');
    throw httpError(502, '无法读取上游模型列表，请检查通道地址及上游响应');
  }
}

function planProviderMappings(providerId, ids, models) {
  const mapped = new Map();
  for (const [alias, model] of Object.entries(models)) {
    for (const route of configuredRouteCandidates(model)) {
      if (route.provider === providerId) mapped.set(route.upstreamModel, alias);
    }
  }
  const usedAliases = new Set([...Object.keys(models), ...Object.getOwnPropertyNames(Object.prototype)]);
  // Reserve upstream IDs first, so a normalized alias never takes a literal ID's place.
  const literal = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
  const reserved = new Set(ids.filter(id => literal.test(id) && !mapped.has(id) && !usedAliases.has(id)));
  return ids.map(id => {
    const existing = mapped.get(id);
    let alias = existing || id;
    if (!existing && !reserved.has(id)) {
      const safeId = (providerId + '.' + id).replace(/[^a-zA-Z0-9._:-]/g, '-');
      const hash = createHash('sha256').update(id).digest('hex').slice(0, 10);
      alias = safeId.slice(0, 116) + '-' + hash;
      for (let index = 2; usedAliases.has(alias) || reserved.has(alias); index++) {
        alias = safeId.slice(0, 105) + '-' + hash + '-' + index;
      }
    }
    usedAliases.add(alias);
    const price = cnyPrice(cnyPriceId(alias, id));
    const billing = price?.image ? 'image' : price?.standard ? 'token' : null;
    return { id, alias, existing: Boolean(existing), billing };
  });
}

async function handleProviderModelImport(req, res, auth, providerId) {
  const provider = Object.hasOwn(config.providers || {}, providerId) ? config.providers[providerId] : undefined;
  if (!provider) throw httpError(404, '通道不存在');
  if (req.method === 'GET') {
    const ids = await discoverProviderModels(provider);
    sendJson(res, 200, { data: planProviderMappings(providerId, ids, config.models || {}) });
    return;
  }
  if (req.headers.origin && !accountOrigin(req)) throw httpError(403, '请求来源不受信任');
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw httpError(415, '请提交 JSON');
  const body = await readJsonBody(req);
  if (!Array.isArray(body?.ids) || body.ids.length < 1 || body.ids.length > 1000
    || body.ids.some(id => typeof id !== 'string' || id.length > 256)
    || !Array.isArray(body.endpoints) || !body.endpoints.length) {
    throw httpError(400, '请选择 1–1000 个模型及其支持的接口');
  }
  const endpoints = normalizeEndpoints(body.endpoints);
  const upstreamModels = await discoverProviderModels(provider);
  const upstreamIds = new Set(upstreamModels);
  if (config.providers?.[providerId] !== provider) throw httpError(409, '通道已修改，请重新获取模型列表');
  const ids = new Set(body.ids);
  if ([...ids].some(id => !upstreamIds.has(id))) throw httpError(409, '有模型已从上游下架，请重新获取列表');
  const original = config.models;
  const next = { ...original };
  const result = [];
  for (const item of planProviderMappings(providerId, upstreamModels, original || {})) {
    const { id, alias, existing, billing } = item;
    if (!ids.has(id)) continue;
    if (existing) {
      result.push({ id, alias, status: 'existing' });
      continue;
    }
    const pricedEndpoints = billing === 'image' ? ['images'] : ['chat', 'responses', 'messages', 'embeddings'];
    const published = body.publish === true && billing !== null && endpoints.every(endpoint => pricedEndpoints.includes(endpoint));
    next[alias] = normalizeModelInput(alias, { provider: providerId, upstreamModel: id, endpoints, saasEnabled: published });
    result.push({ id, alias, status: published ? 'published' : 'internal' });
  }
  if (result.some(item => item.status !== 'existing')) {
    config.models = next;
    try {
      await saveConfig();
    } catch (error) {
      if (config.models === next) config.models = original;
      throw error;
    }
    auditAdminAction(auth, 'import', 'provider-models', providerId, {
      imported: result.filter(item => item.status !== 'existing').length
    });
  }
  sendJson(res, 200, { data: result });
}

async function checkProviderHealth(id, provider, live = false) {
  const configured = providerConfigured(provider);
  const base = {
    id,
    name: provider.name || id,
    type: provider.type,
    enabled: provider.enabled !== false,
    configured,
    live,
    ok: provider.enabled !== false && configured
  };
  if (provider.type === 'mock') {
    return { ...base, ok: provider.enabled !== false, message: 'mock provider is local' };
  }
  if (provider.type !== 'openai-compatible') {
    return { ...base, ok: false, message: `unsupported provider type ${provider.type}` };
  }
  if (!provider.baseUrl) {
    return { ...base, ok: false, message: 'baseUrl missing' };
  }
  if (!configured) {
    return { ...base, ok: false, message: 'Provider API key is not configured. Set apiKey or apiKeyEnv.' };
  }
  if (!live) {
    return { ...base, message: 'configuration looks ready; use ?live=true to check upstream' };
  }

  const started = Date.now();
  try {
    const upstream = await fetch(buildUpstreamUrl(provider, '/v1/models', ''), {
      method: 'GET',
      headers: buildUpstreamHeaders({ headers: {} }, provider, randomUUID()),
      redirect: 'error',
      signal: AbortSignal.timeout(normalizeTimeout(provider.timeoutMs, 30_000))
    });
    const detail = upstream.ok ? '' : await upstreamErrorDetail(upstream);
    return {
      ...base,
      ok: upstream.ok,
      status: upstream.status,
      durationMs: Date.now() - started,
      message: upstream.ok ? 'upstream reachable' : `upstream returned HTTP ${upstream.status}${detail ? `: ${detail}` : ''}`
    };
  } catch (error) {
    return {
      ...base,
      ok: false,
      durationMs: Date.now() - started,
      message: error.message
    };
  }
}

// Codex model picker expects the native catalog shape rather than the OpenAI SDK list.
function codexModelCatalog(key) {
  return publicModelList(key).filter(model =>
    model.endpoints.some(endpoint => endpoint === 'responses' || endpoint === '*') &&
    (!key.allowedEndpoints || key.allowedEndpoints.some(endpoint => endpoint === '*' || endpoint === 'responses'))
  ).map((model, priority) => ({
    slug: model.id,
    display_name: model.id,
    description: model.description || null,
    priority,
    visibility: 'list',
    supported_in_api: true,
    shell_type: 'shell_command',
    supported_reasoning_levels: [],
    support_verbosity: false,
    supports_parallel_tool_calls: false,
    truncation_policy: { mode: 'tokens', limit: 10_000 },
    experimental_supported_tools: [],
    base_instructions: 'You are a coding assistant. Help the user with their software development tasks.',
    input_modalities: ['text']
  }));
}

async function handleModels(req, res, url) {
  const auth = await authenticateProxy(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }
  if (url.pathname === '/v1/codex/models') {
    if (req.method !== 'GET') throw httpError(405, '只允许读取 Codex 模型目录');
    sendJson(res, 200, { models: codexModelCatalog(auth.key) });
    return;
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length === 2) {
    sendJson(res, 200, { object: 'list', data: publicModelList(auth.key) });
    return;
  }
  const alias = decodeURIComponent(parts.slice(2).join('/'));
  const model = config.models?.[alias];
  if (!model || model.enabled === false) {
    sendJson(res, 404, { error: `Model not found: ${alias}` });
    return;
  }
  if (!modelVisibleToKey(auth.key, alias, model)) {
    sendJson(res, 404, { error: `Model not found: ${alias}` });
    return;
  }
  sendJson(res, 200, {
    ...publicModelDescriptor(alias, model, auth.key)
  });
}

function verifyAdminLogin(req, username, password) {
  const rate = checkAdminLoginRateLimit(req);
  if (!rate.ok) throw httpError(429, `Too many sign-in attempts. Retry after ${rate.retryAfterSeconds}s.`);
  if (
    safeTextEqual(username.toLowerCase(), superAdminUsername().toLowerCase()) &&
    typeof password === 'string' &&
    password.length <= 256 &&
    verifySuperAdminPassword(password)
  )
    return true;
  pushAuditLog({
    id: randomUUID(),
    time: new Date().toISOString(),
    actorKeyId: 'anonymous',
    action: 'login_failed',
    resource: 'admin-session',
    target: username || 'unknown',
    details: { remoteAddress: clientAddress(req) }
  });
  return false;
}

function revokeAdminSession(req) {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (token) adminSessions.delete(hashSessionToken(token));
}

function sendAdminLogin(req, res, extraCookies = []) {
  revokeAdminSession(req);
  const ttl = Math.floor(ADMIN_SESSION_TTL_MS / 1000);
  const cookie = adminSessionCookie(req, createAdminSession(), ttl);
  pushAuditLog({
    id: randomUUID(),
    time: new Date().toISOString(),
    actorKeyId: 'console-session',
    action: 'login',
    resource: 'admin-session',
    target: superAdminUsername(),
    details: { remoteAddress: clientAddress(req) }
  });
  sendJson(
    res,
    200,
    { role: 'admin', user: superAdminUserPayload(), expiresInSeconds: ttl },
    { 'set-cookie': [cookie, ...extraCookies] }
  );
}

async function handleAdminSession(req, res, url) {
  if (url.pathname === '/admin/session/password') {
    if (req.method !== 'PUT') {
      sendJson(res, 405, { error: 'Method not allowed.' });
      return;
    }
    const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
    const auth = authenticateAdminSession(req);
    if (!auth.ok || !token) {
      sendJson(res, 401, { error: 'Admin session required.' });
      return;
    }
    const body = await readJsonBody(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!verifySuperAdminPassword(currentPassword)) {
      sendJson(res, 401, { error: 'Current password is incorrect.' });
      return;
    }
    if (safeTextEqual(currentPassword, newPassword)) {
      sendJson(res, 400, { error: 'New password must be different from the current password.' });
      return;
    }
    assertAdminPasswordPolicy(newPassword);
    config.auth = {
      ...(config.auth || {}),
      superAdmin: {
        ...(config.auth?.superAdmin || {}),
        username: superAdminUsername(),
        name: superAdminName(),
        passwordHash: hashAdminPassword(newPassword),
        passwordUpdatedAt: new Date().toISOString()
      }
    };
    const persisted = await saveConfig();
    const currentSessionHash = hashSessionToken(token);
    for (const hash of adminSessions.keys()) {
      if (hash !== currentSessionHash) {
        adminSessions.delete(hash);
      }
    }
    pushAuditLog({
      id: randomUUID(),
      time: new Date().toISOString(),
      actorKeyId: auth.key.id,
      action: 'change-password',
      resource: 'admin-session',
      target: superAdminUsername(),
      details: { remoteAddress: clientAddress(req) }
    });
    sendJson(res, 200, {
      updated: true,
      persisted,
      user: superAdminUserPayload(),
      passwordUpdatedAt: config.auth.superAdmin.passwordUpdatedAt
    });
    return;
  }

  if (req.method === 'GET') {
    const auth = authenticateAdminSession(req);
    if (!auth.ok) {
      sendJson(res, 401, { error: 'Admin session required.' });
      return;
    }
    sendJson(res, 200, {
      user: superAdminUserPayload(),
      expiresAt: new Date(auth.session.expiresAt).toISOString()
    });
    return;
  }

  if (req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!verifyAdminLogin(req, cleanString(body?.username), body?.password)) throw httpError(401, 'Invalid super admin credentials.');
    sendAdminLogin(req, res);
    return;
  }

  if (req.method === 'DELETE') {
    revokeAdminSession(req);
    sendJson(res, 200, { deleted: true }, {
      'set-cookie': clearAdminSessionCookie(req)
    });
    return;
  }

  sendJson(res, 405, { error: 'Method not allowed.' });
}

async function handleAdmin(req, res, url) {
  const auth = authenticate(req, { admin: true });
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
    return;
  }

  const paymentRoute = /^\/admin\/payments\/(wechat|alipay)\/(.+)$/.exec(url.pathname);
  if (paymentRoute) {
    const store = await walletStore();
    const [, channel, path] = paymentRoute;
    const qrImage = paymentImages[channel];
    const token = channel === 'wechat' ? wechatReceiptToken : receiptToken;
    if (req.method !== 'GET' && req.headers.origin && !accountOrigin(req)) throw httpError(403, '请求来源不受信任');
    if (req.method === 'GET' && path === 'settings') {
      sendJson(res,200,{...await store.checkout(Boolean(qrImage),channel),shortcutConfigured:token.length >= 32});
    } else if (req.method === 'GET' && path === 'qr') {
      const image = await store.qr(qrImage,true,channel);
      if (!image) throw httpError(404,'尚未配置收款码');
      res.writeHead(200,{'content-type':image.type}); res.end(image.bytes);
    } else if (req.method === 'PUT' && path === 'qr') {
      const image = paymentQr(await readRawBody(req,maxQrBytes));
      await store.saveQr(image.type,image.bytes,channel);
      auditAdminAction(auth,'configure',channel,'qr',{});
      sendJson(res,200,{ok:true});
    } else if (req.method === 'PUT' && path === 'settings') {
      const body = await readJsonBody(req);
      if (typeof body?.enabled !== 'boolean') throw httpError(400,'请指定收款状态');
      await store.setCheckout(body.enabled,Boolean(qrImage),channel);
      auditAdminAction(auth,body.enabled?'enable':'pause',channel,'checkout',{});
      sendJson(res,200,{ok:true});
    } else if (req.method === 'GET' && path === 'orders') {
      const orderId = (url.searchParams.get('id') || '').trim().toUpperCase();
      const filter = (url.searchParams.get('filter') || 'pending').trim().toLowerCase();
      if (orderId && !/^[A-F0-9]{12}$/.test(orderId)) throw httpError(400,'请输入完整的 12 位网站订单号');
      sendJson(res,200,{orders:await store.receiptOrders(orderId,channel,filter)});
    } else if (req.method === 'DELETE' && path === 'orders') {
      const orderId = (url.searchParams.get('id') || '').trim().toUpperCase();
      if (!/^[A-F0-9]{12}$/.test(orderId)) throw httpError(400,'请输入完整的 12 位网站订单号');
      if (await store.removeOrder(orderId,channel)) auditAdminAction(auth,'delete',channel,orderId,{});
      sendJson(res,200,{ok:true});
    } else if (req.method === 'POST' && path === 'confirm') {
      if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw httpError(415,'请提交 JSON');
      const result = await store.confirm(channel,(await readJsonBody(req)) || {});
      if (!result.repeated) auditAdminAction(auth,'confirm',channel,result.orderId,{amount:result.amount});
      sendJson(res,200,result);
    } else throw httpError(404,'没有找到该收款接口');
    return;
  }
  const supportRoute = /^\/admin\/support\/([a-f0-9-]{36})(?:\/(reset|resolve))?$/.exec(url.pathname);
  if (url.pathname === '/admin/support' && req.method === 'GET') {
    sendJson(res, 200, { data: await (await walletStore()).accounts.support.list() });
    return;
  }
  if (supportRoute) {
    const [, id, operation] = supportRoute;
    const support = (await walletStore()).accounts.support;
    if (req.method === 'GET' && !operation) {
      sendJson(res, 200, { data: await support.detail(id) });
      return;
    }
    if (req.method !== 'POST') throw httpError(405, '不支持的请求方法');
    if (req.headers.origin && !accountOrigin(req)) throw httpError(403, '请求来源不受信任');
    if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') throw httpError(415, '需要 JSON 请求');
    const body = await readJsonBody(req);
    if (operation === 'resolve') {
      const data = await support.resolve(id);
      auditAdminAction(auth, 'resolve', 'support-thread', id);
      sendJson(res, 200, { data });
    } else if (operation === 'reset') {
      const { owner, reset } = await support.authorizeReset(id, body?.username);
      auditAdminAction(auth, 'authorize-password-reset', 'user', owner, { threadId: id });
      sendJson(res, 200, { reset });
    } else {
      const data = await support.reply(id, body?.message);
      auditAdminAction(auth, 'reply', 'support-thread', id);
      sendJson(res, 200, { data });
    }
    return;
  }

  if (url.pathname === '/admin/users' && req.method === 'GET') {
    const rows = await (await walletStore()).accounts.list(url.searchParams.get('after') || '');
    sendJson(res,200,{data:rows.slice(0,50), next:rows.length > 50 ? rows[49].username : null});
    return;
  }
  const userRoute = /^\/admin\/users\/([a-f0-9-]{36})$/.exec(url.pathname);
  if (userRoute && req.method === 'PUT') {
    const body = await readJsonBody(req);
    if (typeof body?.enabled !== 'boolean') throw httpError(400,'请指定用户启用状态');
    const data = await (await walletStore()).accounts.setEnabled(userRoute[1],body.enabled);
    auditAdminAction(auth,body.enabled ? 'enable' : 'suspend','user',userRoute[1]);
    sendJson(res,200,{data});
    return;
  }
  if (url.pathname === '/admin/payments/reviews') {
    const store = await walletStore();
    if (req.method === 'GET') {
      sendJson(res, 200, { data: await store.reviews() });
      return;
    }
    if (req.method === 'POST') {
      const body = await readJsonBody(req);
      const units = parseYuan(body?.amount, 10);
      if (units === null || typeof body.reason !== 'string' || !body.reason.trim() || body.reason.length > 500) {
        throw httpError(400, '请提交人民币金额及核对依据（最多 500 字）');
      }
      const amount = await store.settle(body.id, units, { actor: auth.key.id, reason: body.reason.trim() }, true);
      auditAdminAction(auth, 'settle', 'wallet-charge', body.id, { amount });
      sendJson(res, 200, { amount });
      return;
    }
  }
  if (req.method === 'GET' && url.pathname === '/admin/config') {
    sendJson(res, 200, safeConfig());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/config/validate') {
    sendJson(res, 200, validateGatewayConfig());
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/diagnostics') {
    sendJson(res, 200, await buildDiagnostics());
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/config/persist') {
    const persisted = await saveConfig();
    auditAdminAction(auth, 'persist', 'config', configState.path, { persisted });
    sendJson(res, 200, { persisted, configFile: configState.path });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/routing') {
    sendJson(res, 200, { data: config.routing || {} });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/admin/routing') {
    const body = await readJsonBody(req);
    config.routing = normalizeRoutingInput(body, config.routing || {});
    const persisted = await saveConfig();
    auditAdminAction(auth, 'update', 'routing', 'default', config.routing);
    sendJson(res, 200, { data: config.routing, persisted });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/pricing') {
    sendJson(res, 200, { data: config.pricing || { currency: 'USD', models: {} } });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/admin/pricing') {
    const body = await readJsonBody(req);
    config.pricing = normalizePricingInput(body, config.pricing || {});
    const persisted = await saveConfig();
    auditAdminAction(auth, 'update', 'pricing', 'default', {
      currency: config.pricing.currency,
      models: Object.keys(config.pricing.models || {})
    });
    sendJson(res, 200, { data: config.pricing, persisted });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/limits') {
    sendJson(res, 200, { data: config.limits || {} });
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/admin/limits') {
    const body = await readJsonBody(req);
    config.limits = normalizeLimitsInput(body, config.limits || {});
    const persisted = await saveConfig();
    auditAdminAction(auth, 'update', 'limits', 'default', config.limits);
    sendJson(res, 200, { data: config.limits, persisted });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/concurrency') {
    sendJson(res, 200, { data: concurrencySnapshot(), limits: config.limits || {} });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/providers') {
    sendJson(res, 200, { data: safeConfig().providers });
    return;
  }

  if (url.pathname.startsWith('/admin/providers/')) {
    const providerPath = decodeURIComponent(url.pathname.replace('/admin/providers/', ''));
    if (providerPath.endsWith('/models') && ['GET', 'POST'].includes(req.method)) {
      const providerId = assertConfigId(providerPath.slice(0, -'/models'.length), 'provider id');
      await handleProviderModelImport(req, res, auth, providerId);
      return;
    }
    if (providerPath.endsWith('/health')) {
      const id = assertConfigId(providerPath.slice(0, -'/health'.length), 'provider id');
      const provider = config.providers?.[id];
      if (!provider) {
        sendJson(res, 404, { error: `Provider not found: ${id}` });
        return;
      }
      if (req.method === 'GET') {
        sendJson(res, 200, await checkProviderHealth(id, provider, url.searchParams.get('live') === 'true'));
        return;
      }
    }

    const id = assertConfigId(providerPath, 'provider id');
    const provider = config.providers?.[id];

    if (req.method === 'GET') {
      if (!provider) {
        sendJson(res, 404, { error: `Provider not found: ${id}` });
        return;
      }
      sendJson(res, 200, { id, provider: safeProvider(provider) });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      config.providers = {
        ...(config.providers || {}),
        [id]: normalizeProviderInput(id, body, provider || {})
      };
      const persisted = await saveConfig();
      auditAdminAction(auth, provider ? 'update' : 'create', 'provider', id, {
        type: config.providers[id].type,
        enabled: config.providers[id].enabled !== false,
        apiKeyEnv: config.providers[id].apiKeyEnv,
        apiKeyConfigured: providerConfigured(config.providers[id])
      });
      sendJson(res, 200, { id, provider: safeProvider(config.providers[id]), persisted });
      return;
    }

    if (req.method === 'DELETE') {
      if (!provider) {
        sendJson(res, 404, { error: `Provider not found: ${id}` });
        return;
      }
      const referencedAliases = Object.entries(config.models || {})
        .filter(([, model]) => model.provider === id
          || (model.fallbacks || []).some((route) => route?.provider === id)
          || (model.routes || []).some((route) => route?.provider === id))
        .map(([alias]) => alias);
      if (referencedAliases.length) {
        sendJson(res, 409, {
          error: `Provider is used by model aliases: ${referencedAliases.join(', ')}`
        });
        return;
      }
      delete config.providers[id];
      const persisted = await saveConfig();
      auditAdminAction(auth, 'delete', 'provider', id);
      sendJson(res, 200, { id, deleted: true, persisted });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/admin/api-keys') {
    sendJson(res, 200, { data: (config.auth?.internalApiKeys || []).filter((key) => !isSystemInternalKey(key)).map(safeInternalKey) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/admin/api-keys') {
    const body = await readJsonBody(req);
    const id = assertConfigId(body.id || generateConfigId('key'), 'api key id');
    const keys = config.auth?.internalApiKeys || [];
    if (keys.some((key) => key.id === id)) {
      sendJson(res, 409, { error: `API key id already exists: ${id}` });
      return;
    }
    const { record: nextKey, secret } = normalizeInternalApiKeyInput(id, body);
    const nextKeys = [nextKey, ...keys];
    assertAdminKeyAvailable(nextKeys);
    config.auth = { ...(config.auth || {}), internalApiKeys: nextKeys };
    const persisted = await saveConfig();
    auditAdminAction(auth, 'create', 'api-key', id, { role: nextKey.role, perMinute: nextKey.perMinute });
    sendJson(res, 201, { id, key: safeInternalKey(nextKey), secret, persisted });
    return;
  }

  if (url.pathname.startsWith('/admin/api-keys/')) {
    const apiKeyPath = decodeURIComponent(url.pathname.replace('/admin/api-keys/', ''));
    const keys = config.auth?.internalApiKeys || [];

    if (apiKeyPath.endsWith('/secret')) {
      const id = assertConfigId(apiKeyPath.slice(0, -'/secret'.length), 'api key id');
      const index = keys.findIndex((key) => key.id === id);
      if (req.method === 'GET') {
        if (index === -1 || isSystemInternalKey(keys[index])) {
          sendJson(res, 404, { error: `API key not found: ${id}` });
          return;
        }
        const secret = storedInternalApiKey(keys[index]);
        if (!secret) {
          sendJson(res, 409, { error: 'API key secret is not recoverable. Rotate the key to copy a new full secret.' });
          return;
        }
        auditAdminAction(auth, 'copy-secret', 'api-key', id, {
          keyPreview: keys[index].keyPreview || maskSecret(secret)
        });
        sendJson(res, 200, { id, secret, key: safeInternalKey(keys[index]) });
        return;
      }
    }

    const id = assertConfigId(apiKeyPath, 'api key id');
    const index = keys.findIndex((key) => key.id === id);

    if (req.method === 'GET') {
      if (index === -1 || isSystemInternalKey(keys[index])) {
        sendJson(res, 404, { error: `API key not found: ${id}` });
        return;
      }
      sendJson(res, 200, { id, key: safeInternalKey(keys[index]) });
      return;
    }

    if (req.method === 'PUT') {
      if (index === -1 || isSystemInternalKey(keys[index])) {
        sendJson(res, 404, { error: `API key not found: ${id}` });
        return;
      }
      const body = await readJsonBody(req);
      const { record: nextKey, secret } = normalizeInternalApiKeyInput(id, body, keys[index]);
      const nextKeys = keys.map((key) => (key.id === id ? nextKey : key));
      assertAdminKeyAvailable(nextKeys);
      config.auth = { ...(config.auth || {}), internalApiKeys: nextKeys };
      const persisted = await saveConfig();
      auditAdminAction(auth, body.rotate === true ? 'rotate' : 'update', 'api-key', id, {
        role: nextKey.role,
        enabled: nextKey.enabled,
        perMinute: nextKey.perMinute
      });
      sendJson(res, 200, {
        id,
        key: safeInternalKey(nextKey),
        secret,
        persisted
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (index === -1 || isSystemInternalKey(keys[index])) {
        sendJson(res, 404, { error: `API key not found: ${id}` });
        return;
      }
      const nextKeys = keys.filter((key) => key.id !== id);
      assertAdminKeyAvailable(nextKeys);
      if (keys[index].walletManaged || keys[index].prepaid) await (await walletStore()).retire(keys[index].walletId);
      config.auth = { ...(config.auth || {}), internalApiKeys: nextKeys };
      const persisted = await saveConfig();
      auditAdminAction(auth, 'delete', 'api-key', id);
      sendJson(res, 200, { id, deleted: true, persisted });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/admin/requests') {
    sendJson(res, 200, await requestLogPage(url.searchParams));
    return;
  }

  if (url.pathname === '/admin/model-groups' && req.method === 'GET') {
    sendJson(res, 200, { data: managedGroups() });
    return;
  }
  if (url.pathname === '/admin/model-groups' && ['POST', 'PUT'].includes(req.method)) {
    const body = await readJsonBody(req);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 48 || /[\u0000-\u001f\u007f]/.test(name)) throw httpError(400, '分组名称应为 1–48 个可见字符');
    const editing = req.method === 'PUT';
    const id = editing ? body?.id : 'grp-' + randomUUID();
    await saveOperationsConfig('modelGroups', (groups) => {
      const available = managedGroups();
      if (editing && !available.some(group => group.id === id)) throw httpError(404, '分组不存在');
      if (available.some(group => group.id !== id && (group.name || 'default').toLowerCase() === name.toLowerCase())) {
        throw httpError(409, '已存在同名分组');
      }
      return { ...groups, [id]: { name } };
    });
    auditAdminAction(auth, editing ? 'update' : 'create', 'model-group', id, { name });
    sendJson(res, editing ? 200 : 201, { data: managedGroups() });
    return;
  }

  if (url.pathname === '/admin/model-groups' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (id === 'default') throw httpError(409, '默认分组需要保留');
    if (!id || deletingGroups.has(id)) throw httpError(409, '请选择可删除的分组，或稍后重试');
    deletingGroups.add(id);
    try {
      await saveOperationsConfig('modelGroups', async (groups) => {
        const group = managedGroups().find(item => item.id === id);
        if (!group) throw httpError(404, '分组不存在');
        if (group.channels.length) throw httpError(409, '请先将此分组的通道移到其他分组');
        if (await (await walletStore()).accounts.hasGroupKeys(id)) {
          throw httpError(409, '请先撤销此分组关联的用户 Key');
        }
        const remaining = { ...groups };
        delete remaining[id];
        return remaining;
      });
    } finally {
      deletingGroups.delete(id);
    }
    auditAdminAction(auth, 'delete', 'model-group', id);
    sendJson(res, 200, { data: managedGroups() });
    return;
  }

  if (url.pathname === '/admin/cny-pricing' && req.method === 'GET') {
    sendJson(res, 200, { prices: cnyPrices(), version: config.cnyPricing?.version || PRICE_DATE });
    return;
  }
  if (url.pathname === '/admin/cny-pricing' && req.method === 'PUT') {
    const body = await readJsonBody(req);
    const id = body?.model;
    if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id) || Object.hasOwn(Object.prototype, id)) {
      throw httpError(400, '请输入有效的模型别名');
    }
    const price = normalizeCnyPrice(body?.price);
    if (!price) throw httpError(400, '请填写有效的单价，最多支持四位小数');
    const version = new Date().toISOString();
    await saveOperationsConfig('cnyPricing', (current) => {
      const previous = cnyPrice(id);
      if (previous && Boolean(previous.image) !== Boolean(price.image)) throw httpError(409, '已有售价的模型不能切换计费单位');
      const mapping = Object.hasOwn(config.models, id) ? config.models[id] : undefined;
      const fallback = mapping && cnyPrice(mapping.upstreamModel);
      if (mapping?.saasEnabled && fallback && Boolean(fallback.image) !== Boolean(price.image)) {
        throw httpError(409, '已开放模型的计费单位必须与当前售价一致');
      }
      return { version, prices: { ...current?.prices, [id]: price } };
    });
    auditAdminAction(auth, 'update', 'cny-pricing', id, { version, price });
    sendJson(res, 200, { prices: cnyPrices(), version });
    return;
  }

  if (url.pathname === '/admin/cny-pricing' && req.method === 'DELETE') {
    const id = assertConfigId(url.searchParams.get('model'), 'model alias');
    if (deletingCnyPrices.has(id)) throw httpError(409, '此售价正在删除，请稍后重试');
    const version = new Date().toISOString();
    deletingCnyPrices.add(id);
    try {
      await saveOperationsConfig('cnyPricing', (current) => {
        if (!cnyPrice(id)) throw httpError(404, '售价不存在');
        const aliases = Object.entries(config.models || {}).filter(([alias, mapping]) =>
          mapping.enabled !== false && cnyPriceId(alias, mapping.upstreamModel) === id &&
          (mapping.saasEnabled || config.auth.internalApiKeys.some(key =>
            key.enabled !== false && key.prepaid && keyAllows(alias, key.allowedModels)))
        ).map(([alias]) => alias);
        if (aliases.length) throw httpError(409, `售价仍在使用，请先下架关联模型：${aliases.join('、')}`);
        const prices = { ...current?.prices };
        // A null override keeps a bundled price deleted across restarts.
        if (Object.hasOwn(CNY_PRICES, id)) prices[id] = null;
        else delete prices[id];
        return { version, prices };
      });
    } finally {
      deletingCnyPrices.delete(id);
    }
    auditAdminAction(auth, 'delete', 'cny-pricing', id, { version });
    sendJson(res, 200, { prices: cnyPrices(), version });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/audit') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    sendJson(res, 200, { data: auditLogs.slice(0, limit) });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/admin/usage') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 500), 500);
    sendJson(res, 200, { data: buildUsageSummary(requestLogs.slice(0, limit)) });
    return;
  }

  if (url.pathname === '/admin/models' && req.method === 'GET') {
    sendJson(res, 200, { data: config.models || {} });
    return;
  }

  if (url.pathname.startsWith('/admin/models/')) {
    const alias = assertConfigId(decodeURIComponent(url.pathname.replace('/admin/models/', '')), 'model alias');

    if (req.method === 'GET') {
      if (!config.models?.[alias]) {
        sendJson(res, 404, { error: `Model alias not found: ${alias}` });
        return;
      }
      sendJson(res, 200, { alias, model: config.models[alias] });
      return;
    }

    if (req.method === 'PUT') {
      const body = await readJsonBody(req);
      const previousAlias = body.previousAlias ? assertConfigId(body.previousAlias, 'previous model alias') : '';
      if (body.createOnly === true && Object.hasOwn(config.models, alias)) {
        throw httpError(409, '模型别名已被使用，请选择其他别名');
      }
      const renaming = Boolean(previousAlias && previousAlias !== alias);
      if (renaming && !config.models?.[previousAlias]) {
        sendJson(res, 404, { error: `Model alias not found: ${previousAlias}` });
        return;
      }
      if (renaming && config.models?.[alias]) {
        sendJson(res, 409, { error: `Model alias already exists: ${alias}` });
        return;
      }

      const existed = renaming ? true : Boolean(config.models?.[alias]);
      const existingModel = renaming ? config.models[previousAlias] : config.models?.[alias];
      const nextModel = normalizeModelInput(alias, body, existingModel || {});
      config.models = {
        ...(config.models || {}),
        [alias]: nextModel
      };
      let movedReferences = { defaultModelMoved: false, apiKeysUpdated: 0, pricingMoved: false };
      if (renaming) {
        delete config.models[previousAlias];
        movedReferences = moveModelAliasReferences(previousAlias, alias);
      }
      const persisted = await saveConfig();
      auditAdminAction(auth, renaming ? 'rename' : existed ? 'update' : 'create', 'model', alias, {
        previousAlias: renaming ? previousAlias : undefined,
        provider: nextModel.provider,
        upstreamModel: nextModel.upstreamModel,
        fallbackRoutes: nextModel.fallbacks?.length || 0,
        enabled: nextModel.enabled !== false,
        movedReferences
      });
      sendJson(res, 200, {
        alias,
        previousAlias: renaming ? previousAlias : undefined,
        model: config.models[alias],
        movedReferences,
        persisted
      });
      return;
    }

    if (req.method === 'DELETE') {
      if (!config.models?.[alias]) {
        sendJson(res, 404, { error: `Model alias not found: ${alias}` });
        return;
      }
      const references = modelAliasReferenceSummary(alias);
      if (references.length) {
        sendJson(res, 409, {
          error: `Model alias is still referenced: ${references.join(', ')}`
        });
        return;
      }
      delete config.models[alias];
      const pricingDeleted = Boolean(config.pricing?.models?.[alias]);
      if (pricingDeleted) {
        config.pricing = {
          ...(config.pricing || {}),
          models: {
            ...(config.pricing?.models || {})
          }
        };
        delete config.pricing.models[alias];
      }
      const persisted = await saveConfig();
      auditAdminAction(auth, 'delete', 'model', alias, { pricingDeleted });
      sendJson(res, 200, { alias, deleted: true, pricingDeleted, persisted });
      return;
    }
  }

  sendJson(res, 404, { error: 'Admin endpoint not found.' });
}

const USER_COOKIE = 'jl_user_session';

async function handleAccount(req, res, path, searchParams) {
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(req.method)) throw httpError(405, '不支持的请求方法');
  if (req.method !== 'GET') {
    if (req.headers.origin && !accountOrigin(req)) throw httpError(403, '请求来源不受信任');
    if (['POST', 'PUT'].includes(req.method) && req.headers['content-type']?.split(';')[0].trim() !== 'application/json')
      throw httpError(415, '账户操作需要 JSON 请求');
  }
  const cookies = parseCookies(req);
  const cookie = cookies[USER_COOKIE];
  const supportPath = /^\/account-api\/support(?:\/(read|end|reset))?$/.exec(path);
  if (supportPath) {
    const operation = supportPath[1];
    const token = cookies[SUPPORT_COOKIE];
    if (!operation && req.method === 'GET' && !token && !cookie) {
      sendJson(res, 200, { data: null });
      return;
    }
    const { accounts } = await walletStore();
    const user = cookie ? await accounts.session(cookie) : null;
    if (cookie && !user) throw httpError(401, '账号登录已过期，请刷新或重新登录');
    const viewer = { owner: user?.id, token };
    const support = accounts.support;
    if (!operation && req.method === 'GET') {
      sendJson(res, 200, { data: await support.read(viewer, searchParams.get('summary') === 'true') });
      return;
    }
    if (req.method !== 'POST') throw httpError(405, '不支持的请求方法');
    if (operation !== 'read' && !checkRateLimit({ id: 'support-' + path + '-' + (user?.id || clientAddress(req)), perMinute: operation === 'reset' ? 5 : 8 }).ok)
      throw httpError(429, '操作频繁，请稍后再试');
    const body = await readJsonBody(req);
    const setGuestCookie = (value, seconds) => ({ 'set-cookie': `${SUPPORT_COOKIE}=${value}; Path=/account-api/support; HttpOnly; SameSite=Lax; Max-Age=${seconds}${isHttpsRequest(req) ? '; Secure' : ''}` });
    if (operation === 'read') {
      await support.markRead(viewer, body?.seq);
      sendJson(res, 200, { ok: true });
    } else if (operation === 'end') {
      await support.endGuest(viewer);
      sendJson(res, 200, { ok: true }, setGuestCookie('', 0));
    } else if (operation === 'reset') {
      const { owner, threadId, recoveryCode } = await support.reset(viewer, body?.password);
      pushAuditLog({ id: randomUUID(), time: new Date().toISOString(), actorKeyId: 'support-session',
        action: 'reset-password', resource: 'user', target: owner, details: { threadId } });
      sendJson(res, 200, { recoveryCode });
    } else {
      const { data, issued } = await support.send(viewer, body?.message);
      sendJson(res, 200, { data }, issued ? setGuestCookie(issued, supportSessionTtl) : {});
    }
    return;
  }
  const sessionProbe = req.method === 'GET' && path === '/account-api/session';
  if (sessionProbe && authenticateAdminSession(req).ok) {
    sendJson(res, 200, { role: 'admin', user: superAdminUserPayload() });
    return;
  }
  if (sessionProbe && !cookie) {
    sendJson(res, 200, { role: null, user: null });
    return;
  }
  const userCookie = (token, seconds) =>
    USER_COOKIE +
    '=' +
    token +
    '; Path=/account-api/; HttpOnly; SameSite=Lax; Max-Age=' +
    seconds +
    (isHttpsRequest(req) ? '; Secure' : '');
  if (req.method === 'POST' && path === '/account-api/logout') {
    if (cookie) await (await walletStore()).accounts.logout(cookie);
    revokeAdminSession(req);
    sendJson(res, 200, { ok: true }, { 'set-cookie': [userCookie('', 0), clearAdminSessionCookie(req)] });
    return;
  }
  const operations = {
    '/account-api/register': 'register',
    '/account-api/login': 'login',
    '/account-api/recover': 'recover'
  };
  if (req.method === 'POST' && Object.hasOwn(operations, path)) {
    if (!checkRateLimit({ id: 'user-auth-' + clientAddress(req), perMinute: 15 }).ok)
      throw httpError(429, '尝试次数过多，请稍后再试');
    const body = await readJsonBody(req);
    if (!isPlainObject(body)) throw httpError(400, '请提交账号资料');
    const name = cleanString(body.username);
    const isAdminName = safeTextEqual(name.toLowerCase(), superAdminUsername().toLowerCase());
    if (isAdminName && path === '/account-api/register') throw httpError(409, '用户名已被使用');
    if (isAdminName && path === '/account-api/login' && verifyAdminLogin(req, name, body.password)) {
      if (cookie) await (await walletStore()).accounts.logout(cookie);
      sendAdminLogin(req, res, [userCookie('', 0)]);
      return;
    }
    // An existing customer with a matching username can still use their own password.
    const accounts = (await walletStore()).accounts;
    const result = await accounts[operations[path]](body);
    if (cookie) await accounts.logout(cookie);
    revokeAdminSession(req);
    sendJson(
      res,
      200,
      { role: 'user', user: result.user, recoveryCode: result.recoveryCode },
      {
        'set-cookie': [userCookie(result.token, result.ttl), clearAdminSessionCookie(req)]
      }
    );
    return;
  }
  const store = await walletStore();
  const accounts = store.accounts;
  const user = await accounts.session(cookie);
  if (sessionProbe && !user) {
    sendJson(res, 200, { role: null, user: null }, { 'set-cookie': userCookie('', 0) });
    return;
  }
  if (!user) throw httpError(401, '请登录用户账号');
  if (!checkRateLimit({ id: 'user-web-' + user.id, perMinute: 120 }).ok) throw httpError(429, '请求过于频繁');
  const owner = 'user/' + user.id;
  const keyAction = /^\/account-api\/keys\/([^/]+)\/(secret|rotate)$/.exec(path);
  if (keyAction) {
    const [, id, action] = keyAction;
    if (action === 'secret' && req.method === 'GET') {
      sendJson(res, 200, { secret: await accounts.keySecret(user.id, id) }, { 'cache-control': 'no-store' });
      return;
    }
    if (action === 'rotate' && req.method === 'POST') {
      sendJson(res, 200, await accounts.rotateKey(user.id, id), { 'cache-control': 'no-store' });
      return;
    }
    throw httpError(405, '不支持的请求方法');
  }
  if (sessionProbe || (req.method === 'GET' && path === '/account-api/me')) {
    const keys = await accounts.keys(user.id);
    const models = publicModelList({ accountId: user.id, role: 'service' });
    const groupIds = new Set([...models.flatMap(model => model.groups), ...keys.map(key => key.modelGroup)]);
    const groupLabels = Object.fromEntries([...groupIds].flatMap((id) => {
      const group = Object.hasOwn(config.modelGroups || {}, id) ? config.modelGroups[id] : undefined;
      return group ? [[id, group.name]] : [];
    }));
    sendJson(res, 200, { role: 'user', user, keys, models, groupLabels });
  } else if (req.method === 'GET' && path === '/account-api/requests') {
    const keyIds = new Set((await accounts.keys(user.id)).map(key => key.id));
    sendJson(res, 200, await requestLogPage(searchParams, log => log.accountId === user.id ||
      (!log.accountId && keyIds.has(log.apiKeyId)), true));
  } else if (req.method === 'POST' && path === '/account-api/keys') {
    const body = await readJsonBody(req);
    const group = body?.modelGroup ?? 'default';
    const result = await queueConfigSave(() => {
      const groups = publicModelList({ accountId: user.id, role: 'service' }).flatMap((model) => model.groups);
      if (!groups.includes(group) || deletingGroups.has(group)) throw httpError(400, '请选择当前已开放的模型分组');
      const savedGroup = Object.hasOwn(config.modelGroups || {}, group) ? config.modelGroups[group] : undefined;
      const name = body?.name ?? ((savedGroup?.name || (group === 'default' ? 'API' : group)) + ' Key');
      return accounts.createKey(user.id, name, group);
    });
    sendJson(res, 201, result);
  } else if (req.method === 'PUT' && /^\/account-api\/keys\/[^/]+$/.test(path)) {
    const body = await readJsonBody(req);
    await accounts.renameKey(user.id, path.slice('/account-api/keys/'.length), body?.name);
    sendJson(res, 200, { ok: true });
  } else if (req.method === 'DELETE' && path.startsWith('/account-api/keys/')) {
    await accounts.removeKey(user.id, path.slice('/account-api/keys/'.length));
    sendJson(res, 200, { ok: true });
  } else if (req.method === 'GET' && path === '/account-api/wallet') {
    const includeCancelled = searchParams?.get('includeCancelled') === 'true';
    sendJson(res, 200, await store.summary(owner, includeCancelled));
  } else if (
    (req.method === 'DELETE' && path.startsWith('/account-api/orders/')) ||
    (req.method === 'POST' && path.startsWith('/account-api/orders/') && path.endsWith('/cancel'))
  ) {
    const orderId = path.replace('/account-api/orders/', '').replace('/cancel', '').trim().toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(orderId)) throw httpError(400, '订单号格式不正确');
    const result = await store.cancelOrder(owner, orderId);
    sendJson(res, 200, result);
  } else if (req.method === 'POST' && path === '/account-api/orders') {
    const body = await readJsonBody(req);
    sendJson(res, 200, await store.create(owner, body?.fen, body?.channel, Boolean(paymentImages[CHECKOUT_CHANNEL])));
  } else throw httpError(404, '没有找到此账户接口');
}

async function handlePayments(req, res, path, searchParams) {
  const qrImage = paymentImages[CHECKOUT_CHANNEL];
  if (path === '/payments/info' && req.method === 'GET') {
    const usableOnly = searchParams.get('usable') === 'true';
    const usableList = publicModelList({ accountId: true, role: 'service' });
    const prices = publishedCnyPrices(usableOnly);
    const comparisons = {};
    for (const { id } of usableList) {
      const routes = availableRoutes(config.models[id], true);
      if (!routes.length || routes.some(route => route.upstreamModel !== id)) continue;
      const discount = standardApiDiscount(id, prices[id]);
      if (discount) comparisons[id] = discount;
    }
    const groupsMap = {};
    for (const [id, g] of Object.entries(config.modelGroups || {})) {
      groupsMap[id] = g.name || id;
    }
    sendJson(res, 200, {
      channel: CHECKOUT_CHANNEL,
      enabled: (await (await walletStore()).checkout(Boolean(qrImage))).enabled,
      priceVersion: config.cnyPricing?.version || PRICE_DATE,
      prices,
      standardApiComparison: { ...OPENAI_STANDARD_REFERENCE, models: comparisons },
      usableModels: usableList.map((m) => m.id),
      models: usableList,
      groupNames: groupsMap
    });
    return;
  }
  if (path === '/payments/wechat/qr' && req.method === 'GET') {
    const image = await (await walletStore()).qr(qrImage);
    if (!image) throw httpError(404,'微信收款尚未开放');
    res.writeHead(200, { 'content-type': image.type });
    res.end(image.bytes);
    return;
  }
  if (['/payments/alipay/confirm','/payments/wechat/confirm','/payments/confirm'].includes(path) && req.method === 'POST') {
    // Previously installed WeChat shortcuts use the unqualified endpoint.
    const channel = path === '/payments/alipay/confirm' ? 'alipay' : 'wechat';
    const expectedToken = channel === 'wechat' ? wechatReceiptToken : receiptToken;
    const credential = extractCredential(req);
    if (expectedToken.length < 32 || !credential.ok || !safeTextEqual(credential.token, expectedToken)) {
      throw httpError(403, '收款确认凭证无效');
    }
    const body = await readJsonBody(req);
    if (body?.channel !== undefined && body.channel !== channel) throw httpError(400, '收款渠道与核款入口不符');
    const result = await (await walletStore()).confirm(channel, body || {});
    sendJson(res, 200, result);
    return;
  }
  if (path.startsWith('/payments/orders/') && req.method === 'DELETE') {
    const auth = await authenticateProxy(req);
    if (!auth.ok) throw httpError(auth.status, auth.error);
    if (auth.key.role !== 'service' || !auth.key.prepaid) throw httpError(403, '请使用已启用预付费的业务 Key');
    const orderId = path.slice('/payments/orders/'.length).trim().toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(orderId)) throw httpError(400, '订单号格式不正确');
    const result = await (await walletStore()).cancelOrder(auth.key.walletId, orderId);
    sendJson(res, 200, result);
    return;
  }
  if ((path === '/payments/account' && req.method === 'GET') || (path === '/payments/orders' && req.method === 'POST')) {
    const auth = await authenticateProxy(req);
    if (!auth.ok) throw httpError(auth.status, auth.error);
    if (auth.key.role !== 'service' || !auth.key.prepaid) throw httpError(403, '请使用已启用预付费的业务 Key');
    const owner = auth.key.walletId;
    if (req.method === 'GET') {
      const includeCancelled = searchParams?.get('includeCancelled') === 'true';
      sendJson(res, 200, await (await walletStore()).summary(owner, includeCancelled));
    } else {
      const body = await readJsonBody(req);
      sendJson(res, 200, await (await walletStore()).create(owner, body?.fen, body?.channel, Boolean(qrImage)));
    }
    return;
  }
  throw httpError(404, '没有找到此收款接口');
}

async function routeRequest(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/admin/') || url.pathname.startsWith('/v1/')) {
      res.setHeader('cache-control', 'no-store');
    }
    const shortcut = /^\/shortcuts\/(AlipayReceipt|WechatReceipt)\.shortcut$/.exec(url.pathname);
    if (shortcut && ['GET', 'HEAD'].includes(req.method)) {
      const name = shortcut[1];
      const file = resolve(__dirname, 'shortcuts', name + '.signed');
      try {
        const { size } = await stat(file);
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': size,
          'content-disposition': 'attachment; filename="' + name + '.shortcut"' });
        res.end(req.method === 'HEAD' ? undefined : await readFile(file));
        return;
      } catch {
        sendJson(res, 404, { error: '快捷指令文件未就绪或未签名' });
        return;
      }
    }
    if (url.pathname.startsWith('/account-api/')) {
      await handleAccount(req,res,url.pathname,url.searchParams);
      return;
    }
    if (url.pathname.startsWith('/payments/')) {
      await handlePayments(req, res, url.pathname, url.searchParams);
      return;
    }
    if (url.pathname === '/app-config') {
      if (!['GET', 'HEAD'].includes(req.method)) {
        sendJson(res, 405, { error: 'Only GET is supported for /app-config.' });
        return;
      }
      sendJson(res, 200, publicRuntimeConfig());
      return;
    }

    if (url.pathname === '/health') {
      if (!requireObserverAccess(req, res)) {
        return;
      }
      sendJson(res, 200, {
        ok: true
      });
      return;
    }

    if (url.pathname === '/ready') {
      if (!requireObserverAccess(req, res)) {
        return;
      }
      const defaultModel = config.routing?.defaultModel;
      const models = defaultModel ? [config.models?.[defaultModel]] : Object.values(config.models || {});
      const ok = !concurrencyState.shuttingDown && models.some((model) => {
        return model && model.enabled !== false && configuredRouteCandidates(model).some(({ provider }) => {
          const channel = config.providers?.[provider];
          return channel && channel.enabled !== false && providerConfigured(channel);
        });
      });
      sendJson(res, ok ? 200 : 503, {
        ok
      });
      return;
    }

    if (url.pathname === '/metrics') {
      const auth = authenticate(req, { admin: true });
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error });
        return;
      }
      sendText(res, 200, prometheusMetrics(), { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
      return;
    }

    if (url.pathname === '/' && !SERVE_FRONTEND) {
      sendJson(res, 200, {
        name: 'Wormhole AI Gateway',
        health: '/health',
        ready: '/ready',
        metrics: '/metrics',
        models: '/v1/models',
        proxy: '/v1/chat/completions',
        admin: '/admin/models'
      });
      return;
    }

    if (url.pathname === '/v1/models' || url.pathname.startsWith('/v1/models/') || url.pathname === '/v1/codex/models') {
      await handleModels(req, res, url);
      return;
    }

    if (url.pathname === '/admin/session' || url.pathname === '/admin/session/password') {
      await handleAdminSession(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/admin/')) {
      await handleAdmin(req, res, url);
      return;
    }

    if (url.pathname.startsWith('/v1/')) {
      const auth = await authenticateProxy(req, { allowAdminSession: true });
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.error });
        return;
      }
      await handleProxy(req, res, url, auth);
      return;
    }

    if (await serveFrontend(req, res, url)) {
      return;
    }

    sendJson(res, 404, { error: 'Not found.' });
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500 && /^\/(?:account-api\/|payments\/|admin\/support(?:\/|\?|$))/.test(req.url || '')) {
      console.error('Account or wallet operation failed', error.code || status);
      sendJson(res, status, { error: '账户或收款服务暂不可用，请稍后重试' });
    } else sendJson(res, status, { error: error.message });
  }
}

const server = createServer(routeRequest);
const host = process.env.HOST || config.server?.host || '0.0.0.0';
const port = Number(process.env.PORT || config.server?.port || 8787);
let shutdownStarted = false;

function beginGracefulShutdown(signal) {
  if (shutdownStarted) {
    return;
  }
  shutdownStarted = true;
  concurrencyState.shuttingDown = true;
  console.log(`Wormhole AI Gateway received ${signal}; draining in-flight requests.`);
  const timeoutMs = Number(config.limits?.gracefulShutdownTimeoutMs || 30_000);
  const forceTimer = setTimeout(() => {
    console.error(`Wormhole AI Gateway forced shutdown after ${timeoutMs}ms.`);
    process.exit(1);
  }, timeoutMs);
  forceTimer.unref();
  server.close((error) => {
    clearTimeout(forceTimer);
    void (async () => {
      if (postgresPool) {
        try {
          await postgresPool.end();
        } catch (closeError) {
          console.error(`Wormhole AI Gateway PostgreSQL shutdown error: ${closeError.message}`);
        }
      }
      if (error) {
        console.error(`Wormhole AI Gateway shutdown error: ${error.message}`);
        process.exit(1);
      }
      console.log('Wormhole AI Gateway shutdown complete.');
      process.exit(0);
    })();
  });
}

server.listen(port, host, () => {
  const mode = configState.persistent
    ? `storage=${configState.driver || STORAGE_DRIVER} config=${configState.path}`
    : `storage=${configState.driver || STORAGE_DRIVER} config=${configState.path} (not persisted)`;
  console.log(`Wormhole AI Gateway listening on http://${host}:${port} ${mode}`);
  if (!configState.persistent) {
    console.log(`First successful admin write will create ${configState.path}.`);
  }
});

process.on('SIGTERM', () => beginGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => beginGracefulShutdown('SIGINT'));

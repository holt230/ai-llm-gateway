import { createServer } from 'node:http';
import { stat, readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import pg from 'pg';

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
const SUPER_ADMIN_PASSWORD = envValue('AI_GW_SUPER_ADMIN_PASSWORD', 'VITE_AI_GW_SUPER_ADMIN_PASSWORD');
const DEFAULT_PUBLIC_BASE_URL = 'https://ai-gw.jetlinks.cn';

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

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
]);

const PUBLIC_UPSTREAM_RESPONSE_HEADERS = new Set([
  'cache-control',
  'content-disposition',
  'content-type'
]);

const DEFAULT_FAILOVER_STATUS_CODES = [429, 500, 502, 503, 504];
const PRICING_BILLING_UNITS = new Set(['token', 'image', 'request']);
const DEFAULT_MAX_MULTIPART_PARTS = 128;
const DEFAULT_MAX_MULTIPART_FILES = 32;

const STATIC_MIME_TYPES = {
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
      internalApiKeys: [
        {
          id: 'admin-dev',
          name: 'System Admin',
          key: 'dev-internal-key',
          role: 'admin',
          system: true,
          enabled: true,
          perMinute: 120,
          allowedModels: ['*'],
          allowedEndpoints: ['*']
        }
      ]
    },
    providers: {},
    models: {},
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
  let keys = (next.auth.internalApiKeys || []).map((key) => ({
    ...normalizeStoredInternalKey(key),
    allowedModels: normalizeAccessList(key.allowedModels, ['*'], 'allowedModels'),
    allowedEndpoints: normalizeEndpoints(key.allowedEndpoints, ['*'])
  }));
  if (process.env.AI_GW_DISABLE_DEV_KEYS === 'true') {
    keys = keys.filter((key) => key.id !== 'admin-dev');
  }
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

async function saveConfig() {
  const serializable = serializeConfigForDisk(config);
  if (postgresPool) {
    await postgresPool.query(
      `
        INSERT INTO jetlink_gateway_config (id, config, created_at, updated_at)
        VALUES ($1, $2::jsonb, now(), now())
        ON CONFLICT (id)
        DO UPDATE SET config = EXCLUDED.config, updated_at = now()
      `,
      [POSTGRES_CONFIG_ID, JSON.stringify(serializable)]
    );
    configState.persistent = true;
    return true;
  }
  await mkdir(dirname(configState.path), { recursive: true });
  await writeFile(configState.path, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
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
    name: 'JetLinksAPI Gateway',
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

function setCors(req, res) {
  const origin = getCorsOrigin(req);
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
      const [, bucket] = existing.split(':');
      if (Number(bucket) < Math.floor(now / windowMs) - 2) {
        rateBuckets.delete(existing);
      }
    }
  }
  return { ok: true };
}

async function readRawBody(req) {
  const maxBytes = Number(config.security?.maxBodyBytes || 26_214_400);
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

function encryptSecret(value) {
  const raw = cleanString(value, '');
  if (!raw) {
    return undefined;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', providerSecretEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`;
}

function decryptSecret(value) {
  const raw = cleanString(value, '');
  if (!raw) {
    return '';
  }
  try {
    const [version, ivText, tagText, encryptedText] = raw.split(':');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
      return '';
    }
    const decipher = createDecipheriv('aes-256-gcm', providerSecretEncryptionKey(), Buffer.from(ivText, 'base64url'));
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
    endpoints: normalizeEndpoints(body.endpoints, existing.endpoints || ['chat'])
  };
  if (fallbacks.length) {
    model.fallbacks = fallbacks;
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

  const provider = {
    ...existing,
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

function resolveModel(alias, endpointKind) {
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
  const candidates = configuredRouteCandidates(mapping)
    .map((candidate) => ({
      ...candidate,
      providerConfig: config.providers?.[candidate.provider]
    }))
    .filter((candidate) => candidate.providerConfig && candidate.providerConfig.enabled !== false);
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
  const headers = {};
  for (const [name, value] of Object.entries(req.headers)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lower) || lower === 'authorization' || lower === 'x-api-key' || lower === 'content-type') {
      continue;
    }
    if (Array.isArray(value)) {
      headers[name] = value.join(', ');
    } else if (value !== undefined) {
      headers[name] = value;
    }
  }
  if (bodyKind === 'json') {
    headers['content-type'] = 'application/json';
  }
  headers['x-request-id'] = requestId;
  const apiKey = upstreamApiKey(provider);
  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }
  for (const [name, value] of Object.entries(provider.headers || {})) {
    headers[name] = value;
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
    if (!HOP_BY_HOP_HEADERS.has(lower) && PUBLIC_UPSTREAM_RESPONSE_HEADERS.has(lower)) {
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
  const limitedScopes = scopes.filter((scope) => Number(scope.limit || 0) > 0);
  if (!limitedScopes.length) {
    return Promise.resolve(() => undefined);
  }
  if (concurrencyState.shuttingDown) {
    throw httpError(503, 'Gateway is shutting down and not accepting new proxy requests.');
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
      meta,
      queuedAt: Date.now(),
      resolve,
      reject,
      timer: undefined
    };
    entry.timer = setTimeout(() => {
      const index = concurrencyState.queue.indexOf(entry);
      if (index !== -1) {
        concurrencyState.queue.splice(index, 1);
      }
      concurrencyState.queueTimeouts += 1;
      concurrencyState.rejected += 1;
      reject(concurrencyError('Gateway concurrency queue timeout.', Math.max(1, Math.ceil(queueTimeoutMs / 1000)), Boolean(meta.retryable)));
    }, queueTimeoutMs);
    concurrencyState.queue.push(entry);
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
    clearTimeout(entry.timer);
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
  const inputTokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.inputTokens ?? 0);
  const outputTokens = Number(usage.completion_tokens ?? usage.output_tokens ?? usage.outputTokens ?? 0);
  const totalTokens = Number(usage.total_tokens ?? usage.totalTokens ?? inputTokens + outputTokens);
  if (![inputTokens, outputTokens, totalTokens].every((value) => Number.isFinite(value) && value >= 0)) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}

function extractUsageFromPayload(payload) {
  if (!isPlainObject(payload)) {
    return undefined;
  }
  const direct = normalizeUsagePayload(payload.usage);
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

function sanitizeProxyJsonBuffer(buffer, contentType, alias) {
  const payload = parseJsonPayload(buffer, contentType);
  if (!payload) {
    return buffer;
  }
  return Buffer.from(JSON.stringify(sanitizeProxyPayload(payload, alias)), 'utf8');
}

function parseJsonUsage(buffer, contentType = '') {
  return extractUsageFromPayload(parseJsonPayload(buffer, contentType));
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
  const cost = estimateCost(modelAlias, usage, billableUsage, logEntry.status);
  if (cost) {
    logEntry.estimatedCost = cost;
  }
}

function estimatedCostFromLog(log) {
  const calculated = estimateCost(log.modelAlias, log.usage, billableUsageFromLog(log), log.status);
  return calculated || log.estimatedCost;
}

function enrichLogWithBilling(log) {
  return {
    ...log,
    billableUsage: billableUsageFromLog(log),
    estimatedCost: estimatedCostFromLog(log)
  };
}

function sanitizeSseDataLine(line, alias) {
  if (!line.startsWith('data:')) {
    return line;
  }
  const data = line.slice(5).trimStart();
  if (!data || data === '[DONE]') {
    return line;
  }
  try {
    const payload = JSON.parse(data);
    return `data: ${JSON.stringify(sanitizeProxyPayload(payload, alias))}`;
  } catch {
    return line;
  }
}

function createProxyStreamSanitizer(contentType, alias) {
  if (!contentType.toLowerCase().includes('text/event-stream')) {
    return undefined;
  }
  let pending = '';
  return new Transform({
    transform(chunk, encoding, callback) {
      pending += chunk.toString('utf8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      const sanitized = lines.map((line) => sanitizeSseDataLine(line, alias)).join('\n');
      callback(null, sanitized ? `${sanitized}\n` : '');
    },
    flush(callback) {
      callback(null, pending ? sanitizeSseDataLine(pending, alias) : '');
    }
  });
}

function pipeUpstreamBody(body, res, contentType = '', alias = '') {
  return new Promise((resolvePromise, rejectPromise) => {
    const stream = Readable.fromWeb(body);
    const sanitizer = alias ? createProxyStreamSanitizer(contentType, alias) : undefined;
    const output = sanitizer ? stream.pipe(sanitizer) : stream;
    let settled = false;
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      stream.removeListener('error', onError);
      sanitizer?.removeListener('error', onError);
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
      callback(value);
    };
    const onError = (error) => settle(rejectPromise, error);
    const onFinish = () => settle(resolvePromise);
    const onClose = () => settle(resolvePromise);
    stream.on('error', onError);
    sanitizer?.on('error', onError);
    res.on('finish', onFinish);
    res.on('close', onClose);
    output.pipe(res);
  });
}

async function handleProxy(req, res, url, auth) {
  const started = Date.now();
  const requestId = req.headers['x-request-id'] || randomUUID();
  const endpointKind = classifyEndpoint(url.pathname);
  let requestRelease = () => undefined;
  let logEntry = {
    requestId,
    time: new Date().toISOString(),
    apiKeyId: auth.key.id,
    endpoint: url.pathname,
    status: 500,
    durationMs: 0
  };

  try {
    if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
      logEntry.status = 405;
      sendJson(res, 405, { error: 'Only POST/PUT/PATCH proxy requests are supported for /v1/*.' });
      return;
    }

    const proxyBody = await readProxyBody(req);
    const resolved = resolveModel(proxyBody.model, endpointKind);
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
    requestRelease = await acquireConcurrency(requestConcurrencyScopes(auth, alias, mapping), {
      requestId,
      apiKeyId: auth.key.id,
      modelAlias: alias
    });

    let lastFailure = null;
    for (const [index, candidate] of candidates.entries()) {
      const provider = candidate.providerConfig;
      let providerRelease = () => undefined;
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
          requestId,
          provider: candidate.provider,
          modelAlias: alias,
          retryable: true
        });

        if (provider.type === 'mock') {
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

        const upstream = await fetch(buildUpstreamUrl(provider, url.pathname, url.search), {
          method: req.method,
          headers: buildUpstreamHeaders(req, provider, requestId, { bodyKind: proxyBody.kind }),
          body: proxyBody.buildUpstreamBody(candidate.upstreamModel),
          signal: AbortSignal.timeout(normalizeTimeout(provider.timeoutMs, 120_000))
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
          await upstream.arrayBuffer().catch(() => undefined);
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

        setProxyResponseHeaders(res, upstream, requestId, alias);
        if (upstream.body) {
          if (proxyBody.stream) {
            await pipeUpstreamBody(upstream.body, res, upstream.headers.get('content-type') || '', alias);
            applyUsageAccounting(logEntry, alias, undefined, buildBillableUsage({
              endpointKind,
              requestBody: proxyBody.requestBody,
              status: logEntry.status
            }));
          } else {
            const payload = Buffer.from(await upstream.arrayBuffer());
            const contentType = upstream.headers.get('content-type') || '';
            const responsePayload = parseJsonPayload(payload, contentType);
            const usage = extractUsageFromPayload(responsePayload);
            applyUsageAccounting(logEntry, alias, usage, buildBillableUsage({
              endpointKind,
              requestBody: proxyBody.requestBody,
              responsePayload,
              status: logEntry.status,
              usage
            }));
            res.end(sanitizeProxyJsonBuffer(payload, contentType, alias));
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
        attempt.status = statusFromProxyError(error);
        attempt.error = error.message;
        const canFailover = hasNextCandidate && (error.retryable || shouldFailoverError(error));
        attempt.retryable = canFailover;
        lastFailure = {
          status: attempt.status,
          provider: candidate.provider,
          upstreamModel: candidate.upstreamModel,
          error: error.message
        };
        if (!canFailover) {
          attempt.durationMs = Date.now() - attemptStarted;
          logEntry.status = attempt.status;
          logEntry.error = error.message;
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
    const status = error.status || 500;
    logEntry.status = status;
    if (!res.headersSent) {
      sendJson(res, status, {
        error: status >= 500 ? 'Internal gateway error.' : error.message,
        request_id: requestId
      });
    } else {
      res.end();
    }
  } finally {
    logEntry.durationMs = Date.now() - started;
    requestRelease();
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
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...headers
    });
    const chunks = ['JetLinksAPI ', 'stream ', `response for ${alias}.`];
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
      output_text: `JetLinksAPI response for ${alias}.`,
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: `JetLinksAPI response for ${alias}.` }]
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
      content: [{ type: 'text', text: `JetLinksAPI message for ${alias}.` }],
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
          content: `JetLinksAPI response for ${alias}.`
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

function publicModelList(key) {
  return Object.entries(config.models || {})
    .filter(([, model]) => model.enabled !== false)
    .filter(([alias, model]) => !key || modelVisibleToKey(key, alias, model))
    .map(([alias, model]) => publicModelDescriptor(alias, model));
}

function publicModelDescriptor(alias, model) {
  return {
    id: alias,
    object: 'model',
    created: 0,
    owned_by: 'jetlinksapi',
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
    name: 'JetLinksAPI Gateway',
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

async function handleModels(req, res, url) {
  const auth = authenticate(req);
  if (!auth.ok) {
    sendJson(res, auth.status, { error: auth.error });
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
    ...publicModelDescriptor(alias, model)
  });
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
    const loginRate = checkAdminLoginRateLimit(req);
    if (!loginRate.ok) {
      sendJson(res, 429, { error: `Too many sign-in attempts. Retry after ${loginRate.retryAfterSeconds}s.` });
      return;
    }
    const body = await readJsonBody(req);
    const username = cleanString(body.username);
    const password = String(body.password || '');
    const valid = safeTextEqual(username.toLowerCase(), superAdminUsername().toLowerCase())
      && verifySuperAdminPassword(password);
    if (!valid) {
      pushAuditLog({
        id: randomUUID(),
        time: new Date().toISOString(),
        actorKeyId: 'anonymous',
        action: 'login_failed',
        resource: 'admin-session',
        target: username || 'unknown',
        details: { remoteAddress: clientAddress(req) }
      });
      sendJson(res, 401, { error: 'Invalid super admin credentials.' });
      return;
    }
    const token = createAdminSession();
    pushAuditLog({
      id: randomUUID(),
      time: new Date().toISOString(),
      actorKeyId: 'console-session',
      action: 'login',
      resource: 'admin-session',
      target: superAdminUsername(),
      details: { remoteAddress: clientAddress(req) }
    });
    sendJson(res, 200, {
      user: superAdminUserPayload(),
      expiresInSeconds: Math.floor(ADMIN_SESSION_TTL_MS / 1000)
    }, {
      'set-cookie': adminSessionCookie(req, token, Math.floor(ADMIN_SESSION_TTL_MS / 1000))
    });
    return;
  }

  if (req.method === 'DELETE') {
    const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
    if (token) {
      adminSessions.delete(hashSessionToken(token));
    }
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
        .filter(([, model]) => model.provider === id)
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
      config.auth = { ...(config.auth || {}), internalApiKeys: nextKeys };
      const persisted = await saveConfig();
      auditAdminAction(auth, 'delete', 'api-key', id);
      sendJson(res, 200, { id, deleted: true, persisted });
      return;
    }
  }

  if (req.method === 'GET' && url.pathname === '/admin/requests') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    sendJson(res, 200, { data: requestLogs.slice(0, limit).map(enrichLogWithBilling) });
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

async function routeRequest(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
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
      const enabledProviders = Object.entries(config.providers || {}).filter(([, provider]) => provider.enabled !== false);
      const enabledModels = Object.entries(config.models || {}).filter(([, model]) => model.enabled !== false);
      const defaultModel = config.routing?.defaultModel;
      const defaultResolution = defaultModel ? resolveModel(defaultModel, 'chat') : { ok: false, error: 'No default model configured.' };
      const defaultConfiguredRouteCount = defaultResolution.ok
        ? defaultResolution.candidates.filter((candidate) => providerConfigured(candidate.providerConfig)).length
        : 0;
      const ok = !concurrencyState.shuttingDown && enabledProviders.length > 0 && enabledModels.length > 0 && defaultResolution.ok && defaultConfiguredRouteCount > 0;
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
        name: 'JetLinksAPI Gateway',
        health: '/health',
        ready: '/ready',
        metrics: '/metrics',
        models: '/v1/models',
        proxy: '/v1/chat/completions',
        admin: '/admin/models'
      });
      return;
    }

    if (url.pathname === '/v1/models' || url.pathname.startsWith('/v1/models/')) {
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
      const auth = authenticate(req, { allowAdminSession: true });
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
    sendJson(res, error.status || 500, { error: error.message });
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
  console.log(`JetLinksAPI Gateway received ${signal}; draining in-flight requests.`);
  const timeoutMs = Number(config.limits?.gracefulShutdownTimeoutMs || 30_000);
  const forceTimer = setTimeout(() => {
    console.error(`JetLinksAPI Gateway forced shutdown after ${timeoutMs}ms.`);
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
          console.error(`JetLinksAPI Gateway PostgreSQL shutdown error: ${closeError.message}`);
        }
      }
      if (error) {
        console.error(`JetLinksAPI Gateway shutdown error: ${error.message}`);
        process.exit(1);
      }
      console.log('JetLinksAPI Gateway shutdown complete.');
      process.exit(0);
    })();
  });
}

server.listen(port, host, () => {
  const mode = configState.persistent
    ? `storage=${configState.driver || STORAGE_DRIVER} config=${configState.path}`
    : `storage=${configState.driver || STORAGE_DRIVER} config=${configState.path} (not persisted)`;
  console.log(`JetLinksAPI Gateway listening on http://${host}:${port} ${mode}`);
  if (!configState.persistent) {
    console.log(`First successful admin write will create ${configState.path}.`);
  }
});

process.on('SIGTERM', () => beginGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => beginGracefulShutdown('SIGINT'));

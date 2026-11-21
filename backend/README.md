# Wormhole AI Gateway Backend

Wormhole AI provides a prepaid model API for individual accounts and internal service keys.
It validates internal API keys, rewrites internal model aliases to upstream model
names, and proxies requests to third-party LLM providers.

人民币预付费业务 Key、网站收款码和 iPhone 人工核款的配置方法见 [微信经营收款码与人民币钱包](manual-payments.md)。

The public client base URL is `https://1024012.xyz/v1`. All accounts sign in at `/login`; the server selects the user workspace or admin console.

## Discover and publish models

In the admin console, open a configured channel and select **Import upstream models**. The gateway reads the upstream model list using that channel's credentials. Select the models and the protocols they support. Bulk import creates mappings and preserves existing mappings. Users can see models published with compatible CNY pricing through an enabled channel in their key's group.

For Codex, select **Responses** for models supported by the upstream Responses API. Import or reimport the key with CC Switch and activate **Wormhole AI** in Codex's provider list. The link sets the same-origin catalog URL at /v1/codex/models. This catalog uses the same authentication and scope as /v1/models, and contains only Responses-capable models. Open a new Codex session to read the catalog if an existing session is still showing its previous models.

## Start

```bash
npm run gateway
```

Default local address:

```text
http://127.0.0.1:8787
```

For container or server deployment, override the listen host:

```bash
HOST=0.0.0.0 npm run gateway
```

Serve the built frontend from the same backend process:

```bash
npm run build
AI_GW_SERVE_FRONTEND=true HOST=0.0.0.0 npm run start
```

Console super admin username:

```text
username: admin
```

For deployment, configure the backend with
`AI_GW_SUPER_ADMIN_USERNAME`,
`AI_GW_SUPER_ADMIN_PASSWORD`, and `AI_GW_SUPER_ADMIN_NAME`. Password
verification is handled by the backend and the browser receives an HttpOnly
session cookie, not an embedded admin API key. `AI_GW_SUPER_ADMIN_PASSWORD`
must be set before the console can sign in.
Supply the password and any API keys as backend runtime variables. The console
uses the sign-in session and can use a newly created or rotated service key
for test requests. It has no build-time API key setting.

## Deploy with Docker Compose

Push to `main` to build and publish `ghcr.io/holt230/ai-llm-gateway` for
`linux/amd64` and `linux/arm64`. GitHub Actions uses the repository's
`GITHUB_TOKEN` and publishes both `latest` and `sha-<full-commit-sha>`.

After the first successful publish, open the
[container package settings](https://github.com/users/holt230/packages/container/ai-llm-gateway/settings)
and set its visibility to **Public** for anonymous pulls. GitHub creates the
package as private on the first publish. Package visibility is independent of
repository visibility.

Copy `compose.yaml` and `.env.production.example` to the deployment host.
Create `.env.production` from the example and fill in the database password,
administrator password and three stable encryption secrets. Generate separate
values with `openssl rand -hex 32`. Restrict access to the file and keep a
secure backup of it alongside the PostgreSQL backups.

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Set the required values in .env.production before running Compose.
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production pull
docker compose --env-file .env.production up -d --wait
curl --fail --silent http://127.0.0.1:5100/health
```

The gateway serves the frontend and API at `127.0.0.1:5100`. Point the host's
HTTPS reverse proxy for `1024012.xyz` to that address. Preserve the request
host, set `X-Forwarded-Proto: https`, and disable proxy buffering for streaming
model responses. For a different domain, set both `AI_GW_PUBLIC_BASE_URL` and
`AI_GW_CORS_ORIGINS` in `.env.production`. PostgreSQL is reachable on the
Compose network and stores data in the `postgres-data` named volume. The
database password initializes the volume on first boot. Rotating it later
requires changing the database role password as well.

To deploy a newer image, run `pull gateway` and `up -d --wait gateway` using the
same Compose command and env file. Set `WORMHOLE_IMAGE_TAG=sha-<full-commit-sha>`
to deploy or roll back to a specific published build. Log in as the configured
administrator to add channels, publish priced models and upload the WeChat
merchant QR code.

`AI_GW_PUBLIC_BASE_URL` controls the public gateway domain shown in the UI
and returned by `/app-config`. If `AI_GW_CORS_ORIGINS` is not set, this public
base URL is also added to CORS automatically.

Production persistence uses PostgreSQL. Set `AI_GW_DATABASE_URL` or
`DATABASE_URL` and the server will create the required tables automatically:

```bash
AI_GW_PERSISTENCE=postgres
AI_GW_DATABASE_URL='postgresql://postgres:password@postgres:5432/jetlinkapi'
```

PostgreSQL stores:

- Runtime config in `jetlink_gateway_config`
- Proxy request logs in `jetlink_gateway_request_logs`
- Admin audit logs in `jetlink_gateway_audit_logs`

When no database URL is configured, the server falls back to local file mode
for development. In file mode it uses `backend/gateway.config.json` when it
exists; otherwise it starts from `backend/gateway.config.example.json` and the
first successful admin write creates `backend/gateway.config.json`.

To make the current example config persistent immediately in file mode:

```bash
cp backend/gateway.config.example.json backend/gateway.config.json
```

Recent proxy requests are also appended to:

```text
backend/data/requests.jsonl
```

Admin configuration changes are appended to:

```text
backend/data/audit.jsonl
```

Production notes:

- Store upstream provider secrets in environment variables such as `OPENAI_API_KEY`.
- Set `AI_GW_PERSISTENCE=postgres` and `AI_GW_DATABASE_URL` for production deployments.
- Provider channels and model aliases are empty by default. `/ready` requires a usable route on the default alias when one is set, or on any enabled alias otherwise, including non-chat models.
- Newly created or persisted internal API keys are stored as hashes plus previews, not as reusable plaintext secrets.
- Set `AI_GW_API_KEY_PEPPER` to a stable private value before first production use.
- Set `AI_GW_PROVIDER_SECRET_KEY` to a stable private value before storing upstream provider keys.
- Set `AI_GW_BOOTSTRAP_ADMIN_KEY` to inject a first admin key at startup.
- Set `AI_GW_SUPER_ADMIN_PASSWORD` before exposing the console outside a developer machine.
- Set `AI_GW_PUBLIC_BASE_URL` to the external HTTPS gateway domain shown to internal callers.
- No development administrator key is created. The legacy built-in key is ignored if it is present in an existing config.
- Set `AI_GW_CORS_ORIGINS` or `security.corsOrigins` to explicit origins instead of `*` for production.
- Only mount `backend/gateway.config.json` and `backend/data/` on durable storage when using file mode.

Run security smoke tests before handoff:

```bash
npm run test:security
```

The security smoke test checks admin session cookies, unauthorized and
cross-role access, CORS allow-list behavior, security headers, body-size
limits, safe API key responses, console proxy testing through the backend
session, and that built frontend assets do not expose the development admin key
or local default password.
Run just the server checks without a frontend build with
`node backend/test-security.mjs --backend-only`.

## Customer support and account recovery

The support bubble works before and after sign-in. A signed-in customer sees
only the conversation owned by their account, including on another device.
Guest conversations stay separate and are readable only while signed out in the
browser that opened them. Existing browser-only conversations remain guest
conversations. Guest access lasts 30 days and can be ended early. The latest
100 messages in a conversation are displayed.

In the admin inbox, open **Open and reply** to send a reply. A reply marks the
conversation as replied and shows an unread indicator in the customer's bubble.
Operators can mark a conversation resolved; a new customer message reopens it.
The inbox lists the most recent 100 conversations.

When a user loses both their password and recovery code, verify ownership using
an independently trusted channel before authorizing a reset. A username or the
contents of a support message alone do not establish ownership. In **Customer
support**, open the conversation, choose **Help reset password**, and enter the
verified username. The grant is valid for up to 15 minutes and can be used once
by the owning account or, for a guest conversation, in the original browser. It does not reveal a password or recovery code to the administrator.
Successful reset revokes previous sessions, user API keys, and the old recovery
code. Balance and request history stay tied to the original account. The user
must save the newly displayed recovery code.

## Internal API Keys

New installations start with no API keys. Set `AI_GW_SUPER_ADMIN_PASSWORD`
and sign in at `/login` to manage the gateway. To call the admin API directly,
set `AI_GW_BOOTSTRAP_ADMIN_KEY` to a private value and supply it as the bearer
token in the admin examples below.

Business service keys are empty by default. Create a service key from the
console or `/admin/api-keys`, then use the returned one-time `secret` to call
the gateway:

```bash
curl http://127.0.0.1:8787/v1/models \
  -H 'Authorization: Bearer <service-key-secret>'
```

Created keys return `secret` once. Later list/get responses only return a
masked `keyPreview`; `gateway.config.json` stores `keyHash`.

## Model Alias Mapping

Internal business systems use an internal alias:

```json
{
  "model": "jetlink-chat",
  "messages": [{ "role": "user", "content": "hello" }]
}
```

The backend maps it to the configured upstream model:

```json
{
  "jetlink-chat": {
    "provider": "openai",
    "upstreamModel": "gpt-4.1-mini",
    "enabled": true,
    "endpoints": ["chat", "responses"],
    "fallbacks": [
      {
        "provider": "deepseek",
        "upstreamModel": "deepseek-chat",
        "label": "backup route"
      }
    ]
  }
}
```

When the primary route returns a configured failover status, or a network/timeout
error occurs, the gateway tries the next fallback route before returning an
error to the caller.

## Proxy Request

```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer <service-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "jetlink-chat",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

Use streaming the same way:

```bash
curl -N http://127.0.0.1:8787/v1/chat/completions \
  -H 'Authorization: Bearer <service-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "jetlink-chat",
    "stream": true,
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

The gateway records usage from streaming events when the provider reports it.
For Chat Completions providers that support it, send
`"stream_options": {"include_usage": true}`. A disconnected client cancels
the upstream request. Failover is available before the gateway starts its response.

## Configure Third-Party Providers

Put provider keys in environment variables, not in the repo:

```bash
export OPENAI_API_KEY='sk-...'
export DASHSCOPE_API_KEY='sk-...'
export DEEPSEEK_API_KEY='sk-...'
```

Provider channels are empty by default. Create them from the admin console or
`/admin/providers`, then create model aliases from the console or
`/admin/models`.

OpenAI-compatible provider format:

```json
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "type": "openai-compatible",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyEnv": "OPENAI_API_KEY",
      "timeoutMs": 120000
    }
  }
}
```

## Admin Mapping API

Admin endpoints require an admin internal key.

List mappings:

```bash
curl http://127.0.0.1:8787/admin/models \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Create or update an alias:

```bash
curl -X PUT http://127.0.0.1:8787/admin/models/company-chat \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "dashscope",
    "upstreamModel": "qwen-plus",
    "enabled": true,
    "endpoints": ["chat", "responses"],
    "description": "Company default chat model",
    "fallbacks": [
      {
        "provider": "deepseek",
        "upstreamModel": "deepseek-chat",
        "label": "deepseek fallback"
      }
    ]
  }'
```

Delete an alias:

```bash
curl -X DELETE http://127.0.0.1:8787/admin/models/company-chat \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Recent requests:

```bash
curl http://127.0.0.1:8787/admin/requests \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Usage summary for up to the latest 500 requests:

```bash
curl http://127.0.0.1:8787/admin/usage \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Configure optional official pricing for internal cost attribution. The gateway
supports token, image, and successful-request billing units. Token models use
prices per one million tokens. Image models are charged by successfully
generated image count; failed upstream calls do not create billable image units.
When a model has no pricing entry, the gateway still records usage but leaves
cost empty.

```bash
curl -X PUT http://127.0.0.1:8787/admin/pricing \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "currency": "USD",
    "models": {
      "jetlink-chat": {
        "billingUnit": "token",
        "inputPerMillionTokens": 1,
        "outputPerMillionTokens": 2
      },
      "jetlinks-image": {
        "billingUnit": "image",
        "currency": "CNY",
        "imageUnitPrice": 0.5,
        "officialProvider": "aliyun",
        "officialModel": "qwen-image-2.0-pro",
        "source": "https://help.aliyun.com/zh/model-studio/model-pricing",
        "note": "Aliyun Model Studio Beijing: charge by successfully generated images."
      }
    }
  }'
```

Configure process-local concurrency limits. `0` means unlimited for that scope.
These limits are single-node backpressure; for multi-node deployments, put the
same policy in Redis/API gateway/mesh as the shared source of truth.

```bash
curl -X PUT http://127.0.0.1:8787/admin/limits \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "maxInFlightRequests": 200,
    "maxInFlightPerApiKey": 50,
    "maxInFlightPerProvider": 100,
    "maxInFlightPerModel": 100,
    "maxQueuedRequests": 1000,
    "queueTimeoutMs": 5000,
    "gracefulShutdownTimeoutMs": 30000
  }'
```

Inspect current in-flight requests, queue length, and concurrency rejections:

```bash
curl http://127.0.0.1:8787/admin/concurrency \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Audit log:

```bash
curl http://127.0.0.1:8787/admin/audit \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Persist the active runtime config immediately:

```bash
curl -X POST http://127.0.0.1:8787/admin/config/persist \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Validate the active config and inspect runtime diagnostics:

```bash
curl http://127.0.0.1:8787/admin/config/validate \
  -H 'Authorization: Bearer <admin-key-secret>'

curl http://127.0.0.1:8787/admin/diagnostics \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Update default routing and failover policy:

```bash
curl -X PUT http://127.0.0.1:8787/admin/routing \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "defaultModel": "jetlink-chat",
    "failoverStatusCodes": [429, 500, 502, 503, 504],
    "failoverOnNetworkError": true
  }'
```

## Admin Provider API

List providers:

```bash
curl http://127.0.0.1:8787/admin/providers \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Create or update an OpenAI-compatible provider. Store the real upstream secret
in the named environment variable; do not submit raw provider keys to the API.

```bash
curl -X PUT http://127.0.0.1:8787/admin/providers/company-openai \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Company OpenAI",
    "type": "openai-compatible",
    "baseUrl": "https://api.openai.com/v1",
    "apiKeyEnv": "OPENAI_API_KEY",
    "enabled": true
  }'
```

Delete an unused provider:

```bash
curl -X DELETE http://127.0.0.1:8787/admin/providers/company-openai \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Check provider readiness without calling the upstream:

```bash
curl http://127.0.0.1:8787/admin/providers/openai/health \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Check the upstream `/models` endpoint when the provider secret is configured:

```bash
curl 'http://127.0.0.1:8787/admin/providers/openai/health?live=true' \
  -H 'Authorization: Bearer <admin-key-secret>'
```

## Admin Internal API Key API

List internal keys. Secrets are masked in list responses.

```bash
curl http://127.0.0.1:8787/admin/api-keys \
  -H 'Authorization: Bearer <admin-key-secret>'
```

Create a service key for an internal business system. The `secret` field is
returned once and then masked in later reads.

```bash
curl -X POST http://127.0.0.1:8787/admin/api-keys \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Order service",
    "role": "service",
    "perMinute": 120,
    "allowedModels": ["jetlink-chat", "jetlink-embedding"],
    "allowedEndpoints": ["chat", "responses", "embeddings"]
  }'
```

Rotate, pause, or change a key:

```bash
curl -X PUT http://127.0.0.1:8787/admin/api-keys/<service-key-id> \
  -H 'Authorization: Bearer <admin-key-secret>' \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Order service",
    "role": "service",
    "enabled": true,
    "perMinute": 180,
    "allowedModels": ["*"],
    "allowedEndpoints": ["chat", "responses"],
    "rotate": true
  }'
```

## Operations

Liveness:

```bash
curl http://127.0.0.1:8787/health
```

Readiness:

```bash
curl http://127.0.0.1:8787/ready
```

Prometheus-style metrics:

```bash
curl http://127.0.0.1:8787/metrics
```

Backend integration tests:

```bash
npm run test:backend
```

## What Is Implemented

- Internal API key authentication
- Internal API keys persisted as hashes plus masked previews
- PostgreSQL persistence for config, request logs, and admin audit logs
- Per-key simple requests-per-minute limit
- Process-local concurrency limits by gateway, API key, provider, and model
- Queue timeout / backpressure with `429` rejection when saturated
- OpenAI-compatible `/v1/models`
- JSON proxy for `/v1/*` model endpoints
- Model alias to upstream model rewrite
- Model alias primary route plus fallback routes
- Configurable failover status codes and network-error failover
- OpenAI-compatible provider adapter
- Mock provider for local tests
- Streaming response passthrough
- Upstream timeout and `x-request-id` propagation
- Per-key allowed model aliases and endpoint scopes
- `/health`, `/ready`, and Prometheus-style `/metrics`
- In-memory recent request logs plus PostgreSQL/JSONL request log persistence
- Admin audit log plus PostgreSQL/JSONL audit persistence
- Usage summary API by provider, model, upstream model, endpoint, key, status, tokens, billable images, estimated cost, and failover count
- Optional per-model official pricing API for token, image, and request billing attribution
- Config validation and runtime diagnostics APIs
- Graceful shutdown on `SIGTERM` / `SIGINT`
- Admin API for model mappings
- Admin API for Provider channels
- Admin API for default routing and failover policy
- Admin API for runtime concurrency limits
- Admin API for internal API keys
- First admin write creates a persistent config file

## Not Implemented Yet

- Database-backed users, tenants, billing, and multi-node audit/query retention
- Secret encryption / KMS integration
- Native non-OpenAI provider adapters
- Multipart audio/file upload proxying
- Production distributed rate limits
- Full RBAC and approval workflows

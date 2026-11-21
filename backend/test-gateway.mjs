import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const tempDir = await mkdtemp(join(tmpdir(), 'jetlinkapi-gateway-test-'));
const port = 18_791 + Math.floor(Math.random() * 1000);
const baseUrl = `http://127.0.0.1:${port}`;
const configPath = join(tempDir, 'gateway.config.json');
const requestLogPath = join(tempDir, 'requests.jsonl');
const auditLogPath = join(tempDir, 'audit.jsonl');
const adminKey = 'gateway-test-admin-key';
const upstreamRequests = [];
let upstreamDisconnections = 0;
const upstreamServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);
  upstreamRequests.push({
    method: req.method,
    url: req.url,
    headers: req.headers,
    body
  });

  if (req.url === '/v1/models') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [
      { id: 'gpt-6.2-sol' }, { id: 'gpt-6.2-astra' }, { id: 'vendor/other' }, { id: 'gpt-6.2-sol' }
    ] }));
    return;
  }

  if (req.url === '/v1/responses') {
    const { input } = JSON.parse(body.toString('utf8'));
    if (input === 'redirect') {
      res.writeHead(307, { location: '/unexpected-redirect' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'public, max-age=3600' });
    if (input === 'disconnect' || input === 'interrupt') {
      res.once('close', () => { upstreamDisconnections += 1; });
      res.write('data: {"type":"response.created"}\n\n');
      if (input === 'interrupt') {
        await delay(20);
        res.destroy();
      }
      return;
    }
    const event = Buffer.from('event: response.output_text.delta\r\ndata: {"delta":"你好"}\r\n\r\n');
    const split = event.indexOf(Buffer.from('你')) + 1;
    res.write(event.subarray(0, split));
    await delay(15);
    res.write(event.subarray(split, -2));
    await delay(15);
    res.write(event.subarray(-2));
    await delay(15);
    res.end('event: response.completed\ndata: {"response":{\ndata: "model":"upstream-stream-model","usage":{"input_tokens":10,"output_tokens":5}}}\n\n');
    return;
  }

  if (req.url?.includes('/audio/speech')) {
    res.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-disposition': 'attachment; filename="speech.mp3"',
      'x-upstream-provider': 'should-not-leak'
    });
    res.end(Buffer.from([0x49, 0x44, 0x33, 0x04]));
    return;
  }

  if (req.url?.includes('/images/edits')) {
    res.writeHead(200, {
      'content-type': 'application/json',
      'x-upstream-provider': 'should-not-leak'
    });
    res.end(JSON.stringify({
      model: 'qwen-image-edit-pro',
      upstream_model: 'qwen-image-edit-pro',
      provider: 'local-upstream',
      data: [{ url: 'https://example.com/edited.png' }]
    }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'unexpected upstream route' }));
});
await new Promise((resolvePromise, rejectPromise) => {
  upstreamServer.once('error', rejectPromise);
  upstreamServer.listen(0, '127.0.0.1', resolvePromise);
});
const upstreamPort = upstreamServer.address().port;
const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}/v1`;

const config = {
  server: { host: '127.0.0.1', port },
  publicBaseUrl: 'https://ai-gw.jetlinks.cn',
  auth: {
    internalApiKeys: [
      { id: 'admin-dev', key: 'dev-internal-key', role: 'admin' },
      {
        id: 'admin-test',
        name: 'Gateway Test Admin',
        key: adminKey,
        role: 'admin',
        enabled: true,
        perMinute: 1000,
        allowedModels: ['*'],
        allowedEndpoints: ['*']
      },
      {
        id: 'service-demo',
        name: 'Internal Business Service Demo',
        key: 'dev-service-key',
        role: 'service',
        enabled: true,
        perMinute: 1000,
        allowedModels: ['*'],
        allowedEndpoints: ['chat', 'responses', 'embeddings']
      }
    ]
  },
  providers: {
    mock: { name: 'Local Mock Provider', type: 'mock' },
    openai: {
      name: 'OpenAI Missing Secret',
      type: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'JETLINKAPI_TEST_OPENAI_KEY',
      timeoutMs: 1000
    },
    localMultimodal: {
      name: 'Local Multimodal Upstream',
      type: 'openai-compatible',
      baseUrl: upstreamBaseUrl,
      apiKey: 'sk-local-upstream',
      timeoutMs: 1000
    }
  },
  models: {
    'jetlink-chat': {
      description: 'Default internal chat model alias',
      provider: 'mock',
      upstreamModel: 'gpt-4.1-mini',
      enabled: true,
      endpoints: ['chat', 'responses']
    },
    'jetlink-embedding': {
      description: 'Default internal embedding model alias',
      provider: 'mock',
      upstreamModel: 'text-embedding-3-small',
      enabled: true,
      endpoints: ['embeddings']
    },
    'jetlink-image': {
      description: 'Default internal image model alias',
      provider: 'mock',
      upstreamModel: 'qwen-image-2.0-pro',
      enabled: true,
      endpoints: ['images']
    },
    'jetlink-image-edit': {
      description: 'Multipart image edit alias',
      provider: 'localMultimodal',
      upstreamModel: 'qwen-image-edit-pro',
      enabled: true,
      endpoints: ['images']
    },
    'jetlink-audio': {
      description: 'Audio speech alias',
      provider: 'localMultimodal',
      upstreamModel: 'tts-1-hd',
      enabled: true,
      endpoints: ['audio']
    },
    'jetlink-stream': {
      provider: 'localMultimodal',
      upstreamModel: 'upstream-stream-model',
      endpoints: ['responses'],
      fallbacks: [{ provider: 'mock', upstreamModel: 'mock-backup' }]
    }
  },
  routing: {
    defaultModel: 'jetlink-chat',
    failoverStatusCodes: [429, 500, 502, 503, 504],
    failoverOnNetworkError: true
  },
  pricing: {
    currency: 'USD',
    models: {
      'jetlink-stream': { inputPerMillionTokens: 10, outputPerMillionTokens: 20 },
      'jetlink-chat': {
        inputPerMillionTokens: 1,
        outputPerMillionTokens: 2
      },
      'tmp-failover-check': {
        inputPerMillionTokens: 1,
        outputPerMillionTokens: 1
      },
      'jetlink-image': {
        billingUnit: 'image',
        currency: 'CNY',
        imageUnitPrice: 0.5,
        officialProvider: 'aliyun',
        officialModel: 'qwen-image-2.0-pro',
        source: 'https://help.aliyun.com/zh/model-studio/model-pricing'
      }
    }
  },
  limits: {
    maxInFlightRequests: 100,
    maxInFlightPerApiKey: 1,
    maxInFlightPerProvider: 100,
    maxInFlightPerModel: 100,
    maxQueuedRequests: 0,
    queueTimeoutMs: 100,
    gracefulShutdownTimeoutMs: 5000
  },
  security: { maxBodyBytes: 26214400, corsOrigins: ['*'] }
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const child = spawn(process.execPath, ['backend/server.mjs'], {
  cwd: rootDir,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    AI_GW_PERSISTENCE: 'file',
    AI_GW_GATEWAY_CONFIG: configPath,
    AI_GW_GATEWAY_REQUEST_LOG: requestLogPath,
    AI_GW_GATEWAY_AUDIT_LOG: auditLogPath,
    AI_GW_API_KEY_PEPPER: 'test-pepper',
    AI_GW_SUPER_ADMIN_PASSWORD: 'Gateway-Test-Password-2026'
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

  const ready = await json('/ready');
  assert.equal(ready.ok, true);
  assert.deepEqual(Object.keys(ready), ['ok']);
  const legacyAdminKey = await raw('/admin/models', { apiKey: 'dev-internal-key' });
  assert.equal(legacyAdminKey.status, 401);

  const models = await json('/v1/models', { apiKey: 'dev-service-key' });
  assert.deepEqual(models.data.map((item) => item.id).sort(), ['jetlink-chat', 'jetlink-embedding', 'jetlink-stream']);
  const serializedModels = JSON.stringify(models);
  assert.equal(serializedModels.includes('provider'), false);
  assert.equal(serializedModels.includes('upstream_model'), false);
  assert.equal(serializedModels.includes('routes'), false);
  assert.equal(serializedModels.includes('gpt-4.1-mini'), false);
  assert.equal(serializedModels.includes('text-embedding-3-small'), false);

  const chat = await json('/v1/chat/completions', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'jetlink-chat', messages: [{ role: 'user', content: 'hello' }] }
  });
  assert.equal(chat.model, 'jetlink-chat');
  assert.equal(chat.upstream_model, undefined);
  assert.equal(JSON.stringify(chat).includes('gpt-4.1-mini'), false);

  const usageAfterChat = await json('/admin/usage', { apiKey: adminKey });
  assert.ok(usageAfterChat.data.tokens.total >= 24);
  assert.ok(usageAfterChat.data.estimatedCost.USD > 0);

  await json('/v1/images/generations', {
    apiKey: adminKey,
    method: 'POST',
    body: { model: 'jetlink-image', prompt: 'billing test', n: 3 }
  });
  const usageAfterImage = await json('/admin/usage', { apiKey: adminKey });
  assert.equal(usageAfterImage.data.billable.images, 3);
  assert.equal(usageAfterImage.data.estimatedCost.CNY, 1.5);

  const imageEditForm = new FormData();
  imageEditForm.append('model', 'jetlink-image-edit');
  imageEditForm.append('prompt', 'make the logo sharper');
  imageEditForm.append('n', '1');
  imageEditForm.append('image', new Blob([Buffer.from('fake image')], { type: 'image/png' }), 'input.png');
  const imageEdit = await raw('/v1/images/edits', {
    apiKey: adminKey,
    method: 'POST',
    formData: imageEditForm
  });
  assert.equal(imageEdit.status, 200);
  assert.equal(imageEdit.headers.get('x-jetlink-model-alias'), 'jetlink-image-edit');
  assert.equal(imageEdit.headers.get('x-upstream-provider'), null);
  const imageEditBody = await imageEdit.json();
  assert.equal(imageEditBody.model, 'jetlink-image-edit');
  assert.equal(imageEditBody.provider, undefined);
  assert.equal(imageEditBody.upstream_model, undefined);
  assert.equal(JSON.stringify(imageEditBody).includes('qwen-image-edit-pro'), false);

  const imageEditUpstream = upstreamRequests.find((item) => item.url?.includes('/images/edits'));
  assert.ok(imageEditUpstream);
  assert.equal(imageEditUpstream.headers.authorization, 'Bearer sk-local-upstream');
  assert.match(imageEditUpstream.headers['content-type'], /^multipart\/form-data; boundary=/);
  const upstreamImageEditForm = await capturedMultipartFormData(imageEditUpstream);
  assert.equal(upstreamImageEditForm.get('model'), 'qwen-image-edit-pro');
  assert.equal(upstreamImageEditForm.get('prompt'), 'make the logo sharper');
  const upstreamImage = upstreamImageEditForm.get('image');
  assert.equal(upstreamImage.name, 'input.png');
  assert.equal(upstreamImage.type, 'image/png');
  assert.equal(upstreamImage.size, 10);

  const audioSpeech = await raw('/v1/audio/speech', {
    apiKey: adminKey,
    method: 'POST',
    body: { model: 'jetlink-audio', input: 'hello', voice: 'alloy' }
  });
  assert.equal(audioSpeech.status, 200);
  assert.equal(audioSpeech.headers.get('content-type'), 'audio/mpeg');
  assert.equal(audioSpeech.headers.get('content-disposition'), 'attachment; filename="speech.mp3"');
  assert.equal(audioSpeech.headers.get('x-upstream-provider'), null);
  assert.deepEqual([...new Uint8Array(await audioSpeech.arrayBuffer())], [0x49, 0x44, 0x33, 0x04]);
  const audioUpstream = upstreamRequests.find((item) => item.url?.includes('/audio/speech'));
  assert.ok(audioUpstream);
  assert.equal(audioUpstream.headers.authorization, 'Bearer sk-local-upstream');
  assert.equal(JSON.parse(audioUpstream.body.toString('utf8')).model, 'tts-1-hd');

  const pricing = await json('/admin/pricing', { apiKey: adminKey });
  assert.equal(pricing.data.models['jetlink-chat'].outputPerMillionTokens, 2);
  assert.equal(pricing.data.models['jetlink-image'].billingUnit, 'image');

  await json('/admin/models/tmp-rename-source', {
    apiKey: adminKey,
    method: 'PUT',
    body: {
      provider: 'mock',
      upstreamModel: 'tmp-source-model',
      enabled: true,
      endpoints: ['chat']
    }
  });
  await json('/admin/routing', {
    apiKey: adminKey,
    method: 'PUT',
    body: { defaultModel: 'tmp-rename-source' }
  });
  const renameScoped = await json('/admin/api-keys', {
    apiKey: adminKey,
    method: 'POST',
    body: {
      id: 'rename-scoped',
      name: 'Rename Scoped',
      role: 'service',
      perMinute: 30,
      allowedModels: ['tmp-rename-source'],
      allowedEndpoints: ['chat']
    }
  });
  const renameScopedSecret = await json('/admin/api-keys/rename-scoped/secret', { apiKey: adminKey });
  assert.equal(renameScopedSecret.secret, renameScoped.secret);
  await json('/admin/pricing', {
    apiKey: adminKey,
    method: 'PUT',
    body: {
      ...pricing.data,
      models: {
        ...pricing.data.models,
        'tmp-rename-source': {
          inputPerMillionTokens: 3,
          outputPerMillionTokens: 4
        }
      }
    }
  });
  const renamedModel = await json('/admin/models/tmp-rename-target', {
    apiKey: adminKey,
    method: 'PUT',
    body: {
      previousAlias: 'tmp-rename-source',
      provider: 'mock',
      upstreamModel: 'tmp-target-model',
      enabled: true,
      endpoints: ['chat']
    }
  });
  assert.equal(renamedModel.previousAlias, 'tmp-rename-source');
  assert.equal(renamedModel.movedReferences.defaultModelMoved, true);
  assert.equal(renamedModel.movedReferences.apiKeysUpdated, 1);
  assert.equal(renamedModel.movedReferences.pricingMoved, true);

  const routingAfterRename = await json('/admin/routing', { apiKey: adminKey });
  assert.equal(routingAfterRename.data.defaultModel, 'tmp-rename-target');
  const pricingAfterRename = await json('/admin/pricing', { apiKey: adminKey });
  assert.equal(pricingAfterRename.data.models['tmp-rename-source'], undefined);
  assert.equal(pricingAfterRename.data.models['tmp-rename-target'].outputPerMillionTokens, 4);
  const scopedModelsAfterRename = await json('/v1/models', { apiKey: renameScoped.secret });
  assert.deepEqual(scopedModelsAfterRename.data.map((item) => item.id), ['tmp-rename-target']);
  const deleteReferencedModel = await raw('/admin/models/tmp-rename-target', {
    apiKey: adminKey,
    method: 'DELETE'
  });
  assert.equal(deleteReferencedModel.status, 409);

  const limits = await json('/admin/limits', { apiKey: adminKey });
  assert.equal(limits.data.maxInFlightPerApiKey, 1);

  const directSecretProvider = await json('/admin/providers/direct-secret-check', {
    apiKey: adminKey,
    method: 'PUT',
    body: {
      name: 'Direct Secret Provider',
      type: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      apiKey: 'sk-test-direct-secret',
      enabled: true
    }
  });
  assert.equal(directSecretProvider.provider.apiKeyConfigured, true);
  assert.equal(directSecretProvider.provider.apiKeyEnv, undefined);
  assert.equal(directSecretProvider.provider.apiKey, undefined);
  assert.equal(directSecretProvider.provider.apiKeyPreview, 'sk-tes...cret');

  const directSecretHealth = await json('/admin/providers/direct-secret-check/health', { apiKey: adminKey });
  assert.equal(directSecretHealth.configured, true);
  assert.equal(directSecretHealth.ok, true);

  await json('/admin/providers/direct-secret-check', {
    apiKey: adminKey,
    method: 'DELETE'
  });

  const restricted = await json('/admin/api-keys', {
    apiKey: adminKey,
    method: 'POST',
    body: {
      id: 'restricted-embedding',
      name: 'Restricted Embedding',
      role: 'service',
      perMinute: 30,
      allowedModels: ['jetlink-embedding'],
      allowedEndpoints: ['embeddings']
    }
  });
  assert.match(restricted.secret, /^jl_/);

  const restrictedModels = await json('/v1/models', { apiKey: restricted.secret });
  assert.deepEqual(restrictedModels.data.map((item) => item.id), ['jetlink-embedding']);

  const forbidden = await raw('/v1/chat/completions', {
    apiKey: restricted.secret,
    method: 'POST',
    body: { model: 'jetlink-chat', messages: [{ role: 'user', content: 'hello' }] }
  });
  assert.equal(forbidden.status, 403);

  await json('/admin/models/tmp-failover-check', {
    apiKey: adminKey,
    method: 'PUT',
    body: {
      routes: [
        { provider: 'openai', upstreamModel: 'gpt-4.1-mini', label: 'missing-key-primary' },
        { provider: 'mock', upstreamModel: 'fallback-mock', label: 'mock-fallback' }
      ],
      enabled: true,
      endpoints: ['chat']
    }
  });

  const failover = await raw('/v1/chat/completions', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'tmp-failover-check', messages: [{ role: 'user', content: 'hello' }] }
  });
  assert.equal(failover.status, 200);
  assert.equal(failover.headers.get('x-jetlink-model-alias'), 'tmp-failover-check');
  assert.equal(failover.headers.get('x-jetlink-provider'), null);
  assert.equal(failover.headers.get('x-jetlink-upstream-model'), null);
  assert.equal(failover.headers.get('x-jetlink-route-attempts'), null);
  const failoverBody = await failover.json();
  assert.equal(failoverBody.model, 'tmp-failover-check');
  assert.equal(JSON.stringify(failoverBody).includes('fallback-mock'), false);

  const validation = await json('/admin/config/validate', { apiKey: adminKey });
  assert.equal(validation.ok, true);
  assert.ok(validation.warnings.some((item) => item.code === 'provider_secret_missing'));

  const diagnostics = await json('/admin/diagnostics', { apiKey: adminKey });
  assert.equal(diagnostics.validation.ok, true);
  assert.ok(diagnostics.usage.total >= 3);

  const usage = await json('/admin/usage', { apiKey: adminKey });
  assert.ok(usage.data.byApiKey['service-demo'] >= 1);
  assert.ok(usage.data.byEndpoint['/v1/chat/completions'] >= 1);
  assert.ok(usage.data.failoverRequests >= 1);
  assert.ok(usage.data.tokens.input >= 24);
  assert.ok(usage.data.estimatedCost.USD > 0);

  const stream = await raw('/v1/chat/completions', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'jetlink-chat', stream: true, messages: [{ role: 'user', content: 'hold slot' }] }
  });
  assert.equal(stream.status, 200);
  const overLimit = await raw('/v1/chat/completions', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'jetlink-chat', messages: [{ role: 'user', content: 'concurrent' }] }
  });
  assert.equal(overLimit.status, 429);
  await stream.text();

  const concurrency = await json('/admin/concurrency', { apiKey: adminKey });
  assert.ok(concurrency.data.rejected >= 1);

  // The admin session is accepted at the gateway and stripped before forwarding.
  const login = await raw('/admin/session', {
    method: 'POST',
    body: { username: 'admin', password: 'Gateway-Test-Password-2026' }
  });
  assert.equal(login.status, 200);
  const sessionCookie = login.headers.get('set-cookie').split(';')[0];
  const streamed = await raw('/v1/responses', {
    method: 'POST',
    headers: { cookie: sessionCookie, accept: 'text/event-stream', 'x-openai-client-secret': 'client-only' },
    body: { model: 'jetlink-stream', input: 'Hello', stream: true }
  });
  assert.equal(streamed.status, 200);
  assert.equal(streamed.headers.get('cache-control'), 'no-store');
  assert.equal(streamed.headers.get('x-accel-buffering'), 'no');
  const streamedText = await streamed.text();
  assert.match(streamedText, /data: {"delta":"你好"}\n\nevent: response.completed/);
  assert.match(streamedText, /"model":"jetlink-stream"/);
  assert.equal(streamedText.includes('upstream-stream-model'), false);
  const streamedUpstream = upstreamRequests.find((item) => item.url === '/v1/responses');
  assert.equal(streamedUpstream.headers.cookie, undefined);
  assert.equal(streamedUpstream.headers['x-openai-client-secret'], undefined);
  assert.equal(streamedUpstream.headers.authorization, 'Bearer sk-local-upstream');
  assert.equal(streamedUpstream.headers.accept, 'text/event-stream');

  const streamLog = await waitForRequestLog(streamed.headers.get('x-request-id'));
  assert.deepEqual(streamLog.usage, { inputTokens: 10, outputTokens: 5, totalTokens: 15 });
  assert.equal(streamLog.estimatedCost.totalCost, 0.0002);
  const newPricing = (await json('/admin/pricing', { apiKey: adminKey })).data;
  newPricing.models['jetlink-stream'].inputPerMillionTokens = 100;
  await json('/admin/pricing', { apiKey: adminKey, method: 'PUT', body: newPricing });
  const historicalLog = await waitForRequestLog(streamed.headers.get('x-request-id'));
  assert.equal(historicalLog.estimatedCost.totalCost, 0.0002);

  const redirected = await raw('/v1/responses', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'jetlink-stream', input: 'redirect' }
  });
  assert.equal(redirected.status, 200);
  await redirected.json();
  const redirectLog = await waitForRequestLog(redirected.headers.get('x-request-id'));
  assert.deepEqual(redirectLog.attempts.map((attempt) => attempt.status), [502, 200]);
  assert.equal(upstreamRequests.some((request) => request.url === '/unexpected-redirect'), false);

  const interrupted = await raw('/v1/responses', {
    apiKey: 'dev-service-key',
    method: 'POST',
    body: { model: 'jetlink-stream', input: 'interrupt', stream: true }
  });
  await assert.rejects(interrupted.text());
  const interruptedLog = await waitForRequestLog(interrupted.headers.get('x-request-id'));
  assert.equal(interruptedLog.status, 502);
  assert.equal(interruptedLog.attempts.length, 1);

  await json('/admin/limits', {
    apiKey: adminKey,
    method: 'PUT',
    body: { maxQueuedRequests: 10, queueTimeoutMs: 5000 }
  });
  const abort = new AbortController();
  const pending = await raw('/v1/responses', {
    apiKey: 'dev-service-key',
    method: 'POST',
    signal: abort.signal,
    body: { model: 'jetlink-stream', input: 'disconnect', stream: true }
  });
  const queuedAbort = new AbortController();
  const queued = assert.rejects(raw('/v1/responses', {
    apiKey: 'dev-service-key',
    method: 'POST',
    signal: queuedAbort.signal,
    headers: { 'x-request-id': 'queued-disconnect' },
    body: { model: 'jetlink-stream', input: 'queued', stream: true }
  }), { name: 'AbortError' });
  await waitFor(async () => {
    const result = await json('/admin/concurrency', { apiKey: adminKey });
    return result.data.queueLength === 1;
  }, 'queued request');
  queuedAbort.abort();
  await queued;
  const queuedLog = await waitForRequestLog('queued-disconnect');
  assert.equal(queuedLog.status, 499);
  assert.equal(queuedLog.attempts.length, 0);
  abort.abort();
  const cancelledLog = await waitForRequestLog(pending.headers.get('x-request-id'));
  assert.equal(cancelledLog.status, 499);
  assert.equal(cancelledLog.attempts.length, 1);
  await waitFor(() => upstreamDisconnections === 2, 'upstream cancellation');

  await json('/admin/routing', {
    apiKey: adminKey,
    method: 'PUT',
    body: { defaultModel: 'jetlink-embedding' }
  });
  assert.deepEqual(await json('/ready'), { ok: true });
  const referencedFallback = await raw('/admin/providers/mock', { apiKey: adminKey, method: 'DELETE' });
  assert.equal(referencedFallback.status, 409);
  assert.match((await referencedFallback.json()).error, /jetlink-stream/);

  const discoveryPath = '/admin/providers/localMultimodal/models';
  const adminOptions = { apiKey: adminKey };
  assert.equal((await raw(discoveryPath, { apiKey: 'dev-service-key' })).status, 403);
  const discovered = (await json(discoveryPath, adminOptions)).data;
  assert.deepEqual(discovered.map(row => row.id), ['gpt-6.2-sol', 'gpt-6.2-astra', 'vendor/other']);
  assert.equal(discovered.find(row => row.id === 'vendor/other').billing, null);
  const modelImport = { ...adminOptions, method: 'POST', body: {
    ids: discovered.map(row => row.id), endpoints: ['responses'], publish: true
  } };
  const imported = (await json(discoveryPath, modelImport)).data;
  assert.deepEqual(imported.map(row => row.status), ['published','published','internal']);
  assert.match(imported[2].alias, /^[a-zA-Z0-9][a-zA-Z0-9._:-]+$/);
  assert.ok((await json(discoveryPath, modelImport)).data.every(row => row.status === 'existing'));
  assert.equal((await raw(discoveryPath, { ...modelImport, body: { ...modelImport.body, ids: ['not-on-upstream'] } })).status, 409);
  assert.equal((await raw('/v1/codex/models')).status, 401);
  const scoped = await json('/admin/api-keys', { ...adminOptions, method:'POST',body:{
    id:'codex-catalog-check', role:'service', allowedModels:['gpt-6.2-sol'], allowedEndpoints:['responses']
  } });
  const catalog = await json('/v1/codex/models?client_version=0.169.0', { apiKey: scoped.secret });
  assert.deepEqual(catalog.models.map(model => model.slug), ['gpt-6.2-sol']);
  assert.equal(catalog.models[0].supported_in_api, true);
  assert.equal(catalog.models[0].visibility, 'list');
  assert.ok((await json('/v1/codex/models', adminOptions)).models.some(model => model.slug === 'gpt-6.2-astra'));
  console.log('Model import, collisions-safe aliases and authenticated Codex catalog passed');
  console.log('backend integration tests passed');
} finally {
  child.kill('SIGTERM');
  await delay(100);
  await new Promise((resolvePromise) => upstreamServer.close(resolvePromise));
  await rm(tempDir, { recursive: true, force: true });
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

async function waitFor(predicate, description) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const result = await predicate();
    if (result) return result;
    await delay(25);
  }
  assert.fail(`Timed out waiting for ${description}`);
}

function waitForRequestLog(requestId) {
  return waitFor(async () => {
    const { data } = await json('/admin/requests', { apiKey: adminKey });
    return data.find((entry) => entry.requestId === requestId);
  }, `request log ${requestId}`);
}

async function raw(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.apiKey) {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  let body;
  if (options.formData !== undefined) {
    body = options.formData;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  return fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers,
    body,
    signal: options.signal
  });
}

async function capturedMultipartFormData(request) {
  return new Request('http://upstream.local', {
    method: request.method || 'POST',
    headers: { 'content-type': request.headers['content-type'] },
    body: request.body
  }).formData();
}

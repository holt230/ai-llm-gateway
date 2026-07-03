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
const upstreamRequests = [];
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
      {
        id: 'admin-dev',
        name: 'Development Admin',
        key: 'dev-internal-key',
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

  const models = await json('/v1/models', { apiKey: 'dev-service-key' });
  assert.deepEqual(models.data.map((item) => item.id).sort(), ['jetlink-chat', 'jetlink-embedding']);
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

  const usageAfterChat = await json('/admin/usage', { apiKey: 'dev-internal-key' });
  assert.ok(usageAfterChat.data.tokens.total >= 24);
  assert.ok(usageAfterChat.data.estimatedCost.USD > 0);

  await json('/v1/images/generations', {
    apiKey: 'dev-internal-key',
    method: 'POST',
    body: { model: 'jetlink-image', prompt: 'billing test', n: 3 }
  });
  const usageAfterImage = await json('/admin/usage', { apiKey: 'dev-internal-key' });
  assert.equal(usageAfterImage.data.billable.images, 3);
  assert.equal(usageAfterImage.data.estimatedCost.CNY, 1.5);

  const imageEditForm = new FormData();
  imageEditForm.append('model', 'jetlink-image-edit');
  imageEditForm.append('prompt', 'make the logo sharper');
  imageEditForm.append('n', '1');
  imageEditForm.append('image', new Blob([Buffer.from('fake image')], { type: 'image/png' }), 'input.png');
  const imageEdit = await raw('/v1/images/edits', {
    apiKey: 'dev-internal-key',
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
    apiKey: 'dev-internal-key',
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

  const pricing = await json('/admin/pricing', { apiKey: 'dev-internal-key' });
  assert.equal(pricing.data.models['jetlink-chat'].outputPerMillionTokens, 2);
  assert.equal(pricing.data.models['jetlink-image'].billingUnit, 'image');

  await json('/admin/models/tmp-rename-source', {
    apiKey: 'dev-internal-key',
    method: 'PUT',
    body: {
      provider: 'mock',
      upstreamModel: 'tmp-source-model',
      enabled: true,
      endpoints: ['chat']
    }
  });
  await json('/admin/routing', {
    apiKey: 'dev-internal-key',
    method: 'PUT',
    body: { defaultModel: 'tmp-rename-source' }
  });
  const renameScoped = await json('/admin/api-keys', {
    apiKey: 'dev-internal-key',
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
  const renameScopedSecret = await json('/admin/api-keys/rename-scoped/secret', { apiKey: 'dev-internal-key' });
  assert.equal(renameScopedSecret.secret, renameScoped.secret);
  await json('/admin/pricing', {
    apiKey: 'dev-internal-key',
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
    apiKey: 'dev-internal-key',
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

  const routingAfterRename = await json('/admin/routing', { apiKey: 'dev-internal-key' });
  assert.equal(routingAfterRename.data.defaultModel, 'tmp-rename-target');
  const pricingAfterRename = await json('/admin/pricing', { apiKey: 'dev-internal-key' });
  assert.equal(pricingAfterRename.data.models['tmp-rename-source'], undefined);
  assert.equal(pricingAfterRename.data.models['tmp-rename-target'].outputPerMillionTokens, 4);
  const scopedModelsAfterRename = await json('/v1/models', { apiKey: renameScoped.secret });
  assert.deepEqual(scopedModelsAfterRename.data.map((item) => item.id), ['tmp-rename-target']);
  const deleteReferencedModel = await raw('/admin/models/tmp-rename-target', {
    apiKey: 'dev-internal-key',
    method: 'DELETE'
  });
  assert.equal(deleteReferencedModel.status, 409);

  const limits = await json('/admin/limits', { apiKey: 'dev-internal-key' });
  assert.equal(limits.data.maxInFlightPerApiKey, 1);

  const directSecretProvider = await json('/admin/providers/direct-secret-check', {
    apiKey: 'dev-internal-key',
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

  const directSecretHealth = await json('/admin/providers/direct-secret-check/health', { apiKey: 'dev-internal-key' });
  assert.equal(directSecretHealth.configured, true);
  assert.equal(directSecretHealth.ok, true);

  await json('/admin/providers/direct-secret-check', {
    apiKey: 'dev-internal-key',
    method: 'DELETE'
  });

  const restricted = await json('/admin/api-keys', {
    apiKey: 'dev-internal-key',
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
    apiKey: 'dev-internal-key',
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

  const validation = await json('/admin/config/validate', { apiKey: 'dev-internal-key' });
  assert.equal(validation.ok, true);
  assert.ok(validation.warnings.some((item) => item.code === 'provider_secret_missing'));

  const diagnostics = await json('/admin/diagnostics', { apiKey: 'dev-internal-key' });
  assert.equal(diagnostics.validation.ok, true);
  assert.ok(diagnostics.usage.total >= 3);

  const usage = await json('/admin/usage', { apiKey: 'dev-internal-key' });
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

  const concurrency = await json('/admin/concurrency', { apiKey: 'dev-internal-key' });
  assert.ok(concurrency.data.rejected >= 1);

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
    body
  });
}

async function capturedMultipartFormData(request) {
  return new Request('http://upstream.local', {
    method: request.method || 'POST',
    headers: { 'content-type': request.headers['content-type'] },
    body: request.body
  }).formData();
}

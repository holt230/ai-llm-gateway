import type { CustomerDashboard } from './customer-session';

type Model = CustomerDashboard['models'][number];
type Format = 'openai_responses' | 'openai_chat' | 'anthropic';
type Client = 'codex' | 'claude';
export type CCSwitchTarget = { client: Client; format: Format; model: string; localRouting: boolean };

export function ccSwitchTargets(models: Model[], group: string): CCSwitchTarget[] {
  const groupModels = models.filter((model) => model.groups.includes(group));
  const target = (client: Client, protocols: [string, Format][]) => {
    for (const [kind, format] of protocols) {
      const model = groupModels.find((item) => item.endpoints.includes(kind) || item.endpoints.includes('*'));
      if (model) return [{ client, format, model: model.id, localRouting: format !== protocols[0][1] }];
    }
    return [];
  };
  return [
    ...target('codex', [
      ['responses', 'openai_responses'],
      ['chat', 'openai_chat'],
      ['messages', 'anthropic']
    ]),
    ...target('claude', [
      ['messages', 'anthropic'],
      ['responses', 'openai_responses'],
      ['chat', 'openai_chat']
    ])
  ];
}

export function ccSwitchLink(apiBase: string, name: string, apiKey: string, target: CCSwitchTarget) {
  const base = new URL(apiBase);
  if (!['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
    throw new Error('Invalid API base URL');
  }
  const root = base.href.replace(/\/+$/, '').replace(/\/v1$/, '');
  const params = new URLSearchParams({
    resource: 'provider',
    app: target.client,
    name: 'Wormhole AI · ' + name,
    homepage: base.origin,
    endpoint: target.format === 'anthropic' ? root : root + '/v1',
    apiKey,
    apiFormat: target.format,
    model: target.model
  });
  if (target.client === 'codex' && target.format === 'openai_responses') {
    const toml = [
      'model_provider = "wormhole"',
      '[model_providers.wormhole]',
      'name = "Wormhole AI"',
      'wire_api = "responses"',
      'model_catalog_url = ' + JSON.stringify(root + '/v1/codex/models')
    ].join('\n');
    const bytes = new TextEncoder().encode(toml);
    params.set('configFormat', 'toml');
    params.set('config', btoa(String.fromCharCode(...bytes)));
  }
  if (target.client === 'claude') {
    for (const field of ['haikuModel', 'sonnetModel', 'opusModel']) params.set(field, target.model);
  }
  return 'ccswitch://v1/import?' + params.toString();
}

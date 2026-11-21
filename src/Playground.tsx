import { useState, useId, useMemo, useRef, useEffect, FormEvent } from 'react';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Textarea } from './components/ui/textarea';
import { SelectField } from './components/ui/select-field';
import {
  Play,
  Send,
  Check,
  Copy,
  Sparkles,
  MessageSquare,
  Code2,
  Clock,
  Cpu,
  RotateCcw,
  AlertCircle,
  KeyRound,
  ChevronDown,
  Layers3
} from 'lucide-react';
import { writeClipboard } from './clipboard';

export type UnifiedModel = {
  id: string;
  name?: string;
  endpoints?: string[];
  provider?: string;
  group?: string;
};

export type PlaygroundKey = {
  id: string;
  name: string;
  preview: string;
};

export type PlaygroundProps = {
  base: string;
  models: UnifiedModel[];
  selectedModelId?: string;
  onModelSelect?: (modelId: string) => void;
  // Customer mode
  keys?: PlaygroundKey[];
  activeSecret?: string;
  onCharged?: () => void;
  // Admin mode
  isAdmin?: boolean;
  serviceApiKey?: string;
  onToast?: (message: string) => void;
  english?: boolean;
};

const CHAT_PRESETS = [
  { label: '自我介绍', prompt: '你好！请用一两句话简要介绍一下你自己和你的能力。' },
  { label: '写首小诗', prompt: '请写一首关于时空折叠与人工智能的优美四行微型诗。' },
  { label: '代码生成', prompt: '请用 Python 编写一个高效计算斐波那契数列的函数，并附带简短注释。' },
  { label: '逻辑推理', prompt: '树上有 9 只鸟，猎人开枪打死 1 只，剩下的鸟全吓跑了，树上还剩几只？请简述理由。' }
];

export function Playground({
  base,
  models,
  selectedModelId,
  onModelSelect,
  keys = [],
  activeSecret = '',
  onCharged,
  isAdmin = false,
  serviceApiKey = '',
  onToast,
  english = false
}: PlaygroundProps) {
  const t = (zh: string, en: string) => (english ? en : zh);

  // Available models filter
  const validModels = useMemo(() => {
    return models.filter((m) => m.id && (!m.endpoints || m.endpoints.some((e) => ['*', 'chat', 'responses', 'embeddings'].includes(e))));
  }, [models]);

  const [currentModel, setCurrentModel] = useState<string>(() => {
    if (selectedModelId && validModels.some((m) => m.id === selectedModelId)) return selectedModelId;
    return validModels[0]?.id || '';
  });

  useEffect(() => {
    if (selectedModelId && validModels.some((m) => m.id === selectedModelId)) {
      setCurrentModel(selectedModelId);
    }
  }, [selectedModelId, validModels]);

  const [mode, setMode] = useState<'chat' | 'raw'>('chat');
  const [apiKeyInput, setApiKeyInput] = useState<string>(activeSecret || serviceApiKey || '');
  const [selectedKeyId, setSelectedKeyId] = useState<string>(keys[0]?.id || '');

  // Chat mode state
  const [systemPrompt, setSystemPrompt] = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [userPrompt, setUserPrompt] = useState('你好！请向我问好并简单介绍你支持哪些功能。');
  const [temperature, setTemperature] = useState('0.7');

  // Raw mode state
  const [endpoint, setEndpoint] = useState('/v1/chat/completions');
  const [rawBody, setRawBody] = useState<string>(() => {
    const model = currentModel || 'gpt-6-astra';
    return JSON.stringify(
      {
        model,
        messages: [{ role: 'user', content: 'Hello Wormhole AI' }]
      },
      null,
      2
    );
  });

  // Response state
  const [busy, setBusy] = useState(false);
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [replyText, setReplyText] = useState('');
  const [rawResponse, setRawResponse] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [usageStats, setUsageStats] = useState<{ prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRawResponse, setShowRawResponse] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Update model change
  const handleModelChange = (id: string) => {
    setCurrentModel(id);
    onModelSelect?.(id);
    try {
      const parsed = JSON.parse(rawBody);
      parsed.model = id;
      setRawBody(JSON.stringify(parsed, null, 2));
    } catch {
      // ignore JSON parse error
    }
  };

  // Resolve key to use
  const effectiveKey = useMemo(() => {
    if (apiKeyInput.trim()) return apiKeyInput.trim();
    if (activeSecret) return activeSecret;
    if (serviceApiKey) return serviceApiKey;
    return '';
  }, [apiKeyInput, activeSecret, serviceApiKey]);

  // Execute request
  const executeRequest = async () => {
    if (!currentModel || busy) return;
    if (!isAdmin && !effectiveKey) {
      setErrorMsg(t('请先填入或选择 API Key', 'Please enter or select an API key'));
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    setBusy(true);
    setErrorMsg('');
    setReplyText('');
    setRawResponse('');
    setResponseStatus(null);
    setDurationMs(null);
    setUsageStats(null);

    const startTime = performance.now();

    try {
      let targetUrl = base;
      let requestBody: unknown;

      if (mode === 'chat') {
        targetUrl = `${base}/v1/chat/completions`;
        const messages: Array<{ role: string; content: string }> = [];
        if (systemPrompt.trim()) {
          messages.push({ role: 'system', content: systemPrompt.trim() });
        }
        messages.push({ role: 'user', content: userPrompt.trim() });

        requestBody = {
          model: currentModel,
          messages,
          temperature: parseFloat(temperature) || 0.7
        };
      } else {
        const ep = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        targetUrl = `${base}${ep}`;
        try {
          requestBody = JSON.parse(rawBody);
        } catch {
          throw new Error(t('请求体 JSON 格式不合法', 'Invalid JSON syntax in request body'));
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };

      if (effectiveKey) {
        headers.Authorization = `Bearer ${effectiveKey}`;
      }

      const res = await fetch(targetUrl, {
        method: 'POST',
        credentials: effectiveKey ? 'omit' : 'include',
        headers,
        body: JSON.stringify(requestBody),
        signal: abort.signal
      });

      const elapsed = Math.round(performance.now() - startTime);
      setDurationMs(elapsed);
      setResponseStatus(res.status);

      const text = await res.text();
      let parsedJson: any = null;
      try {
        parsedJson = JSON.parse(text);
        setRawResponse(JSON.stringify(parsedJson, null, 2));
      } catch {
        setRawResponse(text);
      }

      if (!res.ok) {
        const errDetail = parsedJson?.error?.message || parsedJson?.error || `HTTP ${res.status}`;
        throw new Error(typeof errDetail === 'string' ? errDetail : JSON.stringify(errDetail));
      }

      if (parsedJson) {
        if (parsedJson.usage) {
          setUsageStats(parsedJson.usage);
        }
        const answer =
          parsedJson.choices?.[0]?.message?.content ||
          parsedJson.choices?.[0]?.text ||
          parsedJson.output_text ||
          parsedJson.output?.[0]?.content?.[0]?.text ||
          '';
        setReplyText(typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2));
      } else {
        setReplyText(text);
      }

      onCharged?.();
      onToast?.(t('请求成功完成', 'Request completed successfully'));
    } catch (err: any) {
      if (!abort.signal.aborted) {
        const msg = err.message || String(err);
        setErrorMsg(msg);
        setDurationMs(Math.round(performance.now() - startTime));
      }
    } finally {
      if (!abort.signal.aborted) {
        setBusy(false);
      }
    }
  };

  const copyResult = async (content: string) => {
    try {
      await writeClipboard(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
    }
  };

  // Keyboard shortcut Ctrl/Cmd + Enter
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void executeRequest();
    }
  };

  return (
    <Card as="section" className="flex flex-col gap-5 p-5 sm:p-6" onKeyDown={handleKeyDown}>
      {/* Top Header & Model / Key Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--ink)] text-white shadow-xs">
            <Play size={18} className="translate-x-0.5 fill-current" />
          </div>
          <div>
            <h2 className="m-0 text-lg font-semibold tracking-tight">{t('模型在线调试台', 'Model Playground')}</h2>
            <p className="m-0 text-xs text-muted-foreground">
              {t('快速验证模型连通性、体验问答效果或调试 API 请求', 'Test model response, connectivity and inspect API payloads')}
            </p>
          </div>
        </div>

        {/* Mode Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`h-8 gap-1.5 px-3 text-xs font-medium ${mode === 'chat' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'}`}
            onClick={() => setMode('chat')}
          >
            <MessageSquare size={14} />
            {t('对话测试', 'Chat mode')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={`h-8 gap-1.5 px-3 text-xs font-medium ${mode === 'raw' ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground'}`}
            onClick={() => setMode('raw')}
          >
            <Code2 size={14} />
            {t('原生 JSON', 'JSON mode')}
          </Button>
        </div>
      </div>

      {/* Control Bar: Model + Key + Send CTA */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]">
        {/* Model Picker */}
        <div className="grid gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('选择测试模型', 'Select Model')}</label>
          <SelectField value={currentModel} onValueChange={handleModelChange}>
            {validModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id} {m.group ? `(${m.group})` : ''}
              </option>
            ))}
          </SelectField>
        </div>

        {/* API Key selector or input */}
        <div className="grid gap-1.5">
          <label className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{t('鉴权凭据 (API Key)', 'API Key')}</span>
            {activeSecret ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-normal">● {t('已绑定当前密钥', 'Key attached')}</span>
            ) : isAdmin ? (
              <span className="text-muted-foreground font-normal">{t('默认使用管理员会话', 'Admin session active')}</span>
            ) : null}
          </label>
          <Input
            type="password"
            placeholder={activeSecret ? t('已加载密钥', 'Secret loaded') : isAdmin ? t('可选：使用特定 Key 测试', 'Optional: Service Key') : 'gw_live_...'}
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            autoComplete="off"
          />
        </div>

        {/* Send Button */}
        <div className="flex items-end">
          <Button
            type="button"
            variant="default"
            size="lg"
            className="w-full gap-2 px-6 font-medium sm:w-auto"
            onClick={() => void executeRequest()}
            disabled={busy || !currentModel}
          >
            <Send size={16} className={busy ? 'animate-pulse' : ''} />
            {busy ? t('请求中…', 'Sending…') : t('发送请求', 'Send request')}
          </Button>
        </div>
      </div>

      {/* Main Workspace (Split Grid) */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left Column: Request Builder */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/50 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {mode === 'chat' ? t('对话配置', 'Request Configuration') : t('请求内容', 'Raw Payload')}
            </span>
            {mode === 'chat' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowSystem(!showSystem)}
              >
                {showSystem ? t('收起系统提示词', 'Hide System Prompt') : t('+ 添加系统提示词', '+ Add System Prompt')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  try {
                    setRawBody(JSON.stringify(JSON.parse(rawBody), null, 2));
                  } catch {}
                }}
              >
                <RotateCcw size={12} className="mr-1" />
                {t('格式化 JSON', 'Prettify JSON')}
              </Button>
            )}
          </div>

          {mode === 'chat' ? (
            <>
              {/* Optional System Prompt */}
              {showSystem && (
                <div className="grid gap-1">
                  <label className="text-xs font-medium text-muted-foreground">{t('System 提示词', 'System Prompt')}</label>
                  <Textarea
                    placeholder={t('例如：你是一名资深的技术专家，请用客观准确的语言回答问题。', 'e.g. You are a helpful AI assistant.')}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    className="min-h-16 text-sm"
                  />
                </div>
              )}

              {/* User Prompt */}
              <div className="grid gap-1.5 flex-1">
                <label className="text-xs font-medium text-foreground">{t('用户提示词 (User Message)', 'User Message')}</label>
                <Textarea
                  placeholder={t('输入需要向模型提问或测试的内容… (支持快捷键 ⌘/Ctrl + Enter 发送)', 'Type your prompt here... (Press ⌘/Ctrl + Enter to send)')}
                  value={userPrompt}
                  onChange={(e) => setUserPrompt(e.target.value)}
                  className="min-h-[160px] text-sm leading-relaxed"
                />
              </div>

              {/* Sample Presets */}
              <div>
                <span className="mb-1.5 block text-xs text-muted-foreground">{t('快捷示例：', 'Quick presets:')}</span>
                <div className="flex flex-wrap gap-1.5">
                  {CHAT_PRESETS.map((preset) => (
                    <Button
                      key={preset.label}
                      variant="outline"
                      size="xs"
                      type="button"
                      className="text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setUserPrompt(preset.prompt)}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Raw JSON Mode Controls */}
              <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                <SelectField value={endpoint} onValueChange={setEndpoint}>
                  <option value="/v1/chat/completions">POST /v1/chat</option>
                  <option value="/v1/responses">POST /v1/responses</option>
                  <option value="/v1/embeddings">POST /v1/embeddings</option>
                </SelectField>
                <Input value={`${base}${endpoint}`} readOnly className="font-mono text-xs text-muted-foreground" />
              </div>

              <div className="flex-1 grid gap-1">
                <label className="text-xs font-medium text-muted-foreground">{t('请求 Body (JSON)', 'Request Body (JSON)')}</label>
                <Textarea
                  value={rawBody}
                  onChange={(e) => setRawBody(e.target.value)}
                  className="font-mono min-h-[220px] text-xs leading-relaxed"
                />
              </div>
            </>
          )}
        </div>

        {/* Right Column: Response Inspector */}
        <div className="flex flex-col gap-3 rounded-xl border border-border/80 bg-background/50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
              {t('模型响应', 'Response')}
            </span>

            {/* Response Metrics / Status */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {responseStatus !== null && (
                <span
                  className={`rounded-md px-2 py-0.5 font-mono font-medium ${
                    responseStatus >= 200 && responseStatus < 300
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                      : 'bg-destructive/10 text-destructive'
                  }`}
                >
                  {responseStatus} {responseStatus === 200 ? 'OK' : ''}
                </span>
              )}

              {durationMs !== null && (
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground">
                  <Clock size={11} />
                  {durationMs}ms
                </span>
              )}

              {usageStats?.total_tokens !== undefined && (
                <span className="flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-muted-foreground" title={t('总消耗 Token 数', 'Total tokens')}>
                  <Cpu size={11} />
                  {usageStats.total_tokens} tokens
                </span>
              )}

              {(replyText || rawResponse) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="h-6 w-6 text-muted-foreground hover:text-foreground"
                  onClick={() => void copyResult(showRawResponse ? rawResponse : replyText)}
                  title={t('复制响应内容', 'Copy response')}
                >
                  {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                </Button>
              )}
            </div>
          </div>

          {/* Response Content View */}
          <div className="flex min-h-[220px] flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card p-3 sm:p-4">
            {busy ? (
              <div className="m-auto flex flex-col items-center gap-2 py-8 text-muted-foreground">
                <Sparkles size={24} className="animate-spin text-[var(--accent-2)]" />
                <span className="text-xs">{t('正在与网关通信并调用模型…', 'Waiting for gateway and upstream model…')}</span>
              </div>
            ) : errorMsg ? (
              <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <div className="grid gap-1">
                  <strong className="font-semibold">{t('请求失败', 'Request Failed')}</strong>
                  <p className="m-0 text-xs leading-relaxed opacity-90 wrap-anywhere">{errorMsg}</p>
                </div>
              </div>
            ) : replyText || rawResponse ? (
              <div className="flex flex-col gap-3">
                {mode === 'chat' && replyText && !showRawResponse ? (
                  <div className="whitespace-pre-wrap leading-relaxed text-sm text-foreground">
                    {replyText}
                  </div>
                ) : (
                  <pre className="m-0 overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
                    <code>{rawResponse || replyText}</code>
                  </pre>
                )}

                {/* Toggle Raw JSON */}
                {mode === 'chat' && rawResponse && (
                  <div className="mt-auto border-t border-border/60 pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      className="h-7 text-xs text-muted-foreground hover:text-foreground gap-1 px-2"
                      onClick={() => setShowRawResponse(!showRawResponse)}
                    >
                      <ChevronDown size={13} className={showRawResponse ? 'rotate-180 transition-transform' : 'transition-transform'} />
                      {showRawResponse ? t('返回文本视图', 'Switch back to Text View') : t('查看完整原始响应 JSON', 'Inspect raw JSON')}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div className="m-auto flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
                <div className="flex size-12 items-center justify-center rounded-full bg-muted/60 text-muted-foreground">
                  <Play size={20} className="translate-x-0.5" />
                </div>
                <strong className="text-sm font-medium text-foreground">{t('尚未发送请求', 'No Request Sent Yet')}</strong>
                <p className="max-w-xs text-xs text-muted-foreground">
                  {t('选择模型并在左侧输入内容，点击「发送请求」或使用 ⌘+Enter 即可在此查看响应结果。', 'Choose a model and type your prompt, then click Send Request or hit ⌘+Enter.')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

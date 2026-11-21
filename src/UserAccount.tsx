import { useConfirmation } from './components/ui/confirmation';
import { openSupport } from './Support';
import { RecoveryCodeNotice } from './RecoveryCodeNotice';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { SelectField } from './components/ui/select-field';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { cn } from './components/ui/utils';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { AccountError, accountRequest } from './account-api';
import { writeClipboard } from './clipboard';
import { CCSwitchImport } from './CCSwitchImport';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  Check,
  Copy,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  KeyRound,
  Layers3,
  LockKeyhole,
  Pencil,
  Play,
  Plus,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Wallet,
  Zap
} from 'lucide-react';
import { TestModelCall } from './TestModelCall';
import { AccountPricing } from './WalletPricing';
import { RequestLogs } from './RequestLogs';
import { WalletAccount } from './WalletPage';
import { Playground } from './Playground';
import type { AdminSession, CustomerDashboard, CustomerKey, CustomerRoute, SignedIn } from './customer-session';

type Props = {
  base: string;
  apiBase: string;
  english: boolean;
  route: CustomerRoute;
  account: CustomerDashboard | null;
  onSession: (session: SignedIn | null) => void;
  onNavigate: (route: CustomerRoute | 'console', replace?: boolean) => void;
  onRefresh: () => Promise<void>;
  onSignOut?: () => Promise<void>;
};

function firstRequest(api: string, models: CustomerDashboard['models']) {
  const model = models.find((m) =>
    m.endpoints.some((endpoint) => ['*', 'chat', 'responses', 'embeddings'].includes(endpoint))
  );
  const auth = '-H "Authorization: Bearer $WORMHOLE_API_KEY"';
  if (!model) return `curl "${api}/v1/models" ${auth}`;
  const chat = model.endpoints.includes('*') || model.endpoints.includes('chat');
  const endpoint = chat ? 'chat/completions' : model.endpoints.includes('responses') ? 'responses' : 'embeddings';
  const payload = chat
    ? { model: model.id, messages: [{ role: 'user', content: 'Hello' }] }
    : { model: model.id, input: 'Hello' };
  return `curl "${api}/v1/${endpoint}" ${auth} -H "Content-Type: application/json" -d '${JSON.stringify(payload)}'`;
}

export function UserAccount({
  base,
  apiBase,
  english,
  route,
  account: me,
  onSession,
  onNavigate,
  onRefresh
}: Props) {
  const askConfirmation = useConfirmation();
  const t = (zh: string, en: string) => (english ? en : zh);
  const mode = route === 'account' ? 'login' : route;
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [visiblePasswordFor, setVisiblePasswordFor] = useState<CustomerRoute>();
  const showPassword = visiblePasswordFor === mode;
  const [recovery, setRecovery] = useState('');
  const [newRecovery, setNewRecovery] = useState<{ owner: string; value: string }>();
  const validAreas = ['wallet', 'models', 'keys', 'playground', 'logs'] as const;
  type Area = (typeof validAreas)[number];
  const [selectedPlaygroundModel, setSelectedPlaygroundModel] = useState<string>('');
  const [area, setAreaState] = useState<Area>(() => {
    const tab = new URLSearchParams(window.location.search).get('tab') as Area;
    return validAreas.includes(tab) ? tab : 'wallet';
  });
  const setArea = (next: Area, pushHistory = true) => {
    setAreaState(next);
    if (pushHistory) {
      const url = new URL(window.location.href);
      if (next === 'wallet') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.pushState({}, '', url.pathname + url.search);
    }
  };
  useEffect(() => {
    const onPop = () => {
      const tab = new URLSearchParams(window.location.search).get('tab') as Area;
      setAreaState(validAreas.includes(tab) ? tab : 'wallet');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [revealKey, setRevealKey] = useState(false);
  const [creatingKey, setCreatingKey] = useState(false);
  const keyCreateButton = useRef<HTMLButtonElement>(null);
  const keyResultTitle = useRef<HTMLHeadingElement>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [rename, setRename] = useState<{ id: string; name: string }>();
  const [walletRevision, setWalletRevision] = useState(0);
  const [choice, setChoice] = useState('default');
  const models = me?.models || [];
  const groups = [...new Set(models.flatMap((model) => model.groups))].sort();
  const group = groups.includes(choice) ? choice : groups[0] || 'default';
  const groupModels = models.filter((model) => model.groups.includes(group));
  const groupLabel = (name: string) => me?.groupLabels?.[name] ?? (name === 'default' ? t('默认分组', 'Default group') : name);
  const [secret, setSecret] = useState<{ id: string; value: string }>();
  const [importKeyId, setImportKeyId] = useState('');
  const selectedImportKey = me?.keys.find((key) => key.id === importKeyId);
  const issuedKey = secret && me?.keys.find((key) => key.id === secret.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  useEffect(() => {
    if (!copyStatus) return;
    const timer = window.setTimeout(() => setCopyStatus(''), 2200);
    return () => window.clearTimeout(timer);
  }, [copyStatus]);
  async function copy(value: string) {
    try {
      await writeClipboard(value);
      setCopyStatus(t('已复制', 'Copied'));
    } catch {
      setCopyStatus(t('请选中内容并复制', 'Select the text and copy it manually'));
    }
  }
  useEffect(() => {
    setPassword('');
    setVisiblePasswordFor(undefined);
    setRecovery('');
    setError('');
  }, [mode]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
      if (me && e instanceof AccountError && e.status === 401) {
        setSecret(undefined);
        setNewRecovery(undefined);
        setRename(undefined);
        await onRefresh();
      }
    } finally {
      setBusy(false);
    }
  }
  const login = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => {
      const result = await accountRequest<
        AdminSession | { role: 'user'; user: CustomerDashboard['user']; recoveryCode?: string }
      >(base, mode, {
        username,
        password,
        ...(mode === 'recover' ? { recoveryCode: recovery } : {})
      });
      setPassword('');
      setRecovery('');
      setSecret(undefined);
      setRevealKey(false);
      setArea('wallet');
      setCreatingKey(false);
      setNewKeyName('');
      setRename(undefined);
      if (result.role === 'admin') {
        onSession(result);
        onNavigate('console', true);
        return;
      }
      setNewRecovery(result.recoveryCode ? { owner: result.user.id, value: result.recoveryCode } : undefined);
      onSession({ role: 'user', user: result.user, keys: [], models: [] });
      onNavigate('account', true);
      await onRefresh();
    });
  };
  async function getKey(id: string) {
    if (secret?.id === id) return secret.value;
    return (await accountRequest<{ secret: string }>(base, 'keys/' + encodeURIComponent(id) + '/secret')).secret;
  }
  const copyKey = (id: string) => perform(async () => copy(await getKey(id)));
  const rotateKey = async (key: CustomerKey) => {
    if (
      !me ||
      !await askConfirmation(
        t(
          '更换后旧密钥立即失效，使用旧密钥的客户端需重新导入。确定更换？',
          'The old key will stop working immediately. Replace this key?'
        )
      )
    )
      return;
    void perform(async () => {
      const { secret: issued, ...replacement } = await accountRequest<CustomerKey & { secret: string }>(
        base,
        'keys/' + encodeURIComponent(key.id) + '/rotate',
        {}
      );
      setSecret({ id: key.id, value: issued });
      setRevealKey(false);
      setImportKeyId('');
      onSession({ ...me, keys: me.keys.map((row) => (row.id === key.id ? replacement : row)) });
    });
  };
  const revokeKey = async (key: CustomerKey) => {
    if (!await askConfirmation(t(
      `撤销「${key.name}」后，使用这把密钥的客户端将停止访问。`,
      `Revoking “${key.name}” stops its clients from accessing the gateway.`
    ))) return;
    void perform(async () => {
      await accountRequest(base, 'keys/' + encodeURIComponent(key.id), undefined, 'DELETE');
      if (secret?.id === key.id) setSecret(undefined);
      if (importKeyId === key.id) setImportKeyId('');
      if (rename?.id === key.id) setRename(undefined);
      await onRefresh();
    });
  };
  const openKeyForm = () => {
    setArea('keys');
    if (issuedKey || creatingKey) return;
    setNewKeyName('');
    setCreatingKey(true);
    setError('');
  };
  const closeKeyForm = () => {
    if (busy) return;
    setCreatingKey(false);
    setNewKeyName('');
    setError('');
  };
  const closeRename = () => { setRename(undefined); setError(''); };
  const saveKeyName = (event: FormEvent) => {
    event.preventDefault();
    const name = rename?.name.trim();
    if (!me || !rename || !name) return;
    void perform(async () => {
      await accountRequest(base, 'keys/' + encodeURIComponent(rename.id), { name }, 'PUT');
      onSession({ ...me, keys: me.keys.map((key) => (key.id === rename.id ? { ...key, name } : key)) });
      setRename(undefined);
    });
  };
  const create = (e: FormEvent) => {
    e.preventDefault();
    void perform(async () => {
      if (!me || !groups.length) return;
      const name = newKeyName.trim();
      const result = await accountRequest<CustomerKey & { secret: string }>(base, 'keys', {
        modelGroup: group,
        ...(name ? { name } : {})
      });
      const { secret: issuedSecret, ...listedKey } = result;
      setRevealKey(false);
      setImportKeyId('');
      setSecret({ id: listedKey.id, value: issuedSecret });
      setCreatingKey(false);
      setNewKeyName('');
      onSession({ ...me, keys: [listedKey, ...me.keys] });
    });
  };
  const workspaceTab = 'min-w-0 justify-start text-muted-foreground aria-[current=page]:bg-background aria-[current=page]:text-[var(--accent-2)] aria-[current=page]:shadow-xs sm:justify-center';
  if (me === null) {
    const registering = mode === 'register';
    const recovering = mode === 'recover';
    const action = registering ? t('创建账号', 'Create account') : recovering ? t('重置密码', 'Reset password') : t('登录', 'Sign in');
    return (
      <main className="relative flex min-w-0 flex-1 items-center justify-center px-4 py-8 sm:px-6 sm:py-12 lg:py-16">
        {/* Decorative background ambient glow & grid mesh */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          <div className="absolute -top-[15%] left-1/2 -translate-x-1/2 w-[800px] h-[450px] rounded-full bg-[radial-gradient(ellipse_at_center,rgba(170,116,46,0.10),transparent_70%)] blur-2xl" />
          <div className="absolute inset-0 bg-[radial-gradient(rgba(28,27,24,0.06)_1px,transparent_1px)] [background-size:24px_24px] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_60%,transparent_100%)] opacity-70" />
        </div>

        {/* Master Card Container: Two-column split showcase on desktop (lg+), clean compact card on mobile */}
        <div className="w-full max-w-5xl rounded-3xl border border-border/70 bg-card/95 shadow-[0_24px_64px_-16px_rgba(23,32,40,0.12)] backdrop-blur-xl overflow-hidden grid grid-cols-1 lg:grid-cols-12">

          {/* Left Column: Developer Showcase & Value Proposition (Desktop only) */}
          <section className="hidden lg:flex lg:col-span-6 xl:col-span-7 flex-col justify-between p-8 xl:p-10 bg-gradient-to-br from-[#121418] via-[#16181e] to-[#0f1013] text-white relative overflow-hidden border-b lg:border-b-0 lg:border-r border-zinc-800/80">
            {/* Ambient lighting inside dark showcase panel */}
            <div className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-amber-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-20 -bottom-20 size-72 rounded-full bg-primary/10 blur-3xl" />

            {/* Top Brand & Status */}
            <div className="relative z-10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <img src="/favicon.svg" alt="Wormhole AI" className="size-9 rounded-xl shadow-xs" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold tracking-tight text-white">Wormhole AI</span>
                    <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 text-[10px] font-semibold text-amber-300">
                      Gateway
                    </span>
                  </div>
                  <p className="m-0 text-xs text-zinc-400">
                    {t('大模型统一聚合路由基础设施', 'Frontier AI Model Gateway Infrastructure')}
                  </p>
                </div>
              </div>

              <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 text-[11px] font-medium text-emerald-400">
                <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>{t('API 运行正常', 'API Operational')}</span>
              </div>
            </div>

            {/* Middle: Value Prop & Stylized API Terminal */}
            <div className="relative z-10 my-8 space-y-6">
              <div>
                <h2 className="text-xl xl:text-2xl font-bold tracking-tight text-white leading-snug">
                  {t('统一接入全球前沿大模型', 'Unified Access to Frontier AI Models')}
                </h2>
                <p className="mt-2 text-sm text-zinc-300 leading-relaxed max-w-[46ch]">
                  {t(
                    '标准 OpenAI 协议全适配，提供毫秒级智能调度、跨供应商自动容灾与企业级隔离鉴权。',
                    'OpenAI-compatible protocol with sub-second routing, cross-provider failover, and enterprise tenant isolation.'
                  )}
                </p>
              </div>

              {/* Terminal Code Mockup */}
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-inner font-mono text-xs overflow-hidden">
                <div className="flex items-center justify-between border-b border-zinc-800/80 bg-zinc-900/60 px-3.5 py-2">
                  <div className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full bg-[#ff5f56]" />
                    <span className="size-2.5 rounded-full bg-[#ffbd2e]" />
                    <span className="size-2.5 rounded-full bg-[#27c93f]" />
                    <span className="ms-2 text-[11px] text-zinc-400 font-sans">OpenAI Compatible</span>
                  </div>
                  <span className="text-[10px] text-zinc-400">POST /v1/chat/completions</span>
                </div>
                <div className="p-3.5 space-y-1 text-zinc-300 leading-relaxed overflow-x-auto text-[11px]">
                  <div className="text-zinc-400"># {t('零迁移成本，无缝切换主流大模型', 'Zero migration cost, plug-and-play')}</div>
                  <div><span className="text-amber-400 font-semibold">curl</span> <span className="text-zinc-200">https://1024012.xyz/v1/chat/completions</span> \</div>
                  <div className="ps-4"><span className="text-zinc-400">-H</span> <span className="text-sky-300">&quot;Authorization: Bearer wk-live-••••••••&quot;</span> \</div>
                  <div className="ps-4"><span className="text-zinc-400">-d</span> <span className="text-zinc-300">&apos;&#123;&quot;model&quot;: &quot;gpt-6.2-astra&quot;, &quot;stream&quot;: true&#125;&apos;</span></div>
                </div>
                <div className="flex items-center justify-between border-t border-zinc-800/60 bg-zinc-900/40 px-3 py-1.5 text-[10px] text-zinc-400">
                  <span className="flex items-center gap-1 text-emerald-400">
                    <span className="size-1 rounded-full bg-emerald-400" />
                    <span>HTTP 200 OK</span>
                  </span>
                  <span>{t('18ms 调度时延 · 零明文留存', '18ms latency · Zero retention')}</span>
                </div>
              </div>

              {/* Core Feature Badges */}
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3">
                  <ShieldCheck size={18} className="text-amber-400 mb-1.5" />
                  <div className="text-xs font-semibold text-zinc-200">{t('端到端隔离', 'Isolated Keys')}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{t('凭证独立隔离鉴权', 'Per-tenant segregation')}</div>
                </div>
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3">
                  <Layers3 size={18} className="text-sky-400 mb-1.5" />
                  <div className="text-xs font-semibold text-zinc-200">{t('多模型路由', 'Smart Routing')}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{t('毫秒级故障自动容灾', 'Sub-second auto failover')}</div>
                </div>
                <div className="rounded-xl border border-zinc-800/90 bg-zinc-900/50 p-3">
                  <Zap size={18} className="text-amber-400 mb-1.5" />
                  <div className="text-xs font-semibold text-zinc-200">{t('秒级计费', 'Live Billing')}</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5 leading-snug">{t('按 Token 精确透明核算', 'Transparent per-token')}</div>
                </div>
              </div>
            </div>

            {/* Bottom Footer Info */}
            <div className="relative z-10 flex items-center justify-between text-xs text-zinc-400 pt-3 border-t border-zinc-800/60">
              <span>{t('全球多可用区部署 · SLA 99.99%', 'Multi-region deployment · SLA 99.99%')}</span>
              <span>{t('256 位 TLS 传输加密', '256-bit TLS encrypted')}</span>
            </div>
          </section>

          {/* Right Column: Auth Form Area */}
          <section aria-labelledby="auth-title" className="col-span-12 lg:col-span-6 xl:col-span-5 flex flex-col justify-between p-6 sm:p-9 xl:p-10 bg-card">
            <div>
              {/* Mobile-only brand badge */}
              <div className="lg:hidden mb-5 text-center">
                <img src="/favicon.svg" alt="Wormhole AI" className="mx-auto mb-2 size-10 rounded-xl shadow-xs" />
                <span className="text-xs font-bold tracking-wider text-muted-foreground uppercase">Wormhole AI</span>
              </div>

              {/* Form Header */}
              <header className="mb-6">
                <h1 id="auth-title" className="m-0 text-2xl font-bold tracking-tight text-foreground sm:text-2xl">
                  {registering
                    ? t('创建开发者账号', 'Create an account')
                    : recovering
                      ? t('找回密码', 'Reset your password')
                      : t('登录工作台', 'Sign in to workspace')}
                </h1>
                <p className="mt-1.5 mb-0 text-sm leading-relaxed text-muted-foreground">
                  {registering
                    ? t('创建账号后即可在工作台查看可用模型并管理密钥。', 'Create an account to browse available models and manage keys.')
                    : recovering
                      ? t('使用注册时保存的恢复码设置新密码。', 'Use the recovery code you saved when you registered.')
                      : t('使用你的账号进入工作台，管理 API 与模型调用。', 'Sign in with your account to access your workspace and API keys.')}
                </p>
              </header>

              {/* Segmented Pill Tabs */}
              {!recovering && (
                <div role="tablist" aria-label={t('账号入口', 'Account access')} className="mb-6 grid grid-cols-2 gap-1 rounded-xl bg-muted/70 p-1 border border-border/60">
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'login'}
                    variant="ghost"
                    size="sm"
                    onClick={() => { if (mode !== 'login') onNavigate('login'); }}
                    className={cn(
                      "h-9 text-xs font-semibold gap-1.5 transition-all rounded-lg border-0",
                      mode === 'login'
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                    )}
                  >
                    <UserRound size={14} className="opacity-70" />
                    {t('账号登录', 'Sign in')}
                  </Button>
                  <Button
                    type="button"
                    role="tab"
                    aria-selected={mode === 'register'}
                    variant="ghost"
                    size="sm"
                    onClick={() => { if (mode !== 'register') onNavigate('register'); }}
                    className={cn(
                      "h-9 text-xs font-semibold gap-1.5 transition-all rounded-lg border-0",
                      mode === 'register'
                        ? "bg-background text-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground hover:bg-transparent"
                    )}
                  >
                    <Sparkles size={14} className="opacity-70" />
                    {t('注册新账号', 'Register')}
                  </Button>
                </div>
              )}

              {/* Error Alert */}
              {error && (
                <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/25 bg-destructive/5 p-3.5 text-sm text-destructive" role="alert">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="leading-snug">{error}</span>
                </div>
              )}

              {/* Auth Form */}
              <form className="grid gap-4.5" onSubmit={login} aria-busy={busy}>
                <div className="grid gap-1.5">
                  <label htmlFor="auth-username" className="text-sm font-medium text-foreground">
                    {t('用户名', 'Username')}
                  </label>
                  <div className="relative">
                    <UserRound size={16} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                    <Input
                      id="auth-username"
                      name="username"
                      className="h-10 ps-9 text-sm"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                      required
                      minLength={registering ? 3 : undefined}
                      maxLength={registering ? 48 : undefined}
                      pattern={registering ? '[a-zA-Z0-9][a-zA-Z0-9._\\-]{2,47}' : undefined}
                      aria-describedby={registering ? 'auth-username-help' : undefined}
                    />
                  </div>
                  {registering && (
                    <small id="auth-username-help" className="text-xs text-muted-foreground">
                      {t('3–48 位，以英文字母或数字开头，可包含点、下划线或短横线。', '3–48 characters. Start with a letter or digit; dots, underscores and hyphens are allowed.')}
                    </small>
                  )}
                </div>

                <div className="grid gap-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <label htmlFor="auth-password" className="text-sm font-medium text-foreground">
                      {recovering ? t('新密码', 'New password') : t('密码', 'Password')}
                    </label>
                    {mode === 'login' && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground font-normal border-0"
                        onClick={() => onNavigate('recover')}
                      >
                        {t('忘记密码？', 'Forgot password?')}
                      </Button>
                    )}
                  </div>
                  <div className="relative">
                    <LockKeyhole size={16} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                    <Input
                      id="auth-password"
                      name="password"
                      className="h-10 ps-9 pe-11 text-sm"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                      minLength={mode === 'login' ? 1 : 12}
                      maxLength={256}
                      required
                      aria-describedby={mode === 'login' ? undefined : 'auth-password-help'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute end-1.5 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground/70 hover:text-foreground hover:bg-muted/80 rounded-md border-0"
                      onClick={() => setVisiblePasswordFor(showPassword ? undefined : mode)}
                      aria-label={showPassword ? t('隐藏密码', 'Hide password') : t('显示密码', 'Show password')}
                    >
                      {showPassword ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                    </Button>
                  </div>
                  {mode !== 'login' && (
                    <small id="auth-password-help" className="text-xs text-muted-foreground">
                      {t('至少 12 位字符。', 'At least 12 characters.')}
                    </small>
                  )}
                </div>

                {recovering && (
                  <div className="grid gap-1.5">
                    <label htmlFor="auth-recovery" className="text-sm font-medium text-foreground">
                      {t('恢复码', 'Recovery code')}
                    </label>
                    <div className="relative">
                      <KeyRound size={16} aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground/70" />
                      <Input
                        id="auth-recovery"
                        type="password"
                        className="h-10 ps-9 text-sm"
                        autoComplete="off"
                        maxLength={128}
                        required
                        value={recovery}
                        onChange={(event) => setRecovery(event.target.value)}
                        aria-describedby="auth-recovery-help"
                      />
                    </div>
                    <small id="auth-recovery-help" className="text-xs text-muted-foreground">
                      {t('重置后，原有 API 密钥将被撤销。', 'Resetting your password revokes your existing API keys.')}
                    </small>
                  </div>
                )}

                <Button type="submit" size="lg" className="mt-2 h-10 w-full gap-2 border-0 font-medium" disabled={busy}>
                  {busy && <RefreshCcw size={15} className="motion-safe:animate-spin" aria-hidden="true" />}
                  {busy ? (
                    registering ? t('正在创建…', 'Creating account…') : recovering ? t('正在重置…', 'Resetting…') : t('正在登录…', 'Signing in…')
                  ) : (
                    <>
                      <span>{action}</span>
                      <ArrowRight size={15} className="opacity-80" />
                    </>
                  )}
                </Button>
              </form>

              {/* Recovery Options */}
              {recovering && (
                <div className="mt-6 space-y-3 border-t border-border/70 pt-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                    <span className="text-xs text-muted-foreground">{t('也没有恢复码？', 'Lost your recovery code too?')}</span>
                    <Button type="button" variant="outline" size="sm" onClick={openSupport}>
                      {t('联系账号客服', 'Contact account support')}
                    </Button>
                  </div>
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs font-medium border-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onNavigate('login')}
                  >
                    ← {t('返回登录', 'Back to sign in')}
                  </Button>
                </div>
              )}
            </div>

            {/* Bottom Security / Privacy Assurance */}
            <div className="mt-8 pt-5 border-t border-border/50 flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck size={14} className="text-muted-foreground/70 shrink-0" />
              <span>{t('256 位 TLS 传输加密 · 严格数据隔离 · 不存储模型提示词', '256-bit TLS encryption · strict tenant isolation · zero prompt logging')}</span>
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="customer-workspace flex-1 mx-auto my-0 grid w-full min-w-0 max-w-6xl content-start gap-5 px-4 py-8 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="m-0 text-3xl font-semibold tracking-tight sm:text-4xl">
          {t('账户工作台', 'Account workspace')}
        </h1>
      </div>
      {error && !creatingKey && !rename && <p role="alert">{error}</p>}
      {copyStatus && (
        <span className="workspace-feedback" role="status">
          {copyStatus}
        </span>
      )}
      {me && (
        <>
          <nav className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted p-1 sm:grid-cols-5" aria-label={t('工作台导航', 'Workspace navigation')}>
            <Button variant="ghost" size="lg" className={workspaceTab} aria-current={area === 'wallet' ? 'page' : undefined} onClick={() => setArea('wallet')}>
              <Wallet size={18} />
              {t('钱包与充值', 'Wallet & top-ups')}
            </Button>
            <Button variant="ghost" size="lg" className={workspaceTab} aria-current={area === 'models' ? 'page' : undefined} onClick={() => setArea('models')}>
              <Layers3 size={18} />
              {t('可用模型', 'Models')} <small>{models.length}</small>
            </Button>
            <Button variant="ghost" size="lg" className={workspaceTab} aria-current={area === 'keys' ? 'page' : undefined} onClick={() => setArea('keys')}>
              <KeyRound size={18} />
              {t('API 密钥', 'API keys')} <small>{me.keys.length}</small>
            </Button>
            <Button variant="ghost" size="lg" className={workspaceTab} aria-current={area === 'playground' ? 'page' : undefined} onClick={() => setArea('playground')}>
              <Play size={18} />
              {t('在线调试', 'Playground')}
            </Button>
            <Button variant="ghost" size="lg" className={workspaceTab} aria-current={area === 'logs' ? 'page' : undefined} onClick={() => setArea('logs')}>
              <Activity size={17} />{t('调用日志', 'Request logs')}
            </Button>
          </nav>
          {newRecovery && newRecovery.owner === me.user.id && <RecoveryCodeNotice
            code={newRecovery.value} english={english} onSaved={() => setNewRecovery(undefined)} />}
          <div hidden={area !== 'wallet'} className="workspace-pane">
            <WalletAccount
              revision={walletRevision}
              guidance={
                !groups.length
                  ? {
                      title: t('模型尚未开放', 'Models are not available yet'),
                      text: t(
                        '平台发布模型后，你就能选择分组、创建密钥并调用 API。',
                        'Once a model is published, choose its group to create a key and call the API.'
                      ),
                      label: t('刷新可用模型', 'Check models again'),
                      run: async () => {
                        await onRefresh();
                        setCopyStatus(t('模型列表已刷新', 'Model list refreshed'));
                      }
                    }
                  : !me.keys.length
                    ? {
                        title: t('创建你的第一把 API 密钥', 'Create your first API key'),
                        text: t(
                          '先查看模型分组，选好分组后创建 Key。充值到账后即可测试调用。',
                          'Choose a model group and create a key. Once funded, send a test request.'
                        ),
                        label: t('选择模型分组', 'Choose a model group'),
                        run: () => setArea('models')
                      }
                    : {
                        title: t('使用密钥调用模型', 'Call a model with your key'),
                        text: t(
                          '进入密钥页，可直接测试请求或复制客户端调用示例。',
                          'Open API keys to test a request or copy a client example.'
                        ),
                        label: t('接入与测试', 'Connect and test'),
                        run: () => setArea('keys')
                      }
              }
              key={me.user.id}
              base={base}
              t={t}
              active={area === 'wallet'}
              hidePricing
              nextStep={{ label: t('查看可用模型', 'Browse models'), run: () => setArea('models') }}
            />
          </div>
          {area === 'keys' && (
            <div className="customer-keys">
              <section className="key-workspace" aria-labelledby="account-keys-title">
                <header className="key-page-head">
                  <div>
                    <h2 id="account-keys-title">{t('API 密钥', 'API keys')}</h2>
                    <p>{t('为不同应用创建密钥，按模型分组接入客户端。', 'Create keys for your apps and connect clients by model group.')}</p>
                  </div>
                  <Button ref={keyCreateButton} type="button" size="sm" className="h-8 gap-1.5 text-xs" disabled={busy || !groups.length || Boolean(issuedKey)} onClick={openKeyForm}>
                    <Plus size={15} />{t('创建密钥', 'Create API key')}
                  </Button>
                </header>
                {!groups.length && (
                  <p className="work-notice">{t('平台尚未开放模型分组，暂时无法创建密钥。', 'Key creation opens when the operator publishes a model group.')}</p>
                )}
                {creatingKey && groups.length > 0 && <FormDialog title={t('新建 API 密钥', 'New API key')}
                  closeLabel={t('关闭', 'Close')} busy={busy} onClose={closeKeyForm}
                  returnFocus={() => keyResultTitle.current || keyCreateButton.current}>
                  <form className={dialogForm} onSubmit={create}>
                    <div className={dialogBody}>
              <div className="key-field">
                <label htmlFor="new-key-name">{t('密钥名称', 'Key name')}</label>
                <Input id="new-key-name" data-initial-focus aria-describedby="new-key-name-help" value={newKeyName} maxLength={80} disabled={busy}
                  placeholder={t('例如：工作电脑', 'e.g. Work laptop')}
                  onChange={(event) => setNewKeyName(event.target.value)} />
                <small id="new-key-name-help">{t('选填，留空按分组自动命名。', 'Optional. Leave blank for a group-based name.')}</small>
              </div>
              <div className="key-field">
                <label htmlFor="new-key-group">{t('模型分组', 'Model group')}</label>
                {groups.length === 1 ? (
                  <output className="key-fixed-group" id="new-key-group"><Layers3 size={16} aria-hidden="true" />{groupLabel(group)}</output>
                ) : (
                  <SelectField id="new-key-group" value={group} disabled={busy} onValueChange={setChoice}>
                    {groups.map((name) => <option value={name} key={name}>{groupLabel(name)}</option>)}
                  </SelectField>
                )}
                <small>{t('密钥可调用这个分组内的模型。', 'This key can call models in this group.')}</small>
              </div>
              {error && <p className="m-0 text-sm text-destructive" role="alert">{error}</p>}
                    </div>
                    <div className={dialogFooter}>
                      <Button variant="outline" type="button" disabled={busy} onClick={closeKeyForm}>{t('取消', 'Cancel')}</Button>
                      <Button type="submit" disabled={busy}>{busy ? t('创建中…', 'Creating…') : t('创建密钥', 'Create API key')}</Button>
                    </div>
                  </form>
                </FormDialog>}
                {rename && <FormDialog title={t('重命名密钥', 'Rename API key')} closeLabel={t('关闭', 'Close')}
                  busy={busy} onClose={closeRename} returnFocus={() => document.getElementById(`key-actions-${rename.id}`)}>
                  <form className={dialogForm} onSubmit={saveKeyName}>
                    <div className={dialogBody}>
                      <label className="grid gap-1.5 text-sm font-medium" htmlFor="rename-key">{t('密钥名称', 'Key name')}
                        <Input id="rename-key" data-initial-focus required maxLength={80} disabled={busy} value={rename.name}
                          onChange={(event) => setRename({ id: rename.id, name: event.target.value })} />
                      </label>
                      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                    </div>
                    <div className={dialogFooter}>
                      <Button variant="outline" type="button" disabled={busy} onClick={closeRename}>{t('取消', 'Cancel')}</Button>
                      <Button type="submit" disabled={busy || !rename.name.trim()}>{busy ? t('保存中…', 'Saving…') : t('保存名称', 'Save name')}</Button>
                    </div>
                  </form>
                </FormDialog>}
                {secret && issuedKey && (
                  <section className="key-result" aria-label={t('新密钥', 'New key')}>
                    <div className="console-section-head">
                      <div>
                        <h3 ref={keyResultTitle} tabIndex={-1}>
                          <Check size={17} aria-hidden="true" />
                          {t('密钥已创建', 'Key created')}
                        </h3>
                        <p>
                          {issuedKey.name} · {groupLabel(issuedKey.modelGroup)}
                        </p>
                      </div>
                      <Button variant="ghost" type="button" onClick={() => setSecret(undefined)}>
                        {t('完成', 'Done')}
                      </Button>
                    </div>
                    <p className="panel-note">
                      {t(
                        '可以立即复制或导入 CC Switch，也可以稍后在密钥列表操作。',
                        'Copy or import this key into CC Switch now, or do it later from the key list.'
                      )}
                    </p>
                    <div className="row-actions">
                      <Button variant="default" type="button" onClick={() => void copyKey(issuedKey.id)}>
                        <Copy size={15} />
                        {t('复制 Key', 'Copy key')}
                      </Button>
                      <Button
                        variant="outline"
                        type="button"
                        aria-pressed={revealKey}
                        onClick={() => setRevealKey(!revealKey)}
                      >
                        {revealKey ? t('隐藏密钥', 'Hide key') : t('显示密钥', 'Show key')}
                      </Button>
                      <Button variant="outline" type="button" onClick={() => setImportKeyId(issuedKey.id)}>
                        <Download />{t('导入 CC Switch', 'Import to CC Switch')}
                      </Button>
                    </div>
                    {revealKey && <code className="key-secret-value">{secret.value}</code>}
                  </section>
                )}
                {selectedImportKey && <CCSwitchImport key={selectedImportKey.id} apiBase={apiBase} record={selectedImportKey} models={models}
                  issued={secret?.id === selectedImportKey.id ? secret.value : undefined} getKey={() => getKey(selectedImportKey.id)}
                  onClose={() => setImportKeyId('')} t={t} />}
                <Card className="key-register">
                  {me.keys.length === 0 ? (
                    <div className="key-empty">{t('暂无密钥', 'No API keys yet')}</div>
                  ) : (
                    <>
                      <div className="key-register-head" aria-hidden="true">
                        <span>{t('名称 / 密钥', 'Name / Key')}</span>
                        <span>{t('模型分组', 'Model group')}</span>
                        <span>{t('操作', 'Actions')}</span>
                      </div>
                      <ul className="customer-key-list">
                        {me.keys.map((key) => (
                          <li key={key.id} className="customer-key-item">
                            <div className="customer-key-row">
                              <div className="key-identity">
                                <KeyRound size={17} aria-hidden="true" />
                                <div><strong>{key.name}</strong><small><code>{key.preview}</code></small></div>
                              </div>
                              <span className="key-group-label">{groupLabel(key.modelGroup)}</span>
                              <div className="key-row-actions">
                                {key.id !== issuedKey?.id && (key.secretAvailable ? (
                                  <>
                                    <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void copyKey(key.id)}>
                                      <Copy />{t('复制 Key', 'Copy key')}
                                    </Button>
                                    <Button variant="outline" size="sm" type="button" aria-haspopup="dialog"
                                      onClick={() => setImportKeyId(key.id)}>
                                      <Download />{t('导入 CC Switch', 'Import to CC Switch')}
                                    </Button>
                                  </>
                                ) : (
                                  <Button variant="outline" size="sm" type="button" disabled={busy || Boolean(issuedKey)} onClick={() => void rotateKey(key)}>
                                    {t('更换密钥', 'Replace key')}
                                  </Button>
                                ))}
                                <DropdownMenu modal={false}>
                                  <DropdownMenuTrigger asChild>
                                    <Button id={`key-actions-${key.id}`} variant="ghost" size="icon-sm" type="button" disabled={busy} aria-label={t(`${key.name} 的更多操作`, `More actions for ${key.name}`)}>
                                      <Ellipsis />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onSelect={() => {
                                      setError('');
                                      setRename({ id: key.id, name: key.name });
                                    }}><Pencil />{t('改名', 'Rename')}</DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem variant="destructive" onSelect={() => void revokeKey(key)}>
                                      <Trash2 />{t('撤销密钥', 'Revoke key')}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </Card>
              </section>
              <Card as="section" className="panel key-connection">
                <h2>{t('客户端接入', 'Client setup')}</h2>
                <div className="key-api-address">
                  <span>{t('接口地址', 'API base URL')}</span>
                  <code>{apiBase}/v1</code>
                  <Button variant="outline" type="button" onClick={() => void copy(apiBase + '/v1')}>
                    {t('复制地址', 'Copy URL')}
                  </Button>
                </div>
                {groups.length > 0 && me.keys.length > 0 && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="default" type="button" onClick={() => setArea('playground')}>
                        <Play size={15} />
                        {t('前往在线调试台', 'Open playground')}
                      </Button>
                      <TestModelCall
                        key={group}
                        base={base}
                        models={groupModels}
                        english={english}
                        issued={issuedKey?.modelGroup === group ? secret?.value : undefined}
                        onCharged={() => setWalletRevision((n) => n + 1)}
                      />
                    </div>
                    <details className="first-call">
                      <summary>{t('客户端调用示例', 'Client request example')}</summary>
                      <p>
                        {t(
                          '将自己的 Key 保存为环境变量 WORMHOLE_API_KEY 后运行。模型调用按实际用量扣费。',
                          'Set WORMHOLE_API_KEY to your key. Model requests are billed by usage.'
                        )}
                      </p>
                      <pre>
                        <code>{firstRequest(apiBase, groupModels)}</code>
                      </pre>
                      <Button
                        variant="outline"
                        type="button"
                        onClick={() => void copy(firstRequest(apiBase, groupModels))}
                      >
                        {t('复制示例', 'Copy example')}
                      </Button>
                    </details>
                  </>
                )}
              </Card>
            </div>
          )}
          {area === 'logs' && <RequestLogs base={base} english={english} />}
          {area === 'playground' && (
            <Playground
              base={base}
              models={models.map((m) => ({ id: m.id, endpoints: m.endpoints, group: groupLabel(m.groups[0] || '') }))}
              selectedModelId={selectedPlaygroundModel}
              onModelSelect={setSelectedPlaygroundModel}
              keys={me.keys}
              activeSecret={secret?.value}
              onCharged={() => setWalletRevision((n) => n + 1)}
              english={english}
            />
          )}
          {area === 'models' && (
            <>
              <Card as="section" className="panel catalog-workspace" aria-label={t('可用模型', 'Available models')}>
                <div className="panel-heading">
                  <h2 className="m-0 text-xl font-semibold">{t('可用模型', 'Available models')}</h2>
                  {groups.length > 0 && (
                    <Button variant="default" size="sm" onClick={openKeyForm}>
                      <Plus size={16} />
                      {t('为此分组创建 Key', 'Create key for this group')}
                    </Button>
                  )}
                </div>
                {groups.length ? (
                  <>
                      <div className="group-tabs my-2" role="group" aria-label={t('浏览模型分组', 'Browse model groups')}>
                        {groups.map((name) => (
                          <Button
                            key={name}
                            type="button"
                            size="sm"
                            variant={group === name ? 'default' : 'outline'}
                            className="h-8 px-3 text-xs"
                            aria-pressed={group === name}
                            onClick={() => setChoice(name)}
                          >
                            {groupLabel(name)} <small>{models.filter((m) => m.groups.includes(name)).length}</small>
                          </Button>
                        ))}
                      </div>
                    <p className="m-0 mb-3 text-sm text-muted-foreground">
                      {t(
                        '选择一个分组查看模型，再为该组创建密钥。客户端在请求中使用该密钥即可调用此分组下的所有模型。',
                        'Choose a group to browse its models. A key created for this group can access all of them.'
                      )}
                    </p>
                    {groupModels.length ? (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('模型标识', 'Model ID')}</TableHead>
                            <TableHead>{t('支持接口', 'Endpoints')}</TableHead>
                            <TableHead>{t('所属分组', 'Group')}</TableHead>
                            <TableHead className="text-right">{t('操作', 'Actions')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {groupModels.map((model) => (
                            <TableRow key={model.id}>
                              <TableHead scope="row">
                                <code className="font-mono text-xs font-semibold">{model.id}</code>
                              </TableHead>
                              <TableCell>
                                <div className="flex flex-wrap gap-1">
                                  {model.endpoints.map((ep) => (
                                    <span key={ep} className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                      {ep}
                                    </span>
                                  ))}
                                </div>
                              </TableCell>
                              <TableCell>
                                <span className="key-group-label">{groupLabel(group)}</span>
                              </TableCell>
                              <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    type="button"
                                    onClick={() => {
                                      setSelectedPlaygroundModel(model.id);
                                      setArea('playground');
                                    }}
                                    title={t('在网页测试调用此模型', 'Test this model')}
                                    aria-label={t('在网页测试调用此模型', 'Test this model')}
                                  >
                                    <Play size={15} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                    type="button"
                                    onClick={() => void copy(model.id)}
                                    title={t('复制模型 ID', 'Copy model ID')}
                                    aria-label={t('复制模型 ID', 'Copy model ID')}
                                  >
                                    <Copy size={15} />
                                  </Button>
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    ) : (
                      <p className="py-4 text-center text-sm text-muted-foreground">{t('该分组暂无模型', 'No models in this group')}</p>
                    )}
                  </>
                ) : (
                  <p>
                    {t(
                      '平台还没有发布可调用的模型。开放后，这里会列出模型和分组，你就可以创建 API 密钥。',
                      'The operator has not published a model yet. Once available, model groups will appear here and you can create an API key.'
                    )}
                  </p>
                )}
              </Card>
              <AccountPricing base={base} t={t} allowedModels={me.models.map((m) => m.id)} />
            </>
          )}
        </>
      )}
    </main>
  );
}

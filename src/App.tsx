import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Bell,
  Boxes,
  Check,
  CircleDollarSign,
  Clipboard,
  Cloud,
  Code2,
  Copy,
  CreditCard,
  DatabaseZap,
  Eye,
  EyeOff,
  KeyRound,
  Layers3,
  LineChart,
  LockKeyhole,
  LogOut,
  Menu,
  Network,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  ShieldCheck,
  TestTube2,
  Trash2,
  User,
  Workflow,
  X
} from 'lucide-react';
import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useState } from 'react';

type Route =
  | 'home'
  | 'login'
  | 'console'
  | 'about'
  | 'not-found';

type UserState = {
  name: string;
  email: string;
};

type RuntimeConfig = {
  publicBaseUrl: string;
};

type ApiKey = {
  id: string;
  name: string;
  value: string;
  role: 'admin' | 'service';
  created: string;
  lastUsed: string;
  limit: string;
  perMinute: number;
  enabled: boolean;
  status: 'Active' | 'Paused';
};

type ApiKeyFormState = {
  id: string;
  name: string;
  perMinute: string;
  enabled: boolean;
};

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type Channel = {
  id: string;
  name: string;
  provider: string;
  models: string;
  latency: number;
  success: number;
  balance: string;
  status: 'Healthy' | 'Degraded' | 'Paused';
  type?: string;
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
};

type GatewayProvider = {
  name?: string;
  type?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  apiKeyPreview?: string;
  enabled?: boolean;
  apiKeyConfigured?: boolean;
  timeoutMs?: number;
  maxConcurrency?: number;
  headers?: Record<string, string>;
};

type ProviderHealth = {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  configured: boolean;
  live: boolean;
  ok: boolean;
  status?: number;
  durationMs?: number;
  message: string;
};

type ChannelHealthState = ProviderHealth & {
  checkedAt: string;
};

type ChannelFormState = {
  id: string;
  name: string;
  type: 'mock' | 'openai-compatible';
  baseUrl: string;
  apiKey: string;
  apiKeyEnv: string;
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  timeoutMs: string;
  maxConcurrency: string;
  enabled: boolean;
};

type GatewayModel = {
  description?: string;
  provider: string;
  upstreamModel: string;
  enabled?: boolean;
  endpoints?: string[];
};

type GatewayApiKey = {
  id: string;
  name?: string;
  key?: string;
  keyPreview?: string;
  secretAvailable?: boolean;
  role?: 'admin' | 'service';
  enabled?: boolean;
  perMinute?: number;
  createdAt?: string;
  updatedAt?: string;
  lastUsedAt?: string;
};

type RequestLog = {
  requestId: string;
  time: string;
  apiKeyId?: string;
  endpoint?: string;
  modelAlias?: string;
  provider?: string;
  upstreamModel?: string;
  status: number;
  durationMs: number;
  usage?: UsageTokens;
  billableUsage?: BillableUsage;
  estimatedCost?: EstimatedCost;
};

type UsageTokens = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type BillingUnit = 'token' | 'image' | 'request';

type BillableUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  images?: number;
  requests?: number;
};

type EstimatedCost = {
  currency?: string;
  billingUnit?: BillingUnit;
  unitLabel?: string;
  inputCost?: number;
  outputCost?: number;
  imageCost?: number;
  requestCost?: number;
  totalCost?: number;
  units?: BillableUsage;
};

type UsageSummary = {
  total: number;
  ok: number;
  error: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
  byUpstreamModel: Record<string, number>;
  byApiKey: Record<string, number>;
  byEndpoint: Record<string, number>;
  byStatus: Record<string, number>;
  failoverRequests: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  billable?: {
    images: number;
    requests: number;
  };
  estimatedCost: Record<string, number>;
  avgDurationMs: number;
};

type PricingEntry = {
  billingUnit?: BillingUnit;
  inputPerMillionTokens: number;
  outputPerMillionTokens: number;
  imageUnitPrice?: number;
  requestUnitPrice?: number;
  unitLabel?: string;
  currency?: string;
  officialProvider?: string;
  officialModel?: string;
  source?: string;
  note?: string;
};

type PricingConfig = {
  currency: string;
  models: Record<string, PricingEntry>;
};

type ModelRow = {
  alias: string;
  model: GatewayModel;
};

type Language = 'zh' | 'en';

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (text: string) => string;
};

const zhMessages: Record<string, string> = {
  'JetLinksAPI home': 'JetLinksAPI 首页',
  About: '关于',
  'Sign in': '登录',
  'Open menu': '打开菜单',
  Language: '语言',
  'ENTERPRISE MODEL ACCESS': '企业模型接入网关',
  'The unified model API gateway': '统一模型 API 网关',
  'for enterprise systems': '面向企业系统',
  'Connect model providers with one domain, one key, and clear risk controls so every service stays observable, scalable, and governed.':
    '通过统一域名、统一密钥与清晰风控接入模型供应商，让业务服务保持可观测、可扩展、可治理。',
  'SWAP THE BASE URL TO START INTEGRATING': '替换 Base URL 即可开始接入',
  'Copy integration URL': '复制接入地址',
  'Integration URL copied.': '接入地址已复制。',
  'Copy gateway root URL': '复制网关根地址',
  'Gateway root URL copied.': '网关根地址已复制。',
  'Copy failed. Please copy it manually.': '复制失败，请手动复制。',
  'Open console': '进入控制台',
  'Signed in as super admin': '已登录超级管理员',
  'BASE URL': '统一根地址',
  'API KEY': '内部密钥',
  'MODEL ALIAS': '模型别名',
  'Gateway operations preview': '网关运行预览',
  'Unified base URL': '统一 Base URL',
  'OpenAI-compatible /v1 endpoints': '兼容 OpenAI 风格 /v1 接口',
  'API key authentication': 'API Key 鉴权',
  'Authorization header is required': '统一使用 Authorization 请求头',
  'Admin-only metrics': '管理员指标',
  'Health and metrics avoid public details': '探活和指标不向公网暴露细节',
  HTTPS: 'HTTPS',
  Bearer: 'Bearer',
  Alias: '别名',
  'Admin only': '管理员',
  VALUE: '价值',
  'Make model access reliable for your teams': '让模型接入成为团队可靠的基础设施',
  'From access control and cost transparency to provider routing, JetLinksAPI delivers the operating layer for enterprise API traffic.':
    '从访问控制、成本透明到供应商路由，JetLinksAPI 提供企业 API 流量的统一运行层。',
  'Unified entry, instant connectivity': '统一入口，即刻接入',
  'Connect every model provider with a single domain and key, while failover keeps your workloads running.':
    '用一个域名和一把密钥接入多个模型供应商，故障切换保障业务持续运行。',
  'Full-stack observability & risk controls': '全链路观测与风险控制',
  'Track usage, errors, and spend in real time, and configure throttles, alerts, and guardrails with one click.':
    '实时跟踪用量、错误和成本，一键配置限流、告警与安全护栏。',
  'Elastic scaling and cost control': '弹性扩展与成本控制',
  'Balance quotas across providers, route intelligently, and orchestrate batch jobs to optimize cost and concurrency.':
    '跨供应商平衡配额，智能路由并编排批任务，优化成本与并发。',
  'Built for developers': '面向开发者构建',
  'Compatible with standard chat, embedding, image, and audio endpoints, with examples and a web playground to accelerate iteration.':
    '兼容标准聊天、向量、图像与音频端点，提供示例与在线调试台，加速业务集成。',
  WORKFLOW: '流程',
  'Build your API control plane in three steps': '三步构建 API 控制平面',
  'Configure access': '配置接入',
  'Create channels, set keys and quotas, and import model catalogs from the console.':
    '创建供应商通道，配置密钥与配额，并在控制台导入模型目录。',
  'Smart dispatch': '智能分发',
  'Pick the best channel automatically using health, latency, and price signals with seamless failover.':
    '根据健康度、延迟和价格自动选择最佳通道，并支持无感故障切换。',
  'Continuous insight': '持续洞察',
  'Monitor trends, spend, and failure rates from dashboards, and trigger alerts to keep SLOs safe.':
    '通过仪表盘监控趋势、成本与失败率，并触发告警保障 SLO。',
  ECOSYSTEM: '生态',
  'Deep integration with leading model providers': '深度集成主流模型供应商',
  'Stay on a unified protocol, switch or extend models quickly, and plug into the newest ecosystem anytime.':
    '保持统一协议，快速切换或扩展模型，随时接入最新生态。',
  'Route internal model traffic through one gateway': '通过一个网关统一内部模型流量',
  'Use JetLinksAPI to centralize provider channels, model aliases, internal keys, quotas, and request observability for company workloads.':
    '使用 JetLinksAPI 集中管理供应商通道、模型别名、内部密钥、配额和请求观测。',
  '© 2026 GitHub YouLin': '© 2026 GitHub YouLin',
  'Internal API gateway': '内部 API 网关',
  'Welcome back': '欢迎回来',
  'Access keys, channels, billing, and model tests.': '管理密钥、通道、计费与模型测试。',
  'Super admin': '超级管理员',
  'Super admin account': '超级管理员账号',
  'Super admin credentials are required.': '需要使用超级管理员账号登录。',
  'Invalid super admin credentials.': '超级管理员账号或密码不正确。',
  'Console requires super admin sign in': '控制台需要超级管理员登录',
  'Use the super admin account to manage internal gateway configuration.': '请使用超级管理员账号管理内部网关配置。',
  'Signing in': '登录中',
  Password: '密码',
  'Enter your password': '输入密码',
  'Toggle password visibility': '切换密码可见性',
  Continue: '继续',
  'Please complete the required fields.': '请填写必填项。',
  'Unknown': '未知',
  Config: '配置',
  admin: '管理员',
  service: '服务',
  'Last used': '最近调用',
  'No recent use': '暂无调用',
  '2 minutes ago': '2 分钟前',
  Yesterday: '昨天',
  'No aliases mapped': '未映射别名',
  'Local mock': '本地模拟',
  'Env ready': '环境变量已配置',
  'Missing env': '缺少环境变量',
  'Credential ready': '凭据已配置',
  'Missing credential': '缺少凭据',
  'Connecting to local gateway...': '正在连接本地网关...',
  'Gateway data refreshed.': '网关数据已刷新。',
  'Gateway online - {providers} providers, {models} model aliases': '网关在线 - {providers} 个供应商，{models} 个模型别名',
  'Gateway offline': '网关离线',
  'Gateway connection failed': '网关连接失败',
  'Internal API key created. The secret is shown once in the table.': '内部 API Key 已创建，密钥只会在表格中显示一次。',
  'Internal API key updated.': '内部 API Key 已更新。',
  'Internal API key rotated and copied.': '内部 API Key 已重置并复制。',
  'API key deleted.': 'API Key 已删除。',
  'Provider channel saved.': '供应商通道已保存。',
  'Provider health check passed.': '供应商健康检查通过。',
  'Provider health check failed.': '供应商健康检查失败。',
  'Provider channel deleted.': '供应商通道已删除。',
  Overview: '概览',
  'API Keys': 'API Key',
  Channels: '通道',
  'Model mapping': '模型映射',
  Playground: '调试台',
  Billing: '计费',
  Profile: '个人中心',
  'Sign out': '退出登录',
  'JetLinksAPI Console': 'JetLinksAPI 控制台',
  'Search keys, channels, models': '搜索密钥、通道、模型',
  Notifications: '通知',
  'No new alerts.': '暂无新告警。',
  Refreshing: '刷新中',
  Refresh: '刷新',
  Saving: '保存中',
  'API gateway overview': 'API 网关概览',
  'API key management': 'API Key 管理',
  'Provider channels': '供应商通道',
  'Model availability testing': '模型映射',
  'Request playground': '请求调试台',
  'Spend and billing': '成本与计费',
  'Profile center': '个人中心',
  Account: '账号',
  'Change password': '修改密码',
  'Current password': '当前密码',
  'New password': '新密码',
  'Confirm new password': '确认新密码',
  'Password updated.': '密码已更新。',
  'Passwords do not match.': '两次输入的新密码不一致。',
  'New password must be at least 12 characters.': '新密码至少需要 12 位。',
  'New password must be different from the current password.': '新密码不能与当前密码相同。',
  'Current password is incorrect.': '当前密码不正确。',
  Console: '控制台',
  'Recent requests': '最近请求',
  'No data': '暂无数据',
  'Success rate': '成功率',
  'last 12 calls': '最近 12 次调用',
  'Active keys': '启用密钥',
  'internal auth': '内部鉴权',
  'Healthy channels': '健康通道',
  'provider routes': '供应商路由',
  'Live dispatch': '实时分发',
  'Recent gateway calls': '最近网关调用',
  request: '请求',
  'No gateway requests yet. Send one from the playground to populate this log.': '暂无网关请求。可从调试台发送一次请求生成日志。',
  'API keys': 'API Key',
  'Create key': '创建密钥',
  'Edit key': '编辑密钥',
  'Save key': '保存密钥',
  'Rotate and copy': '重置并复制',
  'Copy key': '复制密钥',
  'Current stored keys are masked. Rotate the key to copy a new full secret.': '当前已保存的密钥只显示掩码。如需完整密钥，请重置并复制。',
  'Key name': '密钥名称',
  'Rate limit per minute': '每分钟限制',
  Name: '名称',
  Secret: '密钥',
  Limit: '限制',
  Status: '状态',
  Actions: '操作',
  Created: '创建于',
  'Key copied to clipboard.': '密钥已复制到剪贴板。',
  'API key secret is not recoverable. Rotate the key to copy a new full secret.': '历史密钥无法恢复真实值，请重置后复制新的完整密钥。',
  'Add channel': '添加通道',
  'New provider channel': '新建供应商通道',
  'Edit provider channel': '编辑供应商通道',
  'Provider ID': '供应商 ID',
  'Provider name': '供应商名称',
  Type: '类型',
  'Protocol compatible': '协议兼容',
  'Mock provider': '模拟供应商',
  'API key env': 'API Key 环境变量',
  'API key': 'API Key',
  'Saved API key': '已保存 API Key',
  'Timeout ms': '超时时间 ms',
  'Max concurrency': '最大并发',
  'Enabled': '启用',
  'Save channel': '保存通道',
  Cancel: '取消',
  Edit: '编辑',
  Delete: '删除',
  'Delete provider channel?': '确定删除这个供应商通道？',
  'Check health': '健康检查',
  'Config check': '配置检查',
  'Live check': '真实检查',
  Configured: '配置就绪',
  'Not configured': '未配置',
  'Last check': '最近检查',
  'Config OK': '配置正常',
  'Live OK': '上游可达',
  'Check failed': '检查失败',
  'Upstream authentication failed. Check API key, workspace, and region.': '上游认证失败，请检查 API Key、业务空间与地域。',
  'Upstream endpoint or model not found. Check provider base URL and model endpoint support.': '上游接口或模型不存在，请检查 Base URL 与模型接口支持。',
  'Upstream request failed.': '上游请求失败。',
  Timeout: '超时',
  Concurrency: '并发',
  Models: '模型',
  'No provider channels configured.': '暂无供应商通道配置。',
  'Create a provider channel before saving model aliases.': '请先创建供应商通道，再保存模型别名。',
  'No gateway test credential is available.': '暂无可用的网关测试凭据。',
  'No providers available': '暂无可用供应商',
  'Environment variable name on the gateway server. Raw upstream keys are not submitted from the browser.':
    '网关服务器上的环境变量名。浏览器不会提交上游密钥明文。',
  'Enter an upstream API key directly, or provide an environment variable name on the gateway server. Saved keys are encrypted and are not shown again.':
    '可以直接填写上游 API Key，也可以填写网关服务器上的环境变量名。已保存的密钥会加密存储，不会再次明文显示。',
  'Use mock only for local tests. Production traffic should use protocol-compatible channels.':
    '模拟通道仅用于本地测试，生产流量应使用协议兼容通道。',
  'API key env is required for real providers.': '真实供应商需要填写 API Key 环境变量。',
  'API key or env is required for real providers.': '真实供应商需要填写 API Key 或环境变量名。',
  'Base URL is required for real providers.': '真实供应商需要填写 Base URL。',
  'Provider ID is required.': '请填写供应商 ID。',
  'Provider ID can only contain letters, numbers, dot, underscore, and hyphen.': '供应商 ID 只能包含字母、数字、点、下划线和短横线。',
  Latency: '延迟',
  Balance: '余额',
  Info: '信息',
  Enable: '启用',
  Pause: '暂停',
  enabled: '已启用',
  paused: '已暂停',
  'local provider': '本地供应商',
  Healthy: '健康',
  Degraded: '异常',
  Paused: '暂停',
  Active: '启用',
  Success: '成功',
  Slow: '较慢',
  Ready: '待测试',
  Testing: '测试中',
  'Model testing': '模型映射',
  'Save alias': '保存映射',
  'Save mapping': '保存映射',
  'New mapping': '新建映射',
  'Delete mapping': '删除映射',
  'Delete model mapping?': '确定删除这个模型映射？',
  'Model mapping deleted.': '模型映射已删除。',
  'Internal alias': '内部别名',
  Provider: '供应商',
  'Upstream model': '上游模型',
  'Endpoint types': '端点类型',
  Description: '描述',
  Use: '编辑',
  Test: '测试',
  'Internal services call the alias; JetLinksAPI rewrites it to the upstream model before proxying.':
    '内部业务调用模型别名，JetLinksAPI 会在代理前改写为上游模型。',
  'Model alias': '模型别名',
  saved: '已保存',
  failed: '失败',
  responded: '已响应',
  'Base URL': 'Base URL',
  Endpoint: '端点',
  Sending: '发送中',
  Send: '发送',
  'Request body': '请求体',
  Response: '响应',
  'Run a request to see the response.': '发送请求后查看响应。',
  'Gateway request completed.': '网关请求已完成。',
  'Request failed': '请求失败',
  'Estimated spend': '预估成本',
  'Gateway requests': '网关请求',
  'Token usage': 'Token 用量',
  'Billable usage': '计费用量',
  'Average latency': '平均延迟',
  'priced from request logs': '基于请求日志计价',
  'successful requests': '成功请求',
  'input/output tokens': '输入/输出 Token',
  'billable images': '计费图片',
  'billable requests': '计费请求',
  'failover requests': '故障切换请求',
  'Pricing is not configured yet.': '尚未配置模型单价。',
  'Real billing is calculated from gateway request logs and configured per-model token prices.':
    '真实成本基于网关请求日志和模型官方计费单位计算；图片按成功生成张数计费，失败请求不计费。',
  'Usage by model': '按模型统计',
  'Usage by provider': '按供应商统计',
  'Pricing configuration': '价格配置',
  'Official billing configuration': '官方计费配置',
  'Official billing preset': '官方计费预设',
  'Aliyun qwen-image-2.0-pro Beijing': '阿里云 qwen-image-2.0-pro 华北2北京',
  'Apply preset': '应用预设',
  'Billing unit': '计费单位',
  'Token': 'Token',
  Image: '图片',
  Request: '请求',
  'Price / image': '每张图片单价',
  'Price / successful request': '每次成功请求单价',
  'Official provider': '官方供应商',
  'Official model': '官方模型',
  'Source URL': '来源链接',
  Note: '备注',
  'Official price': '官方价格',
  'Official source': '官方来源',
  'per 1M tokens': '每百万 Token',
  'per image': '每张图片',
  'per successful request': '每次成功请求',
  'Images': '图片张数',
  'Billable units': '计费单位',
  'Model price saved.': '模型价格已保存。',
  'Model price deleted.': '模型价格已删除。',
  'Model alias is required.': '请填写模型别名。',
  'Price must be a non-negative number.': '价格必须是非负数字。',
  'Currency': '币种',
  'Input / 1M tokens': '输入 / 百万 Token',
  'Output / 1M tokens': '输出 / 百万 Token',
  'Save price': '保存价格',
  'No usage records yet.': '暂无用量记录。',
  'No pricing entries configured.': '暂无价格配置。',
  Requests: '请求数',
  Tokens: 'Token 数',
  Cost: '成本',
  'Input price': '输入价格',
  'Output price': '输出价格',
  'Image price': '图片价格',
  'Request price': '请求价格',
  input: '输入',
  output: '输出',
  tokens: 'tokens',
  'Page not found': '页面不存在',
  'Please check the browser address or return to the JetLinksAPI landing page.': '请检查浏览器地址，或返回 JetLinksAPI 首页。',
  'Back home': '返回首页',
  Dismiss: '关闭',
  'About JetLinksAPI': '关于 JetLinksAPI',
  'Unified model access': '统一模型接入',
  'Expose one compatible base URL for internal systems, then map business aliases to upstream provider models.':
    '为内部系统暴露一个兼容 Base URL，再把业务模型别名映射到上游供应商模型。',
  'Provider routing': '供应商路由',
  'Configure provider channels, health status, fallback priority, and model availability from the console.':
    '在控制台配置供应商通道、健康状态、故障切换优先级和模型可用性。',
  'Operational controls': '运维控制',
  'Use internal API keys, quotas, request logs, and playground tests to keep company workloads observable and governable.':
    '通过内部 API Key、配额、请求日志和调试台，让公司业务调用保持可观测、可治理。'
};

const I18nContext = createContext<I18nValue>({
  language: 'zh',
  setLanguage: () => undefined,
  t: (text) => zhMessages[text] || text
});

function useI18n() {
  return useContext(I18nContext);
}

function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const stored = localStorage.getItem('jetlinkapi-language');
    return stored === 'en' || stored === 'zh' ? stored : 'zh';
  });

  const setLanguage = (next: Language) => {
    localStorage.setItem('jetlinkapi-language', next);
    setLanguageState(next);
  };

  useEffect(() => {
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  }, [language]);

  const value = useMemo<I18nValue>(
    () => ({
      language,
      setLanguage,
      t: (text: string) => (language === 'zh' ? zhMessages[text] || text : text)
    }),
    [language]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

const gatewayEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const DEFAULT_GATEWAY_BASE_URL = ['5173', '5174'].includes(window.location.port) ? 'http://127.0.0.1:8787' : window.location.origin;
const GATEWAY_BASE_URL = (gatewayEnv.VITE_AI_GW_GATEWAY_URL || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
const DEFAULT_PUBLIC_BASE_URL = 'https://ai-gw.jetlinks.cn';
const INITIAL_PUBLIC_BASE_URL = normalizeDisplayBaseUrl(gatewayEnv.VITE_AI_GW_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL);
const ADMIN_API_KEY = gatewayEnv.VITE_AI_GW_ADMIN_KEY || '';
const SERVICE_API_KEY = gatewayEnv.VITE_AI_GW_SERVICE_KEY || '';
const SUPER_ADMIN_USERNAME = gatewayEnv.VITE_AI_GW_SUPER_ADMIN_USERNAME || 'admin';
const SUPER_ADMIN_NAME = gatewayEnv.VITE_AI_GW_SUPER_ADMIN_NAME || '超级管理员';
const USER_STORAGE_KEY = 'jetlinkapi-user';

function normalizeDisplayBaseUrl(value: string | undefined, fallback = DEFAULT_PUBLIC_BASE_URL) {
  const candidate = String(value || fallback).trim().replace(/\/+$/, '');
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return fallback;
    }
    parsed.hash = '';
    parsed.search = '';
    parsed.pathname = parsed.pathname.replace(/\/+$/, '');
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return fallback;
  }
}

function displayHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  }
}

function readStoredUser(): UserState | null {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<UserState>;
    return parsed.name ? { name: parsed.name, email: parsed.email || `${parsed.name}@jetlinksapi.local` } : null;
  } catch {
    localStorage.removeItem(USER_STORAGE_KEY);
    return null;
  }
}

async function gatewayRequest<T>(path: string, options: { method?: string; body?: unknown; apiKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const apiKey = options.apiKey || ADMIN_API_KEY;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    credentials: 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error || `Gateway request failed with ${response.status}`);
  }
  return data as T;
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const response = await fetch(`${GATEWAY_BASE_URL}/app-config`, {
    method: 'GET',
    cache: 'no-store'
  });
  if (!response.ok) {
    throw new Error(`Runtime config request failed with ${response.status}`);
  }
  const payload = await response.json().catch(() => ({})) as Partial<RuntimeConfig>;
  return {
    publicBaseUrl: normalizeDisplayBaseUrl(payload.publicBaseUrl, INITIAL_PUBLIC_BASE_URL)
  };
}

const endpoints = [
  '/v1/chat/completions',
  '/v1/responses',
  '/v1/messages',
  '/v1beta/models',
  '/v1/embeddings',
  '/v1/rerank',
  '/v1/images/generations',
  '/v1/images/edits',
  '/v1/images/variations',
  '/v1/audio/speech',
  '/v1/audio/transcriptions',
  '/v1/audio/translations'
];

function endpointKindFromPath(endpoint: string) {
  if (endpoint.includes('/chat/completions')) return 'chat';
  if (endpoint.includes('/responses')) return 'responses';
  if (endpoint.includes('/messages')) return 'messages';
  if (endpoint.includes('/embeddings')) return 'embeddings';
  if (endpoint.includes('/rerank')) return 'rerank';
  if (endpoint.includes('/images/')) return 'images';
  if (endpoint.includes('/audio/')) return 'audio';
  if (endpoint.includes('/models')) return 'models';
  return 'generic';
}

function endpointForModel(model?: GatewayModel) {
  const modelEndpoints = model?.endpoints || [];
  if (modelEndpoints.includes('images')) return '/v1/images/generations';
  if (modelEndpoints.includes('embeddings')) return '/v1/embeddings';
  if (modelEndpoints.includes('chat')) return '/v1/chat/completions';
  if (modelEndpoints.includes('messages')) return '/v1/messages';
  if (modelEndpoints.includes('responses')) return '/v1/responses';
  return '/v1/chat/completions';
}

function requestBodyForEndpoint(endpoint: string, modelAlias: string) {
  const kind = endpointKindFromPath(endpoint);
  if (kind === 'images') {
    return {
      model: modelAlias,
      prompt: 'A clean product-style illustration of JetLinksAPI',
      n: 1,
      size: '1024x1024'
    };
  }
  if (kind === 'embeddings') {
    return {
      model: modelAlias,
      input: 'Hello JetLinksAPI'
    };
  }
  if (kind === 'responses') {
    return {
      model: modelAlias,
      input: 'Hello JetLinksAPI'
    };
  }
  return {
    model: modelAlias,
    messages: [{ role: 'user', content: 'Hello JetLinksAPI' }]
  };
}

const featureCards = [
  {
    icon: <Cloud size={22} />,
    title: 'Unified entry, instant connectivity',
    body: 'Connect every model provider with a single domain and key, while failover keeps your workloads running.'
  },
  {
    icon: <ShieldCheck size={22} />,
    title: 'Full-stack observability & risk controls',
    body: 'Track usage, errors, and spend in real time, and configure throttles, alerts, and guardrails with one click.'
  },
  {
    icon: <CircleDollarSign size={22} />,
    title: 'Elastic scaling and cost control',
    body: 'Balance quotas across providers, route intelligently, and orchestrate batch jobs to optimize cost and concurrency.'
  },
  {
    icon: <Code2 size={22} />,
    title: 'Built for developers',
    body: 'Compatible with standard chat, embedding, image, and audio endpoints, with examples and a web playground to accelerate iteration.'
  }
];

const providers = [
  'OpenAI',
  'Claude',
  'Claude Code',
  'Gemini',
  'Azure OpenAI',
  'DeepSeek',
  'Grok',
  'Mistral',
  'Cohere',
  'Jina',
  'MiniMax',
  'Qwen'
];

const starterChannels: Channel[] = [];
const starterKeys: ApiKey[] = [];

const legalPages: Record<string, { title: string; eyebrow: string; sections: Array<[string, string]> }> = {
  about: {
    title: 'About JetLinksAPI',
    eyebrow: 'Internal API gateway',
    sections: [
      ['Unified model access', 'Expose one compatible base URL for internal systems, then map business aliases to upstream provider models.'],
      ['Provider routing', 'Configure provider channels, health status, fallback priority, and model availability from the console.'],
      ['Operational controls', 'Use internal API keys, quotas, request logs, and playground tests to keep company workloads observable and governable.']
    ]
  }
};

function routeFromPath(pathname: string): Route {
  const clean = pathname.replace(/^\/+/, '') || 'home';
  const known: Route[] = [
    'login',
    'console',
    'about'
  ];
  return known.includes(clean as Route) ? (clean as Route) : clean === 'home' ? 'home' : 'not-found';
}

function App() {
  return (
    <I18nProvider>
      <AppRoutes />
    </I18nProvider>
  );
}

function AppRoutes() {
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  const [user, setUser] = useState<UserState | null>(() => readStoredUser());
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>(() => ({
    publicBaseUrl: INITIAL_PUBLIC_BASE_URL
  }));

  useEffect(() => {
    const onPop = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadRuntimeConfig()
      .then((nextConfig) => {
        if (!cancelled) {
          setRuntimeConfig(nextConfig);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${GATEWAY_BASE_URL}/admin/session`, { credentials: 'include' })
      .then(async (response) => {
        if (cancelled) {
          return;
        }
        if (response.ok) {
          const payload = await response.json().catch(() => ({}));
          const nextUser = {
            name: payload.user?.name || SUPER_ADMIN_NAME,
            email: `${(payload.user?.username || SUPER_ADMIN_USERNAME).toLowerCase()}@jetlinksapi.local`
          };
          localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
          setUser(nextUser);
          return;
        }
        if (response.status === 401) {
          localStorage.removeItem(USER_STORAGE_KEY);
          setUser(null);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = (next: Route) => {
    const path = next === 'home' ? '/' : `/${next}`;
    window.history.pushState({}, '', path);
    setRoute(next);
    window.scrollTo({ top: 0 });
  };

  const signIn = (name: string) => {
    const nextUser = { name, email: `${name.toLowerCase().replace(/\s+/g, '.')}@jetlinksapi.local` };
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(nextUser));
    setUser(nextUser);
    navigate('console');
  };

  const signOut = () => {
    void fetch(`${GATEWAY_BASE_URL}/admin/session`, {
      method: 'DELETE',
      credentials: 'include'
    }).catch(() => undefined);
    localStorage.removeItem(USER_STORAGE_KEY);
    setUser(null);
    navigate('home');
  };

  if (route === 'login') {
    return <AuthPage onNavigate={navigate} onSignIn={signIn} />;
  }

  if (route === 'console') {
    return <ConsolePage user={user} onNavigate={navigate} onSignOut={signOut} />;
  }

  if (route === 'not-found') {
    return <NotFound onNavigate={navigate} />;
  }

  if (route !== 'home') {
    return <LegalPage page={route} onNavigate={navigate} user={user} onSignOut={signOut} />;
  }

  return <HomePage onNavigate={navigate} user={user} onSignOut={signOut} publicBaseUrl={runtimeConfig.publicBaseUrl} />;
}

function Header({
  onNavigate,
  user,
  onSignOut
}: {
  onNavigate: (route: Route) => void;
  user?: UserState | null;
  onSignOut?: () => void;
}) {
  const { language, setLanguage, t } = useI18n();
  const [open, setOpen] = useState(false);
  const go = (route: Route) => {
    setOpen(false);
    onNavigate(route);
  };

  return (
    <header className="site-header">
      <button className="logo-button" type="button" onClick={() => go('home')} aria-label={t('JetLinksAPI home')}>
        <img src="/logo-full.svg" alt="JetLinksAPI" />
      </button>
      <nav className={open ? 'top-nav open' : 'top-nav'}>
        <button type="button" onClick={() => go('about')}>
          {t('About')}
        </button>
      </nav>
      <div className="header-actions">
        <button
          className="locale-pill"
          type="button"
          title={t('Language')}
          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
        >
          {language === 'zh' ? 'EN' : '中'}
        </button>
        {user ? (
          <>
            <button className="header-user-chip" type="button" onClick={() => go('console')} title={t('Signed in as super admin')}>
              <User size={16} />
              <span>{user.name}</span>
            </button>
            <button className="icon-button" type="button" onClick={onSignOut} title={t('Sign out')} aria-label={t('Sign out')}>
              <LogOut size={17} />
            </button>
          </>
        ) : (
          <button className="button ghost compact" type="button" onClick={() => go('login')}>
            {t('Sign in')}
          </button>
        )}
        <button className="icon-button menu-button" type="button" onClick={() => setOpen(!open)} aria-label={t('Open menu')}>
          {open ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>
    </header>
  );
}

function HomePage({
  onNavigate,
  user,
  onSignOut,
  publicBaseUrl
}: {
  onNavigate: (route: Route) => void;
  user: UserState | null;
  onSignOut: () => void;
  publicBaseUrl: string;
}) {
  const { t } = useI18n();
  const [toast, setToast] = useState('');
  const integrationUrl = publicBaseUrl;
  const integrationHost = displayHost(publicBaseUrl);

  const copyIntegrationUrl = async () => {
    try {
      await writeClipboard(integrationUrl);
      setToast(t('Gateway root URL copied.'));
    } catch {
      setToast(t('Copy failed. Please copy it manually.'));
    }
  };

  return (
    <div className="public-shell">
      <Header onNavigate={onNavigate} user={user} onSignOut={onSignOut} />
      <main className="snap-container">
        <section className="hero-section snap-panel">
          <div className="hero-bg-grid" />
          <div className="hero-layout">
            <div className="hero-copy">
              <div className="eyebrow">{t('ENTERPRISE MODEL ACCESS')}</div>
              <h1>
                {t('The unified model API gateway')}
                <span>{t('for enterprise systems')}</span>
              </h1>
              <p>
                {t('Connect model providers with one domain, one key, and clear risk controls so every service stays observable, scalable, and governed.')}
              </p>
              <div className="endpoint-card">
                <strong>{t('SWAP THE BASE URL TO START INTEGRATING')}</strong>
                <div className="endpoint-pill">
                  <code className="endpoint-origin">{publicBaseUrl}</code>
                  <div className="endpoint-path-ticker" aria-hidden="true">
                    <code className="endpoint-path">/v1/chat/completions</code>
                  </div>
                  <button type="button" onClick={copyIntegrationUrl} aria-label={t('Copy gateway root URL')} title={t('Copy gateway root URL')}>
                    <Copy size={18} />
                  </button>
                </div>
              </div>
              <div className="hero-actions">
                <button className="button primary" type="button" onClick={() => onNavigate('console')}>
                  <KeyRound size={18} />
                  {t('Open console')}
                </button>
              </div>
              <div className="hero-stats">
                <Metric value="HTTPS" label={t('BASE URL')} />
                <Metric value="Bearer" label={t('API KEY')} />
                <Metric value={t('Alias')} label={t('MODEL ALIAS')} />
              </div>
            </div>
            <div className="ops-panel" aria-label={t('Gateway operations preview')}>
              <div className="ops-header">
                <span>{integrationHost}</span>
                <BadgeCheck size={18} />
              </div>
              <GatewayRow title={t('Unified base URL')} text={t('OpenAI-compatible /v1 endpoints')} value="HTTPS" />
              <GatewayRow title={t('API key authentication')} text={t('Authorization header is required')} value="Bearer" />
              <GatewayRow title={t('Admin-only metrics')} text={t('Health and metrics avoid public details')} value={t('Admin only')} />
              <div className="code-block">
                <span>curl {publicBaseUrl}/v1/chat/completions</span>
                <span>-H "Authorization: Bearer &lt;API_KEY&gt;"</span>
                <span>-d '&#123;"model":"jetlinks-chat","stream":true&#125;'</span>
              </div>
            </div>
          </div>
          {toast && <Toast message={toast} onClose={() => setToast('')} />}
        </section>

        <section className="snap-panel section-panel">
          <SectionIntro eyebrow={t('VALUE')} title={t('Make model access reliable for your teams')}>
            {t('From access control and cost transparency to provider routing, JetLinksAPI delivers the operating layer for enterprise API traffic.')}
          </SectionIntro>
          <div className="feature-grid">
            {featureCards.map((feature) => (
              <article className="feature-card" key={feature.title}>
                <div className="feature-icon">{feature.icon}</div>
                <h3>{t(feature.title)}</h3>
                <p>{t(feature.body)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="snap-panel section-panel">
          <SectionIntro eyebrow={t('WORKFLOW')} title={t('Build your API control plane in three steps')} />
          <div className="workflow-grid">
            {[
              ['01', 'Configure access', 'Create channels, set keys and quotas, and import model catalogs from the console.'],
              ['02', 'Smart dispatch', 'Pick the best channel automatically using health, latency, and price signals with seamless failover.'],
              ['03', 'Continuous insight', 'Monitor trends, spend, and failure rates from dashboards, and trigger alerts to keep SLOs safe.']
            ].map(([step, title, body]) => (
              <article className="workflow-card" key={step}>
                <span>{step}</span>
                <h3>{t(title)}</h3>
                <p>{t(body)}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="snap-panel section-panel ecosystem-panel">
          <SectionIntro eyebrow={t('ECOSYSTEM')} title={t('Deep integration with leading model providers')}>
            {t('Stay on a unified protocol, switch or extend models quickly, and plug into the newest ecosystem anytime.')}
          </SectionIntro>
          <div className="provider-grid">
            {providers.map((provider) => (
              <div className="provider-chip" key={provider}>
                <span>{provider.slice(0, 1)}</span>
                {provider}
              </div>
            ))}
          </div>
        </section>

        <section className="snap-panel final-panel">
          <div className="cta-band">
            <h2>{t('Route internal model traffic through one gateway')}</h2>
            <p>{t('Use JetLinksAPI to centralize provider channels, model aliases, internal keys, quotas, and request observability for company workloads.')}</p>
            <div className="hero-actions centered">
              <button className="button primary" type="button" onClick={() => onNavigate('console')}>
                <ArrowRight size={18} />
                {t('Open console')}
              </button>
            </div>
          </div>
          <Footer />
        </section>
      </main>
    </div>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function GatewayRow({ title, text, value }: { title: string; text: string; value: string }) {
  return (
    <div className="gateway-row">
      <div>
        <b>{title}</b>
        <span>{text}</span>
      </div>
      <em>{value}</em>
    </div>
  );
}

function SectionIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="section-intro">
      <span>{eyebrow}</span>
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}

function Footer() {
  const { t } = useI18n();
  return (
    <footer className="footer">
      <div className="footer-meta">
        <span>{t('© 2026 GitHub YouLin')}</span>
        <a href="https://github.com/holt230/ai-llm-gateway/blob/main/LICENSE" target="_blank" rel="noreferrer">
          AGPL-3.0-only
        </a>
      </div>
    </footer>
  );
}

function AuthPage({
  onNavigate,
  onSignIn
}: {
  onNavigate: (route: Route) => void;
  onSignIn: (name: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({ username: SUPER_ADMIN_USERNAME, password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [toast, setToast] = useState('');
  const [signingIn, setSigningIn] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.username || !form.password) {
      setToast(t('Please complete the required fields.'));
      return;
    }
    setSigningIn(true);
    try {
      const response = await fetch(`${GATEWAY_BASE_URL}/admin/session`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          username: form.username,
          password: form.password
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || t('Invalid super admin credentials.'));
      }
      onSignIn(payload.user?.name || SUPER_ADMIN_NAME);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setSigningIn(false);
    }
  };

  return (
    <div className="auth-shell">
      <button className="logo-button auth-logo" type="button" onClick={() => onNavigate('home')}>
        <img src="/logo-full.svg" alt="JetLinksAPI" />
      </button>
      <div className="auth-card">
        <div className="auth-heading">
          <span>{t('Internal API gateway')}</span>
          <h1>{t('Sign in')}</h1>
          <p>{t('Super admin credentials are required.')}</p>
        </div>
        <form onSubmit={submit}>
          <Label icon={<User size={18} />} label={t('Super admin account')}>
            <input
              autoComplete="username"
              value={form.username}
              placeholder={SUPER_ADMIN_USERNAME}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
            />
          </Label>
          <Label icon={<LockKeyhole size={18} />} label={t('Password')}>
            <div className="password-input">
              <input
                autoComplete="current-password"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                placeholder={t('Enter your password')}
                onChange={(event) => setForm({ ...form, password: event.target.value })}
              />
              <button type="button" onClick={() => setShowPassword(!showPassword)} aria-label={t('Toggle password visibility')}>
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </Label>
          <button className="button primary full" type="submit" disabled={signingIn}>
            <ArrowRight size={18} />
            {signingIn ? t('Signing in') : t('Continue')}
          </button>
        </form>
      </div>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function Label({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <label className="field-label">
      <span>
        {icon}
        {label}
      </span>
      {children}
    </label>
  );
}

function formatDateLabel(value?: string, fallback = 'Unknown') {
  if (!value) {
    return fallback;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toISOString().slice(0, 10);
}

async function writeClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.top = '-1000px';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('copy failed');
  }
}

function mapApiKey(item: GatewayApiKey): ApiKey {
  return {
    id: item.id,
    name: item.name || item.id,
    value: item.keyPreview || item.key || '***',
    role: item.role || 'service',
    created: formatDateLabel(item.createdAt, 'Config'),
    lastUsed: item.lastUsedAt ? formatDateLabel(item.lastUsedAt) : 'No recent use',
    limit: `${item.perMinute ?? 0} / min`,
    perMinute: item.perMinute ?? 0,
    enabled: item.enabled !== false,
    status: item.enabled === false ? 'Paused' : 'Active'
  };
}

function mapChannels(providers: Record<string, GatewayProvider>, models: Record<string, GatewayModel>): Channel[] {
  return Object.entries(providers).map(([id, provider], index) => {
    const relatedModels = Object.entries(models)
      .filter(([, model]) => model.provider === id)
      .map(([alias, model]) => `${alias} -> ${model.upstreamModel}`);
    const healthy = provider.enabled !== false && (provider.type === 'mock' || provider.apiKeyConfigured !== false);
    const paused = provider.enabled === false;
    return {
      id,
      name: provider.name || id,
      provider: provider.type || 'provider',
      models: relatedModels.length ? relatedModels.join(', ') : 'No aliases mapped',
      latency: 360 + index * 80,
      success: healthy ? 99.9 - index * 0.08 : 0,
      balance: provider.type === 'mock' ? 'Local mock' : provider.apiKeyConfigured ? 'Credential ready' : 'Missing credential',
      status: paused ? 'Paused' : healthy ? 'Healthy' : 'Degraded',
      type: provider.type,
      apiKeyConfigured: provider.apiKeyConfigured,
      apiKeyPreview: provider.apiKeyPreview,
      baseUrl: provider.baseUrl,
      apiKeyEnv: provider.apiKeyEnv,
      timeoutMs: provider.timeoutMs,
      maxConcurrency: provider.maxConcurrency
    };
  });
}

function mapModelRows(models: Record<string, GatewayModel>): ModelRow[] {
  return Object.entries(models).map(([alias, model]) => ({ alias, model }));
}

function apiKeyLastUsedLabel(value: string, t: (text: string) => string) {
  if (value === 'No recent use') {
    return t(value);
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${t('Last used')} ${value}`;
  }
  return t(value);
}

function providerHealthMessage(health: ProviderHealth, t: (text: string) => string) {
  if (health.status === 401) {
    return t('Upstream authentication failed. Check API key, workspace, and region.');
  }
  if (health.status === 404) {
    return t('Upstream endpoint or model not found. Check provider base URL and model endpoint support.');
  }
  return t(health.message || 'Upstream request failed.');
}

function ConsolePage({
  user,
  onNavigate,
  onSignOut
}: {
  user: UserState | null;
  onNavigate: (route: Route) => void;
  onSignOut: () => void;
}) {
  const { language, t } = useI18n();
  const [view, setView] = useState<'overview' | 'keys' | 'channels' | 'models' | 'playground' | 'billing' | 'profile'>('overview');
  const [keys, setKeys] = useState<ApiKey[]>(starterKeys);
  const [channels, setChannels] = useState<Channel[]>(starterChannels);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [gatewayStatus, setGatewayStatus] = useState(t('Connecting to local gateway...'));
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [serviceApiKey, setServiceApiKey] = useState(SERVICE_API_KEY);

  const refreshGateway = async (silent = false) => {
    setRefreshing(true);
    try {
      const [providersResult, modelsResult, keysResult, requestsResult] = await Promise.all([
        gatewayRequest<{ data: Record<string, GatewayProvider> }>('/admin/providers'),
        gatewayRequest<{ data: Record<string, GatewayModel> }>('/admin/models'),
        gatewayRequest<{ data: GatewayApiKey[] }>('/admin/api-keys'),
        gatewayRequest<{ data: RequestLog[] }>('/admin/requests?limit=12')
      ]);
      const providerMap = providersResult.data || {};
      const modelMap = modelsResult.data || {};
      setChannels(mapChannels(providerMap, modelMap));
      setModels(mapModelRows(modelMap));
      setKeys((keysResult.data || []).map(mapApiKey));
      setRequests(requestsResult.data || []);
      setGatewayStatus(
        t('Gateway online - {providers} providers, {models} model aliases')
          .replace('{providers}', String(Object.keys(providerMap).length))
          .replace('{models}', String(Object.keys(modelMap).length))
      );
      if (!silent) {
        setToast(t('Gateway data refreshed.'));
      }
    } catch (error) {
      setGatewayStatus(`${t('Gateway offline')} - ${(error as Error).message}`);
      if (!silent) {
        setToast(`${t('Gateway connection failed')}: ${(error as Error).message}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) {
      void refreshGateway(true);
    }
  }, [user, language]);

  if (!user) {
    return (
      <div className="console-guard">
        <img src="/logo-full.svg" alt="JetLinksAPI" />
        <h1>{t('Console requires super admin sign in')}</h1>
        <p>{t('Use the super admin account to manage internal gateway configuration.')}</p>
        <div className="hero-actions centered">
          <button className="button primary" type="button" onClick={() => onNavigate('login')}>
            {t('Sign in')}
          </button>
        </div>
      </div>
    );
  }

  const createKey = async () => {
    try {
      const result = await gatewayRequest<{ key: GatewayApiKey; secret: string }>('/admin/api-keys', {
        method: 'POST',
        body: {
          name: `Internal service ${keys.length + 1}`,
          role: 'service',
          perMinute: 120
        }
      });
      setKeys((current) => [{ ...mapApiKey(result.key), value: result.secret }, ...current]);
      setServiceApiKey(result.secret);
      setToast(t('Internal API key created. The secret is shown once in the table.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const updateKey = async (form: ApiKeyFormState) => {
    try {
      const perMinute = Number(form.perMinute || 0);
      if (!form.name.trim()) {
        throw new Error(t('Key name') + ' ' + t('Please complete the required fields.'));
      }
      if (!Number.isFinite(perMinute) || perMinute < 0) {
        throw new Error(t('Rate limit per minute') + ' ' + t('Please complete the required fields.'));
      }
      const result = await gatewayRequest<{ key: GatewayApiKey; secret?: string }>(`/admin/api-keys/${encodeURIComponent(form.id)}`, {
        method: 'PUT',
        body: {
          name: form.name.trim(),
          perMinute,
          enabled: form.enabled
        }
      });
      const nextKey = mapApiKey(result.key);
      setKeys((current) => current.map((key) => (key.id === form.id ? { ...nextKey, value: key.value } : key)));
      setToast(t('Internal API key updated.'));
      return true;
    } catch (error) {
      setToast((error as Error).message);
      return false;
    }
  };

  const rotateKey = async (key: ApiKey) => {
    try {
      const result = await gatewayRequest<{ key: GatewayApiKey; secret?: string }>(`/admin/api-keys/${encodeURIComponent(key.id)}`, {
        method: 'PUT',
        body: {
          name: key.name,
          role: key.role,
          perMinute: key.perMinute,
          enabled: key.enabled,
          rotate: true
        }
      });
      const nextSecret = result.secret || '';
      const nextKey = mapApiKey(result.key);
      setKeys((current) => current.map((item) => (item.id === key.id ? { ...nextKey, value: nextSecret || nextKey.value } : item)));
      if (nextSecret && key.role === 'service') {
        setServiceApiKey(nextSecret);
      }
      if (nextSecret) {
        await writeClipboard(nextSecret);
      }
      setToast(nextSecret ? t('Internal API key rotated and copied.') : t('Internal API key updated.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const deleteKey = async (id: string) => {
    try {
      await gatewayRequest(`/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
      setKeys((current) => current.filter((key) => key.id !== id));
      setToast(t('API key deleted.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const changePassword = async (form: PasswordFormState) => {
    try {
      if (form.newPassword.length < 12) {
        throw new Error(t('New password must be at least 12 characters.'));
      }
      if (form.newPassword !== form.confirmPassword) {
        throw new Error(t('Passwords do not match.'));
      }
      const response = await fetch(`${GATEWAY_BASE_URL}/admin/session/password`, {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          currentPassword: form.currentPassword,
          newPassword: form.newPassword
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.error || `Gateway request failed with ${response.status}`);
      }
      setToast(t('Password updated.'));
      return true;
    } catch (error) {
      setToast(t((error as Error).message));
      return false;
    }
  };

  const saveChannel = async (form: ChannelFormState) => {
    const id = form.id.trim();
    const type = form.type;
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();
    const apiKeyEnv = form.apiKeyEnv.trim();
    try {
      if (!id) {
        throw new Error(t('Provider ID is required.'));
      }
      if (!/^[A-Za-z0-9._-]+$/.test(id)) {
        throw new Error(t('Provider ID can only contain letters, numbers, dot, underscore, and hyphen.'));
      }
      if (type === 'openai-compatible' && !baseUrl) {
        throw new Error(t('Base URL is required for real providers.'));
      }
      if (type === 'openai-compatible' && !apiKey && !apiKeyEnv && !form.apiKeyConfigured) {
        throw new Error(t('API key or env is required for real providers.'));
      }
      await gatewayRequest(`/admin/providers/${encodeURIComponent(id)}`, {
        method: 'PUT',
        body: {
          name: form.name.trim() || id,
          type,
          baseUrl: type === 'openai-compatible' ? baseUrl : undefined,
          apiKey: type === 'openai-compatible' && apiKey ? apiKey : undefined,
          apiKeyEnv: type === 'openai-compatible' ? apiKeyEnv : undefined,
          timeoutMs: type === 'openai-compatible' ? Number(form.timeoutMs || 120000) : undefined,
          maxConcurrency: Number(form.maxConcurrency || 0),
          enabled: form.enabled
        }
      });
      await refreshGateway(true);
      setToast(t('Provider channel saved.'));
      return true;
    } catch (error) {
      setToast((error as Error).message);
      return false;
    }
  };

  const checkChannelHealth = async (id: string, live = false): Promise<ProviderHealth | null> => {
    try {
      const result = await gatewayRequest<ProviderHealth>(`/admin/providers/${encodeURIComponent(id)}/health${live ? '?live=true' : ''}`);
      const status = result.status ? ` HTTP ${result.status}` : '';
      const duration = result.durationMs !== undefined ? ` ${result.durationMs}ms` : '';
      setToast(`${result.ok ? t('Provider health check passed.') : t('Provider health check failed.')} ${providerHealthMessage(result, t)}${status}${duration}`);
      return result;
    } catch (error) {
      setToast((error as Error).message);
      return null;
    }
  };

  const deleteChannel = async (id: string) => {
    try {
      await gatewayRequest(`/admin/providers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await refreshGateway(true);
      setToast(t('Provider channel deleted.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const toggleChannel = async (channel: Channel) => {
    try {
      await gatewayRequest(`/admin/providers/${encodeURIComponent(channel.id)}`, {
        method: 'PUT',
        body: {
          name: channel.name,
          type: channel.type || 'mock',
          baseUrl: channel.baseUrl,
          apiKeyEnv: channel.type === 'openai-compatible' ? channel.apiKeyEnv || undefined : undefined,
          enabled: channel.status === 'Paused'
        }
      });
      await refreshGateway(true);
      setToast(`${channel.name} ${channel.status === 'Paused' ? t('enabled') : t('paused')}.`);
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  return (
    <div className="console-shell">
      <aside className="sidebar">
        <button className="logo-button side-logo" type="button" onClick={() => onNavigate('home')}>
          <img src="/logo-full-inverse.svg" alt="JetLinksAPI" />
        </button>
        <nav>
          <ConsoleNav icon={<BarChart3 size={18} />} label={t('Overview')} active={view === 'overview'} onClick={() => setView('overview')} />
          <ConsoleNav icon={<KeyRound size={18} />} label={t('API Keys')} active={view === 'keys'} onClick={() => setView('keys')} />
          <ConsoleNav icon={<Network size={18} />} label={t('Channels')} active={view === 'channels'} onClick={() => setView('channels')} />
          <ConsoleNav icon={<Layers3 size={18} />} label={t('Model mapping')} active={view === 'models'} onClick={() => setView('models')} />
          <ConsoleNav icon={<Play size={18} />} label={t('Playground')} active={view === 'playground'} onClick={() => setView('playground')} />
          <ConsoleNav icon={<CreditCard size={18} />} label={t('Billing')} active={view === 'billing'} onClick={() => setView('billing')} />
          <ConsoleNav icon={<User size={18} />} label={t('Profile')} active={view === 'profile'} onClick={() => setView('profile')} />
        </nav>
        <button className="button soft full" type="button" onClick={onSignOut}>
          <LogOut size={18} />
          {t('Sign out')}
        </button>
      </aside>
      <main className="console-main">
        <div className="console-topbar">
          <div>
            <span>{t('JetLinksAPI Console')}</span>
            <h1>{t(viewTitle(view))}</h1>
          </div>
          <div className="topbar-actions">
            <div className="search-box">
              <Search size={16} />
              <input placeholder={t('Search keys, channels, models')} />
            </div>
            <button className="icon-button" type="button" title={t('Notifications')} onClick={() => setToast(t('No new alerts.'))}>
              <Bell size={18} />
            </button>
            <button className="user-chip" type="button" onClick={() => setView('profile')} title={t('Profile')}>
              <User size={16} />
              {user.name}
            </button>
            <button className="button soft" type="button" onClick={() => refreshGateway()} disabled={refreshing}>
              <RefreshCcw size={16} />
              {refreshing ? t('Refreshing') : t('Refresh')}
            </button>
          </div>
        </div>
        {view === 'overview' && <Overview channels={channels} keys={keys} requests={requests} gatewayStatus={gatewayStatus} />}
        {view === 'keys' && <KeysView keys={keys} onCreate={createKey} onSave={updateKey} onRotate={rotateKey} onDelete={deleteKey} onToast={setToast} />}
        {view === 'channels' && <ChannelsView channels={channels} onSave={saveChannel} onToggle={toggleChannel} onDelete={deleteChannel} onCheckHealth={checkChannelHealth} />}
        {view === 'models' && <ModelTestView channels={channels} models={models} serviceApiKey={serviceApiKey} onRefresh={() => refreshGateway(true)} onToast={setToast} />}
        {view === 'playground' && <PlaygroundView models={models} serviceApiKey={serviceApiKey} onToast={setToast} />}
        {view === 'billing' && <BillingView />}
        {view === 'profile' && <ProfileView user={user} onChangePassword={changePassword} />}
      </main>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function ConsoleNav({ icon, label, active, onClick }: { icon: ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={active ? 'active' : ''} type="button" onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function viewTitle(view: string) {
  const names: Record<string, string> = {
    overview: 'API gateway overview',
    keys: 'API key management',
    channels: 'Provider channels',
    models: 'Model mapping',
    playground: 'Request playground',
    billing: 'Spend and billing',
    profile: 'Profile center'
  };
  return names[view] || 'Console';
}

function ProfileView({
  user,
  onChangePassword
}: {
  user: UserState;
  onChangePassword: (form: PasswordFormState) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<PasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);

  const updateForm = (patch: Partial<PasswordFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    const saved = await onChangePassword(form);
    setSaving(false);
    if (saved) {
      setForm({ currentPassword: '', newPassword: '', confirmPassword: '' });
    }
  };

  return (
    <div className="console-stack">
      <section className="panel">
        <PanelTitle icon={<User size={18} />} title={t('Account')} />
        <div className="profile-summary">
          <div className="user-avatar">
            <User size={18} />
          </div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </div>
        </div>
      </section>
      <section className="panel">
        <PanelTitle icon={<LockKeyhole size={18} />} title={t('Change password')} />
        <form className="key-editor" onSubmit={submit}>
          <div className="form-grid">
            <label>
              {t('Current password')}
              <input
                type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) => updateForm({ currentPassword: event.target.value })}
              />
            </label>
            <label>
              {t('New password')}
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={form.newPassword}
                onChange={(event) => updateForm({ newPassword: event.target.value })}
              />
            </label>
            <label>
              {t('Confirm new password')}
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                value={form.confirmPassword}
                onChange={(event) => updateForm({ confirmPassword: event.target.value })}
              />
            </label>
          </div>
          <div className="row-actions">
            <button className="button primary" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Change password')}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function Overview({
  channels,
  keys,
  requests,
  gatewayStatus
}: {
  channels: Channel[];
  keys: ApiKey[];
  requests: RequestLog[];
  gatewayStatus: string;
}) {
  const { t } = useI18n();
  const healthy = channels.filter((channel) => channel.status === 'Healthy').length;
  const successful = requests.filter((request) => request.status < 400).length;
  const successRate = requests.length ? `${((successful / requests.length) * 100).toFixed(1)}%` : t('No data');
  const avgDuration = requests.length
    ? `${Math.round(requests.reduce((total, request) => total + request.durationMs, 0) / requests.length)}ms`
    : t('No data');
  return (
    <div className="console-stack">
      <div className="metric-grid">
        <ConsoleMetric icon={<Activity />} label={t('Recent requests')} value={String(requests.length)} trend={avgDuration} />
        <ConsoleMetric icon={<LineChart />} label={t('Success rate')} value={successRate} trend={t('last 12 calls')} />
        <ConsoleMetric icon={<DatabaseZap />} label={t('Active keys')} value={String(keys.filter((key) => key.status === 'Active').length)} trend={t('internal auth')} />
        <ConsoleMetric icon={<Boxes />} label={t('Healthy channels')} value={`${healthy}/${channels.length}`} trend={t('provider routes')} />
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <PanelTitle icon={<Workflow size={18} />} title={t('Live dispatch')} />
          <p className="panel-note">{gatewayStatus}</p>
          <div className="route-map">
            {channels.map((channel, index) => (
              <div className="route-line" key={channel.id}>
                <span>{index + 1}</span>
                <div>
                  <b>{channel.name}</b>
                  <small>
                    {t(channel.type === 'mock' ? 'Mock provider' : channel.type === 'openai-compatible' ? 'Protocol compatible' : channel.provider)} - {channel.latency}ms - {formatPercent(channel.success)}
                  </small>
                </div>
                <StatusBadge status={channel.status} />
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={<BarChart3 size={18} />} title={t('Recent gateway calls')} />
          <div className="model-grid">
            {requests.length ? (
              requests.slice(0, 6).map((request) => (
                <div className="model-row" key={request.requestId}>
                  <span>
                    <b>{request.modelAlias || request.endpoint || t('request')}</b>
                    <small>{request.provider || request.apiKeyId || request.requestId}</small>
                  </span>
                  <StatusBadge status={request.status < 400 ? 'Success' : 'Degraded'} />
                  <span>{request.durationMs}ms</span>
                </div>
              ))
            ) : (
              <p className="panel-note">{t('No gateway requests yet. Send one from the playground to populate this log.')}</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ConsoleMetric({ icon, label, value, trend }: { icon: ReactNode; label: string; value: string; trend: string }) {
  return (
    <section className="metric-tile">
      <div className="tile-icon">{icon}</div>
      <span>{label}</span>
      <strong>{value}</strong>
      <em>{trend}</em>
    </section>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="panel-title">
      {icon}
      <h2>{title}</h2>
    </div>
  );
}

function KeysView({
  keys,
  onCreate,
  onSave,
  onRotate,
  onDelete,
  onToast
}: {
  keys: ApiKey[];
  onCreate: () => void;
  onSave: (form: ApiKeyFormState) => Promise<boolean>;
  onRotate: (key: ApiKey) => Promise<void>;
  onDelete: (id: string) => void;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<ApiKeyFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (key: ApiKey) => {
    setForm({
      id: key.id,
      name: key.name,
      perMinute: String(key.perMinute),
      enabled: key.enabled
    });
  };

  const updateForm = (patch: Partial<ApiKeyFormState>) => {
    if (form) {
      setForm({ ...form, ...patch });
    }
  };

  const copyKey = async (key: ApiKey) => {
    try {
      const result = await gatewayRequest<{ id: string; secret: string; key: GatewayApiKey }>(`/admin/api-keys/${encodeURIComponent(key.id)}/secret`);
      await writeClipboard(result.secret);
      onToast(t('Key copied to clipboard.'));
    } catch (error) {
      const message = (error as Error).message || 'Copy failed. Please copy it manually.';
      onToast(t(message));
    }
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) {
      return;
    }
    setSaving(true);
    const saved = await onSave(form);
    setSaving(false);
    if (saved) {
      setForm(null);
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <PanelTitle icon={<KeyRound size={18} />} title={t('API keys')} />
        <button className="button primary" type="button" onClick={onCreate}>
          <Plus size={18} />
          {t('Create key')}
        </button>
      </div>
      {form && (
        <form className="key-editor" onSubmit={submitForm}>
          <div className="panel-heading">
            <PanelTitle icon={<Code2 size={18} />} title={t('Edit key')} />
            <button className="button text-button" type="button" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
          </div>
          <div className="form-grid">
            <label>
              {t('Key name')}
              <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
            </label>
            <label>
              {t('Rate limit per minute')}
              <input type="number" min="0" step="1" value={form.perMinute} onChange={(event) => updateForm({ perMinute: event.target.value })} />
            </label>
            <label className="toggle-row key-toggle">
              <span>{t('Enabled')}</span>
              <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm({ enabled: event.target.checked })} />
            </label>
          </div>
          <div className="row-actions">
            <button className="button primary" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Save key')}
            </button>
            <button className="button soft" type="button" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
      <div className="data-table">
        <div className="table-row head">
          <span>{t('Name')}</span>
          <span>{t('Secret')}</span>
          <span>{t('Limit')}</span>
          <span>{t('Status')}</span>
          <span>{t('Actions')}</span>
        </div>
        {keys.map((key) => (
          <div className="table-row" key={key.id}>
            <span>
              <b>{key.name}</b>
              <small>
                {t(key.role)} - {t('Created')} {t(key.created)} - {apiKeyLastUsedLabel(key.lastUsed, t)}
              </small>
            </span>
            <code>{key.value}</code>
            <span>{key.limit}</span>
            <StatusBadge status={key.status} />
            <span className="row-actions">
              <button className="icon-button" type="button" onClick={() => copyKey(key)} title={t('Copy key')} aria-label={t('Copy key')}>
                <Copy size={16} />
              </button>
              <button className="icon-button" type="button" onClick={() => startEdit(key)} title={t('Edit')} aria-label={t('Edit')}>
                <Code2 size={16} />
              </button>
              <button className="icon-button" type="button" onClick={() => onRotate(key)} title={t('Rotate and copy')} aria-label={t('Rotate and copy')}>
                <RefreshCcw size={16} />
              </button>
              <button className="icon-button danger" type="button" onClick={() => onDelete(key.id)}>
                <Trash2 size={16} />
              </button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ChannelsView({
  channels,
  onToggle,
  onDelete,
  onSave,
  onCheckHealth
}: {
  channels: Channel[];
  onToggle: (channel: Channel) => void;
  onDelete: (id: string) => Promise<void>;
  onSave: (form: ChannelFormState) => Promise<boolean>;
  onCheckHealth: (id: string, live?: boolean) => Promise<ProviderHealth | null>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<ChannelFormState | null>(null);
  const [lockedId, setLockedId] = useState(false);
  const [saving, setSaving] = useState(false);
  const [healthById, setHealthById] = useState<Record<string, ChannelHealthState>>({});

  const startCreate = () => {
    setLockedId(false);
    setForm({
      id: '',
      name: '',
      type: 'openai-compatible',
      baseUrl: '',
      apiKey: '',
      apiKeyEnv: '',
      apiKeyConfigured: false,
      apiKeyPreview: '',
      timeoutMs: '120000',
      maxConcurrency: '100',
      enabled: false
    });
  };

  const startEdit = (channel: Channel) => {
    setLockedId(true);
    setForm({
      id: channel.id,
      name: channel.name,
      type: channel.type === 'mock' ? 'mock' : 'openai-compatible',
      baseUrl: channel.baseUrl || '',
      apiKey: '',
      apiKeyEnv: channel.apiKeyEnv || '',
      apiKeyConfigured: channel.apiKeyConfigured,
      apiKeyPreview: channel.apiKeyPreview || '',
      timeoutMs: String(channel.timeoutMs || 120000),
      maxConcurrency: String(channel.maxConcurrency || 0),
      enabled: channel.status !== 'Paused'
    });
  };

  const updateForm = (patch: Partial<ChannelFormState>) => {
    if (form) {
      setForm({ ...form, ...patch });
    }
  };

  const submitForm = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) {
      return;
    }
    setSaving(true);
    const saved = await onSave(form);
    setSaving(false);
    if (saved) {
      setForm(null);
    }
  };

  const checkHealth = async (id: string, live = false) => {
    const result = await onCheckHealth(id, live);
    if (result) {
      setHealthById((current) => ({
        ...current,
        [id]: {
          ...result,
          checkedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        }
      }));
    }
  };

  const removeChannel = async (channel: Channel) => {
    if (!window.confirm(t('Delete provider channel?'))) {
      return;
    }
    await onDelete(channel.id);
    setHealthById((current) => {
      const next = { ...current };
      delete next[channel.id];
      return next;
    });
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <PanelTitle icon={<Network size={18} />} title={t('Channels')} />
        <button className="button primary" type="button" onClick={startCreate}>
          <Plus size={18} />
          {t('Add channel')}
        </button>
      </div>
      {form && (
        <form className="provider-editor" onSubmit={submitForm}>
          <div className="panel-heading">
            <PanelTitle icon={<Workflow size={18} />} title={t(lockedId ? 'Edit provider channel' : 'New provider channel')} />
            <button className="button text-button" type="button" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
          </div>
          <div className="form-grid">
            <label>
              {t('Provider ID')}
              <input value={form.id} disabled={lockedId} onChange={(event) => updateForm({ id: event.target.value })} placeholder="company-openai" />
            </label>
            <label>
              {t('Provider name')}
              <input value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder="Company Provider" />
            </label>
            <label>
              {t('Type')}
              <select
                value={form.type}
                disabled={form.type === 'mock'}
                onChange={(event) => updateForm({ type: event.target.value as ChannelFormState['type'] })}
              >
                <option value="openai-compatible">{t('Protocol compatible')}</option>
                {form.type === 'mock' && <option value="mock">{t('Mock provider')}</option>}
              </select>
            </label>
            <label>
              {t('Base URL')}
              <input
                value={form.baseUrl}
                disabled={form.type === 'mock'}
                onChange={(event) => updateForm({ baseUrl: event.target.value })}
                placeholder="https://api.openai.com/v1"
              />
            </label>
            <label>
              {t('API key')}
              <input
                type="password"
                value={form.apiKey}
                disabled={form.type === 'mock'}
                onChange={(event) => updateForm({ apiKey: event.target.value, apiKeyConfigured: Boolean(event.target.value.trim()) || Boolean(form.apiKeyPreview) })}
                placeholder={form.apiKeyPreview ? t('Saved API key') + ` ${form.apiKeyPreview}` : 'sk-...'}
              />
            </label>
            <label>
              {t('API key env')}
              <input
                value={form.apiKeyEnv}
                disabled={form.type === 'mock'}
                onChange={(event) => updateForm({ apiKeyEnv: event.target.value })}
                placeholder="PROVIDER_API_KEY"
              />
            </label>
            <label>
              {t('Timeout ms')}
              <input
                type="number"
                min="1000"
                step="1000"
                value={form.timeoutMs}
                disabled={form.type === 'mock'}
                onChange={(event) => updateForm({ timeoutMs: event.target.value })}
              />
            </label>
            <label>
              {t('Max concurrency')}
              <input type="number" min="0" step="1" value={form.maxConcurrency} onChange={(event) => updateForm({ maxConcurrency: event.target.value })} />
            </label>
            <label className="provider-toggle">
              <span>{t('Enabled')}</span>
              <span className="toggle-control">
                <input type="checkbox" checked={form.enabled} onChange={(event) => updateForm({ enabled: event.target.checked })} />
              </span>
            </label>
          </div>
          <p className="panel-note">
            {form.type === 'mock'
              ? t('Use mock only for local tests. Production traffic should use protocol-compatible channels.')
              : t('Enter an upstream API key directly, or provide an environment variable name on the gateway server. Saved keys are encrypted and are not shown again.')}
          </p>
          <div className="row-actions">
            <button className="button primary" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Save channel')}
            </button>
            <button className="button soft" type="button" onClick={() => setForm(null)}>
              {t('Cancel')}
            </button>
          </div>
        </form>
      )}
      <div className="channel-list">
        {channels.length ? (
          channels.map((channel) => {
            const health = healthById[channel.id];
            const secretState = channel.type === 'mock'
              ? t('local provider')
              : channel.apiKeyConfigured
                ? t('Configured')
                : t('Not configured');
            const healthLabel = health
              ? `${health.ok ? t(health.live ? 'Live OK' : 'Config OK') : providerHealthMessage(health, t)} - ${health.checkedAt}${health.durationMs !== undefined ? ` - ${health.durationMs}ms` : ''}`
              : t(channel.balance);
            const displayStatus = health?.ok === false ? 'Degraded' : channel.status;
            return (
              <article className="channel-item" key={channel.id}>
                <div className="channel-main">
                  <div className="channel-title-row">
                    <div>
                      <h3>{channel.name}</h3>
                      <p>{channel.id} - {t(channel.type === 'mock' ? 'Mock provider' : 'Protocol compatible')}</p>
                    </div>
                    <StatusBadge status={displayStatus} />
                  </div>
                  <small>{channel.type === 'mock' ? t('local provider') : channel.baseUrl || t('Base URL')}</small>
                  <div className="channel-meta-grid">
                    <MetricInline label={t('API key')} value={channel.type === 'mock' ? '-' : channel.apiKeyPreview || (channel.apiKeyConfigured ? t('Configured') : '-')} />
                    <MetricInline label={t('API key env')} value={channel.type === 'mock' ? '-' : channel.apiKeyEnv || '-'} />
                    <MetricInline label={t('Status')} value={secretState} />
                    <MetricInline label={t('Timeout')} value={channel.type === 'mock' ? '-' : `${channel.timeoutMs || 120000}ms`} />
                    <MetricInline label={t('Concurrency')} value={channel.maxConcurrency ? String(channel.maxConcurrency) : t('No data')} />
                    <MetricInline label={t('Models')} value={t(channel.models)} />
                    <MetricInline label={health?.ok === false ? t('Check failed') : t('Last check')} value={healthLabel} />
                  </div>
                </div>
                <div className="channel-actions row-actions">
                  <button className="button soft" type="button" onClick={() => startEdit(channel)}>
                    <Code2 size={16} />
                    {t('Edit')}
                  </button>
                  <button className="button soft" type="button" onClick={() => checkHealth(channel.id)}>
                    <RefreshCcw size={16} />
                    {t('Config check')}
                  </button>
                  <button className="button soft" type="button" onClick={() => checkHealth(channel.id, true)} disabled={channel.type === 'mock'}>
                    <TestTube2 size={16} />
                    {t('Live check')}
                  </button>
                  <button className="button soft" type="button" onClick={() => onToggle(channel)}>
                    {channel.status === 'Paused' ? t('Enable') : t('Pause')}
                  </button>
                  <button className="icon-button danger" type="button" onClick={() => removeChannel(channel)} title={t('Delete')}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </article>
            );
          })
        ) : (
          <p className="panel-note">{t('No provider channels configured.')}</p>
        )}
      </div>
    </section>
  );
}

function MetricInline({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-metric">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function ModelTestView({
  channels,
  models,
  serviceApiKey,
  onRefresh,
  onToast
}: {
  channels: Channel[];
  models: ModelRow[];
  serviceApiKey: string;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState({
    alias: '',
    provider: '',
    upstreamModel: '',
    endpoints: 'chat,responses',
    description: ''
  });
  const [editingAlias, setEditingAlias] = useState('');
  const [runningAlias, setRunningAlias] = useState('');
  const [testByAlias, setTestByAlias] = useState<Record<string, { status: 'Success' | 'Degraded'; message: string }>>({});
  const selectableChannels = useMemo(() => channels.filter((item) => item.type !== 'mock'), [channels]);
  const providerOptions = selectableChannels.length ? selectableChannels : channels;

  useEffect(() => {
    if (!providerOptions.length || providerOptions.some((item) => item.id === form.provider)) {
      return;
    }
    setForm((current) => ({
      ...current,
      provider: providerOptions[0].id
    }));
  }, [form.provider, providerOptions]);

  const resetMappingForm = () => {
    setEditingAlias('');
    setForm({
      alias: '',
      provider: providerOptions[0]?.id || '',
      upstreamModel: '',
      endpoints: 'chat,responses',
      description: ''
    });
  };

  const editMapping = (alias: string, model: GatewayModel) => {
    setEditingAlias(alias);
    setForm({
      alias,
      provider: model.provider,
      upstreamModel: model.upstreamModel,
      endpoints: (model.endpoints || ['chat']).join(','),
      description: model.description || ''
    });
  };

  const saveMapping = async () => {
    try {
      if (!providerOptions.length) {
        throw new Error(t('Create a provider channel before saving model aliases.'));
      }
      const alias = form.alias.trim();
      if (!alias) {
        throw new Error(t('Model alias is required.'));
      }
      await gatewayRequest(`/admin/models/${encodeURIComponent(alias)}`, {
        method: 'PUT',
        body: {
          previousAlias: editingAlias || undefined,
          provider: form.provider,
          upstreamModel: form.upstreamModel,
          enabled: true,
          endpoints: form.endpoints.split(',').map((item) => item.trim()).filter(Boolean),
          description: form.description
        }
      });
      await onRefresh();
      setEditingAlias(alias);
      setForm((current) => ({ ...current, alias }));
      onToast(`${t('Model alias')} ${alias} ${t('saved')}.`);
    } catch (error) {
      onToast((error as Error).message);
    }
  };

  const deleteMapping = async (alias: string) => {
    if (!window.confirm(t('Delete model mapping?'))) {
      return;
    }
    try {
      await gatewayRequest(`/admin/models/${encodeURIComponent(alias)}`, { method: 'DELETE' });
      if (editingAlias === alias) {
        resetMappingForm();
      }
      await onRefresh();
      onToast(t('Model mapping deleted.'));
    } catch (error) {
      onToast((error as Error).message);
    }
  };

  const testAlias = async (alias: string, model: GatewayModel) => {
    const proxyApiKey = serviceApiKey || ADMIN_API_KEY || undefined;
    const endpoint = endpointForModel(model);
    const body = requestBodyForEndpoint(endpoint, alias);
    setRunningAlias(alias);
    try {
      const result = await gatewayRequest<Record<string, unknown>>(endpoint, {
        method: 'POST',
        apiKey: proxyApiKey,
        body
      });
      const responseId = String(result.id || result.object || 'ok');
      const message = `${alias} ${t('responded')}: ${responseId}`;
      setTestByAlias((current) => ({ ...current, [alias]: { status: 'Success', message } }));
      onToast(`${alias} ${t('responded')}: ${compactMiddle(responseId, 48)}`);
    } catch (error) {
      const message = `${alias} ${t('failed')}: ${(error as Error).message}`;
      setTestByAlias((current) => ({ ...current, [alias]: { status: 'Degraded', message } }));
      onToast(message);
    } finally {
      setRunningAlias('');
    }
  };

  return (
    <section className="panel">
      <div className="panel-heading">
        <PanelTitle icon={<Layers3 size={18} />} title={t('Model testing')} />
        <div className="row-actions">
          <button className="button soft" type="button" onClick={resetMappingForm}>
            <Plus size={18} />
            {t('New mapping')}
          </button>
          <button className="button primary" type="button" onClick={saveMapping}>
            <Check size={18} />
            {t('Save mapping')}
          </button>
        </div>
      </div>
      <div className="form-grid">
        <label>
          {t('Internal alias')}
          <input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="company-chat" />
        </label>
        <label>
          {t('Provider')}
          <select value={form.provider} disabled={!providerOptions.length} onChange={(event) => setForm({ ...form, provider: event.target.value })}>
            {providerOptions.length ? (
              providerOptions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))
            ) : (
              <option value="">{t('No providers available')}</option>
            )}
          </select>
        </label>
        <label>
          {t('Upstream model')}
          <input value={form.upstreamModel} onChange={(event) => setForm({ ...form, upstreamModel: event.target.value })} placeholder="qwen-plus" />
        </label>
        <label>
          {t('Endpoint types')}
          <input value={form.endpoints} onChange={(event) => setForm({ ...form, endpoints: event.target.value })} />
        </label>
        <label>
          {t('Description')}
          <input value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
        </label>
      </div>
      <div className="model-grid">
        {models.map(({ alias, model }) => {
          const testState = testByAlias[alias];
          const status = model.enabled === false ? 'Paused' : runningAlias === alias ? 'Testing' : testState?.status || 'Ready';
          return (
            <div className="model-row" key={alias}>
              <span>
                <b>{alias}</b>
                <small>
                  <span>{model.provider} &rarr; {model.upstreamModel}</span>
                  {testState && <span className="model-test-message">{testState.message}</span>}
                </small>
              </span>
              <StatusBadge status={status} />
              <div className="row-actions">
                <button className="button soft" type="button" onClick={() => editMapping(alias, model)}>
                  {t('Use')}
                </button>
                <button className="button soft" type="button" onClick={() => testAlias(alias, model)} disabled={Boolean(runningAlias)}>
                  <Play size={16} />
                  {t('Test')}
                </button>
                <button className="icon-button danger" type="button" title={t('Delete mapping')} onClick={() => deleteMapping(alias)}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="panel-note">{t('Internal services call the alias; JetLinksAPI rewrites it to the upstream model before proxying.')}</p>
    </section>
  );
}

function PlaygroundView({ models, serviceApiKey, onToast }: { models: ModelRow[]; serviceApiKey: string; onToast: (message: string) => void }) {
  const { t } = useI18n();
  const initialModelAlias = models[0]?.alias || 'jetlink-chat';
  const [endpoint, setEndpoint] = useState(endpointForModel(models[0]?.model));
  const [body, setBody] = useState(JSON.stringify(requestBodyForEndpoint(endpointForModel(models[0]?.model), initialModelAlias), null, 2));
  const [response, setResponse] = useState('');
  const [sending, setSending] = useState(false);
  const selectedModel = useMemo(() => {
    try {
      const parsed = JSON.parse(body);
      return typeof parsed.model === 'string' ? parsed.model : '';
    } catch {
      return '';
    }
  }, [body]);

  const replaceBodyForEndpoint = (nextEndpoint: string, alias = selectedModel || initialModelAlias) => {
    setEndpoint(nextEndpoint);
    setBody(JSON.stringify(requestBodyForEndpoint(nextEndpoint, alias), null, 2));
  };

  const updateModel = (alias: string) => {
    const model = models.find((item) => item.alias === alias)?.model;
    const nextEndpoint = endpointForModel(model);
    setEndpoint(nextEndpoint);
    try {
      const parsed = JSON.parse(body);
      if (endpointKindFromPath(endpoint) === endpointKindFromPath(nextEndpoint)) {
        setBody(JSON.stringify({ ...parsed, model: alias }, null, 2));
        return;
      }
      setBody(JSON.stringify(requestBodyForEndpoint(nextEndpoint, alias), null, 2));
    } catch {
      setBody(JSON.stringify(requestBodyForEndpoint(nextEndpoint, alias), null, 2));
    }
  };

  const send = async () => {
    const proxyApiKey = serviceApiKey || ADMIN_API_KEY;
    setSending(true);
    try {
      const parsed = JSON.parse(body);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (proxyApiKey) {
        headers.Authorization = `Bearer ${proxyApiKey}`;
      }
      const httpResponse = await fetch(`${GATEWAY_BASE_URL}${endpoint}`, {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(parsed)
      });
      const text = await httpResponse.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        formatted = text;
      }
      setResponse(formatted || `HTTP ${httpResponse.status}`);
      if (!httpResponse.ok) {
        onToast(`${t('Request failed')}: HTTP ${httpResponse.status}`);
      } else {
        onToast(t('Gateway request completed.'));
      }
    } catch (error) {
      setResponse((error as Error).message);
      onToast((error as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="panel playground">
      <div className="panel-heading">
        <PanelTitle icon={<Play size={18} />} title={t('Request playground')} />
        <button className="button primary" type="button" onClick={send} disabled={sending}>
          <Send size={18} />
          {sending ? t('Sending') : t('Send')}
        </button>
      </div>
      <div className="form-grid">
        <label>
          {t('Endpoint')}
          <select value={endpoint} onChange={(event) => replaceBodyForEndpoint(event.target.value)}>
            {endpoints.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('Base URL')}
          <input value={GATEWAY_BASE_URL} readOnly />
        </label>
        <label>
          {t('Model alias')}
          <select value={selectedModel} onChange={(event) => updateModel(event.target.value)}>
            {models.map(({ alias }) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
            {!models.some(({ alias }) => alias === selectedModel) && <option value={selectedModel}>{selectedModel || 'jetlink-chat'}</option>}
          </select>
        </label>
      </div>
      <div className="playground-grid">
        <label>
          {t('Request body')}
          <textarea value={body} onChange={(event) => setBody(event.target.value)} />
        </label>
        <label>
          {t('Response')}
          <textarea value={response || t('Run a request to see the response.')} readOnly />
        </label>
      </div>
    </section>
  );
}

const emptyUsageSummary: UsageSummary = {
  total: 0,
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

function formatWholeNumber(value = 0) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value = 0, maximumFractionDigits = 2) {
  const safeValue = Number.isFinite(value) ? value : 0;
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits }).format(safeValue)}%`;
}

function formatCompactNumber(value = 0) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: value >= 1000 ? 1 : 0
  }).format(value);
}

function compactMiddle(value = '', maxLength = 64) {
  if (value.length <= maxLength) {
    return value;
  }
  const edgeLength = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, edgeLength)}...${value.slice(-edgeLength)}`;
}

function formatMoney(value = 0, currency = 'USD') {
  return `${currency} ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: value > 0 && value < 0.01 ? 6 : 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 6 : 2
  }).format(value)}`;
}

function formatCostMap(costs: Record<string, number> = {}, fallbackCurrency = 'USD') {
  const entries = Object.entries(costs).filter(([, value]) => Number(value) > 0);
  if (!entries.length) {
    return formatMoney(0, fallbackCurrency);
  }
  return entries.map(([currency, value]) => formatMoney(value, currency)).join(' / ');
}

function priceCurrency(entry: PricingEntry, fallbackCurrency = 'USD') {
  return entry.currency || fallbackCurrency || 'USD';
}

function billingUnitOf(entry: PricingEntry): BillingUnit {
  return entry.billingUnit || 'token';
}

function labelForBillingUnit(unit: BillingUnit, t: (text: string) => string) {
  if (unit === 'image') return t('Image');
  if (unit === 'request') return t('Request');
  return t('Token');
}

function formatPricingEntry(entry: PricingEntry, fallbackCurrency: string, t: (text: string) => string) {
  const currency = priceCurrency(entry, fallbackCurrency);
  const unit = billingUnitOf(entry);
  if (unit === 'image') {
    return `${formatMoney(entry.imageUnitPrice || 0, currency)} / ${t('per image')}`;
  }
  if (unit === 'request') {
    return `${formatMoney(entry.requestUnitPrice || 0, currency)} / ${t('per successful request')}`;
  }
  return `${formatMoney(entry.inputPerMillionTokens || 0, currency)} ${t('input')} / ${formatMoney(entry.outputPerMillionTokens || 0, currency)} ${t('output')}`;
}

function formatUsageUnits(row: { tokens: number; images: number; imageRequests: number; billableRequests: number }, t: (text: string) => string) {
  const parts: string[] = [];
  if (row.tokens > 0) {
    parts.push(`${formatWholeNumber(row.tokens)} ${t('tokens')}`);
  }
  if (row.images > 0 || row.imageRequests > 0) {
    parts.push(`${formatWholeNumber(row.images)} ${t('Images')}`);
  }
  if (!parts.length) {
    parts.push(`${formatWholeNumber(row.billableRequests)} ${t('billable requests')}`);
  }
  return parts.join(' / ');
}

function summarizeRequestUsage(requests: RequestLog[], groupBy: 'modelAlias' | 'provider') {
  const rows = new Map<string, { id: string; requests: number; tokens: number; images: number; imageRequests: number; billableRequests: number; costs: Record<string, number> }>();
  for (const request of requests) {
    const id = request[groupBy] || 'unknown';
    const current = rows.get(id) || { id, requests: 0, tokens: 0, images: 0, imageRequests: 0, billableRequests: 0, costs: {} };
    current.requests += 1;
    current.tokens += Number(request.billableUsage?.totalTokens ?? request.usage?.totalTokens ?? 0);
    current.images += Number(request.billableUsage?.images || request.estimatedCost?.units?.images || 0);
    if (request.endpoint?.includes('/images/') || request.estimatedCost?.billingUnit === 'image') {
      current.imageRequests += 1;
    }
    current.billableRequests += Number(request.billableUsage?.requests || request.estimatedCost?.units?.requests || 0);
    if (request.estimatedCost) {
      const currency = request.estimatedCost.currency || 'USD';
      current.costs[currency] = Number(((current.costs[currency] || 0) + Number(request.estimatedCost.totalCost || 0)).toFixed(10));
    }
    rows.set(id, current);
  }
  return [...rows.values()].sort((left, right) => right.requests - left.requests || right.tokens - left.tokens);
}

type PricingFormState = {
  alias: string;
  currency: string;
  billingUnit: BillingUnit;
  inputPerMillionTokens: string;
  outputPerMillionTokens: string;
  imageUnitPrice: string;
  requestUnitPrice: string;
  officialProvider: string;
  officialModel: string;
  source: string;
  note: string;
};

const officialPricingPresets: Array<{ id: string; label: string; alias: string; entry: PricingEntry }> = [
  {
    id: 'aliyun-qwen-image-2-pro-cn-beijing',
    label: 'Aliyun qwen-image-2.0-pro Beijing',
    alias: 'jetlinks-image',
    entry: {
      billingUnit: 'image',
      currency: 'CNY',
      inputPerMillionTokens: 0,
      outputPerMillionTokens: 0,
      imageUnitPrice: 0.5,
      requestUnitPrice: 0,
      unitLabel: 'image',
      officialProvider: 'aliyun',
      officialModel: 'qwen-image-2.0-pro',
      source: 'https://help.aliyun.com/zh/model-studio/model-pricing',
      note: '阿里云百炼华北2北京：按成功生成图像张数计费，请求失败不计费。'
    }
  }
];

function emptyPricingForm(currency = 'USD'): PricingFormState {
  return {
    alias: '',
    currency,
    billingUnit: 'token',
    inputPerMillionTokens: '',
    outputPerMillionTokens: '',
    imageUnitPrice: '',
    requestUnitPrice: '',
    officialProvider: '',
    officialModel: '',
    source: '',
    note: ''
  };
}

function BillingView() {
  const { t } = useI18n();
  const [usage, setUsage] = useState<UsageSummary>(emptyUsageSummary);
  const [pricing, setPricing] = useState<PricingConfig>({ currency: 'USD', models: {} });
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [form, setForm] = useState<PricingFormState>(() => emptyPricingForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const modelUsageRows = useMemo(() => summarizeRequestUsage(requests, 'modelAlias'), [requests]);
  const providerUsageRows = useMemo(() => summarizeRequestUsage(requests, 'provider'), [requests]);
  const pricingRows = Object.entries(pricing.models || {});

  const refreshBilling = async () => {
    setLoading(true);
    try {
      const [usageResult, pricingResult, requestResult] = await Promise.all([
        gatewayRequest<{ data: UsageSummary }>('/admin/usage?limit=500'),
        gatewayRequest<{ data: PricingConfig }>('/admin/pricing'),
        gatewayRequest<{ data: RequestLog[] }>('/admin/requests?limit=500')
      ]);
      setUsage(usageResult.data || emptyUsageSummary);
      setPricing(pricingResult.data || { currency: 'USD', models: {} });
      setRequests(requestResult.data || []);
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refreshBilling();
  }, []);

  const savePricing = async (event: FormEvent) => {
    event.preventDefault();
    const alias = form.alias.trim();
    const input = Number(form.inputPerMillionTokens || 0);
    const output = Number(form.outputPerMillionTokens || 0);
    const image = Number(form.imageUnitPrice || 0);
    const request = Number(form.requestUnitPrice || 0);
    try {
      if (!alias) {
        throw new Error(t('Model alias is required.'));
      }
      if (![input, output, image, request].every((value) => Number.isFinite(value) && value >= 0)) {
        throw new Error(t('Price must be a non-negative number.'));
      }
      const currency = form.currency.trim() || pricing.currency || 'USD';
      setSaving(true);
      const nextPricing: PricingConfig = {
        currency,
        models: {
          ...(pricing.models || {}),
          [alias]: {
            billingUnit: form.billingUnit,
            inputPerMillionTokens: input,
            outputPerMillionTokens: output,
            imageUnitPrice: image,
            requestUnitPrice: request,
            unitLabel: form.billingUnit,
            currency,
            officialProvider: form.officialProvider.trim(),
            officialModel: form.officialModel.trim(),
            source: form.source.trim(),
            note: form.note.trim()
          }
        }
      };
      const result = await gatewayRequest<{ data: PricingConfig }>('/admin/pricing', {
        method: 'PUT',
        body: nextPricing
      });
      setPricing(result.data || nextPricing);
      setForm(emptyPricingForm(nextPricing.currency));
      setToast(t('Model price saved.'));
    } catch (error) {
      setToast((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const usePricingEntry = (alias: string, entry: PricingEntry) => {
    setForm({
      alias,
      currency: entry.currency || pricing.currency || 'USD',
      billingUnit: billingUnitOf(entry),
      inputPerMillionTokens: String(entry.inputPerMillionTokens ?? 0),
      outputPerMillionTokens: String(entry.outputPerMillionTokens ?? 0),
      imageUnitPrice: String(entry.imageUnitPrice ?? 0),
      requestUnitPrice: String(entry.requestUnitPrice ?? 0),
      officialProvider: entry.officialProvider || '',
      officialModel: entry.officialModel || '',
      source: entry.source || '',
      note: entry.note || ''
    });
  };

  const applyPricingPreset = (preset: typeof officialPricingPresets[number]) => {
    usePricingEntry(preset.alias, preset.entry);
  };

  const deletePricing = async (alias: string) => {
    const nextModels = { ...(pricing.models || {}) };
    delete nextModels[alias];
    const nextPricing = { ...pricing, models: nextModels };
    try {
      const result = await gatewayRequest<{ data: PricingConfig }>('/admin/pricing', {
        method: 'PUT',
        body: nextPricing
      });
      setPricing(result.data || nextPricing);
      setToast(t('Model price deleted.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const successRate = usage.total ? `${((usage.ok / usage.total) * 100).toFixed(1)}%` : '0%';
  const billableImages = Number(usage.billable?.images || 0);
  const billableRequests = Number(usage.billable?.requests || usage.ok || 0);

  return (
    <div className="console-stack">
      <div className="metric-grid">
        <ConsoleMetric icon={<CircleDollarSign />} label={t('Estimated spend')} value={formatCostMap(usage.estimatedCost, pricing.currency)} trend={pricingRows.length ? t('priced from request logs') : t('Pricing is not configured yet.')} />
        <ConsoleMetric icon={<CreditCard />} label={t('Gateway requests')} value={formatWholeNumber(usage.total)} trend={`${successRate} ${t('successful requests')}`} />
        <ConsoleMetric icon={<Layers3 />} label={t('Billable usage')} value={`${formatCompactNumber(usage.tokens.total)} ${t('tokens')}`} trend={`${formatWholeNumber(billableImages)} ${t('billable images')} / ${formatWholeNumber(billableRequests)} ${t('billable requests')}`} />
        <ConsoleMetric icon={<Clipboard />} label={t('Average latency')} value={`${usage.avgDurationMs || 0}ms`} trend={`${usage.failoverRequests || 0} ${t('failover requests')}`} />
      </div>
      <p className="panel-note">{t('Real billing is calculated from gateway request logs and configured per-model token prices.')}</p>
      <div className="dashboard-grid billing-dashboard">
        <section className="panel">
          <div className="panel-heading">
            <PanelTitle icon={<BarChart3 size={18} />} title={t('Usage by model')} />
            <button className="button soft" type="button" onClick={refreshBilling} disabled={loading}>
              <RefreshCcw size={16} />
              {loading ? t('Refreshing') : t('Refresh')}
            </button>
          </div>
          <BillingUsageTable rows={modelUsageRows} currency={pricing.currency} />
        </section>
        <section className="panel">
          <PanelTitle icon={<Network size={18} />} title={t('Usage by provider')} />
          <BillingUsageTable rows={providerUsageRows} currency={pricing.currency} />
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <PanelTitle icon={<CircleDollarSign size={18} />} title={t('Official billing configuration')} />
        </div>
        <div className="billing-presets">
          <span>{t('Official billing preset')}</span>
          {officialPricingPresets.map((preset) => (
            <button className="button soft" type="button" key={preset.id} onClick={() => applyPricingPreset(preset)}>
              <Check size={16} />
              {t(preset.label)}
            </button>
          ))}
        </div>
        <form className="form-grid billing-price-form" onSubmit={savePricing}>
          <label>
            {t('Model alias')}
            <input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="company-chat" />
          </label>
          <label>
            {t('Billing unit')}
            <select value={form.billingUnit} onChange={(event) => setForm({ ...form, billingUnit: event.target.value as BillingUnit })}>
              <option value="token">{t('Token')}</option>
              <option value="image">{t('Image')}</option>
              <option value="request">{t('Request')}</option>
            </select>
          </label>
          <label>
            {t('Currency')}
            <input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="USD" />
          </label>
          {form.billingUnit === 'token' && (
            <>
              <label>
                {t('Input / 1M tokens')}
                <input type="number" min="0" step="0.000001" value={form.inputPerMillionTokens} onChange={(event) => setForm({ ...form, inputPerMillionTokens: event.target.value })} />
              </label>
              <label>
                {t('Output / 1M tokens')}
                <input type="number" min="0" step="0.000001" value={form.outputPerMillionTokens} onChange={(event) => setForm({ ...form, outputPerMillionTokens: event.target.value })} />
              </label>
            </>
          )}
          {form.billingUnit === 'image' && (
            <label>
              {t('Price / image')}
              <input type="number" min="0" step="0.000001" value={form.imageUnitPrice} onChange={(event) => setForm({ ...form, imageUnitPrice: event.target.value })} />
            </label>
          )}
          {form.billingUnit === 'request' && (
            <label>
              {t('Price / successful request')}
              <input type="number" min="0" step="0.000001" value={form.requestUnitPrice} onChange={(event) => setForm({ ...form, requestUnitPrice: event.target.value })} />
            </label>
          )}
          <label>
            {t('Official provider')}
            <input value={form.officialProvider} onChange={(event) => setForm({ ...form, officialProvider: event.target.value })} placeholder="aliyun" />
          </label>
          <label>
            {t('Official model')}
            <input value={form.officialModel} onChange={(event) => setForm({ ...form, officialModel: event.target.value })} placeholder="qwen-image-2.0-pro" />
          </label>
          <label>
            {t('Source URL')}
            <input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="https://help.aliyun.com/zh/model-studio/model-pricing" />
          </label>
          <label>
            {t('Note')}
            <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder={t('per image')} />
          </label>
          <div className="row-actions billing-form-actions">
            <button className="button primary" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Save price')}
            </button>
          </div>
        </form>
        <div className="billing-table">
          <div className="billing-row head">
            <span>{t('Model alias')}</span>
            <span>{t('Billing unit')}</span>
            <span>{t('Official price')}</span>
            <span>{t('Actions')}</span>
          </div>
          {pricingRows.length ? pricingRows.map(([alias, entry]) => (
            <div className="billing-row" key={alias}>
              <span><b>{alias}</b><small>{entry.officialModel || entry.officialProvider || priceCurrency(entry, pricing.currency)}</small></span>
              <span>{labelForBillingUnit(billingUnitOf(entry), t)}<small>{priceCurrency(entry, pricing.currency)}</small></span>
              <span>{formatPricingEntry(entry, pricing.currency, t)}<small>{entry.source || t('Official source')}</small></span>
              <span className="row-actions">
                <button className="button soft" type="button" onClick={() => usePricingEntry(alias, entry)}>{t('Edit')}</button>
                <button className="icon-button danger" type="button" onClick={() => deletePricing(alias)} title={t('Delete')}>
                  <Trash2 size={16} />
                </button>
              </span>
            </div>
          )) : (
            <p className="panel-note">{t('No pricing entries configured.')}</p>
          )}
        </div>
      </section>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function BillingUsageTable({
  rows,
  currency
}: {
  rows: Array<{ id: string; requests: number; tokens: number; images: number; imageRequests: number; billableRequests: number; costs: Record<string, number> }>;
  currency: string;
}) {
  const { t } = useI18n();
  return (
    <div className="billing-table">
      <div className="billing-row head">
        <span>{t('Name')}</span>
        <span>{t('Requests')}</span>
        <span>{t('Billable units')}</span>
        <span>{t('Cost')}</span>
      </div>
      {rows.length ? rows.map((row) => (
        <div className="billing-row" key={row.id}>
          <span><b>{row.id}</b></span>
          <span>{formatWholeNumber(row.requests)}</span>
          <span>{formatUsageUnits(row, t)}</span>
          <span>{formatCostMap(row.costs, currency)}</span>
        </div>
      )) : (
        <p className="panel-note">{t('No usage records yet.')}</p>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`status-badge ${status.toLowerCase()}`}>{t(status)}</span>;
}

function LegalPage({
  page,
  onNavigate,
  user,
  onSignOut
}: {
  page: Route;
  onNavigate: (route: Route) => void;
  user: UserState | null;
  onSignOut: () => void;
}) {
  const { t } = useI18n();
  const content = legalPages[page] || legalPages.about;
  return (
    <div className="legal-shell">
      <Header onNavigate={onNavigate} user={user} onSignOut={onSignOut} />
      <main className="legal-main">
        <div className="legal-header">
          <span>{t(content.eyebrow)}</span>
          <h1>{t(content.title)}</h1>
        </div>
        <div className="legal-content">
          {content.sections.map(([title, body]) => (
            <section key={title}>
              <h2>{t(title)}</h2>
              <p>{t(body)}</p>
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  );
}

function NotFound({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useI18n();
  return (
    <div className="console-guard">
      <img src="/logo-full.svg" alt="JetLinksAPI" />
      <h1>{t('Page not found')}</h1>
      <p>{t('Please check the browser address or return to the JetLinksAPI landing page.')}</p>
      <button className="button primary" type="button" onClick={() => onNavigate('home')}>
        {t('Back home')}
      </button>
    </div>
  );
}

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const timer = window.setTimeout(onClose, 2600);
    return () => window.clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="toast">
      <Check size={18} />
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label={t('Dismiss')}>
        <X size={16} />
      </button>
    </div>
  );
}

export default App;

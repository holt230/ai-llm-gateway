import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Checkbox } from './components/ui/checkbox';
import { Button } from './components/ui/button';
import { ConfirmationProvider, useConfirmation } from './components/ui/confirmation';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { SelectField } from './components/ui/select-field';
import { Textarea } from './components/ui/textarea';
import { cn } from './components/ui/utils';
import { SupportAdmin, SupportBubble } from './Support';
/// <reference types="vite/client" />

import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Check,
  CheckCircle2,
  CheckSquare,
  ChevronDown,
  CircleDollarSign,
  Clipboard,
  Clock,
  Code2,
  Copy,
  CreditCard,
  Globe,
  Info,
  KeyRound,
  Layers3,
  LayoutDashboard,
  LockKeyhole,
  LogOut,
  Menu,
  MessageCircle,
  Network,
  Pause,
  Pencil,
  Play,
  Plus,
  ReceiptText,
  RefreshCcw,
  Send,
  ShieldCheck,
  Sparkles,
  TestTube2,
  Trash2,
  User,
  UserCheck,
  Users,
  UserX,
  Wallet,
  X,
  Zap
} from 'lucide-react';
import { createContext, FormEvent, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { writeClipboard } from './clipboard';
import { WormholeOrbit } from './WormholeOrbit';
import { HomePointerTrail } from './HomePointerTrail';
import { HomeHeroBackground } from './HomeHeroBackground';
import { LiquidGlass, LiquidGlassDefs } from './LiquidGlass';
import { PaymentAdmin } from './AlipayAdmin';
import { CnyPricingAdmin, GroupsAdmin, type ManagedGroup } from './OperationsAdmin';
import { RequestLogs } from './RequestLogs';
import { WalletPage } from './WalletPage';
import { UserAccount } from './UserAccount';
import { Playground } from './Playground';
import { accountRequest } from './account-api';
import { useGatewaySession, type CustomerRoute, type SignedIn } from './customer-session';

type Route =
  | 'home'
  | 'login'
  | 'register'
  | 'recover'
  | 'console'
  | 'about'
  | 'wallet'
  | 'account'
  | 'not-found';

type UserState = {
  name: string;
  username: string;
};

type RuntimeConfig = {
  publicBaseUrl: string;
};

type ApiKey = {
  prepaid?: boolean;
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
  prepaid?: boolean;
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
  modelGroup: string;
  id: string;
  name: string;
  provider: string;
  models: string;
  latency?: number;
  success?: number;
  balance: string;
  status: 'Ready' | 'Degraded' | 'Paused';
  type?: string;
  apiKeyConfigured?: boolean;
  apiKeyPreview?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
};

type GatewayProvider = {
  modelGroup?: string;
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
  modelGroup: string;
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
  saasEnabled?: boolean;
  description?: string;
  provider: string;
  upstreamModel: string;
  enabled?: boolean;
  endpoints?: string[];
  fallbacks?: { provider: string }[];
  routes?: { provider: string }[];
};

type GatewayApiKey = {
  prepaid?: boolean;
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
  attempts?: { provider: string; status: number; durationMs: number }[];
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
  'Wormhole AI home': 'Wormhole AI 首页',
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
  'From access control and cost transparency to provider routing, Wormhole AI delivers the operating layer for enterprise API traffic.':
    '从访问控制、成本透明到供应商路由，Wormhole AI 提供企业 API 流量的统一运行层。',
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
  'Use Wormhole AI to centralize provider channels, model aliases, internal keys, quotas, and request observability for company workloads.':
    '使用 Wormhole AI 集中管理供应商通道、模型别名、内部密钥、配额和请求观测。',
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
  Billing: '上游成本',
  'CNY pricing': '售价管理',
  'Model groups': '分组管理',
  'Request logs': '调用日志',
  Profile: '个人中心',
  'Sign out': '退出登录',
  'Wormhole AI Console': 'Wormhole AI 控制台',
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
  'Spend and billing': '上游成本与待核对调用',
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
  'Configured channels': '已配置通道',
  'provider routes': '供应商路由',
  'Live dispatch': '实时分发',
  'Recent gateway calls': '最近网关调用',
  request: '请求',
  'No gateway requests yet. Send one from the playground to populate this log.': '暂无网关请求。可从调试台发送一次请求生成日志。',
  'API keys': 'API Key',
  'Create key': '创建密钥',
  'Account security': '账户安全',
  Close: '关闭',
  'Getting started': '使用指南',
  'Customer support': '客户支持',
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
  'Internal services call the alias; Wormhole AI rewrites it to the upstream model before proxying.':
    '内部业务调用模型别名，Wormhole AI 会在代理前改写为上游模型。',
  'Model alias': '模型别名',
  'Choose a model': '请选择模型',
  'No available models': '暂无可用模型',
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
  'Payment collection': '收款管理',
  'Model group': '模型分组',
  'Default group': '默认分组',
  'Import upstream models': '获取并导入模型',
  'My workspace': '用户工作台',
  'Service key wallet': '业务 Key 充值',
  'Admin sign in': '管理员登录',
  'User accounts': '用户管理',
  'Available to registered users': '向注册用户开放',
  'Prepaid CNY wallet': '使用预付余额',
  'Download Alipay receipt shortcut for iPhone': '下载 iPhone 支付宝到账确认快捷指令',
  'Up to 500 recent requests': '最多最近 500 条请求',
  'successful requests': '成功请求',
  'input/output tokens': '输入/输出 Token',
  'billable images': '计费图片',
  'billable requests': '计费请求',
  'failover requests': '故障切换请求',
  'Pricing is not configured yet.': '尚未配置模型单价。',
  'Estimates use the price recorded for each request. Streamed token usage depends on what the upstream reports.':
    '成本按每条请求记录的价格估算。流式 Token 用量取决于上游是否返回用量。',
  'Usage by model': '按模型统计',
  'Usage by provider': '按供应商统计',
  'Pricing configuration': '价格配置',
  'Official billing configuration': '官方计费配置',
  'Aliyun qwen-image-2.0-pro Beijing': '阿里云 qwen-image-2.0-pro 华北2北京',
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
  'Please check the browser address or return to the Wormhole AI landing page.': '请检查浏览器地址，或返回 Wormhole AI 首页。',
  'Back home': '返回首页',
  Dismiss: '关闭',
  'About Wormhole AI': '关于 Wormhole AI',
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

const DEFAULT_GATEWAY_BASE_URL = window.location.origin;
const GATEWAY_BASE_URL = (import.meta.env.VITE_AI_GW_GATEWAY_URL || DEFAULT_GATEWAY_BASE_URL).replace(/\/+$/, '');
const DEFAULT_PUBLIC_BASE_URL = 'https://1024012.xyz';
const INITIAL_PUBLIC_BASE_URL = normalizeDisplayBaseUrl(import.meta.env.VITE_AI_GW_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL);
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

async function gatewayRequest<T>(path: string, options: { method?: string; body?: unknown; apiKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  const { apiKey } = options;
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  const response = await fetch(`${GATEWAY_BASE_URL}${path}`, {
    method: options.method || (options.body ? 'POST' : 'GET'),
    headers,
    credentials: apiKey ? 'omit' : 'include',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    if (!apiKey && response.status === 401 && path.startsWith('/admin/')) window.dispatchEvent(new Event('gateway-session-check'));
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
      prompt: 'A clean product-style illustration of Wormhole AI',
      n: 1,
      size: '1024x1024'
    };
  }
  if (kind === 'embeddings') {
    return {
      model: modelAlias,
      input: 'Hello Wormhole AI'
    };
  }
  if (kind === 'responses') {
    return {
      model: modelAlias,
      input: 'Hello Wormhole AI'
    };
  }
  return {
    model: modelAlias,
    messages: [{ role: 'user', content: 'Hello Wormhole AI' }]
  };
}

const starterChannels: Channel[] = [];
const starterKeys: ApiKey[] = [];

function routeFromPath(pathname: string): Route {
  const path = pathname.replace(/^\/+|\/+$/g, '');
  if (!path) return 'home';
  const routes: Route[] = ['login', 'register', 'recover', 'console', 'about', 'wallet', 'account'];
  return routes.includes(path as Route) ? path as Route : 'not-found';
}

function App() {
  return (
    <I18nProvider>
      <SiteContent />
    </I18nProvider>
  );
}

function SiteContent() {
  const { language } = useI18n();
  return (
    <ConfirmationProvider english={language === 'en'}>
      <AppRoutes />
    </ConfirmationProvider>
  );
}

function AppRoutes() {
  const { language } = useI18n();
  const [route, setRoute] = useState<Route>(() => routeFromPath(window.location.pathname));
  const session = useGatewaySession(GATEWAY_BASE_URL);
  const identity = session.account;
  const [publicBaseUrl, setPublicBaseUrl] = useState(INITIAL_PUBLIC_BASE_URL);
  const [logoutError, setLogoutError] = useState('');
  useEffect(() => {
    const pop = () => setRoute(routeFromPath(window.location.pathname));
    window.addEventListener('popstate', pop);
    let active = true;
    void loadRuntimeConfig()
      .then((config) => {
        if (active) setPublicBaseUrl(config.publicBaseUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      window.removeEventListener('popstate', pop);
    };
  }, []);
  const navigate = (next: Route, replace = false) => {
    const path = next === 'home' ? '/' : '/' + next;
    if (path !== window.location.pathname) {
      if (replace) window.history.replaceState({}, '', path);
      else window.history.pushState({}, '', path);
    }
    setRoute(next);
    setLogoutError('');
    window.scrollTo({ top: 0 });
  };
  const destination = identity?.role === 'admin' ? 'console' : 'account';
  const entry = route === 'login' || route === 'register' || route === 'recover';
  const needsLogin = route === 'console' || route === 'account';
  let redirect: Route | undefined;
  if (identity !== undefined) {
    if (needsLogin && !identity) redirect = 'login';
    if (identity && (entry || (needsLogin && route !== destination))) redirect = destination;
  }
  useEffect(() => {
    if (redirect) navigate(redirect, true);
  }, [redirect]);
  const signOut = async () => {
    try {
      await accountRequest(GATEWAY_BASE_URL, 'logout', {});
      session.update(null);
      navigate('home', true);
    } catch (e) {
      setLogoutError((e as Error).message);
    }
  };
  const publicHeader = <>
    <Header onNavigate={navigate} identity={identity} currentRoute={route} onSignOut={signOut} />
    {identity !== undefined && identity?.role !== 'admin' && <SupportBubble key={identity?.user.id ?? 'guest'}
      base={GATEWAY_BASE_URL} english={language === 'en'} signedIn={identity?.role === 'user'} />}
  </>;
  const feedback = logoutError ? <Toast message={logoutError} onClose={() => setLogoutError('')} /> : null;
  const showLoading = (entry || needsLogin) && identity === undefined;
  if (showLoading || redirect === 'console' || (route === 'console' && redirect)) {
    return (
      <>
        {publicHeader}
        <main className="wallet-page" aria-live="polite">
          {session.error ? (
            <>
              <p>{session.error}</p>
              <Button variant="outline" onClick={() => void session.refresh()}>
                {language === 'zh' ? '重新连接' : 'Retry'}
              </Button>
            </>
          ) : (
            <p>{language === 'zh' ? '正在确认登录状态…' : 'Checking your session…'}</p>
          )}
        </main>
      </>
    );
  }
  if (route === 'console' && identity?.role === 'admin') {
    return (
      <>
        <ConsolePage user={identity.user} publicBaseUrl={publicBaseUrl} onNavigate={navigate} onSignOut={signOut} />
        {feedback}
      </>
    );
  }
  if (entry || route === 'account') {
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
        {publicHeader}
        <UserAccount
          base={GATEWAY_BASE_URL}
          apiBase={publicBaseUrl}
          english={language === 'en'}
          route={route as CustomerRoute}
          account={identity?.role === 'user' ? identity : null}
          onNavigate={navigate}
          onSession={session.update}
          onRefresh={session.refresh}
          onSignOut={signOut}
        />
        {entry && <Footer centered />}
        {feedback}
      </div>
    );
  }
  if (route === 'wallet')
    return (
      <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
        {publicHeader}
        <WalletPage baseUrl={GATEWAY_BASE_URL} english={language === 'en'} />
        <Footer />
      </div>
    );
  if (route === 'not-found') return <NotFound onNavigate={navigate} />;
  return (
    <div className="flex min-h-dvh flex-col bg-[var(--bg)]">
      {publicHeader}
      {route === 'about' ? (
        <AboutPage />
      ) : (
        <HomePage identity={identity} onNavigate={navigate} publicBaseUrl={publicBaseUrl} />
      )}
      <Footer centered={route === 'home'} />
    </div>
  );
}

function UserMenu({
  identity,
  zh,
  onNavigate,
  onSignOut
}: {
  identity: SignedIn;
  zh: boolean;
  onNavigate: (route: Route) => void;
  onSignOut?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={menuRef}>
      <Button
        variant="outline"
        size="sm"
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        className={cn(
          "h-8 rounded-full border-border/80 bg-background/90 hover:bg-muted/60 pl-1.5 pr-2.5 py-1 text-xs font-medium text-foreground transition shadow-2xs gap-1.5",
          open && "border-primary/50 bg-muted/50 ring-2 ring-primary/10"
        )}
        onClick={() => setOpen(!open)}
        title={identity.user.username}
      >
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-[10px]">
          {identity.user.username.slice(0, 1).toUpperCase()}
        </div>
        <span className="max-w-[90px] truncate font-medium sm:max-w-[130px]">{identity.user.username}</span>
        <ChevronDown size={12} className={cn("text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </Button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 rounded-2xl border border-border/80 bg-popover/98 backdrop-blur-md p-1.5 shadow-xl shadow-foreground/5 z-50 animate-in fade-in-50 zoom-in-95 duration-150">
          {/* 基本信息 */}
          <div className="flex items-center gap-2.5 px-3 py-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary font-bold text-sm ring-1 ring-border/50">
              {identity.user.username.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-xs text-foreground truncate">{identity.user.username}</div>
              <div className="mt-0.5">
                <span className={cn(
                  "inline-block rounded-full px-1.5 py-0.2 text-[10px] font-medium",
                  identity.role === 'admin'
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                    : "bg-muted text-muted-foreground"
                )}>
                  {identity.role === 'admin' ? (zh ? '系统管理员' : 'Administrator') : (zh ? '普通用户' : 'Standard user')}
                </span>
              </div>
            </div>
          </div>

          {/* 分割线 */}
          <div className="my-1 border-t border-border/60" />

          {/* 退出登录 */}
          {onSignOut && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              className="w-full justify-start gap-2 rounded-xl px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
            >
              <LogOut size={14} />
              <span>{zh ? '退出登录' : 'Sign out'}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Header({
  onNavigate,
  identity,
  currentRoute,
  onSignOut
}: {
  onNavigate: (route: Route) => void;
  identity: SignedIn | null | undefined;
  currentRoute?: Route;
  onSignOut?: () => void;
}) {
  const { language, setLanguage } = useI18n();
  const zh = language === 'zh';
  return (
    <header className="sticky top-0 z-40 border-b border-black/[0.07] bg-[#faf9f6]/80 backdrop-blur-xl backdrop-saturate-180 shadow-[inset_0_-1px_0_rgba(255,255,255,0.75),0_8px_28px_-18px_rgba(17,24,39,0.16)]">
      <div className="mx-auto flex min-h-16 max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2 sm:px-8">
      <a
        className="shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        href="/"
        aria-label="Wormhole AI"
        onClick={(e) => {
          e.preventDefault();
          onNavigate('home');
        }}
      >
        <img className="w-28 sm:w-40" src="/logo-full.svg" alt="Wormhole AI" />
      </a>
      <nav className="ms-auto hidden items-center gap-1 sm:flex" aria-label={zh ? '导航' : 'Navigation'}>
        <Button asChild variant={currentRoute === 'about' ? 'secondary' : 'ghost'} size="sm">
          <a
            href="/about"
            aria-current={currentRoute === 'about' ? 'page' : undefined}
            onClick={(e) => {
              e.preventDefault();
              onNavigate('about');
            }}
          >
            {zh ? '使用指南' : 'Getting started'}
          </a>
        </Button>
      </nav>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <Button variant="ghost"
          size="icon-sm"
          type="button"
          aria-label={zh ? 'Switch to English' : '切换至中文'}
          onClick={() => setLanguage(zh ? 'en' : 'zh')}
        >
          {zh ? 'EN' : '中'}
        </Button>
        {identity ? (
          <div className="flex items-center gap-2">
            {currentRoute !== 'account' && currentRoute !== 'console' && (
              <Button
                variant="default"
                size="sm"
                className="h-8 text-xs font-medium"
                onClick={() => onNavigate(identity.role === 'admin' ? 'console' : 'account')}
              >
                {identity.role === 'admin' ? (zh ? '管理后台' : 'Admin console') : zh ? '我的工作台' : 'My workspace'}
              </Button>
            )}
            <UserMenu
              identity={identity}
              zh={zh}
              onNavigate={onNavigate}
              onSignOut={onSignOut}
            />
          </div>
        ) : (
          <>
            <Button asChild variant="ghost" size="sm">
              <a href="/login" onClick={(e) => { e.preventDefault(); onNavigate('login'); }}>
                {zh ? '登录' : 'Sign in'}
              </a>
            </Button>
            <Button asChild variant="default" size="sm">
              <a href="/register" onClick={(e) => { e.preventDefault(); onNavigate('register'); }}>
                {zh ? '注册' : 'Register'}
              </a>
            </Button>
          </>
        )}
      </div>
      </div>
    </header>
  );
}

type HomePriceComparison = {
  checkedOn: string;
  usdCny: number;
  models: Record<string, { minRatio: number; maxRatio: number; referenceInputCny: number; referenceOutputCny: number }>;
};

type ModelPromotion = {
  id: string;
  name: string;
  tagZh: string;
  tagEn: string;
  descZh: string;
  descEn: string;
  highlight?: boolean;
};

const PROMOTED_MODELS: ModelPromotion[] = [
  {
    id: 'gpt-6.2-astra',
    name: 'gpt-6.2-astra',
    tagZh: '旗舰推理 · 复杂任务',
    tagEn: 'Flagship Reasoning · Complex Tasks',
    descZh: '专为深度编码、复杂逻辑和前沿科学推理打造的高智商旗舰大模型。',
    descEn: 'Engineered for advanced coding, intricate logic, and science research.',
    highlight: true
  },
  {
    id: 'gpt-6.2-sol',
    name: 'gpt-6.2-sol',
    tagZh: '全能主力 · 性价比之王',
    tagEn: 'Versatile Workhorse · Best Value',
    descZh: '日常开发与多场景应用的绝对主力，速度与智能极佳平衡。',
    descEn: 'The perfect daily driver balancing intelligence, high speed, and low cost.',
    highlight: true
  },
  {
    id: 'gpt-6-astra',
    name: 'gpt-6-astra',
    tagZh: '深度思考 · 代码专家',
    tagEn: 'Deep Thinking · Code Specialist',
    descZh: '具备强大上下文理解与多步推理能力，胜任系统级架构设计与推演。',
    descEn: 'Exceptional context comprehension and multi-step architectural reasoning.',
  },
  {
    id: 'gpt-6.1-sol',
    name: 'gpt-6.1-sol',
    tagZh: '极速响应 · 高并发',
    tagEn: 'Fast Response · High Throughput',
    descZh: '高并发客服、实时对话与批量任务首选，超低延迟毫秒级流式返回。',
    descEn: 'Ultra-low latency streaming for chatbots and high-volume workloads.',
  },
  {
    id: 'gpt-6-sol',
    name: 'gpt-6-sol',
    tagZh: '经典稳健 · 企业级',
    tagEn: 'Classic Robust · Enterprise Ready',
    descZh: '经久考验的生产级大模型，输出稳定规范，遵循指令丝丝入扣。',
    descEn: 'Proven production model with consistent output and strict instruction following.',
  },
  {
    id: 'gpt-6.1-terra',
    name: 'gpt-6.1-terra',
    tagZh: '超低成本 · 轻量批量',
    tagEn: 'Ultra Low Cost · Bulk Processing',
    descZh: '适合文本清洗、分类、摘要和简单翻译等批量任务。',
    descEn: 'Extreme affordability for bulk categorization, summarization, and data parsing.',
  }
];

function HomePage({
  identity,
  onNavigate,
  publicBaseUrl
}: {
  identity: SignedIn | null | undefined;
  onNavigate: (route: Route) => void;
  publicBaseUrl: string;
}) {
  const { language } = useI18n();
  const zh = language === 'zh';
  const apiBase = publicBaseUrl + '/v1';
  const curlCommand = 'curl "' + apiBase + '/models" -H "Authorization: Bearer $WORMHOLE_API_KEY"';
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [pricingError, setPricingError] = useState(false);
  const orbitAnchor = useRef<HTMLDivElement>(null);
  const [infoData, setInfoData] = useState<{
    prices?: Record<string, { standard?: { input: number; output: number; read?: number; write?: number | null } }>;
    usableModels?: string[];
    standardApiComparison?: HomePriceComparison;
  }>();

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${GATEWAY_BASE_URL}/payments/info?usable=true`, { cache: 'no-store', credentials: 'omit', signal: controller.signal })
      .then(response => {
        if (!response.ok) throw Error('Pricing is unavailable');
        return response.json();
      })
      .then(data => {
        if (!Array.isArray(data.usableModels) || !data.prices) throw Error('Pricing is unavailable');
        if (!controller.signal.aborted) setInfoData(data);
      })
      .catch(() => { if (!controller.signal.aborted) setPricingError(true); });
    return () => controller.abort();
  }, []);

  const comparison = infoData?.standardApiComparison;
  const usable = new Set(infoData?.usableModels ?? []);
  const activeModels = PROMOTED_MODELS.flatMap(model => {
    const price = infoData?.prices?.[model.id]?.standard;
    return usable.has(model.id) && price && Number.isFinite(price.input) && Number.isFinite(price.output) ? [{ model, price }] : [];
  });
  const hasComparison = activeModels.some(({ model }) => Boolean(comparison?.models[model.id]));
  const formatRate = (ratio: number) => {
    const scaled = ratio * (zh ? 10 : 100);
    return scaled > 0 && scaled < 0.01 ? '<0.01' : String(Number(scaled.toFixed(2)));
  };
  const priceText = (value: number) => value.toLocaleString(zh ? 'zh-CN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  const copyAddress = async () => {
    try {
      await writeClipboard(apiBase);
      setCopied(true);
      setCopyError('');
    } catch {
      setCopyError(zh ? '请选中地址并复制。' : 'Select and copy the address.');
    }
  };
  const copyCurl = async () => {
    try {
      await writeClipboard(curlCommand);
      setCopiedCurl(true);
      setTimeout(() => setCopiedCurl(false), 2000);
    } catch {
      // fallback
    }
  };
  const action =
    identity?.role === 'admin'
      ? zh
        ? '进入管理后台'
        : 'Open admin console'
      : identity
        ? zh
          ? '进入我的工作台'
          : 'Open my workspace'
        : zh
          ? '创建账号'
          : 'Create an account';
  return (
    <main className="relative flex flex-1 flex-col min-w-0 bg-[var(--bg)]">
      <LiquidGlassDefs />
      <HomePointerTrail />
      <section className="relative isolate overflow-hidden bg-[#06080c] text-white">
        <HomeHeroBackground orbitAnchor={orbitAnchor} />
        <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-8 px-4 py-14 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:py-20">
          <div className="min-w-0">
            <LiquidGlass
              tone="dark"
              interactive={false}
              className="mb-4 inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white/90"
            >
              <span className="size-1.5 rounded-full bg-[#73c9cc] shadow-[0_0_8px_#73c9cc]" aria-hidden="true" />
              <span>{zh ? '统一大模型网关 · 人民币按量计费' : 'Unified AI Gateway · CNY Pay-as-you-go'}</span>
            </LiquidGlass>
            <h1 className="m-0 text-5xl leading-none font-semibold tracking-[-0.04em] sm:text-7xl">Wormhole AI</h1>
            <h2 className="m-0 mt-4 text-xl leading-snug font-medium text-white/90 sm:text-2xl">{zh ? '为你的应用接入 AI 模型' : 'Connect your app to AI models'}</h2>
            <p className="m-0 mt-3 max-w-[52ch] text-base leading-relaxed text-white/75">
              {zh
                ? '用一个 API 地址访问已开放的模型。在工作台创建密钥、充值人民币余额，逐笔查看调用费用。'
                : 'Access available models through one API. Create keys, fund your CNY wallet, and track what each request costs.'}
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-2.5">
              <Button
                variant="default" className="bg-[#daf1e9] text-[#17342c] shadow-[0_10px_28px_-10px_rgba(115,201,204,0.48),inset_0_1px_0_rgba(255,255,255,0.85)] hover:bg-[#c5e8db]"
                onClick={() => onNavigate(identity?.role === 'admin' ? 'console' : identity ? 'account' : 'register')}
              >
                {action}
                <ArrowRight size={17} />
              </Button>
              <Button asChild variant="ghost" className="liquid-glass-btn-dark text-white hover:text-white">
                <a href="#getting-started">{zh ? '接入指南' : 'Quickstart'}</a>
              </Button>
            </div>
            <LiquidGlass
              tone="dark"
              className="mt-5 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl py-1.5 pe-1.5 ps-3.5 text-sm"
            >
              <span className="text-white/65">Base URL</span>
              <code className="min-w-0 wrap-anywhere text-white/95">{apiBase}</code>
              <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 rounded-lg text-white hover:bg-white/15 hover:text-white" onClick={copyAddress} aria-label={zh ? '复制 API 地址' : 'Copy API address'}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </LiquidGlass>
            {copyError && <small role="status">{copyError}</small>}
          </div>
          <div className="mx-auto w-full max-w-md lg:max-w-none"><WormholeOrbit anchor={orbitAnchor} /></div>
        </div>
      </section>

      {/* Promotional Model Matrix Section */}
      <section id="pricing-matrix" className="relative isolate overflow-hidden border-b border-border/60 bg-muted/20 py-12 sm:py-16 scroll-mt-14">
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
          <div className="absolute -top-24 left-[8%] h-72 w-72 rounded-full bg-[#73c9cc]/18 blur-3xl" />
          <div className="absolute top-1/3 right-[6%] h-80 w-80 rounded-full bg-[#edad69]/18 blur-3xl" />
          <div className="absolute -bottom-24 left-[42%] h-72 w-72 rounded-full bg-[#8f9fda]/14 blur-3xl" />
        </div>
        <div className="mx-auto max-w-7xl px-4 sm:px-8">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
            <div>
              <h2 className="m-0 text-2xl font-bold tracking-tight sm:text-3xl text-foreground">
                {zh ? '开放模型价格' : 'Available model prices'}
              </h2>
              <p className="m-0 mt-2 max-w-[65ch] text-sm text-muted-foreground leading-relaxed">
                {zh
                  ? '每百万 Token 的人民币标准价。标有折扣的模型对照 OpenAI 标准短上下文未缓存输入和输出价。'
                  : 'Standard CNY rates per million tokens. Discounts compare with uncached OpenAI standard short-context input and output rates.'}
              </p>
            </div>
            {hasComparison && comparison && <div className="flex items-center gap-2 shrink-0">
              <LiquidGlass tone="light" interactive={false} className="rounded-full px-3.5 py-1.5 text-xs font-medium text-muted-foreground">
                {zh ? `比价基准：1 USD = ¥${comparison.usdCny}` : `Comparison FX: 1 USD = ¥${comparison.usdCny}`}
              </LiquidGlass>
            </div>}
          </div>

          {!activeModels.length && (
            <LiquidGlass tone="light" interactive={false} className="rounded-2xl p-5 text-sm text-muted-foreground" role="status">
              {pricingError ? (zh ? '暂时无法获取模型报价。' : 'Model prices are temporarily unavailable.')
                : infoData ? (zh ? '暂无可用模型报价。' : 'No published model prices yet.')
                  : (zh ? '正在获取模型报价…' : 'Loading model prices…')}
            </LiquidGlass>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {activeModels.map(({ model: m, price }) => {
              const compare = comparison?.models[m.id];
              const reference = compare && Number.isFinite(compare.referenceInputCny) && Number.isFinite(compare.referenceOutputCny) ? compare : undefined;
              const low = compare ? formatRate(compare.minRatio) : '';
              const high = compare ? formatRate(compare.maxRatio) : '';
              const discountLabel = compare ? `${low === high ? high : `${low}–${high}`}${zh ? ' 折' : '% of standard'}` : '';

              return (
                <LiquidGlass
                  key={m.id}
                  tone="light"
                  className={`group flex flex-col justify-between rounded-2xl p-5 hover:-translate-y-1 ${
                    m.highlight
                      ? 'ring-1 ring-[#2f746e]/25'
                      : ''
                  }`}
                >
                  {m.highlight && (
                    <div className="absolute -top-3 right-5 z-10">
                      <span className="inline-flex items-center gap-1 rounded-full border border-white/40 bg-primary/92 px-3 py-0.5 text-[11px] font-semibold text-primary-foreground shadow-[0_6px_16px_-4px_rgba(17,24,39,0.35),inset_0_1px_0_rgba(255,255,255,0.35)] backdrop-blur-md">
                        <Sparkles size={11} />
                        {zh ? '热门推荐' : 'Popular'}
                      </span>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="m-0 font-mono text-lg font-bold text-foreground tracking-tight group-hover:text-primary transition-colors">
                          {m.name}
                        </h3>
                        <span className="mt-1 inline-block text-xs font-medium text-muted-foreground">
                          {zh ? m.tagZh : m.tagEn}
                        </span>
                      </div>
                      {discountLabel && <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2.5 py-1 text-xs font-bold text-amber-800 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:text-amber-300">
                        <Zap size={12} className="fill-current text-amber-600 dark:text-amber-400" />
                        {discountLabel}
                      </span>}
                    </div>

                    <div className="relative group/desc mt-3">
                      <p
                        title={zh ? m.descZh : m.descEn}
                        className="truncate text-xs leading-relaxed text-muted-foreground cursor-default"
                      >
                        {zh ? m.descZh : m.descEn}
                      </p>
                      <div
                        role="tooltip"
                        className="pointer-events-none absolute left-0 bottom-full mb-1.5 z-30 hidden w-max max-w-[280px] sm:max-w-[320px] rounded-xl border border-white/75 bg-white/90 p-2.5 text-xs leading-relaxed text-popover-foreground shadow-xl backdrop-blur-xl group-hover/desc:block"
                      >
                        {zh ? m.descZh : m.descEn}
                      </div>
                    </div>

                    {/* Price comparison card */}
                    <div className="mt-4 rounded-xl border border-white/75 bg-white/55 p-3.5 space-y-2.5 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.88),0_2px_8px_-4px_rgba(20,32,42,0.06)]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">{zh ? '输入价格 (1M)' : 'Input (1M)'}</span>
                        <div className="flex items-baseline gap-2">
                          {reference && <span className="text-[11px] text-muted-foreground line-through">
                            ¥{priceText(reference.referenceInputCny)}
                          </span>}
                          <span className="text-base font-bold tabular-nums text-foreground">
                            ¥{priceText(price.input)}
                          </span>
                        </div>
                      </div>
                      <div className="h-px bg-border/45" />
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium">{zh ? '输出价格 (1M)' : 'Output (1M)'}</span>
                        <div className="flex items-baseline gap-2">
                          {reference && <span className="text-[11px] text-muted-foreground line-through">
                            ¥{priceText(reference.referenceOutputCny)}
                          </span>}
                          <span className="text-base font-bold tabular-nums text-foreground">
                            ¥{priceText(price.output)}
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>

                  <div className="mt-5 pt-3 border-t border-border/40">
                    <Button
                      variant={m.highlight ? 'default' : 'outline'}
                      className={`w-full text-xs font-semibold h-9 gap-1.5 ${
                        m.highlight
                          ? 'shadow-[0_8px_18px_-8px_rgba(17,24,39,0.45),inset_0_1px_0_rgba(255,255,255,0.22)]'
                          : 'border-white/80 bg-white/65 backdrop-blur-md hover:bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]'
                      }`}
                      onClick={() => onNavigate(identity?.role === 'admin' ? 'console' : identity ? 'account' : 'register')}
                    >
                      <span>
                        {identity
                          ? zh
                            ? '在工作台调用'
                            : 'Use in workspace'
                          : zh
                            ? '立即注册接入'
                            : 'Get started'}
                      </span>
                      <ArrowRight size={14} />
                    </Button>
                  </div>
                </LiquidGlass>
              );
            })}
          </div>
        </div>
      </section>
      <section id="getting-started" className="relative isolate flex-1 mx-auto w-full max-w-7xl scroll-mt-20 px-4 py-10 sm:px-8 sm:py-14">
        <div className="pointer-events-none absolute inset-x-0 top-8 -z-10 flex justify-between overflow-hidden px-8" aria-hidden="true">
          <div className="h-56 w-56 rounded-full bg-[#73c9cc]/12 blur-3xl" />
          <div className="h-56 w-56 rounded-full bg-[#edad69]/12 blur-3xl" />
        </div>
        <h2 className="m-0 text-2xl font-semibold tracking-tight sm:text-3xl">{zh ? '从注册到第一次调用' : 'Make your first API call'}</h2>
        <ol className="m-0 mt-6 grid list-none gap-4 p-0 sm:grid-cols-3">
          {(zh
            ? [
                ['创建账号和密钥', '注册后保存恢复码，在工作台为你的应用创建 API Key。'],
                ['为钱包充值', '用微信扫描经营收款码付款，收款人核实后按实收金额入账。'],
                ['调用模型并查看扣费', '从工作台选择已开放的模型，在客户端填入 API 地址和 Key。']
              ]
            : [
                ['Create an account and key', 'Save your recovery code, then create an API key for your application.'],
                [
                  'Fund your wallet',
                  'Scan the WeChat Pay code. The amount received is credited after manual confirmation.'
                ],
                [
                  'Call a model',
                  'Use the API address, a published model and your key. Review charges in your workspace.'
                ]
              ]
          ).map(([title, body], index) => (
            <li key={title}>
              <LiquidGlass tone="light" className="grid h-full content-start gap-2 rounded-2xl p-4 sm:p-5 hover:-translate-y-0.5">
                <span className="inline-flex w-fit items-center rounded-full border border-[#346267]/20 bg-[#346267]/10 px-2.5 py-0.5 text-xs font-semibold text-[var(--accent-2)] tabular-nums" aria-hidden="true">
                  0{index + 1}
                </span>
                <h3 className="m-0 text-base font-semibold">{title}</h3>
                <p className="m-0 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </LiquidGlass>
            </li>
          ))}
        </ol>
        <LiquidGlass tone="light" className="mt-6 grid gap-4 rounded-2xl p-4 sm:p-5 lg:grid-cols-[minmax(0,0.5fr)_minmax(0,1fr)] lg:items-center">
          <div>
            <h3 className="m-0 text-base font-semibold">{zh ? '查询可用模型' : 'List available models'}</h3>
            <p className="m-0 mt-1 text-sm text-muted-foreground">
              {zh
                ? '先将自己的 Key 存入环境变量 WORMHOLE_API_KEY。'
                : 'Set WORMHOLE_API_KEY to a key created in your workspace.'}
            </p>
          </div>
          <LiquidGlass tone="obsidian" className="flex items-center justify-between gap-3 overflow-hidden rounded-xl p-3 pe-2 text-sm text-white sm:p-4 sm:pe-3">
            <pre className="m-0 min-w-0 flex-1 overflow-x-auto font-mono text-xs text-[#a7f3d0] sm:text-sm">
              <code className="text-[#a7f3d0]">{curlCommand}</code>
            </pre>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="shrink-0 rounded-lg text-white/80 hover:bg-white/15 hover:text-white"
              onClick={copyCurl}
              aria-label={zh ? '复制调用命令' : 'Copy command'}
            >
              {copiedCurl ? <Check size={16} /> : <Copy size={16} />}
            </Button>
          </LiquidGlass>
        </LiquidGlass>
      </section>
    </main>
  );
}

function AboutPage() {
  const { language } = useI18n();
  const zh = language === 'zh';
  return (
    <main className="flex-1 mx-auto grid w-full max-w-5xl content-start gap-6 px-4 py-8 sm:px-8 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-5">
        <div>
          <h1 className="m-0 text-3xl font-semibold tracking-tight sm:text-4xl">{zh ? '使用指南' : 'Getting started'}</h1>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            {zh ? '了解账号管理、余额充值以及如何接入各类 AI 客户端。' : 'Learn about account management, wallet top-ups, and client integration.'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="default" size="sm">
            <a href="/register">{zh ? '免费注册' : 'Register'}</a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/login">{zh ? '立即登录' : 'Sign in'}</a>
          </Button>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card as="section" className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#edf4f1] text-[#2f746e]">
            <KeyRound size={20} aria-hidden="true" />
          </div>
          <h2 className="m-0 text-base font-semibold">{zh ? '账户与 API Key' : 'Account and API keys'}</h2>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            {zh
              ? '使用用户名和密码登录。首次注册后保存恢复码，用于找回账户。你创建的多个 Key 共用一个钱包，可随时单独撤销。'
              : 'Sign in with your username and password. Save your recovery code when registering. Keys share your wallet and can be revoked individually.'}
          </p>
        </Card>
        <Card as="section" className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#f9f3ea] text-[#aa742e]">
            <CreditCard size={20} aria-hidden="true" />
          </div>
          <h2 className="m-0 text-base font-semibold">{zh ? '充值与扣费' : 'Payments and pricing'}</h2>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            {zh
              ? '在工作台生成充值订单，微信扫码付款并在必填项输入网站订单号。收款人核对后按实收入账。模型按公布的人民币价格扣费，订单和扣费明细可在工作台查看。'
              : 'Create a top-up in your workspace and enter its order number into the required field when paying with WeChat. The recipient credits the amount received. Model usage is billed in CNY and listed alongside your top-ups.'}
          </p>
        </Card>
        <Card as="section" className="flex flex-col gap-3 p-5 sm:p-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#eaf4ff] text-[#2563eb]">
            <Code2 size={20} aria-hidden="true" />
          </div>
          <h2 className="m-0 text-base font-semibold">{zh ? '连接客户端' : 'Connect your client'}</h2>
          <p className="m-0 text-sm leading-relaxed text-muted-foreground">
            {zh
              ? '复制工作台显示的 API 地址，填入自己的 Key，通过 GET /v1/models 查看当前可用模型。余额不足或模型未开放时，工作台会显示相应状态。'
              : 'Copy the API address from your workspace, enter your key and call GET /v1/models to list available models. Check your wallet balance before sending a model request.'}
          </p>
        </Card>
      </div>
    </main>
  );
}

function Footer({ centered = false }: { centered?: boolean }) {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-border bg-background">
      <div className={`mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-5 text-sm text-muted-foreground sm:px-8${centered ? ' justify-center text-center' : ''}`}>
        <Button asChild variant="link" size="sm"><a href="/about">{t('Getting started')}</a></Button>
        <span>© 2026 A Smile</span>
        <span>AGPL-3.0-only</span>
      </div>
    </footer>
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

function mapApiKey(item: GatewayApiKey): ApiKey {
  return {
    id: item.id,
    name: item.name || item.id,
    value: item.keyPreview || item.key || '***',
    role: item.role || 'service',
    created: formatDateLabel(item.createdAt, 'Config'),
    lastUsed: item.lastUsedAt ? formatDateLabel(item.lastUsedAt) : 'No recent use',
    prepaid: item.prepaid,
    limit: `${item.perMinute ?? 0} / min`,
    perMinute: item.perMinute ?? 0,
    enabled: item.enabled !== false,
    status: item.enabled === false ? 'Paused' : 'Active'
  };
}

function mapChannels(providers: Record<string, GatewayProvider>, models: Record<string, GatewayModel>, requests: RequestLog[]): Channel[] {
  const attempts = requests.flatMap((request) => request.attempts || []);
  return Object.entries(providers).map(([id, provider]) => {
    const relatedModels = Object.entries(models)
      .filter(([, model]) => model.provider === id)
      .map(([alias, model]) => `${alias} -> ${model.upstreamModel}`);
    const configured = provider.type === 'mock' || provider.apiKeyConfigured === true;
    const paused = provider.enabled === false;
    const recentAttempts = attempts.filter((attempt) => attempt.provider === id && attempt.status !== 499);
    return {
      id,
      name: provider.name || id,
      provider: provider.type || 'provider',
      modelGroup: provider.modelGroup || 'default',
      models: relatedModels.length ? relatedModels.join(', ') : 'No aliases mapped',
      latency: recentAttempts.length
        ? Math.round(recentAttempts.reduce((total, attempt) => total + attempt.durationMs, 0) / recentAttempts.length)
        : undefined,
      success: recentAttempts.length
        ? recentAttempts.filter((attempt) => attempt.status >= 200 && attempt.status < 300).length / recentAttempts.length * 100
        : undefined,
      balance: provider.type === 'mock' ? 'Local mock' : provider.apiKeyConfigured ? 'Credential ready' : 'Missing credential',
      status: paused ? 'Paused' : configured ? 'Ready' : 'Degraded',
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

type ConsoleView = 'overview' | 'keys' | 'channels' | 'groups' | 'pricing' | 'logs' | 'playground' | 'billing' | 'payments' | 'users' | 'support' | 'profile';

const validConsoleViews: ConsoleView[] = [
  'overview',
  'keys',
  'channels',
  'groups',
  'pricing',
  'logs',
  'playground',
  'billing',
  'payments',
  'users',
  'support',
  'profile'
];

function getInitialConsoleView(): ConsoleView {
  const tab = new URLSearchParams(window.location.search).get('tab') as ConsoleView;
  return validConsoleViews.includes(tab) ? tab : 'overview';
}

function ConsolePage({
  user,
  publicBaseUrl,
  onNavigate,
  onSignOut
}: {
  user: UserState;
  publicBaseUrl: string;
  onNavigate: (route: Route) => void;
  onSignOut: () => void;
}) {
  const { language, t } = useI18n();
  const [view, setView] = useState<ConsoleView>(getInitialConsoleView);
  const [navOpen, setNavOpen] = useState(false);
  const showView = (next: ConsoleView, pushHistory = true) => {
    setView(next);
    setNavOpen(false);
    if (pushHistory) {
      const url = new URL(window.location.href);
      if (next === 'overview') url.searchParams.delete('tab');
      else url.searchParams.set('tab', next);
      window.history.pushState({}, '', url.pathname + url.search);
    }
    document.getElementById('console-content')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onPop = () => {
      const tab = new URLSearchParams(window.location.search).get('tab') as ConsoleView;
      setView(validConsoleViews.includes(tab) ? tab : 'overview');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [keys, setKeys] = useState<ApiKey[]>(starterKeys);
  const [channels, setChannels] = useState<Channel[]>(starterChannels);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [requests, setRequests] = useState<RequestLog[]>([]);
  const [usage, setUsage] = useState<UsageSummary>(emptyUsageSummary);
  const [gatewayState, setGatewayState] = useState<'loading' | 'connected' | 'error'>('loading');
  const [gatewayError, setGatewayError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState('');
  const [testKey, setTestKey] = useState<{ id: string; secret: string }>();
  const serviceApiKey = testKey?.secret || '';

  const refreshGateway = async (silent = false) => {
    setRefreshing(true);
    try {
      const [providersResult, modelsResult, keysResult, requestsResult, usageResult] = await Promise.all([
        gatewayRequest<{ data: Record<string, GatewayProvider> }>('/admin/providers'),
        gatewayRequest<{ data: Record<string, GatewayModel> }>('/admin/models'),
        gatewayRequest<{ data: GatewayApiKey[] }>('/admin/api-keys'),
        gatewayRequest<{ data: RequestLog[] }>('/admin/requests?limit=50'),
        gatewayRequest<{ data: UsageSummary }>('/admin/usage?limit=500').catch(() => ({ data: emptyUsageSummary }))
      ]);
      const providerMap = providersResult.data || {};
      const modelMap = modelsResult.data || {};
      setChannels(mapChannels(providerMap, modelMap, requestsResult.data || []));
      setModels(mapModelRows(modelMap));
      setKeys((keysResult.data || []).map(mapApiKey));
      setRequests(requestsResult.data || []);
      setUsage(usageResult.data || emptyUsageSummary);
      setGatewayState('connected');
      setGatewayError('');
      if (!silent) {
        setToast(t('Gateway data refreshed.'));
      }
    } catch (error) {
      setGatewayState('error');
      setGatewayError((error as Error).message);
      if (!silent) {
        setToast(`${t('Gateway connection failed')}: ${(error as Error).message}`);
      }
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshGateway(true);
  }, [user.username, language]);

  const saveKey = async (form: ApiKeyFormState) => {
    const perMinute = Number(form.perMinute || 0);
    if (!form.name.trim()) throw new Error(t('Key name') + ' ' + t('Please complete the required fields.'));
    if (!Number.isInteger(perMinute) || perMinute < 0) {
      throw new Error(t('Rate limit per minute') + ' ' + t('Please complete the required fields.'));
    }
    const creating = !form.id;
    const path = '/admin/api-keys' + (creating ? '' : '/' + encodeURIComponent(form.id));
    const { key, secret } = await gatewayRequest<{ key: GatewayApiKey; secret?: string }>(path, {
      method: creating ? 'POST' : 'PUT',
      body: { name: form.name.trim(), perMinute, enabled: form.enabled, prepaid: form.prepaid,
        ...(creating ? { role: 'service' } : {}) }
    });
    const saved = mapApiKey(key);
    if (creating) {
      setKeys((current) => [{ ...saved, value: secret || saved.value }, ...current]);
      if (secret && saved.enabled) setTestKey({ id: saved.id, secret });
    } else {
      setKeys((current) => current.map((item) => (item.id === form.id ? { ...saved, value: item.value } : item)));
      if (!saved.enabled) setTestKey((current) => current?.id === saved.id ? undefined : current);
    }
    setToast(t(creating ? 'Internal API key created. The secret is shown once in the table.' : 'Internal API key updated.'));
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
      if (nextSecret && nextKey.role === 'service' && nextKey.enabled) {
        setTestKey({ id: nextKey.id, secret: nextSecret });
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
      setTestKey((current) => current?.id === id ? undefined : current);
      setToast(t('API key deleted.'));
    } catch (error) {
      setToast((error as Error).message);
    }
  };

  const changePassword = async (form: PasswordFormState) => {
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
  };

  const saveChannel = async (form: ChannelFormState) => {
    const id = form.id.trim();
    const type = form.type;
    const baseUrl = form.baseUrl.trim();
    const apiKey = form.apiKey.trim();
    const apiKeyEnv = form.apiKeyEnv.trim();
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
        modelGroup: form.modelGroup.trim(),
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

  const zh = language === 'zh';
  const sections = [
    {
      title: zh ? '网关' : 'Gateway',
      items: [
        { view: 'overview', label: 'Overview', Icon: BarChart3 },
        { view: 'channels', label: 'Channels', Icon: Network },
        { view: 'groups', label: 'Model groups', Icon: Layers3 },
        { view: 'keys', label: 'API Keys', Icon: KeyRound },
        { view: 'playground', label: 'Playground', Icon: Play }
      ]
    },
    {
      title: zh ? '运营' : 'Operations',
      items: [
        { view: 'users', label: 'User accounts', Icon: Users },
        { view: 'support', label: 'Customer support', Icon: MessageCircle },
        { view: 'payments', label: 'Payment collection', Icon: CreditCard },
        { view: 'pricing', label: 'CNY pricing', Icon: CircleDollarSign },
        { view: 'logs', label: 'Request logs', Icon: Activity },
        { view: 'billing', label: 'Billing', Icon: ReceiptText }
      ]
    }
  ] as const;

  const navigation = (dark: boolean) => (
    <nav className="grid gap-5" aria-label={zh ? '后台导航' : 'Console navigation'}>
      {sections.map(section => (
        <div className="grid gap-1" key={section.title}>
          <span className={dark ? 'px-2 text-xs text-slate-400' : 'px-2 text-xs text-muted-foreground'}>{section.title}</span>
          {section.items.map(({view: destination, label, Icon}) => (
            <ConsoleNav key={destination} dark={dark} icon={<Icon size={17} />} label={t(label)} active={view === destination} onClick={() => showView(destination)} />
          ))}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-[#f4f6f5] min-[781px]:grid min-[781px]:h-dvh min-[781px]:grid-cols-[14rem_minmax(0,1fr)] min-[781px]:grid-rows-[minmax(0,1fr)] min-[781px]:overflow-hidden">
      <aside className="hidden min-h-0 min-w-0 flex-col gap-6 overflow-x-hidden overflow-y-auto bg-[#15232b] p-4 text-white min-[781px]:flex">
        <Button variant="ghost" className="my-1 w-full justify-start px-2 hover:bg-white/10 hover:text-white" type="button" onClick={() => onNavigate('home')} aria-label={zh ? '返回网站首页' : 'Go to site home'}>
          <img className="w-40" src="/logo-full-inverse.svg" alt="Wormhole AI" />
        </Button>
        {navigation(true)}
        <Button variant="ghost" className="mt-auto w-full justify-start text-slate-300 hover:bg-white/10 hover:text-white" type="button" onClick={onSignOut}>
          <LogOut size={17} />{t('Sign out')}
        </Button>
      </aside>
      <header className="flex items-center justify-between gap-4 bg-[#15232b] px-4 py-2 text-white min-[781px]:hidden">
        <Button variant="ghost" className="px-1 hover:bg-white/10 hover:text-white" type="button" onClick={() => onNavigate('home')} aria-label={zh ? '返回网站首页' : 'Go to site home'}>
          <img className="w-32" src="/logo-full-inverse.svg" alt="Wormhole AI" />
        </Button>
        <Button variant="ghost" size="icon" className="hover:bg-white/10 hover:text-white" type="button" aria-expanded={navOpen}
          aria-label={zh ? '打开后台菜单' : 'Open console menu'} onClick={() => setNavOpen(true)}><Menu size={20} /></Button>
      </header>
      {navOpen && <FormDialog title={zh ? '后台导航' : 'Console navigation'} closeLabel={t('Close')} onClose={() => setNavOpen(false)} drawer>
        <div className={dialogBody}>
          {navigation(false)}
          <Button variant="outline" type="button" onClick={onSignOut}><LogOut size={17} />{t('Sign out')}</Button>
        </div>
      </FormDialog>}
      <main className="console-main min-h-0 min-w-0 px-4 pb-8 min-[781px]:overflow-auto min-[781px]:px-7 lg:px-9" id="console-content">
        <header className="console-topbar sticky top-0 z-10 mb-5 flex-wrap border-b border-border bg-[#f4f6f5] pt-4 pb-3 min-[781px]:pt-5">
          <h1>{t(viewTitle(view))}</h1>
          <div className="topbar-actions">
            <span className="console-connection" data-state={gatewayState} role="status">
              <i aria-hidden="true"/>
              {gatewayState === 'connected' ? (zh ? '网关已连接' : 'Gateway connected') :
                gatewayState === 'error' ? (zh ? '连接失败' : 'Connection failed') : (zh ? '连接中' : 'Connecting')}
            </span>
            <Button variant="outline" type="button" onClick={() => refreshGateway()} disabled={refreshing}>
              <RefreshCcw size={15} />
              {refreshing ? t('Refreshing') : t('Refresh')}
            </Button>
            <Button variant="ghost" className="user-chip" type="button" onClick={() => showView('profile')}
              aria-label={t('Profile')} aria-current={view === 'profile' ? 'page' : undefined}>
              <User size={16} />
              <span>{user.name}</span>
            </Button>
          </div>
        </header>
        {view === 'overview' && <Overview channels={channels} models={models} keys={keys} requests={requests} usage={usage}
          state={gatewayState} error={gatewayError} onNavigate={showView} onRefresh={() => void refreshGateway(true)}/>}
        {view === 'keys' && <KeysView keys={keys} onSave={saveKey} onRotate={rotateKey} onDelete={deleteKey} onToast={setToast} />}
        {view === 'channels' && <ChannelsView channels={channels} onSave={saveChannel} onToggle={toggleChannel} onDelete={deleteChannel} onCheckHealth={checkChannelHealth} onModelsImported={() => refreshGateway(true)} />}
        {view === 'playground' && (
          <Playground
            base={GATEWAY_BASE_URL}
            models={models.map((m) => ({
              id: m.alias,
              name: m.alias,
              endpoints: m.model.endpoints,
              provider: m.model.provider
            }))}
            isAdmin
            serviceApiKey={serviceApiKey}
            onToast={setToast}
            english={language === 'en'}
          />
        )}
        {view === 'users' && <UsersAdmin />}
        {view === 'support' && <SupportAdmin request={gatewayRequest} english={!zh} />}
        {view === 'payments' && <PaymentAdmin base={GATEWAY_BASE_URL} publicBaseUrl={publicBaseUrl} english={language === 'en'} />}
        {view === 'groups' && <GroupsAdmin request={gatewayRequest} t={(chinese, english) => zh ? chinese : english}
          onChannels={() => showView('channels')} renderModels={(group, reloadGroups) => (
            <GroupModelMappings key={group.id} group={group} channels={channels} models={models} serviceApiKey={serviceApiKey}
              onRefresh={async () => { await refreshGateway(true); reloadGroups(); }} onToast={setToast} />
          )} />}
        {view === 'pricing' && <CnyPricingAdmin request={gatewayRequest} t={(chinese, english) => zh ? chinese : english} aliases={models.map(({ alias }) => alias)} />}
        {view === 'logs' && <RequestLogs base={GATEWAY_BASE_URL} english={!zh} admin />}
        {view === 'billing' && <BillingView />}
        {view === 'profile' && <ProfileView user={user} onChangePassword={changePassword} />}
      </main>
      {toast && <Toast message={toast} onClose={() => setToast('')} />}
    </div>
  );
}

function UsersAdmin() {
  const askConfirmation = useConfirmation();
  const { language } = useI18n();
  const zh = language === 'zh';
  type Member = { id: string; username: string; enabled: number; created: string; balance: string };
  const [users, setUsers] = useState<Member[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load(after = '') {
    setBusy(true);
    setError('');
    try {
      const result = await gatewayRequest<{ data: Member[]; next: string | null }>(
        '/admin/users?after=' + encodeURIComponent(after)
      );
      setUsers((current) => (after ? [...current, ...result.data] : result.data));
      setNext(result.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function toggle(user: Member) {
    if (
      user.enabled &&
      !await askConfirmation(
        zh ? '停用该用户会注销所有会话，并暂停其 API Key。继续吗？' : 'Suspend this account and its API keys?'
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      const { data } = await gatewayRequest<{ data: Member }>('/admin/users/' + user.id, {
        method: 'PUT',
        body: { enabled: !user.enabled }
      });
      setUsers((current) => current.map((item) => (item.id === user.id ? { ...item, enabled: data.enabled } : item)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card as="section" className="panel">
      <div className="panel-heading">
        <h2>{zh ? '注册用户' : 'Registered users'}</h2>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {zh ? '刷新' : 'Refresh'}
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !users.length && <p>{zh ? '暂无注册用户' : 'No registered users'}</p>}
      {users.length > 0 && <Table className="console-data">
        <TableHeader><TableRow>
          {(zh ? ['用户名','余额','注册时间','账户状态','操作'] : ['Username','Balance','Registered','Status','Actions']).map(label => (
            <TableHead key={label} scope="col" className={label === (zh ? '操作' : 'Actions') ? 'text-right' : undefined}>{label}</TableHead>
          ))}
        </TableRow></TableHeader>
        <TableBody>{users.map(user => <TableRow key={user.id}>
          <TableHead scope="row">{user.username}</TableHead><TableCell>¥{user.balance}</TableCell><TableCell>{new Date(user.created).toLocaleDateString()}</TableCell>
          <TableCell><StatusBadge status={user.enabled ? 'Active' : 'Paused'}/></TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className={user.enabled ? "h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" : "h-8 w-8 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600"}
                disabled={busy}
                onClick={() => void toggle(user)}
                title={user.enabled ? (zh ? '停用用户' : 'Suspend') : (zh ? '启用用户' : 'Enable')}
                aria-label={user.enabled ? (zh ? '停用用户' : 'Suspend') : (zh ? '启用用户' : 'Enable')}
              >
                {user.enabled ? <UserX size={15} /> : <UserCheck size={15} />}
              </Button>
            </div>
          </TableCell>
        </TableRow>)}</TableBody>
      </Table>}

      {next && (
        <Button variant="outline" disabled={busy} onClick={() => void load(next)}>
          {zh ? '加载更多' : 'Load more'}
        </Button>
      )}
    </Card>
  );
}

function ConsoleNav({ icon, label, active, dark, onClick }: { icon: ReactNode; label: string; active: boolean; dark: boolean; onClick: () => void }) {
  return (
    <Button variant="ghost" className={dark
      ? (active ? 'w-full justify-start bg-white/12 text-[#bde9dc] hover:bg-white/15 hover:text-[#bde9dc]' : 'w-full justify-start text-slate-300 hover:bg-white/10 hover:text-white')
      : (active ? 'w-full justify-start bg-accent text-accent-foreground' : 'w-full justify-start')} aria-current={active ? 'page' : undefined} type="button" onClick={onClick}>
      {icon}
      {label}
    </Button>
  );
}

function viewTitle(view: string) {
  const names: Record<string, string> = {
    overview: 'API gateway overview',
    keys: 'API key management',
    channels: 'Provider channels',
    groups: 'Model groups',
    pricing: 'CNY pricing',
    logs: 'Request logs',
    playground: 'Request playground',
    billing: 'Spend and billing',
    payments: 'Payment collection',
    users: 'User accounts',
    support: 'Customer support',
    profile: 'Profile center'
  };
  return names[view] || 'Console';
}

function ProfileView({
  user,
  onChangePassword
}: {
  user: UserState;
  onChangePassword: (form: PasswordFormState) => Promise<void>;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState<PasswordFormState>({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  });
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const closeForm = () => { setOpen(false); setError(''); setForm({ currentPassword: '', newPassword: '', confirmPassword: '' }); };

  const updateForm = (patch: Partial<PasswordFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try { await onChangePassword(form); closeForm(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  return (
    <div className="console-stack">
      <Card as="section" className="panel">
        <PanelTitle icon={<User size={18} />} title={t('Account')} />
        <div className="profile-summary">
          <div className="user-avatar">
            <User size={18} />
          </div>
          <div>
            <strong>{user.name}</strong>
            <span>{user.username}</span>
          </div>
        </div>
      </Card>
      <Card as="section" className="panel">
        <div className="panel-heading">
          <PanelTitle icon={<LockKeyhole size={18} />} title={t('Account security')} />
          <Button variant="outline" type="button" onClick={() => setOpen(true)}>{t('Change password')}</Button>
        </div>
      </Card>
      {open && <FormDialog title={t('Change password')} closeLabel={t('Close')} busy={saving} onClose={closeForm}>
        <form className={dialogForm} onSubmit={submit}>
          <div data-slot="dialog-body" className={dialogBody}>
            <label>
              {t('Current password')}
              <Input
                required type="password"
                autoComplete="current-password"
                value={form.currentPassword}
                onChange={(event) => updateForm({ currentPassword: event.target.value })}
              />
            </label>
            <label>
              {t('New password')}
              <Input
                required type="password"
                autoComplete="new-password"
                minLength={12}
                value={form.newPassword}
                onChange={(event) => updateForm({ newPassword: event.target.value })}
              />
            </label>
            <label>
              {t('Confirm new password')}
              <Input
                required type="password"
                autoComplete="new-password"
                minLength={12}
                value={form.confirmPassword}
                onChange={(event) => updateForm({ confirmPassword: event.target.value })}
              />
            </label>
            {error && <p role="alert" className="work-notice">{error}</p>}
          </div>
          <div data-slot="dialog-footer" className={dialogFooter}>
            <Button variant="outline" type="button" disabled={saving} onClick={closeForm}>{t('Cancel')}</Button>
            <Button variant="default" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Change password')}
            </Button>
          </div>
        </form>
      </FormDialog>}
    </div>
  );
}

function Overview({
  channels,
  models,
  keys,
  requests,
  usage,
  state,
  error,
  onNavigate,
  onRefresh
}: {
  channels: Channel[];
  models: ModelRow[];
  keys: ApiKey[];
  requests: RequestLog[];
  usage: UsageSummary;
  state: 'loading' | 'connected' | 'error';
  error: string;
  onNavigate: (view: ConsoleView) => void;
  onRefresh: () => void;
}) {
  const { language, t } = useI18n();
  const zh = language === 'zh';
  const [copyStatus, setCopyStatus] = useState('');
  const ready = channels.filter((channel) => channel.status === 'Ready').length;
  const published = models.filter(({ model }) => model.saasEnabled && model.enabled !== false).length;
  const needsSetup = !ready || !published;
  const active = keys.filter((key) => key.enabled).length;

  const totalReq = usage.total || requests.length;
  const successfulReq = usage.ok || requests.filter((r) => r.status >= 200 && r.status < 300).length;
  const clientErrReq = requests.filter((r) => r.status >= 400 && r.status < 500).length;
  const serverErrReq = usage.error || requests.filter((r) => r.status >= 500).length;
  const successRate = totalReq ? `${((successfulReq / totalReq) * 100).toFixed(1)}%` : '—';
  const meanDuration = usage.avgDurationMs || Math.round(requests.reduce((sum, r) => sum + r.durationMs, 0) / (requests.length || 1));

  const totalTokens = usage.tokens?.total || requests.reduce((sum, r) => sum + Number(r.billableUsage?.totalTokens ?? r.usage?.totalTokens ?? 0), 0);
  const inputTokens = usage.tokens?.input || requests.reduce((sum, r) => sum + Number(r.billableUsage?.inputTokens ?? r.usage?.inputTokens ?? 0), 0);
  const outputTokens = usage.tokens?.output || requests.reduce((sum, r) => sum + Number(r.billableUsage?.outputTokens ?? r.usage?.outputTokens ?? 0), 0);

  // Group requests by model to show popularity
  const modelStats = useMemo(() => {
    const counts = new Map<string, { requests: number; tokens: number; totalMs: number; errors: number }>();
    for (const r of requests) {
      const alias = r.modelAlias || r.endpoint || 'other';
      const item = counts.get(alias) || { requests: 0, tokens: 0, totalMs: 0, errors: 0 };
      item.requests += 1;
      item.tokens += Number(r.billableUsage?.totalTokens ?? r.usage?.totalTokens ?? 0);
      item.totalMs += r.durationMs;
      if (r.status >= 400) item.errors += 1;
      counts.set(alias, item);
    }
    return Array.from(counts.entries())
      .map(([alias, stat]) => ({
        alias,
        requests: stat.requests,
        tokens: stat.tokens,
        avgMs: Math.round(stat.totalMs / (stat.requests || 1)),
        errors: stat.errors,
        pct: requests.length ? Math.round((stat.requests / requests.length) * 100) : 0
      }))
      .sort((a, b) => b.requests - a.requests)
      .slice(0, 5);
  }, [requests]);

  if (state === 'loading')
    return (
      <div className="console-overview" aria-busy="true">
        <p className="overview-status" role="status">
          {zh ? '正在读取网关配置…' : 'Loading gateway configuration…'}
        </p>
      </div>
    );
  if (state === 'error')
    return (
      <div className="console-overview">
        <Card as="section" className="panel" role="alert">
          <h2>{zh ? '暂时无法读取网关' : 'Gateway data is unavailable'}</h2>
          <p>{error}</p>
          <Button type="button" variant="outline" onClick={onRefresh}>
            <RefreshCcw size={16} />
            {zh ? '重新连接' : 'Retry'}
          </Button>
        </Card>
      </div>
    );

  return (
    <div className="console-overview space-y-5">
      {needsSetup && (
        <section className="overview-setup" aria-labelledby="overview-setup-title">
          <div className="overview-next">
            <h2 id="overview-setup-title">
              {!ready
                ? zh
                  ? '接入首个上游通道'
                  : 'Connect your first channel'
                : zh
                  ? '发布首个可用模型'
                  : 'Publish your first model'}
            </h2>
            <p>
              {!ready
                ? zh
                  ? '先在通道页添加供应商，配置接口地址和凭据。通道启用后，就可以为它映射模型。'
                  : 'Add a provider with its endpoint and credentials, then enable the channel to map a model.'
                : zh
                  ? '把已启用通道映射成一个模型，并选择向注册用户开放。'
                  : 'Map an enabled channel to a model and publish it for registered users.'}
            </p>
            <Button variant="default" type="button" onClick={() => onNavigate(ready ? 'groups' : 'channels')}>
              {ready ? (zh ? '配置分组模型' : 'Configure group models') : zh ? '配置上游通道' : 'Configure a channel'}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          </div>
          <div className="overview-steps">
            <h3>{zh ? '接入步骤' : 'Setup steps'}</h3>
            <ol>
              <li data-current={!ready}>
                <span className="overview-step-index">
                  {ready ? <Check size={16} aria-label={zh ? '已完成' : 'Complete'} /> : 1}
                </span>
                <div>
                  <strong>{zh ? '配置通道' : 'Configure a channel'}</strong>
                  <p>
                    {ready
                      ? zh
                        ? '已配置 ' + ready + ' 个通道'
                        : ready + ' configured'
                      : zh
                        ? '添加上游地址和凭据'
                        : 'Add the provider endpoint and credentials'}
                  </p>
                </div>
              </li>
              <li data-current={Boolean(ready && !published)}>
                <span className="overview-step-index">
                  {published ? <Check size={16} aria-label={zh ? '已完成' : 'Complete'} /> : 2}
                </span>
                <div>
                  <strong>{zh ? '发布模型' : 'Publish a model'}</strong>
                  <p>
                    {published
                      ? zh
                        ? '已发布 ' + published + ' 个模型'
                        : published + ' published'
                      : zh
                        ? '添加映射并开放给用户'
                        : 'Create a mapping and enable user access'}
                  </p>
                </div>
              </li>
              <li>
                <span className="overview-step-index">3</span>
                <div>
                  <strong>{zh ? '验证调用' : 'Verify a request'}</strong>
                  <p>{zh ? '通过调试台发出第一条请求' : 'Send a request from the playground'}</p>
                </div>
              </li>
            </ol>
            <Button type="button" variant="ghost" onClick={() => onNavigate('payments')}>
              {zh ? '配置微信收款' : 'Set up WeChat Pay'}
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </section>
      )}

      {/* 6 Core KPI Metric Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3.5">
        <ConsoleMetric
          color="blue"
          icon={<Activity size={18} />}
          label={zh ? '网关调用总量' : 'Total requests'}
          value={formatWholeNumber(totalReq)}
          trend={totalReq ? `${successRate} ${zh ? '成功率' : 'success'}` : (zh ? '等待首条请求' : 'No requests')}
        />
        <ConsoleMetric
          color="purple"
          icon={<Layers3 size={18} />}
          label={zh ? 'Token 总吞吐' : 'Total tokens'}
          value={formatCompactNumber(totalTokens)}
          trend={`入: ${formatCompactNumber(inputTokens)} · 出: ${formatCompactNumber(outputTokens)}`}
        />
        <ConsoleMetric
          color="amber"
          icon={<Clock size={18} />}
          label={zh ? '平均响应延迟' : 'Avg. latency'}
          value={`${meanDuration}ms`}
          trend={zh ? `故障转移 ${usage.failoverRequests || 0} 次` : `${usage.failoverRequests || 0} failovers`}
        />
        <ConsoleMetric
          color="emerald"
          icon={<CircleDollarSign size={18} />}
          label={zh ? '预估上游成本' : 'Estimated cost'}
          value={formatCostMap(usage.estimatedCost, 'USD')}
          trend={zh ? '按调用量折算' : 'Based on usage'}
        />
        <ConsoleMetric
          color="indigo"
          icon={<Network size={18} />}
          label={zh ? '可用上游通道' : 'Channels'}
          value={`${ready} / ${channels.length}`}
          trend={ready === channels.length ? (zh ? '全部通道在线' : 'All channels ready') : (zh ? `${channels.length - ready} 个通道待配置` : `${channels.length - ready} paused`)}
        />
        <ConsoleMetric
          color="rose"
          icon={<Sparkles size={18} />}
          label={zh ? '已发布模型' : 'Published models'}
          value={`${published} / ${models.length}`}
          trend={zh ? `共映射 ${models.length} 个模型` : `${models.length} mapped`}
        />
      </div>

      {/* Quick Gateway Access & Status Banner */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-card p-3.5 sm:px-5 shadow-2xs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 font-mono text-xs bg-muted/60 px-3 py-1.5 rounded-lg border border-border/50">
            <Globe size={14} className="text-primary shrink-0" />
            <span className="font-semibold text-foreground">API Base:</span>
            <code className="text-foreground/90 select-all">{window.location.origin}/v1</code>
            <Button
              variant="ghost"
              size="icon-xs"
              type="button"
              className="ml-1 h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => {
                void writeClipboard(`${window.location.origin}/v1`);
                setCopyStatus(zh ? '已复制 Base URL' : 'Copied Base URL');
                setTimeout(() => setCopyStatus(''), 2000);
              }}
              title={zh ? '复制地址' : 'Copy URL'}
            >
              <Copy size={12} />
            </Button>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              {zh ? '网关就绪' : 'Gateway Ready'}
            </span>
            <span className="hidden sm:inline text-border">|</span>
            <span className="hidden sm:inline font-mono">GET /v1/models</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {copyStatus && <span className="text-xs text-emerald-600 font-medium">{copyStatus}</span>}
          <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => onNavigate('playground')}>
            <Play size={13} />
            <span>{zh ? '在线调试台' : 'Playground'}</span>
          </Button>
          <Button variant="default" size="sm" className="h-8 text-xs gap-1.5" onClick={() => onNavigate('channels')}>
            <Plus size={13} />
            <span>{zh ? '添加通道' : 'Add Channel'}</span>
          </Button>
        </div>
      </div>

      {/* Main Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left Column (8 cols): Requests, Traffic Analytics, Quality */}
        <div className="lg:col-span-7 xl:col-span-8 space-y-5">
          {/* Card 1: Recent Gateway Calls */}
          <Card as="section" className="panel">
            <div className="panel-heading">
              <PanelTitle icon={<Activity size={18} />} title={zh ? '最近网关调用' : 'Recent gateway calls'} />
              <div className="flex items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={() => onNavigate('playground')} className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Play size={12} />
                  <span>{zh ? '调试台' : 'Playground'}</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onNavigate('logs')} className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <span>{zh ? '全部日志' : 'All logs'}</span>
                  <ArrowRight size={13} />
                </Button>
              </div>
            </div>
            {requests.length ? (
              <div className="divide-y divide-border/60">
                {requests.slice(0, 7).map((request, index) => {
                  const ok = request.status >= 200 && request.status < 300;
                  const clientErr = request.status >= 400 && request.status < 500;
                  const statusColor = ok
                    ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
                    : clientErr
                    ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20';

                  const tokens = request.billableUsage?.totalTokens ?? request.usage?.totalTokens;
                  const timeFormatted = request.time ? new Date(request.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';

                  return (
                    <div key={request.requestId + '-' + index} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                      <div className="min-w-0 flex-1 flex items-center gap-2.5">
                        <span className={`px-2 py-0.5 rounded font-mono font-semibold border ${statusColor} shrink-0`}>
                          {request.status}
                        </span>
                        <span className="font-mono font-semibold text-foreground truncate max-w-[180px] sm:max-w-[240px]">
                          {request.modelAlias || request.endpoint || t('request')}
                        </span>
                        {request.provider && (
                          <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground border border-border/40 font-mono hidden md:inline shrink-0">
                            {request.provider}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-muted-foreground font-mono tabular-nums text-right">
                        {tokens ? <span>{tokens} tokens</span> : <span className="hidden sm:inline">—</span>}
                        <span className="w-16 font-semibold text-foreground">{request.durationMs} ms</span>
                        {timeFormatted && <span className="text-[11px] text-muted-foreground/80 hidden xl:inline">{timeFormatted}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-10 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <Activity size={24} className="text-muted-foreground/30" />
                <span>{zh ? '调用模型后，请求记录会实时出现在这里。' : 'Model requests will appear here in real-time.'}</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('playground')} className="mt-2 text-xs">
                  {zh ? '前往在线调试台' : 'Go to Playground'}
                </Button>
              </div>
            )}
          </Card>

          {/* Card 2: Traffic Distribution by Model */}
          <Card as="section" className="panel">
            <div className="panel-heading">
              <PanelTitle icon={<BarChart3 size={18} />} title={zh ? '模型流量分布与负载' : 'Traffic by model'} />
              <Button variant="ghost" size="sm" onClick={() => onNavigate('billing')} className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
                <span>{zh ? '用量明细' : 'Billing breakdown'}</span>
                <ArrowRight size={13} />
              </Button>
            </div>
            {modelStats.length ? (
              <div className="space-y-3.5">
                {modelStats.map((item) => (
                  <div key={item.alias} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-foreground">{item.alias}</span>
                        {item.errors > 0 && (
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-rose-500/10 text-rose-600 font-mono">
                            {item.errors} {zh ? '异常' : 'err'}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground tabular-nums">
                        {item.tokens > 0 && <span>{formatCompactNumber(item.tokens)} tokens</span>}
                        <span>{item.avgMs} ms</span>
                        <span className="font-semibold text-foreground">{item.requests} {zh ? '次' : 'req'} ({item.pct}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${Math.max(item.pct, 4)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <Sparkles size={24} className="text-muted-foreground/30" />
                <span>{zh ? '暂无模型调用数据，可在调试台发送请求。' : 'No model requests recorded yet.'}</span>
              </div>
            )}
          </Card>

          {/* Card 3: Quality & Status Codes */}
          <Card as="section" className="panel">
            <div className="panel-heading">
              <PanelTitle icon={<CheckCircle2 size={18} />} title={zh ? '网关调用质量与状态分布' : 'Request quality & status'} />
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-center">
                <div className="text-xs font-medium text-emerald-700 dark:text-emerald-300">{zh ? '2xx 正常请求' : '2xx Success'}</div>
                <div className="text-2xl font-bold text-emerald-800 dark:text-emerald-200 tabular-nums mt-0.5">{successfulReq}</div>
                <div className="text-xs text-emerald-600/80 mt-0.5">{successRate}</div>
              </div>
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-center">
                <div className="text-xs font-medium text-amber-700 dark:text-amber-300">{zh ? '4xx 客户端/余额' : '4xx Client'}</div>
                <div className="text-2xl font-bold text-amber-800 dark:text-amber-200 tabular-nums mt-0.5">{clientErrReq}</div>
                <div className="text-xs text-amber-600/80 mt-0.5">{totalReq ? `${((clientErrReq / totalReq) * 100).toFixed(1)}%` : '0%'}</div>
              </div>
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-center">
                <div className="text-xs font-medium text-rose-700 dark:text-rose-300">{zh ? '5xx 服务端故障' : '5xx Server'}</div>
                <div className="text-2xl font-bold text-rose-800 dark:text-rose-200 tabular-nums mt-0.5">{serverErrReq}</div>
                <div className="text-xs text-rose-600/80 mt-0.5">{totalReq ? `${((serverErrReq / totalReq) * 100).toFixed(1)}%` : '0%'}</div>
              </div>
            </div>
            <p className="m-0 text-xs text-muted-foreground leading-relaxed">
              {zh
                ? '提示：402 代表用户余额不足；上游通道故障（如 5xx 或超时）会自动触发通道故障转移重试。'
                : 'Note: 402 indicates insufficient balance. Upstream errors (5xx/timeouts) automatically trigger failover retries.'}
            </p>
          </Card>
        </div>

        {/* Right Column (4 cols): Channels, Quick Hub & System Specifications */}
        <div className="lg:col-span-5 xl:col-span-4 space-y-5">
          {/* Card 1: Channel Monitor */}
          <Card as="section" className="panel">
            <div className="panel-heading">
              <PanelTitle icon={<Network size={18} />} title={zh ? '上游通道运行状态' : 'Channel status'} />
              <Button variant="ghost" size="sm" onClick={() => onNavigate('channels')} className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground">
                <span>{zh ? '管理' : 'Manage'}</span>
                <ArrowRight size={13} />
              </Button>
            </div>
            {channels.length ? (
              <div className="divide-y divide-border/60">
                {channels.map((channel) => (
                  <div key={channel.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="text-sm font-semibold text-foreground truncate">{channel.name}</strong>
                        <span className="text-[11px] px-1.5 py-0.2 rounded bg-muted/60 text-muted-foreground border border-border/40 font-mono">
                          {channel.type === 'mock' ? 'Mock' : 'OpenAI'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[11px]">{channel.modelGroup || 'default'}</span>
                        {channel.latency !== undefined && (
                          <>
                            <span>·</span>
                            <span className="tabular-nums font-mono text-[11px]">{channel.latency} ms</span>
                          </>
                        )}
                        {channel.success !== undefined && (
                          <>
                            <span>·</span>
                            <span className="tabular-nums text-emerald-600 dark:text-emerald-400 font-medium text-[11px]">{formatPercent(channel.success)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <StatusBadge status={channel.status} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <Network size={22} className="text-muted-foreground/30" />
                <span>{zh ? '尚未添加上游通道' : 'No upstream channels yet'}</span>
                <Button size="sm" variant="outline" onClick={() => onNavigate('channels')} className="mt-2 text-xs">
                  {zh ? '添加首个通道' : 'Add Channel'}
                </Button>
              </div>
            )}
          </Card>

          {/* Card 2: Quick Management Hub */}
          <Card as="section" className="panel">
            <div className="panel-heading mb-3">
              <PanelTitle icon={<Layers3 size={18} />} title={zh ? '快捷管理中心' : 'Management hub'} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('playground')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-blue-500/10 text-blue-600 shrink-0">
                  <Play size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '在线调试' : 'Playground'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? '测试模型接口' : 'Test API'}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('channels')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-emerald-500/10 text-emerald-600 shrink-0">
                  <Network size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '供应商通道' : 'Channels'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? '配置与凭据' : 'Providers'}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('groups')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-purple-500/10 text-purple-600 shrink-0">
                  <Layers3 size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '分组与路由' : 'Model Groups'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? '调度与别名' : 'Routing'}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('pricing')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-amber-500/10 text-amber-600 shrink-0">
                  <CircleDollarSign size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '售价管理' : 'Pricing'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? 'Token 单价' : 'Token rates'}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('payments')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-teal-500/10 text-teal-600 shrink-0">
                  <CreditCard size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '收款管理' : 'Payments'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? '充值与审核' : 'Orders'}</div>
                </div>
              </Button>
              <Button
                variant="outline"
                type="button"
                onClick={() => onNavigate('users')}
                className="h-auto p-2.5 justify-start text-left bg-background hover:bg-muted/50 border-border/70 hover:border-foreground/30 shadow-2xs font-normal"
              >
                <div className="p-2 rounded-md bg-rose-500/10 text-rose-600 shrink-0">
                  <Users size={14} />
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-xs text-foreground truncate">{zh ? '用户管理' : 'Users'}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{zh ? '账号与状态' : 'Accounts'}</div>
                </div>
              </Button>
            </div>
          </Card>

          {/* Card 3: Gateway System Specifications */}
          <Card as="section" className="panel">
            <div className="panel-heading mb-3">
              <PanelTitle icon={<ShieldCheck size={18} />} title={zh ? '网关环境概况' : 'Gateway specifications'} />
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">{zh ? '网关服务状态' : 'Service status'}</span>
                <span className="inline-flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={13} />
                  {zh ? '正常运行中' : 'Healthy'}
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">{zh ? '上游 API 协议' : 'Protocol'}</span>
                <span className="font-mono font-medium text-foreground">OpenAI v1 Compatible</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">{zh ? '默认模型分组' : 'Default group'}</span>
                <span className="font-mono font-medium text-foreground">Codex / Default</span>
              </div>
              <div className="flex items-center justify-between py-1.5 border-b border-border/50">
                <span className="text-muted-foreground">{zh ? '计费模式' : 'Billing model'}</span>
                <span className="font-medium text-foreground">{zh ? '预付余额实时扣费' : 'Prepaid balance'}</span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-muted-foreground">{zh ? '速率防护' : 'Rate limits'}</span>
                <span className="font-medium text-foreground">{zh ? '全局限流 + 按 Key 限制' : 'Token bucket'}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
function ConsoleMetric({
  icon,
  label,
  value,
  trend,
  color = 'blue'
}: {
  icon: ReactNode;
  label: string;
  value: string;
  trend: string;
  color?: 'emerald' | 'blue' | 'purple' | 'amber' | 'indigo' | 'rose';
}) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
    amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
    rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
  };
  return (
    <Card className="p-4 sm:p-5 flex flex-col justify-between shadow-xs hover:border-foreground/20 transition-all border-border/80">
      <div className="flex items-center justify-between gap-2 mb-3">
        <span className="text-xs font-medium text-muted-foreground tracking-wide">{label}</span>
        <div className={`p-2 rounded-lg flex items-center justify-center shrink-0 ${colorMap[color] || colorMap.blue}`}>
          {icon}
        </div>
      </div>
      <div>
        <div className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground tabular-nums mb-1">
          {value}
        </div>
        <div className="text-xs text-muted-foreground flex items-center gap-1">
          <span>{trend}</span>
        </div>
      </div>
    </Card>
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
  onSave,
  onRotate,
  onDelete,
  onToast
}: {
  keys: ApiKey[];
  onSave: (form: ApiKeyFormState) => Promise<void>;
  onRotate: (key: ApiKey) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onToast: (message: string) => void;
}) {
  const { t, language } = useI18n();
  const confirm = useConfirmation();
  const [error, setError] = useState('');
  const [acting, setActing] = useState(false);
  const closeForm = () => { setForm(null); setError(''); };
  const [form, setForm] = useState<ApiKeyFormState | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = (key: ApiKey) => {
    setError('');
    setForm({
      id: key.id,
      name: key.name,
      perMinute: String(key.perMinute),
      prepaid: key.prepaid === true,
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
    setError('');
    try { await onSave(form); closeForm(); }
    catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  };

  async function changeKey(key: ApiKey, rotate: boolean) {
    if (acting) return;
    const zh = language === 'zh';
    const warning = rotate
      ? (zh ? `轮换「${key.name}」会立即使旧密钥失效。客户端需要换用新密钥。` : `Rotating “${key.name}” immediately invalidates the old key. Clients will need the replacement.`)
      : (zh ? `删除「${key.name}」后，使用该密钥的客户端会失去访问权限。` : `Clients using “${key.name}” will lose access when it is deleted.`);
    if (!await confirm(warning)) return;
    setActing(true);
    try { if (rotate) await onRotate(key); else await onDelete(key.id); }
    finally { setActing(false); }
  }

  return (
    <Card as="section" className="panel">
      <div className="panel-heading">
        <PanelTitle icon={<KeyRound size={18} />} title={t('API keys')} />
        <Button variant="default" type="button" onClick={() => { setError(''); setForm({ id: '', name: '', perMinute: '120', prepaid: false, enabled: true }); }}>
          <Plus size={18} />
          {t('Create key')}
        </Button>
      </div>
      {form && (
        <FormDialog title={t(form.id ? 'Edit key' : 'Create key')} closeLabel={t('Close')} busy={saving} onClose={closeForm}>
          <form className={dialogForm} onSubmit={submitForm}>
            <div data-slot="dialog-body" className={dialogBody}>
              <div className="form-grid">
                <label>
                  {t('Key name')}
                  <Input required value={form.name} onChange={(event) => updateForm({ name: event.target.value })} />
                </label>
                <label>
                  {t('Rate limit per minute')}
                  <Input type="number" min="0" step="1" value={form.perMinute} onChange={(event) => updateForm({ perMinute: event.target.value })} />
                </label>
              </div>
              <div className="mt-2 flex flex-col gap-2.5">
                {(!form.id || keys.find((key) => key.id === form.id)?.role === 'service') && (
                  <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-foreground select-none">
                    <Checkbox checked={Boolean(form.prepaid)} onCheckedChange={(checked) => updateForm({ prepaid: checked })} />
                    <span>{t('Prepaid CNY wallet')}</span>
                  </label>
                )}
                <label className="flex items-center gap-2.5 cursor-pointer text-sm font-medium text-foreground select-none">
                  <Checkbox checked={form.enabled} onCheckedChange={(checked) => updateForm({ enabled: checked })} />
                  <span>{t('Enabled')}</span>
                </label>
              </div>
              {error && <p className="work-notice mt-3" role="alert">{error}</p>}
            </div>
            <div data-slot="dialog-footer" className={dialogFooter}>
              <Button variant="outline" type="button" onClick={closeForm} disabled={saving}>{t('Cancel')}</Button>
              <Button variant="default" type="submit" disabled={saving}>
                <Check size={18} />{saving ? t('Saving') : t(form.id ? 'Save key' : 'Create key')}
              </Button>
            </div>
          </form>
        </FormDialog>
      )}
      <Table className="min-w-[38rem]">
        <TableHeader><TableRow>
          {['Name', 'Secret', 'Limit', 'Status', 'Actions'].map((label) => <TableHead key={label} className={label === 'Actions' ? 'text-right' : undefined}>{t(label)}</TableHead>)}
        </TableRow></TableHeader>
        <TableBody>{keys.map((key) => <TableRow key={key.id}>
          <TableHead scope="row"><strong>{key.name}</strong>
            <small className="mt-1 block text-xs text-muted-foreground">{t(key.role)} · {t('Created')} {t(key.created)} · {apiKeyLastUsedLabel(key.lastUsed, t)}</small>
          </TableHead>
          <TableCell><code>{key.value}</code></TableCell>
          <TableCell className="tabular-nums">{key.limit}</TableCell>
          <TableCell><StatusBadge status={key.status} /></TableCell>
            <TableCell><div className="flex min-w-max items-center justify-end gap-1">
              <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:text-foreground" type="button" onClick={() => copyKey(key)} title={t('Copy key')} aria-label={t('Copy key')}>
                <Copy size={15} />
              </Button>
              <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:text-foreground" type="button" onClick={() => startEdit(key)} title={t('Edit')} aria-label={t('Edit')}>
                <Pencil size={15} />
              </Button>
              <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:text-foreground" type="button" disabled={acting} onClick={() => void changeKey(key, true)} title={t('Rotate and copy')} aria-label={t('Rotate and copy')}>
                <RefreshCcw size={15} />
              </Button>
              <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" type="button" disabled={acting} aria-label={t('Delete')} title={t('Delete')} onClick={() => void changeKey(key, false)}>
                <Trash2 size={15} />
              </Button>
            </div></TableCell>
        </TableRow>)}</TableBody>
      </Table>
    </Card>
  );
}

function ChannelsView({
  channels,
  onToggle,
  onDelete,
  onSave,
  onCheckHealth,
  onModelsImported
}: {
  channels: Channel[];
  onToggle: (channel: Channel) => void;
  onDelete: (id: string) => Promise<void>;
  onSave: (form: ChannelFormState) => Promise<void>;
  onCheckHealth: (id: string, live?: boolean) => Promise<ProviderHealth | null>;
  onModelsImported: () => Promise<void>;
}) {
  const askConfirmation = useConfirmation();
  const { t, language } = useI18n();
  const zh = language === 'zh';
  const [formError, setFormError] = useState('');
  const closeForm = () => { setForm(null); setFormError(''); };
  const [importChannel, setImportChannel] = useState<Channel>();
  const [managedGroups, setManagedGroups] = useState<ManagedGroup[]>([]);
  const [groupError, setGroupError] = useState('');
  useEffect(() => {
    let active = true;
    gatewayRequest<{ data: ManagedGroup[] }>('/admin/model-groups').then(({ data }) => {
      if (active) setManagedGroups(data);
    }).catch((e: Error) => { if (active) setGroupError(e.message); });
    return () => { active = false; };
  }, []);
  const channelGroups = new Map([['default', t('Default group')]]);
  for (const channel of channels) if (!channelGroups.has(channel.modelGroup)) channelGroups.set(channel.modelGroup, channel.modelGroup);
  for (const group of managedGroups) channelGroups.set(group.id, group.name || t('Default group'));
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
      modelGroup:'default',
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
      modelGroup:channel.modelGroup,
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
    setFormError('');
    try { await onSave(form); closeForm(); }
    catch (e) { setFormError((e as Error).message); }
    finally { setSaving(false); }
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
    if (!await askConfirmation(t('Delete provider channel?'))) {
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
    <Card as="section" className="panel">
      <div className="panel-heading">
        <PanelTitle icon={<Network size={18} />} title={t('Channels')} />
        <Button variant="default" type="button" onClick={startCreate}>
          <Plus size={18} />
          {t('Add channel')}
        </Button>
      </div>
      {form && (
        <FormDialog title={t(lockedId ? 'Edit provider channel' : 'New provider channel')} closeLabel={t('Close')} busy={saving} onClose={closeForm} drawer description={lockedId ? form.name : undefined}>
          <form className={dialogForm} onSubmit={submitForm} autoComplete="off">
            <div data-slot="dialog-body" className={dialogBody}>
              <section className="admin-fields">
                <h3>{zh ? '基本信息' : 'Channel details'}</h3>
                <div className="form-grid">
                  <label>{t('Provider name')}
                    <Input name="provider-display-name" autoComplete="off" value={form.name} onChange={(event) => updateForm({ name: event.target.value })} placeholder={zh ? '例如：公司模型服务' : 'e.g. Company model service'} />
                  </label>
                  <label>{t('Provider ID')}
                    <Input name="provider-id" autoComplete="off" required value={form.id} disabled={lockedId} onChange={(event) => updateForm({ id: event.target.value })} placeholder="company-openai" />
                  </label>
                  <label>{t('Model group')}
                    <SelectField value={form.modelGroup} onValueChange={(value) => updateForm({ modelGroup: value })}>
                      {[...channelGroups].map(([id, name]) => <option key={id} value={id}>{name}</option>)}
                    </SelectField>
                    {groupError && <small role="alert">{groupError}</small>}
                  </label>
                  <label>{t('Type')}
                    <SelectField value={form.type} disabled={form.type === 'mock'} onValueChange={(value) => updateForm({ type: value as ChannelFormState['type'] })}>
                      <option value="openai-compatible">{t('Protocol compatible')}</option>
                      {form.type === 'mock' && <option value="mock">{t('Mock provider')}</option>}
                    </SelectField>
                  </label>
                </div>
              </section>
              {form.type !== 'mock' && <section className="admin-fields">
                <h3>{zh ? '连接与凭据' : 'Connection and credentials'}</h3>
                <div className="form-grid">
                  <label className="console-field-wide">{t('Base URL')}
                    <Input required value={form.baseUrl} onChange={(event) => updateForm({ baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" />
                  </label>
                  <label>{t('API key')}
                    <Input type="password" name="upstream-provider-key" autoComplete="new-password" spellCheck={false} value={form.apiKey}
                      onChange={(event) => updateForm({ apiKey: event.target.value, apiKeyConfigured: Boolean(event.target.value.trim()) || Boolean(form.apiKeyPreview) })}
                      placeholder={form.apiKeyPreview ? t('Saved API key') + ` ${form.apiKeyPreview}` : 'sk-...'} />
                  </label>
                  <label>{t('API key env')}
                    <Input value={form.apiKeyEnv} onChange={(event) => updateForm({ apiKeyEnv: event.target.value })} placeholder="PROVIDER_API_KEY" />
                  </label>
                </div>
                <p className="panel-note">{t('Enter an upstream API key directly, or provide an environment variable name on the gateway server. Saved keys are encrypted and are not shown again.')}</p>
              </section>}
              <section className="admin-fields">
                <h3>{zh ? '运行设置' : 'Runtime settings'}</h3>
                <div className="form-grid">
                  {form.type !== 'mock' && <label>{t('Timeout ms')}
                    <Input type="number" min="1000" step="1000" value={form.timeoutMs} onChange={(event) => updateForm({ timeoutMs: event.target.value })} />
                  </label>}
                  <label>{t('Max concurrency')}
                    <Input type="number" min="0" step="1" value={form.maxConcurrency} onChange={(event) => updateForm({ maxConcurrency: event.target.value })} />
                  </label>
                </div>
                <label className="console-option admin-check"><Checkbox checked={form.enabled} onCheckedChange={(checked) => updateForm({ enabled: checked })} />
                  {zh ? '启用此通道' : 'Enable this channel'}
                </label>
              </section>
              {formError && <p role="alert" className="work-notice">{formError}</p>}
            </div>
            <div data-slot="dialog-footer" className={dialogFooter}>
              <Button variant="outline" type="button" disabled={saving} onClick={closeForm}>{t('Cancel')}</Button>
              <Button variant="default" type="submit" disabled={saving}><Check size={18} />{saving ? t('Saving') : t('Save channel')}</Button>
            </div>
          </form>
        </FormDialog>
      )}
      {importChannel && <ChannelModelImport key={importChannel.id} channel={importChannel}
        onClose={() => setImportChannel(undefined)} onImported={onModelsImported} />}
      <div className="grid gap-4">
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
            const displayStatus = channel.status === 'Paused' ? 'Paused'
              : health?.ok === false ? 'Degraded'
              : health?.ok && health.live ? 'Healthy' : channel.status;

            const modelItems = channel.models && channel.models !== 'No aliases mapped'
              ? channel.models.split(', ').map((item) => {
                  const parts = item.split(' -> ');
                  return { alias: parts[0], upstream: parts[1] || parts[0] };
                })
              : [];

            return (
              <div
                className="rounded-xl border border-border/80 bg-card p-5 sm:p-6 shadow-2xs transition hover:border-border hover:shadow-xs"
                key={channel.id}
              >
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Network size={20} />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="m-0 text-base font-semibold tracking-tight text-foreground">{channel.name}</h3>
                        <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground border border-border/50">
                          {channel.id}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground font-medium">
                          {t(channel.type === 'mock' ? 'Mock provider' : 'Protocol compatible')}
                        </span>
                        <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                          <Layers3 size={11} />
                          {channelGroups.get(channel.modelGroup) || channel.modelGroup}
                        </span>
                      </div>
                      {channel.type !== 'mock' && channel.baseUrl && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Globe size={12} className="shrink-0 text-muted-foreground" />
                          <code className="font-mono text-xs text-foreground/80 select-all">{channel.baseUrl}</code>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions & Status in Header */}
                  <div className="flex items-center gap-1 shrink-0">
                    <StatusBadge status={displayStatus} />
                    <div className="mx-1 h-4 w-px bg-border/60" />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      type="button"
                      onClick={() => startEdit(channel)}
                      title={t('Edit')}
                      aria-label={t('Edit')}
                    >
                      <Pencil size={14} />
                    </Button>
                    {channel.type !== 'mock' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        type="button"
                        disabled={!channel.apiKeyConfigured}
                        onClick={() => setImportChannel(channel)}
                        title={t('Import upstream models')}
                        aria-label={t('Import upstream models')}
                      >
                        <Layers3 size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      type="button"
                      onClick={() => checkHealth(channel.id)}
                      title={t('Config check')}
                      aria-label={t('Config check')}
                    >
                      <RefreshCcw size={13} />
                    </Button>
                    {channel.type !== 'mock' && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        type="button"
                        onClick={() => checkHealth(channel.id, true)}
                        title={t('Live check')}
                        aria-label={t('Live check')}
                      >
                        <TestTube2 size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn("h-8 w-8 text-muted-foreground hover:text-foreground", channel.status === 'Paused' && "text-amber-600 dark:text-amber-400")}
                      type="button"
                      onClick={() => onToggle(channel)}
                      title={channel.status === 'Paused' ? (zh ? '恢复通道' : 'Enable') : (zh ? '暂停通道' : 'Pause')}
                      aria-label={channel.status === 'Paused' ? 'Enable' : 'Pause'}
                    >
                      {channel.status === 'Paused' ? <Play size={14} /> : <Pause size={14} />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      type="button"
                      onClick={() => removeChannel(channel)}
                      title={t('Delete')}
                      aria-label={t('Delete')}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </div>

                {/* Parameters & Credentials */}
                <div className="my-3.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4 lg:grid-cols-5">
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">{t('API key')}</span>
                    <div className="mt-1 font-mono text-xs font-semibold text-foreground truncate" title={channel.apiKeyPreview}>
                      {channel.type === 'mock' ? '-' : channel.apiKeyPreview || (channel.apiKeyConfigured ? t('Configured') : '-')}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">{t('API key env')}</span>
                    <div className="mt-1 font-mono text-xs font-semibold text-foreground truncate" title={channel.apiKeyEnv}>
                      {channel.type === 'mock' ? '-' : channel.apiKeyEnv || '-'}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">{t('Concurrency')}</span>
                    <div className="mt-1 text-xs font-semibold text-foreground">
                      {channel.maxConcurrency ? String(channel.maxConcurrency) : (zh ? '不限' : t('No data'))}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5">
                    <span className="text-[11px] font-medium text-muted-foreground block">{t('Timeout')}</span>
                    <div className="mt-1 text-xs font-semibold text-foreground">
                      {channel.type === 'mock' ? '-' : `${channel.timeoutMs || 120000}ms`}
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/50 bg-muted/30 p-2.5 col-span-2 sm:col-span-4 lg:col-span-1">
                    <span className="text-[11px] font-medium text-muted-foreground block">{zh ? '健康诊断' : t('Recent check')}</span>
                    <div className="mt-1 text-xs font-semibold text-foreground truncate">
                      {health ? (
                        <span className={cn("inline-flex items-center gap-1 font-medium", health.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive")}>
                          {health.ok ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                          {health.durationMs !== undefined ? `${health.durationMs}ms` : (health.ok ? 'OK' : 'Fail')}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t(channel.balance)}</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Mapped Models Section */}
                <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Sparkles size={13} className="text-primary" />
                      <span>{t('Models')}</span>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {modelItems.length}
                      </span>
                    </div>
                    {channel.type !== 'mock' && channel.apiKeyConfigured && (
                      <Button
                        variant="link"
                        size="sm"
                        type="button"
                        className="h-auto p-0 text-xs text-primary font-medium inline-flex items-center gap-1 hover:underline"
                        onClick={() => setImportChannel(channel)}
                      >
                        <Layers3 size={12} />
                        {t('Import upstream models')}
                      </Button>
                    )}
                  </div>
                  {modelItems.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-1.5 max-h-48 overflow-y-auto pr-1">
                      {modelItems.map(({ alias, upstream }, idx) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 rounded-md border border-border/70 bg-background px-2.5 py-1 font-mono text-xs text-foreground shadow-2xs"
                          title={alias !== upstream ? `${alias} → ${upstream}` : alias}
                        >
                          <span className="font-semibold">{alias}</span>
                          {alias !== upstream && (
                            <>
                              <span className="text-[10px] text-muted-foreground">→</span>
                              <span className="text-muted-foreground">{upstream}</span>
                            </>
                          )}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-xs text-muted-foreground italic">
                      {zh ? '暂无映射别名。可点击右上角「获取并导入模型」快速添加。' : 'No aliases mapped. Click "Import upstream models" above to add.'}
                    </p>
                  )}
                </div>

                {/* Health diagnostics */}
                {health && (
                  <div className={cn(
                    "mt-3 flex items-center justify-between rounded-lg px-3 py-2 text-xs",
                    health.ok ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 border border-emerald-500/20" : "bg-destructive/10 text-destructive border border-destructive/20"
                  )}>
                    <div className="flex items-center gap-1.5 font-medium">
                      {health.ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                      <span>{healthLabel}</span>
                    </div>
                    {health.checkedAt && (
                      <span className="text-[11px] opacity-75">{health.checkedAt}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <p className="panel-note">{t('No provider channels configured.')}</p>
        )}
      </div>
    </Card>
  );
}

type ImportModel = { id: string; alias: string; existing: boolean; billing: 'token' | 'image' | null };
type ImportResult = { id: string; alias: string; status: 'published' | 'internal' | 'existing' };

function ChannelModelImport({ channel, onClose, onImported }: {
  channel: Channel; onClose: () => void; onImported: () => Promise<void>;
}) {
  const { language, t } = useI18n();
  const zh = language === 'zh';
  const path = '/admin/providers/' + encodeURIComponent(channel.id) + '/models';
  const [rows, setRows] = useState<ImportModel[]>([]);
  const [ids, setIds] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [endpoints, setEndpoints] = useState(['chat']);
  const [publish, setPublish] = useState(true);
  const [result, setResult] = useState<ImportResult[]>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const visible = rows.filter(row => row.id.toLowerCase().includes(query.trim().toLowerCase()));
  const selectable = visible.filter(row => !row.existing);
  const protocolOptions = [
    ['chat','Chat Completions'],
    ['responses','Responses · Codex'],
    ['messages','Messages · Claude Code'],
    ['embeddings','Embeddings'],
    ['images',zh ? '图像生成' : 'Images']
  ];

  async function load() {
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const response = await gatewayRequest<{data: ImportModel[]}>(path);
      setRows(response.data);
      setIds([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { void load(); }, [path]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ids.length || ids.length > 1000 || !endpoints.length) return;
    setBusy(true);
    setError('');
    try {
      const response = await gatewayRequest<{data: ImportResult[]}>(path, { method:'POST',body:{ids,endpoints,publish} });
      setResult(response.data);
      const imported = new Map(response.data.map(row => [row.id,row]));
      setRows(current => current.map(row => {
        const mapping = imported.get(row.id);
        return mapping ? {...row,alias:mapping.alias,existing:true} : row;
      }));
      setIds([]);
      await onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog title={t('Import upstream models')} closeLabel={t('Close')} busy={busy} onClose={onClose} drawer description={`${channel.name} · ${channel.modelGroup}`}>
      <form className={dialogForm} onSubmit={submit}>
        <div data-slot="dialog-body" className={dialogBody}>
      {channel.status === 'Paused' && <p className="work-notice">{zh ? '通道已暂停。启用后，已开放的模型才会出现在用户端。' : 'Enable this channel to make published models available to users.'}</p>}
      {error && <p className="work-notice" role="alert">{error}</p>}
      {busy && <p className="panel-note" role="status">{zh ? '正在处理模型列表…' : 'Loading model catalog…'}</p>}
      {result && <p className="work-notice" role="status">{zh
        ? '已开放 '+result.filter(row => row.status === 'published').length+' 个，内部模型 '+result.filter(row => row.status === 'internal').length+' 个，已有映射 '+result.filter(row => row.status === 'existing').length+' 个。'
        : result.filter(row => row.status === 'published').length+' published, '+result.filter(row => row.status === 'internal').length+' internal, '+result.filter(row => row.status === 'existing').length+' already mapped.'}</p>}
      <div className="upstream-import-layout">
        <section className="upstream-model-catalog" aria-label={zh ? '上游模型' : 'Upstream models'}>
          <div className="console-section-head"><h3>{zh ? '上游模型' : 'Upstream models'}</h3>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => void load()}>
              <RefreshCcw size={14} aria-hidden="true"/>{zh ? '重新获取' : 'Reload'}
            </Button>
          </div>
          <Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={zh ? '查找模型名称' : 'Find a model'} aria-label={zh ? '查找上游模型' : 'Find an upstream model'} />
          <div className="upstream-list-tools">
            <span>{zh ? '显示 ' + visible.length + ' 个模型' : visible.length + ' models shown'}</span>
            <div className="row-actions">
              <Button type="button" variant="ghost" disabled={busy || !selectable.length}
                onClick={() => setIds(current => [...new Set([...current,...selectable.map(row => row.id)])].slice(0,1000))}>
                {zh ? '选中筛选结果' : 'Select filtered'}</Button>
              {ids.length > 0 && <Button type="button" variant="ghost" disabled={busy}
                onClick={() => setIds([])}>{zh ? '清空' : 'Clear'}</Button>}
            </div>
          </div>
          <div className="upstream-import-list">
            {visible.map(row => <label key={row.id} className="upstream-import-row" data-selected={ids.includes(row.id)}>
              <Checkbox disabled={row.existing || busy} checked={ids.includes(row.id)}
                onCheckedChange={(checked) => setIds(current => checked ? [...current,row.id] : current.filter(id => id !== row.id))}/>
              <span><code>{row.id}</code>{row.alias !== row.id && <small>{zh ? '映射别名' : 'Gateway alias'} · {row.alias}</small>}</span>
              <small className="import-model-status" data-priced={Boolean(row.billing)}>
                {row.existing ? (zh ? '已有映射' : 'Already mapped') : row.billing ? (zh ? '有单价' : 'Priced') : (zh ? '待定价' : 'Unpriced')}
              </small>
            </label>)}
            {!busy && !visible.length && !error && <p className="panel-note">{zh ? '没有匹配的上游模型。' : 'No matching upstream models.'}</p>}
          </div>
        </section>
        <section className="upstream-import-settings">
          <fieldset className="upstream-import-options">
            <legend>{zh ? '支持的接口' : 'Supported protocols'}</legend>
            <p className="panel-note">{zh ? '按供应商实际支持的接口勾选。Codex 模型目录读取 Responses。' : 'Choose the protocols supported upstream. The Codex catalog uses Responses.'}</p>
            {protocolOptions.map(([id,label]) => <label className="console-option" key={id}>
              <Checkbox disabled={busy} checked={endpoints.includes(id)}
                onCheckedChange={(checked) => setEndpoints(current => checked ? [...current,id] : current.filter(item => item !== id))}/>
              <span>{label}</span>
            </label>)}
          </fieldset>
          <label className="console-option upstream-publish">
            <Checkbox disabled={busy} checked={publish} onCheckedChange={(checked) => setPublish(checked)}/>
            <span><strong>{zh ? '导入后向用户开放' : 'Publish after import'}</strong>
              <small>{zh ? '仅开放已有售价、且计费方式匹配的模型。' : 'Requires pricing that matches the selected protocols.'}</small>
            </span>
          </label>
        </section>
      </div>
        </div>
        <div data-slot="dialog-footer" className={dialogFooter}>
        <span className="me-auto text-sm text-muted-foreground">{zh ? '已选 ' + ids.length + ' 个模型' : ids.length + ' models selected'}</span>
        <Button variant="default" disabled={busy || !ids.length || ids.length > 1000 || !endpoints.length}>
          {zh ? '导入所选模型' : 'Import selected models'}
        </Button>
      </div>
      </form>
    </FormDialog>
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

function GroupModelMappings({
  group,
  channels,
  models,
  serviceApiKey,
  onRefresh,
  onToast
}: {
  group: ManagedGroup;
  channels: Channel[];
  models: ModelRow[];
  serviceApiKey: string;
  onRefresh: () => Promise<void>;
  onToast: (message: string) => void;
}) {
  const askConfirmation = useConfirmation();
  const { t, language } = useI18n();
  const zh = language === "zh";
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const closeEditor = () => { setEditorOpen(false); setEditorError(''); };
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    alias: '',
    provider: '',
    upstreamModel: '',
    endpoints: 'chat,responses',
    saasEnabled: false,
    description: ''
  });
  const [editingAlias, setEditingAlias] = useState('');
  const [runningAlias, setRunningAlias] = useState('');
  const [testByAlias, setTestByAlias] = useState<Record<string, { status: 'Success' | 'Degraded'; message: string }>>({});
  const [importing, setImporting] = useState(false);
  const [importChannelId, setImportChannelId] = useState('');
  const channelIds = new Set(group.channels.map(channel => channel.id));
  const groupChannels = channels.filter(channel => channelIds.has(channel.id));
  const importSources = groupChannels.filter(channel => channel.type === 'openai-compatible');
  const importChannel = importSources.find(channel => channel.id === importChannelId) || importSources[0];
  const routesFor = (model: GatewayModel) => model.routes?.length
    ? model.routes
    : [{ provider: model.provider }, ...(model.fallbacks || [])];
  const groupModels = models.filter(({ model }) => routesFor(model).some(route => channelIds.has(route.provider)));
  const originalProvider = models.find(({ alias }) => alias === editingAlias)?.model.provider;
  const providerOptions = channels.filter(channel => channelIds.has(channel.id) || channel.id === originalProvider);

  const resetMappingForm = () => {
    setEditorError('');
    setEditorOpen(true);
    setEditingAlias('');
    setForm({
      alias: '',
      provider: groupChannels[0]?.id || '',
      upstreamModel: '',
      endpoints: 'chat,responses',
      saasEnabled: false,
      description: ''
    });
  };

  const editMapping = (alias: string, model: GatewayModel) => {
    setEditorError('');
    setEditorOpen(true);
    setEditingAlias(alias);
    setForm({
      alias,
      provider: model.provider,
      upstreamModel: model.upstreamModel,
      saasEnabled: model.saasEnabled === true,
      endpoints: (model.endpoints || ['chat']).join(','),
      description: model.description || ''
    });
  };

  const saveMapping = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setEditorError('');
    try {
      if (!providerOptions.some(channel => channel.id === form.provider)) {
        throw new Error(zh ? '请选择通道后保存模型。' : 'Select a channel before saving the mapping.');
      }
      const alias = form.alias.trim();
      if (!alias) {
        throw new Error(t('Model alias is required.'));
      }
      if (alias !== editingAlias && models.some(row => row.alias === alias)) {
        throw new Error(zh ? '模型别名已被使用，请选择其他别名。' : 'This model alias is already in use.');
      }
      await gatewayRequest(`/admin/models/${encodeURIComponent(alias)}`, {
        method: 'PUT',
        body: {
          previousAlias: editingAlias || undefined,
          createOnly: !editingAlias,
          provider: form.provider,
          upstreamModel: form.upstreamModel,
          enabled: true,
          endpoints: form.endpoints.split(',').map((item) => item.trim()).filter(Boolean),
          saasEnabled: form.saasEnabled,
          description: form.description
        }
      });
      await onRefresh();
      closeEditor();
      setEditingAlias(alias);
      onToast(`${t('Model alias')} ${alias} ${t('saved')}.`);
    } catch (error) {
      setEditorError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteMapping = async (alias: string, shared: boolean) => {
    const message = shared
      ? (zh ? '此模型同时关联其他分组，删除会影响所有关联分组。确定删除？' : 'Deleting this model affects every group that uses it. Delete it?')
      : t('Delete model mapping?');
    if (!await askConfirmation(message)) {
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
    const endpoint = endpointForModel(model);
    const body = requestBodyForEndpoint(endpoint, alias);
    setRunningAlias(alias);
    try {
      const result = await gatewayRequest<Record<string, unknown>>(endpoint, {
        method: 'POST',
        apiKey: serviceApiKey || undefined,
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

  return (<>
    <Card as="section" className="panel mapping-panel">
      <div className="console-section-head">
        <div><h2>{zh ? '模型映射' : 'Model mappings'}</h2>
          <p>{zh ? '向用户开放模型后，持有本分组 Key 的用户即可调用。' : 'Users with a key for this group can call published models.'}</p>
        </div>
        <div className="row-actions">
          {importSources.length > 1 && <SelectField aria-label={zh ? '导入通道' : 'Import source'} value={importChannel?.id || ''}
            onValueChange={(value) => setImportChannelId(value)} disabled={importing}>
            {importSources.map(channel => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
          </SelectField>}
          {importChannel && <Button variant="outline" type="button" disabled={importing || saving} onClick={() => setImporting(true)}>
            {t('Import upstream models')}
          </Button>}
          <Button variant="default" type="button" onClick={resetMappingForm} disabled={!groupChannels.length || saving}>
            <Plus size={16} />{t('New mapping')}
          </Button>
        </div>
      </div>
      {editorOpen && <FormDialog title={editingAlias ? (zh ? '编辑映射' : 'Edit mapping') : t('New mapping')} closeLabel={t('Close')} busy={saving} onClose={closeEditor} drawer description={editingAlias || undefined}>
        <form className={dialogForm} onSubmit={saveMapping}>
          <div data-slot="dialog-body" className={dialogBody}>
        <div className="form-grid">
          <label>{t('Internal alias')}<Input required value={form.alias} onChange={e => setForm({ ...form, alias:e.target.value })} placeholder="company-chat"/></label>
          <label>{t('Provider')}<SelectField value={form.provider} onValueChange={(value) => setForm({ ...form, provider:value })}>
            {providerOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectField></label>
          <label>{t('Upstream model')}<Input required value={form.upstreamModel} onChange={e => setForm({ ...form, upstreamModel:e.target.value })} placeholder="qwen-plus"/></label>
          <label>{t('Endpoint types')}<Input value={form.endpoints} onChange={e => setForm({ ...form, endpoints:e.target.value })} placeholder="chat,responses"/></label>
          <label className="console-field-wide">{t('Description')}<Input value={form.description} onChange={e => setForm({ ...form, description:e.target.value })}/></label>
        </div>
        <label className="console-option"><Checkbox checked={form.saasEnabled}
          onCheckedChange={(checked) => setForm({ ...form, saasEnabled:checked })}/><span>{t('Available to registered users')}</span></label>
            {editorError && <p role="alert" className="work-notice">{editorError}</p>}
          </div>
          <div data-slot="dialog-footer" className={dialogFooter}>
            <Button type="button" variant="outline" disabled={saving} onClick={closeEditor}>{t('Cancel')}</Button>
            <Button variant="default" disabled={saving}><Check size={16}/>{saving ? t('Saving') : t('Save mapping')}</Button>
          </div>
        </form>
      </FormDialog>}
      {!groupModels.length && <p className="overview-empty">{zh ? '本分组暂无模型，添加一个映射即可开始配置。' : 'Add a mapping to configure the first model for this group.'}</p>}
      <ul className="mapping-list">
        {groupModels.map(({ alias, model }) => {
          const shared = routesFor(model).some(route => channels.some(channel => channel.id === route.provider && !channelIds.has(channel.id)));
          const testState = testByAlias[alias];
          const status = model.enabled === false ? 'Paused' : runningAlias === alias ? 'Testing' : testState?.status || 'Ready';
          return <li className="mapping-row" key={alias} data-editing={editorOpen && editingAlias === alias}>
            <div className="mapping-identity">
              <strong>{alias}</strong><small>{channels.find(channel => channel.id === model.provider)?.name || model.provider} → {model.upstreamModel}</small>
              {testState && <small className="model-test-message" title={testState.message}>{testState.message}</small>}
            </div>
            <div className="mapping-status">
              <StatusBadge status={status}/>
              <small>{model.saasEnabled ? (zh ? '向用户开放' : 'Published') : (zh ? '仅内部' : 'Internal')}</small>
              {shared && <small>{zh ? '跨分组共用' : 'Shared across groups'}</small>}
            </div>
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                type="button"
                onClick={() => editMapping(alias, model)}
                disabled={saving}
                title={zh ? '编辑映射' : t('Edit mapping')}
                aria-label={zh ? '编辑映射' : t('Edit mapping')}
              >
                <Pencil size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-muted-foreground hover:text-primary"
                type="button"
                onClick={() => testAlias(alias, model)}
                disabled={Boolean(runningAlias)}
                title={zh ? '测试调用' : t('Test')}
                aria-label={zh ? '测试调用' : t('Test')}
              >
                <Play size={15} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                type="button"
                title={t('Delete mapping')}
                aria-label={t('Delete mapping')}
                onClick={() => deleteMapping(alias, shared)}
                disabled={saving}
              >
                <Trash2 size={15} />
              </Button>
            </div>
          </li>;
        })}
      </ul>
    </Card>
    {importing && importChannel && <ChannelModelImport key={importChannel.id} channel={importChannel}
      onClose={() => setImporting(false)} onImported={onRefresh} />}
  </>);
}

function PlaygroundView({ models, serviceApiKey, onToast }: { models: ModelRow[]; serviceApiKey: string; onToast: (message: string) => void }) {
  const { t } = useI18n();
  const availableModels = models.filter(({ model }) => model.enabled !== false);
  const firstModel = availableModels[0];
  const [draft, setDraft] = useState<{ endpoint: string; body: string }>();
  const endpoint = draft?.endpoint ?? endpointForModel(firstModel?.model);
  const body = draft?.body ?? (firstModel
    ? JSON.stringify(requestBodyForEndpoint(endpoint, firstModel.alias), null, 2)
    : '{}');
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

  const replaceBodyForEndpoint = (nextEndpoint: string, alias = selectedModel || firstModel?.alias) => {
    setDraft({
      endpoint: nextEndpoint,
      body: alias ? JSON.stringify(requestBodyForEndpoint(nextEndpoint, alias), null, 2) : '{}'
    });
  };

  const updateModel = (alias: string) => {
    const model = availableModels.find((item) => item.alias === alias)?.model;
    if (!model) return;
    const nextEndpoint = endpointForModel(model);
    try {
      const parsed = JSON.parse(body);
      if (endpointKindFromPath(endpoint) === endpointKindFromPath(nextEndpoint)) {
        setDraft({ endpoint: nextEndpoint, body: JSON.stringify({ ...parsed, model: alias }, null, 2) });
        return;
      }
    } catch {
      // Selecting a model replaces invalid JSON with a request template.
    }
    replaceBodyForEndpoint(nextEndpoint, alias);
  };

  const send = async () => {
    setSending(true);
    try {
      const parsed = JSON.parse(body);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json'
      };
      if (serviceApiKey) {
        headers.Authorization = `Bearer ${serviceApiKey}`;
      }
      const httpResponse = await fetch(`${GATEWAY_BASE_URL}${endpoint}`, {
        method: 'POST',
        credentials: serviceApiKey ? 'omit' : 'include',
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
    <Card as="section" className="panel playground">
      <div className="panel-heading">
        <PanelTitle icon={<Play size={18} />} title={t('Request playground')} />
        <Button variant="default" type="button" onClick={send} disabled={sending || !availableModels.length}>
          <Send size={18} />
          {sending ? t('Sending') : t('Send')}
        </Button>
      </div>
      <div className="form-grid">
        <label>
          {t('Endpoint')}
          <SelectField value={endpoint} onValueChange={(value) => replaceBodyForEndpoint(value)}>
            {endpoints.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>
        </label>
        <label>
          {t('Base URL')}
          <Input value={GATEWAY_BASE_URL} readOnly />
        </label>
        <label>
          {t('Model alias')}
          <SelectField
            value={availableModels.some(({ alias }) => alias === selectedModel) ? selectedModel : ''}
            disabled={!availableModels.length}
            onValueChange={(value) => updateModel(value)}
          >
            <option value="" disabled>{t(availableModels.length ? 'Choose a model' : 'No available models')}</option>
            {availableModels.map(({ alias }) => (
              <option key={alias} value={alias}>{alias}</option>
            ))}
          </SelectField>
        </label>
      </div>
      <div className="playground-grid">
        <label>
          {t('Request body')}
          <Textarea value={body} onChange={(event) => setDraft({ endpoint, body: event.target.value })} />
        </label>
        <label>
          {t('Response')}
          <Textarea value={response || t('Run a request to see the response.')} readOnly />
        </label>
      </div>
    </Card>
  );
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

function ChargeReviews() {
  const askConfirmation = useConfirmation();
  const { language } = useI18n();
  const zh = language === 'zh';
  type Review = { id: string; model: string; created: string; owner: string };
  const [rows, setRows] = useState<Review[]>([]);
  const [selected, setSelected] = useState<Review>();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [isOpen, setIsOpen] = useState(false);

  async function refresh() {
    setBusy(true); setMessage('');
    try {
      const res = await gatewayRequest<{ data: Review[] }>('/admin/payments/reviews');
      setRows(res.data || []);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const toggleOpen = () => {
    const next = !isOpen;
    setIsOpen(next);
    if (next) void refresh();
  };

  async function settle(event: FormEvent) {
    event.preventDefault();
    if (!selected || !await askConfirmation(zh ? `确认将此笔调用按 ¥${amount} 结算？` : `Settle this request at CNY ${amount}?`)) return;
    setBusy(true); setMessage('');
    try {
      const result = await gatewayRequest<{ amount: string }>('/admin/payments/reviews', { method: 'POST', body: { id: selected.id, amount, reason } });
      setSelected(undefined);
      setRows(list => list.filter(row => row.id !== selected.id));
      setMessage((zh ? '实际扣费 ¥' : 'Charged ¥') + result.amount);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card as="section" className="overflow-hidden border-border/80">
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/30 transition-colors select-none"
        onClick={toggleOpen}
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
            <ReceiptText size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-sm text-foreground">
                {zh ? '待核对的人民币扣费' : 'CNY charges awaiting review'}
              </span>
              {rows.length > 0 ? (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300">
                  {zh ? `${rows.length} 笔待核对` : `${rows.length} pending`}
                </span>
              ) : (
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                  {zh ? '0 笔待核对' : '0 pending'}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {zh ? '按需人工审核的调用扣费与异常补账记录' : 'Manual verification for exceptional charges'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void refresh()}
            className="h-8 gap-1 text-xs"
          >
            <RefreshCcw size={13} className={busy ? 'animate-spin' : ''} />
            {zh ? '刷新' : 'Refresh'}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-muted-foreground transition-transform"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
            onClick={toggleOpen}
            aria-label={isOpen ? '收起' : '展开'}
          >
            <ChevronDown size={18} />
          </Button>
        </div>
      </div>

      {isOpen && (
        <div className="border-t border-border/60 p-4 bg-muted/10">
          {message && !selected && (
            <div className="mb-3 px-3 py-2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs flex items-center justify-between">
              <span>{message}</span>
              <Button variant="ghost" size="icon-xs" type="button" onClick={() => setMessage('')} className="h-5 w-5 hover:opacity-75"><X size={14} /></Button>
            </div>
          )}

          {!busy && !rows.length && !message && (
            <div className="py-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <CheckCircle2 size={24} className="text-emerald-500/70" />
              <span>{zh ? '当前没有待核对调用，所有费用已平账。' : 'No charges awaiting review.'}</span>
            </div>
          )}

          {rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-1/4">{zh ? '模型' : 'Model'}</TableHead>
                  <TableHead className="w-1/4">{zh ? '请求时间' : 'Time'}</TableHead>
                  <TableHead className="w-1/3">{zh ? '请求 ID' : 'Request ID'}</TableHead>
                  <TableHead className="text-right">{zh ? '操作' : 'Action'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <span className="font-mono text-xs font-medium px-2 py-1 rounded bg-muted/80 text-foreground border border-border/50">
                        {row.model}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(row.created).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <code className="text-xs font-mono text-muted-foreground select-all">
                        {row.id}
                      </code>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          disabled={busy}
                          onClick={() => { setSelected(row); setAmount(''); setReason(''); setMessage(''); }}
                          title={zh ? '核对结算' : 'Review'}
                          aria-label={zh ? '核对结算' : 'Review'}
                          className="h-8 w-8 text-primary hover:bg-primary/10"
                        >
                          <CheckSquare size={16} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      )}

      {selected && (
        <FormDialog
          title={zh ? '核对调用费用' : 'Verify request charge'}
          closeLabel={zh ? '关闭' : 'Close'}
          busy={busy}
          onClose={() => setSelected(undefined)}
          description={`${selected.model} · ${selected.id}`}
        >
          <form className={dialogForm} onSubmit={settle}>
            <div data-slot="dialog-body" className={dialogBody}>
              <div className="form-grid">
                <label>
                  {zh ? '实核金额（元）' : 'Verified amount (CNY)'}
                  <Input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" required />
                </label>
                <label>
                  {zh ? '核对依据 / 备注' : 'Reason / Note'}
                  <Input maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder={zh ? '例如：官方后台补单平账' : 'e.g., Manual settlement'} required />
                </label>
              </div>
              {message && <p role="alert" className="work-notice mt-2">{message}</p>}
            </div>
            <div data-slot="dialog-footer" className={dialogFooter}>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setSelected(undefined)}>
                {zh ? '取消' : 'Cancel'}
              </Button>
              <Button variant="default" disabled={busy || !amount || !reason.trim()}>
                {zh ? '确认结算' : 'Confirm settlement'}
              </Button>
            </div>
          </form>
        </FormDialog>
      )}
    </Card>
  );
}

function BillingView() {
  const { t, language } = useI18n();
  const askConfirmation = useConfirmation();
  const zh = language === 'zh';
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorError, setEditorError] = useState('');
  const closeEditor = () => { setEditorOpen(false); setEditorError(''); };
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
    setEditorError('');
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
      closeEditor();
      setToast(t('Model price saved.'));
    } catch (error) {
      setEditorError((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const usePricingEntry = (alias: string, entry: PricingEntry) => {
    setEditorError('');
    setEditorOpen(true);
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

  const deletePricing = async (alias: string) => {
    if (!await askConfirmation(zh ? `删除「${alias}」的上游成本配置？` : `Delete the upstream cost for “${alias}”?`)) return;
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

  const totalTokens = usage.tokens.total || 0;
  const inputTokens = usage.tokens.input || 0;
  const outputTokens = usage.tokens.output || 0;
  const inputPct = totalTokens > 0 ? Math.round((inputTokens / totalTokens) * 100) : 0;
  const outputPct = totalTokens > 0 ? 100 - inputPct : 0;

  const totalProviderRequests = useMemo(
    () => providerUsageRows.reduce((sum, r) => sum + r.requests, 0),
    [providerUsageRows]
  );

  const configuredModelsCount = useMemo(() => {
    if (!pricing.models) return 0;
    return modelUsageRows.filter((row) => !!pricing.models?.[row.id]).length;
  }, [modelUsageRows, pricing.models]);

  const pricingCoveragePct = modelUsageRows.length > 0
    ? Math.round((configuredModelsCount / modelUsageRows.length) * 100)
    : 0;

  return (
    <div className="console-stack">
      <div className="metric-grid">
        <ConsoleMetric
          color="amber"
          icon={<CircleDollarSign size={20} />}
          label={t('Estimated spend')}
          value={formatCostMap(usage.estimatedCost, pricing.currency)}
          trend={t('Up to 500 recent requests')}
        />
        <ConsoleMetric
          color="blue"
          icon={<CreditCard size={20} />}
          label={t('Gateway requests')}
          value={formatWholeNumber(usage.total)}
          trend={`${successRate} ${t('successful requests')}`}
        />
        <ConsoleMetric
          color="purple"
          icon={<Layers3 size={20} />}
          label={t('Billable usage')}
          value={`${formatCompactNumber(usage.tokens.total)} ${t('tokens')}`}
          trend={`${formatWholeNumber(billableImages)} ${t('billable images')} / ${formatWholeNumber(billableRequests)} ${t('billable requests')}`}
        />
        <ConsoleMetric
          color="amber"
          icon={<Clock size={20} />}
          label={t('Average latency')}
          value={`${usage.avgDurationMs || 0}ms`}
          trend={`${usage.failoverRequests || 0} ${t('failover requests')}`}
        />
      </div>

      <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg bg-muted/40 border border-border/70 text-xs text-muted-foreground">
        <Info size={15} className="shrink-0 text-muted-foreground/80" />
        <span>{t('Estimates use the price recorded for each request. Streamed token usage depends on what the upstream reports.')}</span>
      </div>

      <ChargeReviews />

      <div className="dashboard-grid billing-dashboard">
        <Card as="section" className="panel">
          <div className="panel-heading">
            <PanelTitle icon={<BarChart3 size={18} />} title={t('Usage by model')} />
            <Button variant="outline" size="sm" type="button" onClick={refreshBilling} disabled={loading} className="gap-1.5 h-8 text-xs">
              <RefreshCcw size={13} className={loading ? 'animate-spin' : ''} />
              {loading ? t('Refreshing') : t('Refresh')}
            </Button>
          </div>
          <BillingUsageTable rows={modelUsageRows} currency={pricing.currency} />
        </Card>

        <Card as="section" className="panel flex flex-col justify-between">
          <div>
            <div className="panel-heading">
              <PanelTitle icon={<Network size={18} />} title={zh ? '用量构成与供应商分布' : 'Usage & Provider Breakdown'} />
              <span className="text-xs text-muted-foreground tabular-nums">
                {providerUsageRows.length} {zh ? '个供应商' : 'providers'}
              </span>
            </div>

            {/* Token prompt vs completion breakdown */}
            <div className="p-3.5 mb-4 rounded-xl bg-muted/40 border border-border/60 space-y-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground flex items-center gap-1.5">
                  <Layers3 size={14} className="text-amber-500" />
                  {zh ? 'Token 输入 / 输出分布' : 'Token Input / Output'}
                </span>
                <span className="tabular-nums text-muted-foreground font-mono">
                  {formatCompactNumber(usage.tokens.total)} tokens
                </span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted border border-border/40">
                <div
                  className="bg-amber-500 transition-all"
                  style={{ width: `${Math.max(inputPct > 0 ? 2 : 0, inputPct)}%` }}
                  title={`Prompt: ${formatWholeNumber(inputTokens)} (${inputPct}%)`}
                />
                <div
                  className="bg-blue-500 transition-all"
                  style={{ width: `${Math.max(outputPct > 0 ? 2 : 0, outputPct)}%` }}
                  title={`Completion: ${formatWholeNumber(outputTokens)} (${outputPct}%)`}
                />
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs pt-0.5">
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-amber-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground truncate">{zh ? '提示词 (Prompt)' : 'Prompt'}</div>
                    <div className="font-semibold text-foreground tabular-nums text-xs">
                      {formatWholeNumber(inputTokens)} <span className="text-[10px] font-normal text-muted-foreground">({inputPct}%)</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-blue-500 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground truncate">{zh ? '模型回复 (Completion)' : 'Completion'}</div>
                    <div className="font-semibold text-foreground tabular-nums text-xs">
                      {formatWholeNumber(outputTokens)} <span className="text-[10px] font-normal text-muted-foreground">({outputPct}%)</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Provider share list */}
            <div className="space-y-2 mb-4">
              <div className="text-xs font-medium text-muted-foreground tracking-wide px-0.5">
                {zh ? '供应商流量与计费份额' : 'Provider Traffic & Share'}
              </div>
              {providerUsageRows.length ? (
                providerUsageRows.map((provider) => {
                  const pct = totalProviderRequests > 0 ? Math.round((provider.requests / totalProviderRequests) * 100) : 0;
                  return (
                    <div key={provider.id} className="p-2.5 rounded-lg bg-background border border-border/70 space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono font-semibold text-foreground flex items-center gap-1.5">
                          <Network size={13} className="text-muted-foreground/80" />
                          {provider.id}
                        </span>
                        <div className="flex items-center gap-2 tabular-nums">
                          <span className="font-semibold text-foreground text-xs">{formatWholeNumber(provider.requests)} {t('requests')}</span>
                          <span className="text-muted-foreground text-[11px]">({pct}%)</span>
                        </div>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-foreground/75 transition-all rounded-full"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-0.5">
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground font-medium">
                          {formatUsageUnits(provider, t)}
                        </span>
                        <span className="font-semibold text-foreground tabular-nums">
                          {formatCostMap(provider.costs, pricing.currency)}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="py-6 text-center text-xs text-muted-foreground">
                  {t('No usage records yet.')}
                </div>
              )}
            </div>
          </div>

          {/* Pricing Coverage Footer inside Right Card */}
          <div className="p-3 rounded-lg bg-muted/30 border border-border/60 flex items-center justify-between gap-3 text-xs mt-1">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="p-1.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 shrink-0">
                <CircleDollarSign size={15} />
              </div>
              <div className="min-w-0">
                <div className="font-semibold text-foreground truncate text-xs">{zh ? '在用模型成本覆盖率' : 'Model Cost Coverage'}</div>
                <div className="text-[11px] text-muted-foreground truncate">
                  {configuredModelsCount} / {modelUsageRows.length} {zh ? '已配置官方成本价' : 'models configured'}
                </div>
              </div>
            </div>
            <span className={cn(
              "text-xs px-2.5 py-0.5 rounded-full font-semibold border shrink-0 tabular-nums",
              configuredModelsCount > 0
                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                : "bg-muted text-muted-foreground border-border/60"
            )}>
              {pricingCoveragePct}%
            </span>
          </div>
        </Card>
      </div>

      <Card as="section" className="panel">
        <div className="panel-heading">
          <PanelTitle icon={<CircleDollarSign size={18} />} title={t('Official billing configuration')} />
          <Button variant="default" size="sm" type="button" disabled={loading} onClick={() => { setForm(emptyPricingForm(pricing.currency)); setEditorOpen(true); }} className="gap-1.5 h-8 text-xs">
            <Plus size={15} />{zh ? '新增成本价' : 'Add upstream cost'}
          </Button>
        </div>

        {editorOpen && <FormDialog title={zh ? '上游成本配置' : 'Upstream cost configuration'} closeLabel={t('Close')} busy={saving} onClose={closeEditor} drawer>
          <form className={dialogForm} onSubmit={savePricing}>
            <div data-slot="dialog-body" className={dialogBody}>
              <div className="form-grid">
          <label>
            {t('Model alias')}
            <Input value={form.alias} onChange={(event) => setForm({ ...form, alias: event.target.value })} placeholder="company-chat" />
          </label>
          <label>
            {t('Billing unit')}
            <SelectField value={form.billingUnit} onValueChange={(value) => setForm({ ...form, billingUnit: value as BillingUnit })}>
              <option value="token">{t('Token')}</option>
              <option value="image">{t('Image')}</option>
              <option value="request">{t('Request')}</option>
            </SelectField>
          </label>
          <label>
            {t('Currency')}
            <Input value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} placeholder="USD" />
          </label>
          {form.billingUnit === 'token' && (
            <>
              <label>
                {t('Input / 1M tokens')}
                <Input type="number" min="0" step="0.000001" value={form.inputPerMillionTokens} onChange={(event) => setForm({ ...form, inputPerMillionTokens: event.target.value })} />
              </label>
              <label>
                {t('Output / 1M tokens')}
                <Input type="number" min="0" step="0.000001" value={form.outputPerMillionTokens} onChange={(event) => setForm({ ...form, outputPerMillionTokens: event.target.value })} />
              </label>
            </>
          )}
          {form.billingUnit === 'image' && (
            <label>
              {t('Price / image')}
              <Input type="number" min="0" step="0.000001" value={form.imageUnitPrice} onChange={(event) => setForm({ ...form, imageUnitPrice: event.target.value })} />
            </label>
          )}
          {form.billingUnit === 'request' && (
            <label>
              {t('Price / successful request')}
              <Input type="number" min="0" step="0.000001" value={form.requestUnitPrice} onChange={(event) => setForm({ ...form, requestUnitPrice: event.target.value })} />
            </label>
          )}
          <label>
            {t('Official provider')}
            <Input value={form.officialProvider} onChange={(event) => setForm({ ...form, officialProvider: event.target.value })} placeholder="aliyun" />
          </label>
          <label>
            {t('Official model')}
            <Input value={form.officialModel} onChange={(event) => setForm({ ...form, officialModel: event.target.value })} placeholder="qwen-image-2.0-pro" />
          </label>
          <label>
            {t('Source URL')}
            <Input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} placeholder="https://help.aliyun.com/zh/model-studio/model-pricing" />
          </label>
          <label>
            {t('Note')}
            <Input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder={t('per image')} />
          </label>
              </div>
              {editorError && <p role="alert" className="work-notice">{editorError}</p>}
            </div>
            <div data-slot="dialog-footer" className={dialogFooter}>
              <Button variant="outline" type="button" disabled={saving} onClick={closeEditor}>{t('Cancel')}</Button>
            <Button variant="default" type="submit" disabled={saving}>
              <Check size={18} />
              {saving ? t('Saving') : t('Save price')}
            </Button>
          </div>
          </form>
        </FormDialog>}

        {!pricingRows.length ? (
          <div className="py-7 px-4 text-center rounded-lg border border-dashed border-border/80 flex flex-col items-center justify-center gap-2.5 bg-muted/10">
            <div className="p-2.5 rounded-full bg-muted/60 text-muted-foreground">
              <CircleDollarSign size={24} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {zh ? '暂无上游成本价配置' : 'No pricing configured'}
              </h3>
              <p className="text-xs text-muted-foreground max-w-md mt-1">
                {zh
                  ? '为模型配置官方成本价后，网关将根据实际调用请求的 Token 或图片数量自动核算上游支出与成本明细。'
                  : 'Configure official upstream prices to track spend automatically on each request.'}
              </p>
            </div>
            <Button
              variant="default"
              size="sm"
              onClick={() => { setForm(emptyPricingForm(pricing.currency)); setEditorOpen(true); }}
              className="gap-1.5 text-xs h-8 mt-1"
            >
              <Plus size={14} />
              {zh ? '新增首个成本价' : 'Add First Pricing Entry'}
            </Button>
          </div>
        ) : (
          <Table className="min-w-[32rem]">
            <TableHeader>
              <TableRow>
                <TableHead>{t('Model alias')}</TableHead>
                <TableHead>{t('Billing unit')}</TableHead>
                <TableHead>{t('Official price')}</TableHead>
                <TableHead className="text-right">{t('Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pricingRows.map(([alias, entry]) => {
                const unit = billingUnitOf(entry);
                const unitBadgeClass =
                  unit === 'token'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                    : unit === 'image'
                    ? 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20'
                    : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20';

                return (
                  <TableRow key={alias}>
                    <TableCell>
                      <div className="font-mono text-xs font-semibold text-foreground">
                        {alias}
                      </div>
                      <small className="mt-0.5 block text-[11px] text-muted-foreground">
                        {entry.officialModel || entry.officialProvider || priceCurrency(entry, pricing.currency)}
                      </small>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${unitBadgeClass}`}>
                        {labelForBillingUnit(unit, t)}
                      </span>
                      <small className="mt-0.5 block text-[11px] text-muted-foreground">
                        {priceCurrency(entry, pricing.currency)}
                      </small>
                    </TableCell>
                    <TableCell>
                      <div className="font-semibold text-xs text-foreground tabular-nums">
                        {formatPricingEntry(entry, pricing.currency, t)}
                      </div>
                      <small className="mt-0.5 block text-[11px] text-muted-foreground">
                        {entry.source || t('Official source')}
                      </small>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          type="button"
                          onClick={() => usePricingEntry(alias, entry)}
                          title={t('Edit')}
                          aria-label={t('Edit')}
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          type="button"
                          onClick={() => deletePricing(alias)}
                          title={t('Delete')}
                          aria-label={t('Delete')}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
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
  const totalRequests = useMemo(() => rows.reduce((sum, r) => sum + r.requests, 0), [rows]);

  if (!rows.length) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
        <Activity size={24} className="text-muted-foreground/30" />
        <span>{t('No usage records yet.')}</span>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table className="min-w-[24rem]">
        <TableHeader>
          <TableRow>
            <TableHead className="w-[36%]">{t('Name')}</TableHead>
            <TableHead className="w-[20%] text-right">{t('Requests')}</TableHead>
            <TableHead className="w-[26%]">{t('Billable units')}</TableHead>
            <TableHead className="w-[18%] text-right">{t('Cost')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const pct = totalRequests > 0 ? Math.round((row.requests / totalRequests) * 100) : 0;
            return (
              <TableRow key={row.id}>
                <TableCell>
                  <span className="font-mono text-xs font-semibold px-2 py-1 rounded bg-muted/70 text-foreground border border-border/50">
                    {row.id}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <div className="tabular-nums font-semibold text-foreground text-sm">
                    {formatWholeNumber(row.requests)}
                  </div>
                  <div className="text-[11px] text-muted-foreground tabular-nums">
                    {pct}%
                  </div>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-muted/60 text-muted-foreground font-medium">
                    {formatUsageUnits(row, t)}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums font-semibold text-foreground text-sm">
                  {formatCostMap(row.costs, currency)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useI18n();
  return <span className={`status-badge ${status.toLowerCase()}`}>{t(status)}</span>;
}

function NotFound({ onNavigate }: { onNavigate: (route: Route) => void }) {
  const { t } = useI18n();
  return (
    <div className="console-guard">
      <img src="/logo-full.svg" alt="Wormhole AI" />
      <h1>{t('Page not found')}</h1>
      <p>{t('Please check the browser address or return to the Wormhole AI landing page.')}</p>
      <Button variant="default" type="button" onClick={() => onNavigate('home')}>
        {t('Back home')}
      </Button>
    </div>
  );
}

function Toast({ message, variant, onClose }: { message: string; variant?: 'default' | 'destructive'; onClose: () => void }) {
  const { t } = useI18n();
  const isError = variant === 'destructive' || /error|failed|失败|错误|不可|无效/i.test(message);
  useEffect(() => {
    const timer = window.setTimeout(onClose, isError ? 4200 : 2600);
    return () => window.clearTimeout(timer);
  }, [onClose, isError]);

  return (
    <div className="toast" data-variant={isError ? 'destructive' : 'default'} role={isError ? 'alert' : 'status'}>
      {isError ? (
        <AlertCircle size={18} className="shrink-0 text-[#b94444]" aria-hidden="true" />
      ) : (
        <Check size={18} className="shrink-0 text-[#1e8a5a]" aria-hidden="true" />
      )}
      <span>{message}</span>
      <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label={t('Dismiss')}>
        <X size={16} />
      </Button>
    </div>
  );
}

export default App;

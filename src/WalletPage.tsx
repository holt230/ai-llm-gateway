import { FormDialog, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowRight, Check, CheckCircle2, Clock, Copy, CreditCard, QrCode, RefreshCw, Wallet } from 'lucide-react';
import { useConfirmation } from './components/ui/confirmation';
import { writeClipboard } from './clipboard';
import { AccountPricing } from './WalletPricing';
import { WalletUsage } from './WalletUsage';
import { accountRequest } from './account-api';
import { cn } from './components/ui/utils';

type Order = {
  id: string;
  fen: number | null;
  created: string;
  paid: string | null;
  channel: 'alipay' | 'wechat';
  deleted?: string | null;
};
type Account = {
  balance: string;
  orders: Order[];
  charges: { id: string; model: string; created: string; state: string; amount: string | null }[];
};
type Info = { channel: 'wechat'; enabled: boolean };
type Labels = (zh: string, en: string) => string;

async function request<T>(base: string, path: string, key?: string, body?: object, method?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (key) headers.Authorization = 'Bearer ' + key;
  if (body) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + '/payments/' + path, {
    method: method || (body ? 'POST' : 'GET'),
    credentials: 'omit',
    cache: 'no-store',
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || String(response.status));
  return result;
}

export function WalletPage({ baseUrl, english }: { baseUrl: string; english: boolean }) {
  const [key, setKey] = useState('');
  const [active, setActive] = useState('');
  const t: Labels = (zh, en) => (english ? en : zh);
  return (
    <main className="flex-1 mx-auto grid w-full min-w-0 max-w-4xl content-start gap-4 px-4 py-8 sm:px-8">
      <h1 className="m-0 text-3xl font-semibold tracking-tight">{t('钱包与充值', 'Wallet & top-up')}</h1>
      {active ? (
        <WalletAccount key={active} base={baseUrl} secret={active} t={t} onExit={() => setActive('')} />
      ) : (
        <form
          className="grid max-w-xl gap-4 rounded-xl border border-border bg-card p-5 sm:p-6"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            setActive(key.trim());
            setKey('');
          }}
        >
          <label className="grid gap-1.5 text-sm font-medium">
            {t('预付费业务 Key', 'Prepaid service key')}
            <Input type="password" value={key} autoComplete="off" required onChange={(e) => setKey(e.target.value)} />
          </label>
          <Button variant="default" disabled={!key.trim()}>
            {t('查看余额与订单', 'View balance and orders')}
          </Button>
        </form>
      )}
    </main>
  );
}

export function WalletAccount({
  base,
  secret,
  t,
  onExit,
  nextStep,
  revision = 0,
  guidance,
  active = true,
  hidePricing = false
}: {
  base: string;
  secret?: string;
  t: Labels;
  onExit?: () => void;
  revision?: number;
  guidance?: { title: string; text: string; label: string; run: () => void };
  active?: boolean;
  nextStep?: { label: string; run: () => void };
  hidePricing?: boolean;
}) {
  const [account, setAccount] = useState<Account>();
  const [info, setInfo] = useState<Info>();
  const [selected, setSelected] = useState<Order>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkout, setCheckout] = useState(false);
  const [orderCopied, setOrderCopied] = useState(false);
  const askConfirmation = useConfirmation();
  const readAccount = useCallback(
    () => (secret ? request<Account>(base, 'account', secret) : accountRequest<Account>(base, 'wallet')),
    [base, secret]
  );
  const reload = useCallback(async () => {
    const [settings, data] = await Promise.all([request<Info>(base, 'info'), readAccount()]);
    return { settings, data };
  }, [base, readAccount]);

  const cancelOrder = async (orderToCancel: Order) => {
    if (
      !await askConfirmation(
        t(
          `确认取消充值订单 ${orderToCancel.id} 吗？取消后可随时重新发起充值。`,
          `Cancel order ${orderToCancel.id}? You can start a new top-up anytime.`
        )
      )
    )
      return;

    setBusy(true);
    setError('');
    try {
      if (secret) {
        await request(base, 'orders/' + orderToCancel.id, secret, undefined, 'DELETE');
      } else {
        await accountRequest(base, 'orders/' + orderToCancel.id, undefined, 'DELETE');
      }
      setCheckout(false);
      const { settings, data } = await reload();
      setInfo(settings);
      setAccount(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!active) return;
    let mounted = true;
    const refresh = () =>
      reload()
        .then(({ settings, data }) => {
          if (mounted) {
            setError('');
            setInfo(settings);
            setAccount(data);
          }
        })
        .catch((e) => {
          if (mounted) setError(e.message);
        });
    const onVisible = () => {
      if (!document.hidden) void refresh();
    };
    void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, active, revision]);
  const latestOrder = account?.orders.find((o) => o.id === selected?.id);
  const order = latestOrder || selected;
  const orderUnavailable = Boolean(account && selected && !selected.paid && !latestOrder);
  useEffect(() => {
    if (!active || !checkout || !order || order.paid) return;
    let alive = true,
      running = false;
    const check = async () => {
      if (document.hidden || running) return;
      running = true;
      try {
        const data = await readAccount();
        if (alive) setAccount(data);
      } catch {
        /* Manual refresh displays connection errors. */
      } finally {
        running = false;
      }
    };
    const timer = window.setInterval(() => void check(), 8000);
    document.addEventListener('visibilitychange', check);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [active, checkout, order?.id, order?.paid, readAccount]);
  const update = async (create = false) => {
    setBusy(true);
    setError('');
    try {
      if (create) {
        const body = { channel: 'wechat' };
        const created = await (secret
          ? request<Order>(base, 'orders', secret, body)
          : accountRequest<Order>(base, 'orders', body));
        setSelected(created);
        setAccount((current) => current && {
          ...current,
          orders: [created, ...current.orders.filter((item) => item.id !== created.id)]
        });
      }
      const { settings, data } = await reload();
      setInfo(settings);
      setAccount(data);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visibleOrders = useMemo(() => account?.orders.filter((item) => !item.deleted) ?? [], [account?.orders]);
  const pending = account?.orders.find((o) => !o.paid && !o.deleted && o.channel === 'wechat');
  const openOrder = (item: Order) => {
    setSelected(item);
    setCheckout(true);
  };
  const openCheckout = () => {
    setSelected(undefined);
    setCheckout(true);
    void update(true);
  };
  const ready = info?.enabled && info.channel === 'wechat';
  const showCheckout = Boolean(checkout && (ready || order));
  return (
    <>
      {onExit && (
        <Button variant="outline" onClick={onExit}>
          {t('更换业务 Key', 'Switch service key')}
        </Button>
      )}
      {error && !showCheckout && (
        <p role="alert" className="work-notice">
          {error}{' '}
          <Button variant="outline" disabled={busy} onClick={() => void update()}>
            {t('重试', 'Retry')}
          </Button>
        </p>
      )}
      <section id="wallet-start" className="wallet-overview">
        <div className="wallet-balance">
          <span>
            <Wallet size={18} /> {t('可用余额', 'Available balance')}
          </span>
          <strong>{account ? '¥' + account.balance : '—'}</strong>
          <small>{t('账户余额 · 用于模型调用', 'Account balance · Used for model requests')}</small>
        </div>
        <div className="wallet-method">
          <div>
            <CreditCard size={19} />
            <h2>{t('微信充值', 'WeChat top-up')}</h2>
            {info && (
              <span className="channel-state">
                {ready ? t('人工核款', 'Manual confirmation') : t('暂未开放', 'Unavailable')}
              </span>
            )}
          </div>
          <p>
            {!info
              ? t('正在查询渠道状态…', 'Checking availability…')
              : ready
                ? t(
                    '扫码付款后，预计 1–5 分钟到账。',
                    'After scanning and paying, expect your balance to update in 1–5 minutes.'
                  )
                : t(
                    '收款方尚未开放此渠道，目前无法付款。',
                    'The operator has not opened this channel. Payments are currently unavailable.'
                  )}
          </p>
          {ready ? (
            <Button variant="default" disabled={busy} onClick={openCheckout}>
              {t('微信扫码充值', 'Top up with WeChat')}
              <ArrowRight size={16} aria-hidden="true" />
            </Button>
          ) : (
            info && (
              <div className="wallet-channel-actions">
                <Button variant="outline" disabled={busy} onClick={() => void update()}>
                  <RefreshCw size={15} aria-hidden="true" />
                  {busy ? t('刷新中…', 'Refreshing…') : t('刷新渠道状态', 'Refresh channel status')}
                </Button>
                {nextStep && (
                  <Button type="button" variant="ghost" onClick={nextStep.run}>
                    {nextStep.label}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      </section>
      {!secret && <WalletUsage base={base} t={t} active={active} revision={revision} />}
      {guidance && (
        <Card as="section" className="panel workspace-guidance">
          <div>
            <h2>{guidance.title}</h2>
            <p>{guidance.text}</p>
          </div>
          <Button type="button" variant="outline" onClick={guidance.run}>
            {guidance.label}
          </Button>
        </Card>
      )}
      {pending && (
        <Button variant="ghost" className="pending-receipt" onClick={() => openOrder(pending)}>
          {t('有待核对订单', 'Pending top-up')} ·{' '}
          {pending.fen === null
            ? t('按实收金额入账', 'Credited at the amount received')
            : '¥' + (pending.fen / 100).toFixed(2)}
          　{t('查看订单', 'View order')} →
        </Button>
      )}
      {showCheckout && info && (
        <FormDialog
          closeLabel={t('关闭', 'Close')}
          onClose={() => setCheckout(false)}
          title={
            order?.deleted
              ? t('订单已取消', 'Order cancelled')
              : orderUnavailable
                ? t('此订单已不可支付', 'This order is no longer payable')
                : order?.paid
                  ? t('充值已到账', 'Top-up credited')
                  : order
                    ? t('微信扫码支付', 'WeChat Pay')
                    : t('正在生成充值订单', 'Creating top-up order')
          }
          description={
            order && !order.paid && !order.deleted && !orderUnavailable
              ? t('请使用微信扫码付款，并在付款页面的必填项「订单号」中输入此单号', 'Scan with WeChat and enter this order ID into the required Order Number field')
              : undefined
          }
        >
          <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <div className={cn(dialogBody, "gap-3 py-3.5")}>
              {order ? (
                <div className="space-y-3">
                  {/* Status Banner when order is already paid */}
                  {order.paid ? (
                    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
                      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600">
                        <CheckCircle2 size={28} />
                      </div>
                      <h3 className="m-0 text-xl font-bold text-foreground">
                        {t('充值已成功到账！', 'Payment Received!')}
                      </h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">
                        {order.fen !== null
                          ? t(`已成功入账 ¥${(order.fen / 100).toFixed(2)}，钱包余额已更新。`, `Credited ¥${(order.fen / 100).toFixed(2)}. Your balance is updated.`)
                          : t('充值金额已全额入账，钱包余额已更新。', 'The payment has been credited to your balance.')}
                      </p>
                      {nextStep && (
                        <Button variant="default" size="lg" className="mt-4 gap-2 font-medium" onClick={nextStep.run}>
                          <span>{nextStep.label}</span>
                          <ArrowRight size={16} />
                        </Button>
                      )}
                    </div>
                  ) : order.deleted ? (
                    /* Order Cancelled View */
                    <div className="rounded-xl border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2 font-semibold text-foreground">
                        <AlertCircle size={16} className="text-muted-foreground" />
                        <span>{t('该订单已取消', 'This order has been cancelled')}</span>
                      </div>
                      <p className="mt-2 mb-0 text-xs leading-relaxed">
                        {t(
                          '此订单已取消，无需继续支付。若您已扫码付款，请联系管理员凭订单号核查入账。如需充值，可直接在工作台重新发起。',
                          'This order has been cancelled. If you already made a payment, please contact the administrator with this order ID.'
                        )}
                      </p>
                    </div>
                  ) : orderUnavailable ? (
                    /* Order Unavailable View */
                    <div className="rounded-xl border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive" role="status">
                      {t(
                        '如已付款，请将网站订单号和支付单号交给收款人核对。',
                        'If you already paid, give the website order number and transaction number to the recipient for verification.'
                      )}
                    </div>
                  ) : (
                    /* Active Checkout View with Clear Hierarchy */
                    <>
                      {/* 1. Primary Focal Point: Amount & Status Badge */}
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-muted/30 px-3.5 py-2.5">
                        <div>
                          <div className="text-[11px] font-medium text-muted-foreground">
                            {order.fen !== null ? t('应付金额', 'Amount due') : t('入账方式', 'Crediting method')}
                          </div>
                          <div className="mt-0.5 text-lg font-bold tracking-tight text-foreground">
                            {order.fen !== null ? (
                              <span className="font-mono text-xl">¥{(order.fen / 100).toFixed(2)}</span>
                            ) : (
                              <span className="text-sm font-semibold text-foreground">
                                {t('按微信实付金额 1:1 全额入账', 'Full 1:1 credit based on actual payment')}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center">
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700">
                            <Clock size={12} className="animate-pulse" />
                            {t('待扫码核款', 'Awaiting payment')}
                          </span>
                        </div>
                      </div>

                      {/* 2. Critical User Action: Highlighted Payment Note Code Box */}
                      <div className="rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-3 sm:p-3.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
                            <AlertCircle size={14} className="shrink-0 text-amber-600" />
                            <span>{t('关键必填项 · 付款时务必输入订单号', 'Required Field: Must Enter Order Number')}</span>
                          </div>
                          <span className="text-[10px] font-medium text-amber-700/80">
                            {t('极速自动入账凭证', 'Auto-credit identifier')}
                          </span>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-background px-3 py-1.5 shadow-xs">
                          <div className="min-w-0">
                            <div className="text-[10px] text-muted-foreground">{t('网站订单号 (付款必填项)', 'Website Order ID (Required in payment)')}</div>
                            <code className="font-mono text-sm font-bold tracking-wider text-foreground select-all">
                              {order.id}
                            </code>
                          </div>
                          <Button
                            type="button"
                            variant={orderCopied ? "outline" : "default"}
                            size="sm"
                            className="h-7 shrink-0 gap-1.5 text-xs font-medium"
                            onClick={async () => {
                              await writeClipboard(order.id);
                              setOrderCopied(true);
                              setTimeout(() => setOrderCopied(false), 2000);
                            }}
                          >
                            {orderCopied ? (
                              <>
                                <Check size={13} className="text-emerald-600" />
                                <span>{t('已复制', 'Copied')}</span>
                              </>
                            ) : (
                              <>
                                <Copy size={13} />
                                <span>{t('复制单号', 'Copy ID')}</span>
                              </>
                            )}
                          </Button>
                        </div>

                        <p className="mt-1.5 mb-0 text-[11px] leading-relaxed text-amber-900/90 font-medium">
                          {t(
                            '💡 微信扫码进入付款界面后，在必填项「订单号」中输入或粘贴此单号，系统将在 1–5 分钟内自动匹配入账。',
                            'In WeChat payment, paste this ID into the required "Order Number" field so the system can match and credit automatically.'
                          )}
                        </p>
                      </div>

                      {/* 3. Action Focal Point: WeChat Pay QR Code Container */}
                      {order.channel === 'wechat' && ready && (
                        <div className="flex flex-col items-center justify-center rounded-2xl border border-border/80 bg-card py-3 px-4 shadow-xs">
                          <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                            <QrCode size={12} />
                            <span>{t('微信扫码付款', 'WeChat Pay')}</span>
                          </div>
                          <div className="relative rounded-xl border border-border bg-white p-2 shadow-xs">
                            <img
                              className="size-40 max-w-full rounded-lg"
                              src={base + '/payments/wechat/qr'}
                              alt={t('微信经营收款码', 'WeChat Pay QR code')}
                            />
                          </div>
                          <div className="mt-1.5 text-[11px] text-muted-foreground text-center">
                            {order.fen === null
                              ? t('打开手机微信「扫一扫」，输入任意充值金额付款', 'Open WeChat scan, enter any top-up amount')
                              : t('打开手机微信「扫一扫」，确认金额后付款', 'Open WeChat scan to pay the amount')}
                          </div>
                        </div>
                      )}

                      {/* 4. Structured 3-Step Guide */}
                      <div className="rounded-xl border border-border/70 bg-muted/20 p-2.5">
                        <div className="mb-1.5 text-[11px] font-semibold text-foreground">
                          {t('充值到账流程', 'Payment Process')}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5 text-xs">
                          <div className="rounded-lg border border-border/40 bg-card/80 p-2">
                            <div className="flex items-center gap-1.5 font-medium text-foreground">
                              <span className="flex size-4 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">1</span>
                              <span className="text-[11px]">{t('扫码输入', 'Scan & Enter')}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground leading-normal">
                              {order.fen === null ? t('扫码并填入任意充值金额', 'Enter top-up amount') : t('扫码核对订单金额', 'Confirm order amount')}
                            </div>
                          </div>

                          <div className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2">
                            <div className="flex items-center gap-1.5 font-medium text-amber-900">
                              <span className="flex size-4 items-center justify-center rounded-full bg-amber-500/20 text-[9px] font-bold text-amber-900">2</span>
                              <span className="text-[11px]">{t('输入订单号', 'Enter Order ID')}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-amber-800 leading-normal">
                              {t('在必填项「订单号」粘贴单号', 'Paste into required Order ID field')}
                            </div>
                          </div>

                          <div className="rounded-lg border border-border/40 bg-card/80 p-2">
                            <div className="flex items-center gap-1.5 font-medium text-foreground">
                              <span className="flex size-4 items-center justify-center rounded-full bg-emerald-500/15 text-[10px] font-bold text-emerald-700">3</span>
                              <span className="text-[11px]">{t('自动入账', 'Auto Credit')}</span>
                            </div>
                            <div className="mt-0.5 text-[10px] text-muted-foreground leading-normal">
                              {t('1–5 分钟自动更新余额', 'Arrives in 1–5 mins')}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Exception Notice */}
                      <p className="m-0 text-center text-[11px] text-muted-foreground">
                        {t('已付款请勿重复扫码。若付款时遗漏或输错订单号，请保留微信账单单号联系客服核对。', 'Pay once. If you omitted or mistyped the order ID, share your WeChat transaction ID with support.')}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  <RefreshCw size={24} className="mx-auto mb-2 animate-spin text-muted-foreground/60" />
                  <p className="m-0">{busy ? t('正在生成待入账订单…', 'Creating your order…') : t('可重新点击微信扫码充值生成订单。', 'Select WeChat top-up again to create an order.')}</p>
                </div>
              )}
              {error && <p role="alert" className="work-notice mt-2">{error}</p>}
            </div>

            {/* 5. Footer Actions with Balanced Hierarchy */}
            <div data-slot="dialog-footer" className={cn(dialogFooter, "justify-between")}>
              <div>
                {!order?.paid && !order?.deleted && !orderUnavailable && (
                  <Button
                    variant="ghost"
                    type="button"
                    size="sm"
                    className="text-xs text-muted-foreground hover:bg-destructive/10 hover:text-destructive border-0"
                    disabled={busy}
                    onClick={() => order && void cancelOrder(order)}
                  >
                    {t('取消此订单', 'Cancel order')}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" type="button" onClick={() => setCheckout(false)}>
                  {order?.paid ? t('完成', 'Done') : t('稍后核对 (关闭)', 'Close')}
                </Button>
                {!order?.paid && !order?.deleted && !orderUnavailable && (
                  <Button type="button" size="sm" disabled={busy} onClick={() => void update()} className="gap-1.5 font-medium border-0">
                    <RefreshCw size={14} className={cn(busy && "animate-spin")} />
                    {busy ? t('正在查询…', 'Checking…') : t('刷新到账状态', 'Check status')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </FormDialog>
      )}
      {account && info && (
        <>
          <Card as="section" className="panel">
            <div className="panel-heading">
              <h2 className="m-0 text-lg font-semibold">{t('最近充值', 'Recent top-ups')}</h2>
              {visibleOrders.length > 0 && <span className="text-xs text-muted-foreground">{visibleOrders.length} {t('笔订单', 'orders')}</span>}
            </div>
            {visibleOrders.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t('暂无订单', 'No orders yet')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('订单号', 'Order ID')}</TableHead>
                    <TableHead>{t('支付渠道', 'Channel')}</TableHead>
                    <TableHead>{t('充值金额', 'Amount')}</TableHead>
                    <TableHead>{t('状态', 'Status')}</TableHead>
                    <TableHead className="text-right">{t('操作', 'Actions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleOrders.map((item) => (
                    <TableRow key={item.id}>
                      <TableHead scope="row"><code className="font-mono text-xs">{item.id}</code></TableHead>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <CreditCard size={14} className="text-muted-foreground" />
                          {item.channel === 'wechat' ? t('微信支付', 'WeChat Pay') : t('支付宝（历史）', 'Alipay (historical)')}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {item.fen === null ? t('待确认实收', 'Pending amount') : '¥' + (item.fen / 100).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <span className={`status-badge ${item.paid ? 'active' : 'slow'}`}>
                          {item.paid ? t('已入账', 'Credited') : t('待核款', 'Pending')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          {item.paid ? (
                            <Button variant="outline" size="sm" onClick={() => openOrder(item)}>
                              {t('查看订单', 'View order')}
                            </Button>
                          ) : (
                            <>
                              <Button variant="default" size="sm" onClick={() => openOrder(item)}>
                                {t('继续支付', 'Continue payment')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                disabled={busy}
                                onClick={() => void cancelOrder(item)}
                              >
                                {t('取消', 'Cancel')}
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <Card as="section" className="panel">
            <div className="panel-heading">
              <h2 className="m-0 text-lg font-semibold">{t('最近扣费', 'Recent charges')}</h2>
              {account.charges.length > 0 && <span className="text-xs text-muted-foreground">{account.charges.length} {t('笔扣费', 'charges')}</span>}
            </div>
            {account.charges.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">{t('暂无调用', 'No calls yet')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('调用时间', 'Time')}</TableHead>
                    <TableHead>{t('模型', 'Model')}</TableHead>
                    <TableHead>{t('结算状态', 'State')}</TableHead>
                    <TableHead className="text-right">{t('扣费金额', 'Charged')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {account.charges.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(item.created).toLocaleString(t('zh-CN', 'en-US'), { hour12: false })}
                      </TableCell>
                      <TableHead scope="row"><code className="font-mono text-xs">{item.model}</code></TableHead>
                      <TableCell>
                        <span className={`status-badge ${item.amount !== null ? 'active' : item.state === 'review' ? 'testing' : 'paused'}`}>
                          {item.amount !== null ? t('已结算', 'Settled') : item.state === 'review' ? t('待核对', 'Review') : t('结算中', 'Processing')}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {item.amount === null ? '—' : '¥' + item.amount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          {!hidePricing && <AccountPricing base={base} t={t} />}
        </>
      )}
    </>
  );
}

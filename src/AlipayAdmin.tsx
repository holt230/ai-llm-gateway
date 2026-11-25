import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Button } from './components/ui/button';
import { useConfirmation } from './components/ui/confirmation';
import { Card } from './components/ui/card';
import { Input } from './components/ui/input';
import { FormEvent, useEffect, useState } from 'react';
import { Check, CheckCircle2, CreditCard, Download, Search, ShieldCheck, Trash2, Upload } from 'lucide-react';

type Settings = { configured: boolean; enabled: boolean; uploaded: boolean; shortcutConfigured: boolean };
type Order = {
  id: string;
  fen: number | null;
  created: string;
  paid: string | null;
  deleted: string | null;
  owner?: string | null;
  username?: string | null;
  serviceKeyName?: string | null;
  transactionId?: string | null;
};

export function PaymentAdmin({ base, publicBaseUrl, english }: { base: string; publicBaseUrl: string; english: boolean }) {
  const [channel, setChannel] = useState<'wechat' | 'alipay'>('wechat');
  return (
    <div className="console-stack">
      <div className="group-tabs" role="group" aria-label={english ? 'Payment channel' : '收款渠道'}>
        <Button
          type="button"
          size="sm"
          variant={channel === 'wechat' ? 'default' : 'outline'}
          aria-pressed={channel === 'wechat'}
          onClick={() => setChannel('wechat')}
        >
          {english ? 'WeChat Pay' : '微信支付'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant={channel === 'alipay' ? 'default' : 'outline'}
          aria-pressed={channel === 'alipay'}
          onClick={() => setChannel('alipay')}
        >
          {english ? 'Alipay history' : '支付宝历史订单'}
        </Button>
      </div>
      <Reconciliation key={channel} base={base} publicBaseUrl={publicBaseUrl} english={english} channel={channel} />
    </div>
  );
}

function Reconciliation({ base, publicBaseUrl, english, channel }: { base: string; publicBaseUrl: string; english: boolean; channel: 'wechat' | 'alipay' }) {
  const askConfirmation = useConfirmation();
  const t = (zh: string, en: string) => (english ? en : zh);
  const active = channel === 'wechat';
  const channelName = active ? t('微信支付', 'WeChat Pay') : t('支付宝', 'Alipay');
  const [settings, setSettings] = useState<Settings>();
  const [file, setFile] = useState<File>();
  const [uploadOpen, setUploadOpen] = useState(false);
  const closeUpload = () => { setUploadOpen(false); setFile(undefined); setError(''); };
  const closeReceipt = () => { setSelected(undefined); setError(''); };
  const [preview, setPreview] = useState('');
  const [revision, setRevision] = useState(0);
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid' | 'cancelled'>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Order>();
  const [details, setDetails] = useState<{ order: Order; trigger: HTMLButtonElement }>();
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const prefix = base + '/admin/payments/' + channel + '/';
  async function api<T>(path: string, method = 'GET', body?: object | File): Promise<T> {
    const raw = body instanceof File;
    const res = await fetch(prefix + path, {
      method,
      credentials: 'include',
      cache: 'no-store',
      headers: body ? { 'Content-Type': raw ? body.type : 'application/json' } : undefined,
      body: raw ? body : body ? JSON.stringify(body) : undefined
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || String(res.status));
    return result;
  }
  const loadOrders = async (id = '', f = filter) => {
    const params = new URLSearchParams();
    if (id) params.set('id', id);
    if (f) params.set('filter', f);
    const qs = params.toString() ? '?' + params.toString() : '';
    setOrders((await api<{ orders: Order[] }>('orders' + qs)).orders);
  };
  const switchFilter = (next: 'all' | 'pending' | 'paid' | 'cancelled') => {
    setFilter(next);
    setSelected(undefined);
    void run(() => loadOrders(search.trim(), next));
  };
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {
      setSettings(await api<Settings>('settings'));
      await loadOrders('', filter);
    });
  }, [base, channel]);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const upload = () =>
    run(async () => {
      if (!file) return;
      if (
        settings?.configured &&
        !await askConfirmation(
          t('待付订单也会展示新的收款码。确认更新？', 'Pending orders will also show this code. Replace it?')
        )
      )
        return;
      await api('qr', 'PUT', file);
      setFile(undefined);
      setRevision((n) => n + 1);
      setSettings(await api<Settings>('settings'));
      setUploadOpen(false);
      setMessage(t('收款码已保存，用户可通过微信充值。', 'Saved. WeChat top-ups are now open.'));
    });
  const toggle = () =>
    run(async () => {
      await api('settings', 'PUT', { enabled: !settings?.enabled });
      setSettings(await api<Settings>('settings'));
    });
  const ownerLabel = (order: Order) => order.username || order.serviceKeyName || (
    order.owner?.startsWith('user/') ? t('账号不可用', 'Account unavailable') : t('历史业务 Key', 'Legacy service key')
  );
  const statusLabel = (order: Order) => order.paid ? t('已入账', 'Credited') : order.deleted ? t('已取消', 'Cancelled') : t('待核款', 'Pending');
  const amountLabel = (order: Order) => order.fen === null ? t('按实收入账', 'Actual amount') : '¥' + (order.fen / 100).toFixed(2);
  const showDetails = (id: string, trigger: HTMLButtonElement) => run(async () => {
    const { orders } = await api<{ orders: Order[] }>('orders?id=' + encodeURIComponent(id));
    if (!orders[0]) throw new Error(t('未找到这笔订单，请刷新列表。', 'This order is no longer available. Refresh the list.'));
    setDetails({ order: orders[0], trigger });
  });
  const remove = async (order: Order) => {
    if (!await askConfirmation(t(
      `删除/取消订单 ${order.id}？请先确认收款账单上没有这笔付款。若之后收到款项，可按订单号找回并核款。`,
      `Cancel/delete order ${order.id}? Check your payment records first. If a payment arrives later, look up the order by ID to verify it.`
    ))) return;
    void run(async () => {
      await api('orders?id=' + encodeURIComponent(order.id), 'DELETE');
      if (selected?.id === order.id) {
        setSelected(undefined);
        setAmount('');
        setReceipt('');
      }
      setSearch('');
      await loadOrders('', filter);
      setMessage(t('订单已删除/标记取消', 'Order cancelled/deleted'));
    });
  };
  const confirm = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected) return;
    if (!await askConfirmation(t('确认已在收款账单核实此笔交易？', 'Have you verified this payment in your account?'))) return;
    void run(async () => {
      const result = await api<{ amount: string; repeated: boolean }>('confirm', 'POST', {
        orderId: selected.id,
        amount,
        transactionId: receipt
      });
      setSelected(undefined);
      setReceipt('');
      setAmount('');
      setSearch('');
      await loadOrders(search.trim(), filter);
      setMessage(
        (result.repeated ? t('此前已入账 ¥', 'Already credited ¥') : t('已入账 ¥', 'Credited ¥')) + result.amount
      );
    });
  };
  return (
    <div className="console-stack">
      {error && !selected && !uploadOpen && (
        <p role="alert" className="work-notice">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="work-notice">
          {message}
        </p>
      )}
      {active && (
        <Card as="section" className="panel collection-panel">
          <div className="console-section-head">
            <div>
              <h2>{t('微信经营收款码', 'WeChat Pay business QR code')}</h2>
              <p>{t('用户扫码支付后，可在下方核款入账。', 'Verify QR payments below to credit customer wallets.')}</p>
            </div>
            <span className="channel-state">
              {settings
                ? settings.enabled
                  ? t('已开放', 'Open')
                  : settings.configured
                    ? t('已暂停', 'Paused')
                    : t('待配置', 'Setup needed')
                : t('加载中', 'Loading')}
            </span>
          </div>
          <div className="collection-layout">
            <div className="collection-preview">
              {settings?.configured ? (
                <img src={prefix + 'qr?v=' + revision} alt={t('收款码预览', 'Collection code preview')} />
              ) : (
                <>
                  <CreditCard size={22} aria-hidden="true" />
                  <span>{t('暂无收款码', 'No QR code')}</span>
                </>
              )}
            </div>
            <div className="collection-controls">
              <div className="row-actions">
                <Button variant="default" type="button" disabled={busy || !settings} onClick={() => { setError(''); setUploadOpen(true); }}>
                  <Upload size={16} />{settings?.configured ? t('更换收款码', 'Replace QR code') : t('上传收款码', 'Upload QR code')}
                </Button>
                {settings?.configured && (
                  <Button variant="outline" disabled={busy} onClick={() => void toggle()}>
                    {settings.enabled ? t('暂停新订单', 'Pause checkout') : t('重新开放', 'Reopen checkout')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Card>
      )}
      {uploadOpen && <FormDialog title={t('微信收款码', 'WeChat Pay QR code')} closeLabel={t('关闭', 'Close')} busy={busy} onClose={closeUpload}>
        <form className={dialogForm} onSubmit={(event) => { event.preventDefault(); void upload(); }}>
          <div data-slot="dialog-body" className={dialogBody}>
            {preview && <div className="collection-preview"><img src={preview} alt={t('待上传的收款码', 'New collection code preview')} /></div>}
              <label className="qr-upload">
                {t('选择微信收款码', 'WeChat Pay QR image')}
                <Input
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={busy}
                  aria-describedby="collection-file-help"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    setMessage('');
                    if (f && (!['image/png', 'image/jpeg'].includes(f.type) || f.size > 4 * 1024 * 1024)) {
                      setFile(undefined);
                      setError(t('请选择 4 MB 以内的 PNG 或 JPG 图片', 'Choose a PNG or JPG up to 4 MB'));
                      return;
                    }
                    setError('');
                    setFile(f);
                  }}
                />
              </label>
              <small id="collection-file-help">
                {file ? file.name : t('PNG 或 JPG，最大 4 MB。', 'PNG or JPG, up to 4 MB.')}
              </small>
            {error && <p role="alert" className="work-notice">{error}</p>}
          </div>
          <div data-slot="dialog-footer" className={dialogFooter}>
            <Button variant="outline" type="button" disabled={busy} onClick={closeUpload}>{t('取消', 'Cancel')}</Button>
            <Button variant="default" type="submit" disabled={busy || !file}>{t('保存并启用微信收款', 'Save and enable WeChat Pay')}</Button>
          </div>
        </form>
      </FormDialog>}
      <Card as="section" className="panel receipt-panel">
        <div className="console-section-head">
          <div>
            <h2>{t('充值订单管理', 'Top-up orders')}</h2>
            <p>
              {t('在 ', 'Verify the transaction in ') +
                channelName +
                t(' 账单核实交易，支持查看全部、待核对及已取消订单。', ' bill records. Supports viewing all, pending, and cancelled orders.')}
            </p>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1.5" role="tablist" aria-label={t('订单筛选', 'Order filter')}>
            {[
              { key: 'all', label: t('全部', 'All') },
              { key: 'pending', label: t('待核对', 'Pending') },
              { key: 'paid', label: t('已入账', 'Credited') },
              { key: 'cancelled', label: t('已取消', 'Cancelled') }
            ].map((tab) => (
              <Button
                key={tab.key}
                type="button"
                size="sm"
                variant={filter === tab.key ? 'default' : 'outline'}
                onClick={() => switchFilter(tab.key as typeof filter)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
          <form
            className="console-search-bar !m-0"
            onSubmit={(e) => {
              e.preventDefault();
              setSelected(undefined);
              void run(() => loadOrders(search.trim(), filter));
            }}
          >
            <Input
              aria-label={t('网站订单号', 'Website order number')}
              placeholder={t('输入完整网站订单号', 'Enter full website order ID')}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button variant="outline" disabled={busy}>
              <Search size={15} />
              {t('查询', 'Search')}
            </Button>
          </form>
        </div>
        {orders.length ? (
          <Table className="receipt-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('订单 / 创建时间', 'Order / Time')}</TableHead>
                <TableHead scope="col">{t('用户名 / 业务 Key', 'Username / Service key')}</TableHead>
                <TableHead scope="col">{t('订单金额', 'Order amount')}</TableHead>
                <TableHead scope="col">{t('状态', 'Status')}</TableHead>
                <TableHead scope="col" className="text-right">{t('操作', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => (
                <TableRow key={o.id} data-selected={selected?.id === o.id}>
                  <TableCell>
                    <code className="font-mono text-xs font-semibold">{o.id}</code>
                    <time className="block text-xs text-muted-foreground">{new Date(o.created).toLocaleString()}</time>
                  </TableCell>
                  <TableCell>
                    <span className={`text-xs wrap-anywhere ${o.username || o.serviceKeyName ? 'font-medium' : 'text-muted-foreground'}`}>
                      {ownerLabel(o)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <strong className="font-medium tabular-nums">
                      {amountLabel(o)}
                    </strong>
                  </TableCell>
                  <TableCell>
                    <span className={`status-badge ${o.paid ? 'active' : o.deleted ? 'paused' : 'slow'}`}>
                      {statusLabel(o)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center justify-end gap-1 whitespace-nowrap">
                      <Button variant="ghost" size="sm" type="button" disabled={busy}
                        onClick={(event) => void showDetails(o.id, event.currentTarget)}>
                        {t('查看详情', 'View details')}
                      </Button>
                      {!o.paid && (<>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setSelected(o);
                            setAmount(o.fen !== null ? (o.fen / 100).toFixed(2) : '');
                            setReceipt('');
                            setError('');
                            setMessage('');
                          }}
                          title={t('核对收款', 'Verify receipt')}
                          aria-label={t('核对收款', 'Verify receipt')}
                        >
                          <CheckCircle2 size={16} />
                        </Button>
                        {!o.deleted && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            type="button"
                            className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            disabled={busy}
                            onClick={() => remove(o)}
                            title={t('删除订单', 'Delete order')}
                            aria-label={t('删除订单', 'Delete order')}
                          >
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </>)}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          !busy && <p className="overview-empty">{t('没有匹配的订单', 'No matching orders')}</p>
        )}
        {details && (
          <FormDialog title={t('充值订单详情', 'Top-up order details')} closeLabel={t('关闭', 'Close')}
            description={`${channelName} · ${statusLabel(details.order)}`} drawer
            onClose={() => setDetails(undefined)} returnFocus={() => details.trigger}>
            <dl className={dialogBody}>
              {[
                [t('网站订单号', 'Website order number'), details.order.id, true],
                [details.order.username ? t('用户名', 'Username') : t('业务 Key', 'Service key'), ownerLabel(details.order)],
                [active ? t('微信支付单号', 'WeChat Pay transaction number') : t('支付宝交易号', 'Alipay transaction number'),
                  details.order.transactionId || t('未记录', 'Not recorded'), Boolean(details.order.transactionId)],
                [details.order.paid ? t('实收金额', 'Amount received') : t('订单金额', 'Order amount'), amountLabel(details.order)],
                [t('创建时间', 'Created at'), new Date(details.order.created).toLocaleString()],
                ...(details.order.paid ? [[t('入账时间', 'Credited at'), new Date(details.order.paid).toLocaleString()]] : []),
                ...(details.order.deleted ? [[t('取消时间', 'Cancelled at'), new Date(details.order.deleted).toLocaleString()]] : [])
              ].map(([label, value, code]) => (
                <div key={String(label)}>
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="m-0 mt-1 wrap-anywhere text-sm font-medium">{code ? <code>{value}</code> : value}</dd>
                </div>
              ))}
            </dl>
          </FormDialog>
        )}
        {selected && (
          <FormDialog title={t('核对网站订单', 'Verify order')} closeLabel={t('关闭', 'Close')} busy={busy} onClose={closeReceipt}
            description={`${selected.id} · ${selected.fen === null ? t('按实收金额入账', 'Credit the amount received') : '¥' + (selected.fen / 100).toFixed(2)}`}>
            <form className={dialogForm} onSubmit={confirm}>
              <div data-slot="dialog-body" className={dialogBody}>
                {selected.deleted && (
                  <div className="mb-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                    {t(
                      '注意：此订单已被标记取消。若用户实际已付款，在此核实入账后，系统将自动恢复该订单并将金额充值至对应用户余额。',
                      'Note: This order was marked as cancelled. If payment was made, confirming here will restore the order and credit the user balance.'
                    )}
                  </div>
                )}
                <div className="form-grid">
                  <label>
                    {t('账单实收金额（元）', 'Actual amount received in CNY')}
                    <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                  </label>
                  <label>
                    {active
                      ? t('微信支付单号', 'WeChat Pay transaction number')
                      : t('支付宝交易号', 'Alipay transaction number')}
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]{12,64}"
                      value={receipt}
                      onChange={(e) => setReceipt(e.target.value)}
                      required
                    />
                  </label>
                </div>
                {error && <p role="alert" className="work-notice">{error}</p>}
              </div>
              <div data-slot="dialog-footer" className={dialogFooter}>
                <Button type="button" variant="outline" disabled={busy} onClick={closeReceipt}>
                  {t('取消', 'Cancel')}
                </Button>
                <Button variant="default" disabled={busy || !amount.trim() || !receipt.trim()}>
                  <Check size={16} />
                  {t('确认到账并增加余额', 'Confirm and credit wallet')}
                </Button>
              </div>
            </form>
          </FormDialog>
        )}
      </Card>
      <Card as="section" className="panel">
        <details className="group">
          <summary className="cursor-pointer font-medium text-foreground py-1">
            {t('用 iPhone 快捷指令核款', 'Use an iPhone shortcut')}
          </summary>
          <div className="mt-3 grid gap-3 text-sm">
            <p className="m-0 text-muted-foreground">
              {settings?.shortcutConfigured ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-[#1e8a5a]">
                  <ShieldCheck size={16} />
                  {t('专用核款凭证已配置', 'Shortcut credential configured')}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  {t('使用快捷指令需先设置环境变量 ', 'The shortcut requires setting ')}
                  <code>{active ? 'AI_GW_WECHAT_RECEIPT_TOKEN' : 'AI_GW_ALIPAY_RECEIPT_TOKEN'}</code>
                </span>
              )}
            </p>
            <label className="grid min-w-0 max-w-xl gap-1.5">
              {t('导入时填写的 HTTPS 核款地址', 'HTTPS confirmation URL for import')}
              <Input type="url" readOnly value={`${publicBaseUrl}/payments/${channel}/confirm`} onFocus={(event) => event.target.select()} />
            </label>
            <p className="m-0 text-muted-foreground">
              {t('在 iPhone 导入时粘贴上面的地址和本渠道的专用凭证。运行前请在商户账单中核实实收与交易号，再填写网站订单号。', 'When importing on iPhone, paste the URL above and the credential for this channel. Verify the amount and transaction number on the merchant statement before entering the website order ID.')}
            </p>
            <div>
              <Button asChild variant="outline" size="sm">
                <a href={base + '/shortcuts/' + (active ? 'WechatReceipt' : 'AlipayReceipt') + '.shortcut'} download>
                  <Download size={15} />
                  {t('下载到账确认快捷指令', 'Download receipt shortcut')}
                </a>
              </Button>
            </div>
          </div>
        </details>
      </Card>
    </div>
  );
}

import { FormDialog, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { SelectField } from './components/ui/select-field';
import { FormEvent, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCcw, Search, X } from 'lucide-react';
import { cn } from './components/ui/utils';

type Entry = {
  requestId: string;
  time: string;
  apiKeyId?: string;
  accountId?: string;
  username?: string;
  provider?: string;
  modelAlias?: string;
  endpoint?: string;
  status: number;
  durationMs: number;
  usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
  chargedCny?: string | null;
  billingState?: string;
  priceVersion?: string;
};
type RequestPage = { data: Entry[]; total: number; page: number; limit: number };

function outputRate(row: Entry, locale: string) {
  const tokens = row.usage?.outputTokens;
  if (row.status < 200 || row.status >= 300 || !tokens || tokens < 0 || !Number.isFinite(tokens) ||
    row.durationMs <= 0 || !Number.isFinite(row.durationMs)) return undefined;
  const rate = tokens / (row.durationMs / 1000);
  if (!Number.isFinite(rate)) return undefined;
  return `${rate < 0.1 ? '<0.1' : rate.toLocaleString(locale, { maximumFractionDigits: 1 })} tok/s`;
}

export function RequestLogs({ base, english, admin = false }: { base: string; english: boolean; admin?: boolean }) {
  const t = (zh: string, en: string) => english ? en : zh;
  const locale = english ? 'en-US' : 'zh-CN';
  const rateLabel = t('平均输出速率', 'Avg. output speed');
  const rateDescription = t(
    '输出 Token ÷ 网关总耗时（秒），包含等待时间。',
    'Output tokens divided by total gateway time in seconds, including wait time.'
  );
  const [selected, setSelected] = useState<Entry>();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<RequestPage>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    const params = new URLSearchParams({ q: query, status, page: String(page), limit: '25' });
    const path = admin ? '/admin/requests' : '/account-api/requests';
    setBusy(true);
    setError('');
    fetch(`${base}${path}?${params}`, { credentials: 'include', cache: 'no-store', signal: abort.signal })
      .then(async (response) => {
        if (admin && response.status === 401) window.dispatchEvent(new Event('gateway-session-check'));
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || data.error || String(response.status));
        if (!abort.signal.aborted) setResult(data);
      })
      .catch((e: Error) => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setBusy(false); });
    return () => abort.abort();
  }, [base, admin, query, status, page, revision]);

  function search(event: FormEvent) {
    event.preventDefault();
    setQuery(text.trim());
    setPage(1);
    setRevision(revision + 1);
  }
  const count = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(count / (result?.limit ?? 25)));
  const shownPage = result?.page ?? 1;
  return (
    <Card as="section" className="panel request-logs" aria-label={t('调用日志', 'Request logs')} aria-busy={busy}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="m-0 text-lg font-semibold">{t('调用日志', 'Request logs')}</h2>
          {admin && (
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              {t('从网关最近 500 条记录中查询请求状态、用量和实扣费用。', 'Search the last 500 gateway requests for status, usage and charges.')}
            </p>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          type="button"
          className="h-8 gap-1.5 text-xs shrink-0"
          disabled={busy}
          onClick={() => setRevision(revision + 1)}
        >
          <RefreshCcw size={13} className={busy ? 'animate-spin' : ''} />
          {t('刷新', 'Refresh')}
        </Button>
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-2" onSubmit={search}>
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" size={14} />
          <Input
            type="search"
            className="h-9 pl-9 text-xs sm:text-sm"
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={128}
            aria-label={t('搜索调用日志', 'Search logs')}
            placeholder={admin ? t('搜索用户名、模型、请求 ID、Key ID 或通道…', 'Search username, model, request ID, key ID or channel…') : t('搜索模型名称或请求 ID…', 'Search model alias or request ID…')}
          />
        </div>
        <div className="w-[130px] shrink-0">
          <SelectField
            aria-label={t('调用结果', 'Request outcome')}
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <option value="">{t('全部结果', 'All results')}</option>
            <option value="success">{t('成功 (2xx)', 'Success (2xx)')}</option>
            <option value="failed">{t('失败 (4xx/5xx)', 'Failed (4xx/5xx)')}</option>
          </SelectField>
        </div>
        <Button variant="default" size="sm" className="h-9 px-4 text-xs font-medium shrink-0" disabled={busy}>
          {t('查询', 'Search')}
        </Button>
        {(text || status) && (
          <Button
            variant="outline"
            size="sm"
            className="h-9 px-3 text-xs text-muted-foreground hover:text-foreground shrink-0"
            type="button"
            disabled={busy}
            onClick={() => {
              setText('');
              setQuery('');
              setStatus('');
              setPage(1);
              setRevision(revision + 1);
            }}
          >
            <X size={14} />
            {t('重置', 'Reset')}
          </Button>
        )}
      </form>
      {error && <p className="work-notice" role="alert">{error}</p>}
      {busy && !result && <p role="status">{t('正在读取调用日志…', 'Loading requests…')}</p>}
      {!busy && !error && !count && (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {query || status ? t('没有符合条件的调用。', 'No requests match the filters.') : t('暂无调用记录。发送请求后可在此查看用量和费用。', 'Requests and charges appear here after your first call.')}
        </p>
      )}
      {Boolean(result?.data.length) && (
        <>
          <Table className="console-data request-log-table w-full text-sm">
            <TableHeader>
              <TableRow>
                <TableHead scope="col" className="whitespace-nowrap">{t('时间', 'Time')}</TableHead>
                {admin && <TableHead scope="col" className="whitespace-nowrap">{t('用户名', 'Username')}</TableHead>}
                <TableHead scope="col">{t('模型与请求', 'Model and request')}</TableHead>
                {admin && <TableHead scope="col">{t('通道', 'Channel')}</TableHead>}
                <TableHead scope="col" className="whitespace-nowrap">{t('状态', 'Status')}</TableHead>
                <TableHead scope="col">{t('用量', 'Usage')}</TableHead>
                {admin && <TableHead scope="col" className="whitespace-nowrap" title={rateDescription}>{rateLabel}</TableHead>}
                <TableHead scope="col" className="whitespace-nowrap text-right">{t('扣费金额', 'Amount charged')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result?.data.map((row) => (
                <TableRow key={row.requestId}>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                    <time dateTime={row.time}>
                      {new Date(row.time).toLocaleString(locale, { hour12: false })}
                    </time>
                  </TableCell>
                  {admin && (
                    <TableCell className="text-xs">
                      {row.username ? (
                        <span className="font-semibold text-foreground">{row.username}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="link"
                      size="sm"
                      aria-haspopup="dialog"
                      className="h-auto p-0 font-mono text-xs font-semibold text-foreground hover:underline"
                      onClick={() => setSelected(row)}
                    >
                      <code>{row.modelAlias || row.endpoint || '—'}</code>
                    </Button>
                  </TableCell>
                  {admin && <TableCell className="text-xs">{row.provider || '—'}</TableCell>}
                  <TableCell>
                    <div className="inline-flex items-center gap-1.5">
                      <span
                        className={cn(
                          'inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[11px] font-mono font-semibold',
                          row.status >= 200 && row.status < 300
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                            : 'bg-rose-500/10 text-rose-700 dark:text-rose-400'
                        )}
                      >
                        {row.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">{row.durationMs}ms</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs">
                    {row.usage ? (
                      <div>
                        <span>
                          {t('输入', 'In')} {row.usage.inputTokens ?? '—'} · {t('输出', 'Out')} {row.usage.outputTokens ?? '—'}
                        </span>
                        {Boolean(row.usage.cacheReadTokens || row.usage.cacheWriteTokens) && (
                          <span className="block text-[11px] text-muted-foreground">
                            {t('缓存读/写', 'Cache R/W')} {row.usage.cacheReadTokens || 0} / {row.usage.cacheWriteTokens || 0}
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  {admin && <TableCell className="text-xs whitespace-nowrap tabular-nums" title={rateDescription}>
                    {outputRate(row, locale) ?? '—'}
                  </TableCell>}
                  <TableCell className="text-right font-medium text-xs tabular-nums">
                    {row.chargedCny != null ? (
                      `¥${row.chargedCny}`
                    ) : row.billingState === 'review' ? (
                      <span className="status-badge testing">{t('待核对', 'Review')}</span>
                    ) : row.billingState ? (
                      <span className="status-badge slow">{t('待结算', 'Pending')}</span>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
            <span>{t(`共 ${count} 条 · 第 ${shownPage} / ${totalPages} 页`, `${count} results · Page ${shownPage} of ${totalPages}`)}</span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs gap-1"
                disabled={busy || shownPage <= 1}
                onClick={() => setPage(shownPage - 1)}
              >
                <ChevronLeft size={14} />
                {t('上一页', 'Previous')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2.5 text-xs gap-1"
                disabled={busy || shownPage >= totalPages}
                onClick={() => setPage(shownPage + 1)}
              >
                {t('下一页', 'Next')}
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>
        </>
      )}
    {selected && <FormDialog title={t('调用详情', 'Request details')} description={selected.modelAlias || selected.endpoint}
      closeLabel={t('关闭', 'Close')} onClose={() => setSelected(undefined)}>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <dl className={dialogBody}>
          <div><dt className="text-sm text-muted-foreground">{t('请求 ID', 'Request ID')}</dt><dd className="m-0 wrap-anywhere"><code>{selected.requestId}</code></dd></div>
          {admin && <div>
            <dt className="text-sm text-muted-foreground">{rateLabel}</dt>
            <dd className="m-0 tabular-nums">
              {outputRate(selected, locale) ?? '—'}
              <small className="mt-1 block text-xs text-muted-foreground">{rateDescription}</small>
            </dd>
          </div>}
          {[
            [t('用户名', 'Username'), admin ? selected.username : undefined],
            [t('接口', 'Endpoint'), selected.endpoint],
            ['Key ID', selected.apiKeyId],
            [t('账户 ID', 'Account ID'), admin ? selected.accountId : undefined],
            [t('售价版本', 'Price version'), selected.priceVersion]
          ].filter(([, value]) => value).map(([label, value]) => <div key={label}>
            <dt className="text-sm text-muted-foreground">{label}</dt><dd className="m-0 wrap-anywhere"><code>{value}</code></dd>
          </div>)}
        </dl>
        <div data-slot="dialog-footer" className={dialogFooter}>
          <Button variant="outline" type="button" onClick={() => setSelected(undefined)}>
            {t('关闭', 'Close')}
          </Button>
        </div>
      </div>
    </FormDialog>}
    </Card>
  );
}

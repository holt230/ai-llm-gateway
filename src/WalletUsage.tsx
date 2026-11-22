import { useEffect, useId, useRef, useState } from 'react';
import { accountRequest } from './account-api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { cn } from './components/ui/utils';

type Labels = (zh: string, en: string) => string;
type Range = 7 | 30;
type Metrics = { inputTokens: number; outputTokens: number; chargedCny: string };
type Day = Metrics & { date: string };
type Usage = { series: Day[]; totals: Metrics };

const shortDate = (date: string) => date.slice(5).replace('-', '/');

function DailyBars({ points, activeDate, onSelect, colors, label, describe }: {
  points: { date: string; values: number[] }[];
  activeDate: string;
  onSelect: (date: string) => void;
  colors: string[];
  label: string;
  describe: (index: number) => string;
}) {
  const peak = Math.max(1e-12, ...points.map(({ values }) => values.reduce((a, b) => a + b, 0)));
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  return <div className="min-w-0">
    <div role="group" aria-label={label} className="relative isolate grid h-24 items-end gap-px border-b border-border sm:h-28 sm:gap-0.5"
      style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 border-t border-border/60" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 -z-10 border-t border-border/60" aria-hidden="true" />
      {points.map(({ date, values }, i) => (
        <Button key={date} ref={element => { buttons.current[i] = element; }} variant="ghost" type="button"
          tabIndex={activeDate === date ? 0 : -1} aria-pressed={activeDate === date}
          aria-label={`${date} · ${describe(i)}`} title={`${date} · ${describe(i)}`}
          className={cn('h-full w-full min-w-0 items-end rounded-sm p-0 focus-visible:z-10', activeDate === date && 'bg-muted')}
          onFocus={() => onSelect(date)} onClick={() => onSelect(date)}
          onPointerEnter={event => { if (event.pointerType === 'mouse') onSelect(date); }}
          onKeyDown={event => {
            const next = event.key === 'ArrowLeft' ? i - 1 : event.key === 'ArrowRight' ? i + 1
              : event.key === 'Home' ? 0 : event.key === 'End' ? points.length - 1 : null;
            if (next !== null) {
              event.preventDefault();
              buttons.current[Math.max(0, Math.min(points.length - 1, next))]?.focus();
            }
          }}>
          <span aria-hidden="true" className="pointer-events-none flex h-full w-[62%] flex-col-reverse overflow-hidden rounded-t-sm">
            {values.map((value, n) => value > 0 && <span key={n} className={cn('block min-h-px shrink-0', colors[n])}
              style={{ height: `${value / peak * 100}%` }} />)}
          </span>
        </Button>
      ))}
    </div>
    <div aria-hidden="true" className="mt-1.5 flex justify-between text-xs tabular-nums text-muted-foreground">
      {[points[0], points[Math.floor(points.length / 2)], points[points.length - 1]].map(point => <span key={point.date}>{shortDate(point.date)}</span>)}
    </div>
  </div>;
}

export function WalletUsage({ base, t, active, revision }: { base: string; t: Labels; active: boolean; revision: number }) {
  const titleId = useId();
  const [days, setDays] = useState<Range>(7);
  const [retry, setRetry] = useState(0);
  const [loaded, setLoaded] = useState<{ days: Range; data: Usage }>();
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState('');
  useEffect(() => {
    if (!active) return;
    let current = true;
    let pending = false;
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const data = await accountRequest<Usage>(base, 'wallet/usage?days=' + days);
        if (current) { setLoaded({ days, data }); setError(false); }
      } catch {
        if (current) setError(true);
      } finally { pending = false; }
    }
    const onVisible = () => { if (!document.hidden) void load(); };
    setError(false);
    void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => { current = false; document.removeEventListener('visibilitychange', onVisible); };
  }, [base, days, active, revision, retry]);

  const data = loaded?.days === days ? loaded.data : undefined;
  const formatTokens = new Intl.NumberFormat(t('zh-CN', 'en'));
  const input = (n: number) => t('输入 ', 'Input ') + formatTokens.format(n);
  const output = (n: number) => t('输出 ', 'Output ') + formatTokens.format(n);
  const hasUsage = (item: Metrics) => item.inputTokens > 0 || item.outputTokens > 0 || Number(item.chargedCny) > 0;
  const selectedDay = data && (data.series.find(day => day.date === selected) || [...data.series].reverse().find(hasUsage));
  return <Card as="section" aria-labelledby={titleId} className="grid min-w-0 gap-4 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <h2 id={titleId} className="m-0 text-lg font-semibold">{t('用量与费用', 'Usage and spending')}</h2>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-muted-foreground">
          {t('统计此账号下所有密钥的记录，按北京时间分日。', 'All keys on this account, grouped by day in Beijing time.')}
        </p>
      </div>
      <div className="flex gap-1 rounded-lg border border-border bg-muted p-1" role="group" aria-label={t('统计范围', 'Date range')}>
        {([7, 30] as const).map(range => <Button key={range} variant={days === range ? 'outline' : 'ghost'} type="button" size="sm"
          className="h-7" aria-pressed={days === range} onClick={() => setDays(range)}>
          {t(`近 ${range} 天`, `Last ${range} days`)}
        </Button>)}
      </div>
    </div>
    {error && <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" role="alert">
      <span>{data ? t('暂时无法刷新，正在显示上次的统计。', 'Could not refresh. Showing the previous results.')
        : t('暂时无法加载统计，请重试。', 'Could not load usage. Please retry.')}</span>
      <Button variant="outline" type="button" size="sm" onClick={() => setRetry(n => n + 1)}>{t('重试', 'Retry')}</Button>
    </div>}
    {!data ? (!error && <p className="m-0 py-4 text-sm text-muted-foreground" role="status">{t('正在统计用量…', 'Loading usage…')}</p>)
      : !hasUsage(data.totals) ? (
        <p className="m-0 rounded-lg bg-muted/55 px-4 py-5 text-sm text-muted-foreground" role="status">
          {t('这段时间还没有可统计的 Token 用量或实际扣费。', 'There are no recorded tokens or settled charges in this period.')}
        </p>
      ) : <>
        <div className="grid min-w-0 gap-5 md:grid-cols-2 md:gap-6">
          <div className="grid min-w-0 gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-sm font-medium">{t('Token 用量', 'Token usage')}</h3>
              <strong className="wrap-anywhere text-lg font-semibold tabular-nums">{formatTokens.format(data.totals.inputTokens + data.totals.outputTokens)}</strong>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-ring" aria-hidden="true" />{input(data.totals.inputTokens)}</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-sm bg-[#8dbcb0]" aria-hidden="true" />{output(data.totals.outputTokens)}</span>
            </div>
            <DailyBars points={data.series.map(day => ({ date: day.date, values: [day.inputTokens, day.outputTokens] }))}
              colors={['bg-ring', 'bg-[#8dbcb0]']} label={t('每日 Token 用量', 'Daily token usage')}
              activeDate={selectedDay?.date || ''} onSelect={setSelected}
              describe={i => `${input(data.series[i].inputTokens)} · ${output(data.series[i].outputTokens)}`} />
          </div>
          <div className="grid min-w-0 gap-2 border-t border-border pt-4 md:border-t-0 md:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="m-0 text-sm font-medium">{t('实际扣费', 'Amount charged')}</h3>
              <strong className="wrap-anywhere text-lg font-semibold tabular-nums">¥{data.totals.chargedCny}</strong>
            </div>
            <p className="m-0 text-xs leading-relaxed text-muted-foreground">{t('人民币 · 仅已结算费用', 'CNY · settled charges only')}</p>
            <DailyBars points={data.series.map(day => ({ date: day.date, values: [Number(day.chargedCny)] }))}
              colors={['bg-[#ad7036]']} label={t('每日实际扣费', 'Daily settled charges')}
              activeDate={selectedDay?.date || ''} onSelect={setSelected} describe={i => `¥${data.series[i].chargedCny}`} />
          </div>
        </div>
        {selectedDay && <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg bg-muted/60 px-3 py-2.5 text-xs tabular-nums">
          <strong className="font-medium"><time dateTime={selectedDay.date}>{selectedDay.date}</time></strong>
          <span className="text-muted-foreground">{input(selectedDay.inputTokens)} · {output(selectedDay.outputTokens)} Token</span>
          <span className="wrap-anywhere font-medium">{t('实扣 ', 'Charged ')}¥{selectedDay.chargedCny}</span>
        </div>}
        <p className="m-0 text-xs leading-relaxed text-muted-foreground">
          {t('Token 仅统计模型已返回并保存的用量；费用按调用日期归集。', 'Token totals use recorded model usage. Charges are grouped by request date.')}
        </p>
      </>}
  </Card>;
}

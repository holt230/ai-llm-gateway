import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { Checkbox } from './components/ui/checkbox';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Calculator, ChevronDown } from 'lucide-react';

export type Tier = { input: number; read: number; write: number | null; output: number };
export type Price = { standard?: Tier; long?: Tier; image?: number };
export type WalletPrices = Record<string, Price>;
export type ModelInfo = { id: string; groups?: string[]; endpoints?: string[] };
type Label = (zh: string, en: string) => string;
const LONG_INPUT = 272_000;
const money = (value: number) =>
  '¥' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 });
const counts = (value: string) => (/^\d{1,9}$/.test(value) ? Number(value) : NaN);

export function AccountPricing({
  base,
  t,
  allowedModels
}: {
  base: string;
  t: Label;
  allowedModels?: string[];
}) {
  const [data, setData] = useState<{
    prices: WalletPrices;
    priceVersion: string;
    usableModels?: string[];
    models?: ModelInfo[];
    groupNames?: Record<string, string>;
  }>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(base + '/payments/info?usable=true', { cache: 'no-store', signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Pricing unavailable');
        return response.json();
      })
      .then((value) => setData(value))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [base, attempt]);
  if (data)
    return (
      <WalletPricing
        prices={data.prices}
        version={data.priceVersion}
        t={t}
        allowedModels={allowedModels}
        usableModels={data.usableModels}
        modelsInfo={data.models}
        groupNames={data.groupNames}
      />
    );
  return (
    <Card className="panel" role="status">
      {failed ? (
        <>
          <span>{t('暂时无法加载价格。', 'Pricing is unavailable.')}</span>{' '}
          <Button
            variant="outline"
            onClick={() => {
              setFailed(false);
              setAttempt(attempt + 1);
            }}
          >
            {t('重试', 'Retry')}
          </Button>
        </>
      ) : (
        t('正在加载模型价格…', 'Loading model prices…')
      )}
    </Card>
  );
}

export function WalletPricing({
  prices,
  version,
  t,
  allowedModels,
  usableModels,
  modelsInfo,
  groupNames
}: {
  prices: WalletPrices;
  version: string;
  t: Label;
  allowedModels?: string[];
  usableModels?: string[];
  modelsInfo?: ModelInfo[];
  groupNames?: Record<string, string>;
}) {
  const [filter, setFilter] = useState<string>('all');
  const [selected, setSelected] = useState('');
  const details = useRef<HTMLHeadingElement | null>(null);
  const selectedButton = useRef<HTMLButtonElement | null>(null);
  const detailsId = useId();

  // Filter models: only show models that exist in usable models/groups and have prices
  const targetIds = allowedModels || usableModels;
  const allUsableModels = Object.keys(prices).filter((model) => {
    if (targetIds && !targetIds.includes(model)) return false;
    return Boolean(prices[model]);
  });

  // Extract distinct groups for dynamic tabs
  const distinctGroups = Array.from(
    new Set(
      allUsableModels.flatMap((model) => {
        const info = modelsInfo?.find((m) => m.id === model);
        return info?.groups || [];
      })
    )
  ).filter(Boolean);

  const models = allUsableModels.filter((model) => {
    if (filter === 'all') return true;
    const info = modelsInfo?.find((m) => m.id === model);
    return info?.groups?.includes(filter);
  });

  const date = version.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  useEffect(() => {
    if (selected) details.current?.focus();
  }, [selected]);
  const changeFilter = (next: string) => {
    if (filter === next) return;
    setFilter(next);
    setSelected('');
  };
  return (
    <details className="panel wallet-pricing">
      <summary>
        <span>{t('模型价格与费用试算', 'Model prices and cost calculator')}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </summary>
      <div className="price-content">
        {distinctGroups.length > 1 && (
          <div className="group-tabs price-filters" role="group" aria-label={t('计价模型分组', 'Pricing model groups')}>
            <Button
              type="button"
              size="sm"
              variant={filter === 'all' ? 'default' : 'outline'}
              aria-pressed={filter === 'all'}
              onClick={() => changeFilter('all')}
            >
              {t('全部', 'All')}
            </Button>
            {distinctGroups.map((groupId) => (
              <Button
                key={groupId}
                type="button"
                size="sm"
                variant={filter === groupId ? 'default' : 'outline'}
                aria-pressed={filter === groupId}
                onClick={() => changeFilter(groupId)}
              >
                {groupNames?.[groupId] || groupId}
              </Button>
            ))}
          </div>
        )}
        {selected && prices[selected] && (
          <section id={detailsId} className="price-details">
            <div className="panel-heading">
              <h3 tabIndex={-1} ref={details}>
                {selected} · {t('价格与试算', 'Pricing and estimate')}
              </h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 px-3 text-xs"
                onClick={() => {
                  setSelected('');
                  selectedButton.current?.focus();
                }}
              >
                {t('收起试算', 'Close calculator')}
              </Button>
            </div>
            <PriceEstimate price={prices[selected]} t={t} />
          </section>
        )}
        {!models.length && <p className="panel-note">{t('暂无可使用的模型售价。', 'No usable model prices to display.')}</p>}
        <div className="price-cards">
          {models.map((model) => {
            const price = prices[model];
            return (
              <article className="model-price-card" key={model}>
                <h3>
                  <code>{model}</code>
                </h3>
                {price?.image !== undefined ? (
                  <>
                    <p>{t('按成功生成的请求计费', 'Per successful generation')}</p>
                    <dl>
                      <div>
                        <dt>{t('每次请求', 'Per request')}</dt>
                        <dd>{money(price.image)}</dd>
                      </div>
                    </dl>
                  </>
                ) : price?.standard ? (
                  <>
                    <p>{t('标准档 · 元 / 百万 Token', 'Standard · CNY per million tokens')}</p>
                    <dl>
                      <div>
                        <dt>{t('输入', 'Input')}</dt>
                        <dd>{money(price.standard.input)}</dd>
                      </div>
                      <div>
                        <dt>{t('输出', 'Output')}</dt>
                        <dd>{money(price.standard.output)}</dd>
                      </div>
                    </dl>
                  </>
                ) : (
                  <p>{t('待定价', 'Pricing pending')}</p>
                )}
                {(price?.standard || price?.image !== undefined) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs font-medium"
                    aria-expanded={selected === model}
                    aria-controls={selected === model ? detailsId : undefined}
                    aria-label={model + ' ' + t('查看计费与试算', 'View rates and estimate')}
                    onClick={(e) => {
                      selectedButton.current = e.currentTarget;
                      setSelected(model);
                      if (selected === model) details.current?.focus();
                    }}
                  >
                    {t('计费与试算', 'Rates and estimate')}
                    <ArrowRight size={15} aria-hidden="true" />
                  </Button>
                )}
              </article>
            );
          })}
        </div>
        {date && (
          <footer className="price-source">
            {t('价格版本', 'Price version')} · {date}
          </footer>
        )}
      </div>
    </details>
  );
}

function PriceEstimate({ price, t }: { price: Price; t: Label }) {
  const id = useId();
  const [input, setInput] = useState('10000');
  const [output, setOutput] = useState('1000');
  const [read, setRead] = useState('0');
  const [write, setWrite] = useState('0');
  const [cache, setCache] = useState(false);
  const [requests, setRequests] = useState('1');
  const totalInput = counts(input),
    totalOutput = counts(output);
  const readTokens = cache ? counts(read) : 0,
    writeTokens = cache ? counts(write) : 0;
  const long = Boolean(price?.long && totalInput > LONG_INPUT);
  const rate = long ? price?.long : price?.standard;
  const image = price?.image;
  const requestCount = counts(requests);
  let estimate: number | undefined;
  let hint = '';
  if (image !== undefined) {
    if (Number.isFinite(requestCount) && requestCount >= 1) estimate = image * requestCount;
    else hint = t('请输入至少 1 次成功请求。', 'Enter at least one successful request.');
  } else if (rate) {
    if (![totalInput, totalOutput, readTokens, writeTokens].every(Number.isFinite))
      hint = t('请输入 0 至 999,999,999 之间的整数。', 'Enter whole numbers from 0 to 999,999,999.');
    else if (readTokens + writeTokens > totalInput)
      hint = t('缓存读取和写入之和不能超过总输入。', 'Cache reads and writes cannot exceed total input.');
    else if (writeTokens && rate.write === null)
      hint = t('该型号未提供缓存写入价格，无法估算这笔用量。', 'There is no cache write rate for this usage.');
    else
      estimate =
        ((totalInput - readTokens - writeTokens) * rate.input +
          readTokens * rate.read +
          writeTokens * (rate.write ?? 0) +
          totalOutput * rate.output) /
        1_000_000;
  }
  const field = (name: string, value: string, change: (v: string) => void, min = 0) => (
    <label>
      {name}
      <Input
        type="number"
        inputMode="numeric"
        step="1"
        min={min}
        max={999999999}
        value={value}
        onChange={(e) => change(e.target.value)}
      />
    </label>
  );
  return (
    <div className="price-layout">
      <section aria-labelledby={id + '-rates'} className="price-rates">
        <h3 id={id + '-rates'}>{t('计费单价', 'Rates')}</h3>
        {image !== undefined ? (
          <>
            <p className="rate-unit">{t('按成功生成的请求计费', 'Per successful generation request')}</p>
            <p className="generation-rate">
              <strong>{money(image)}</strong> / {t('次', 'request')}
            </p>
          </>
        ) : (
          price.standard && (
            <>
              <p className="rate-unit">{t('每 100 万 Token 单价', 'Rate per 1 million tokens')}</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t('计费项', 'Usage')}</TableHead>
                    <TableHead scope="col">{price.long ? t('标准档', 'Standard') : t('单价', 'Rate')}</TableHead>
                    {price.long && <TableHead scope="col">{t('长上下文', 'Long context')}</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    [
                      ['input', t('普通输入', 'Uncached input')],
                      ['output', t('输出', 'Output')],
                      ['read', t('缓存读取', 'Cache read')],
                      ['write', t('缓存写入', 'Cache write')]
                    ] as const
                  ).map(([key, label]) => (
                    <TableRow key={key}>
                      <TableHead scope="row">{label}</TableHead>
                      {[price.standard, price.long]
                        .filter((v): v is Tier => Boolean(v))
                        .map((tier, i) => (
                          <TableCell key={i}>{tier[key] === null ? t('未定价', 'Unpriced') : money(tier[key])}</TableCell>
                        ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {price.long && (
                <p className="rate-note">
                  {t(
                    '单次总输入超过 272,000 Token 时，整次调用按长上下文价计算。',
                    'Above 272,000 input tokens, long-context rates apply to the whole request.'
                  )}
                </p>
              )}
            </>
          )
        )}
      </section>
      <section className="price-estimate" aria-labelledby={id + '-estimate'}>
        <h3 id={id + '-estimate'}>
          <Calculator size={17} aria-hidden="true" />
          {t('费用试算', 'Cost calculator')}
        </h3>
        {image !== undefined ? (
          <div className="estimate-fields">
            {field(t('成功请求次数', 'Successful requests'), requests, setRequests, 1)}
          </div>
        ) : (
          <>
            <div className="estimate-fields">
              {field(t('总输入 Token', 'Input tokens'), input, setInput)}
              {field(t('输出 Token', 'Output tokens'), output, setOutput)}
            </div>
            <label className="estimate-cache">
              <Checkbox checked={cache} onCheckedChange={(checked) => setCache(checked)} />
              {t('输入中包含缓存', 'Input includes cached tokens')}
            </label>
            {cache && (
              <div className="estimate-fields">
                {field(t('缓存读取 Token', 'Cache read tokens'), read, setRead)}
                {field(t('缓存写入 Token', 'Cache write tokens'), write, setWrite)}
              </div>
            )}
          </>
        )}
        <div className="estimate-result" aria-live="polite">
          <span>
            {t('预计费用', 'Estimated cost')}
            {rate && price.long ? ' · ' + (long ? t('长上下文', 'Long context') : t('标准档', 'Standard')) : ''}
          </span>
          <output>{estimate === undefined ? '—' : money(estimate)}</output>
          {hint && <small>{hint}</small>}
        </div>
      </section>
    </div>
  );
}

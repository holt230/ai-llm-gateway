import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, Download, Images, LoaderCircle, Upload } from 'lucide-react';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { SelectField } from './components/ui/select-field';
import { Textarea } from './components/ui/textarea';
import { SavedTestKey, eligibleTestKeys, type TestKeySource } from './SavedTestKey';
import type { ModelInfo, WalletPrices } from './WalletPricing';

type Labels = (zh: string, en: string) => string;
type Mode = 'text' | 'reference';
type Result = { blob: Blob } | { link: string };
type ImageResponse = { b64_json?: string; url?: string; image_url?: string };
type ImageGroup = ImageResponse & { data?: ImageResponse[]; images?: ImageResponse[]; results?: ImageResponse[] };
type Catalog = { models?: ModelInfo[]; prices: WalletPrices };
const sizes = [['1:1', '1024x1024'], ['3:2', '1536x1024'], ['2:3', '1024x1536']] as const;
const formats = ['image/png', 'image/jpeg', 'image/webp'];
const imageLimit = 10 * 1024 * 1024;

function useImageUrl(blob: Blob | null) {
  const [entry, setEntry] = useState<{ blob: Blob; url: string }>();
  useEffect(() => {
    if (!blob) { setEntry(undefined); return; }
    const url = URL.createObjectURL(blob);
    setEntry({ blob, url });
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return entry?.blob === blob ? entry?.url : undefined;
}

async function imageResult(payload: ImageGroup & { output?: ImageGroup; result?: ImageGroup }, signal: AbortSignal): Promise<Result | undefined> {
  for (const group of [payload, payload.output, payload.result]) {
    if (!group) continue;
    const image = group.data?.[0] || group.images?.[0] || group.results?.[0] || group;
    if (typeof image.b64_json === 'string') {
      try {
        const bytes = Uint8Array.from(atob(image.b64_json), char => char.charCodeAt(0));
        const mime = bytes[0] === 137 && bytes[1] === 80 ? 'image/png'
          : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
          : String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP' ? 'image/webp' : '';
        if (mime) return { blob: new Blob([bytes], { type: mime }) };
      } catch { /* A channel may provide a link instead. */ }
    }
    const address = image.url || image.image_url;
    if (typeof address !== 'string') continue;
    let url: URL;
    try { url = new URL(address); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password) continue;
    try {
      // Some channels return signed URLs. Preview only when the CDN permits cross-origin reads.
      const response = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal });
      const type = response.headers.get('content-type')?.split(';')[0] || '';
      if (response.ok && formats.includes(type)) return { blob: await response.blob() };
    } catch { /* Opening the original remains available if the URL cannot be read here. */ }
    return { link: url.href };
  }
}

export function ImageStudio({ base, t, keySource, onCharged }: {
  base: string;
  t: Labels;
  keySource: TestKeySource;
  onCharged: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [mode, setMode] = useState<Mode>('text');
  const [prompt, setPrompt] = useState('');
  const [reference, setReference] = useState<File | null>(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [size, setSize] = useState<(typeof sizes)[number][1]>('1536x1024');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const referenceUrl = useImageUrl(reference);
  const resultUrl = useImageUrl(result && 'blob' in result ? result.blob : null);

  useEffect(() => {
    const controller = new AbortController();
    setCatalogFailed(false);
    fetch(base + '/payments/info?usable=true', { cache: 'no-store', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(data => { if (!controller.signal.aborted) setCatalog(data); })
      .catch(() => { if (!controller.signal.aborted) setCatalogFailed(true); });
    return () => controller.abort();
  }, [base, retry]);
  useEffect(() => () => request.current?.abort(), []);
  const useReference = useCallback((file?: File) => {
    if (!file || request.current) return;
    setMode('reference');
    if (!formats.includes(file.type) || file.size > imageLimit || file.size === 0) {
      setError(t('请选择不超过 10 MB 的 PNG、JPG 或 WebP 图片。', 'Choose a PNG, JPG, or WebP image of up to 10 MB.'));
      return;
    }
    setReference(file);
    setError('');
  }, [t]);
  useEffect(() => {
    function paste(event: ClipboardEvent) {
      const image = Array.from(event.clipboardData?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
      if (image && !request.current) { event.preventDefault(); useReference(image); }
    }
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, [useReference]);

  const models = (catalog?.models || []).filter(model =>
    (model.endpoints?.includes('images') || model.endpoints?.includes('*')) && (catalog?.prices?.[model.id]?.image ?? 0) > 0);
  const model = models.find(item => item.id === selectedModel) || models.find(item => eligibleTestKeys(keySource, item.groups).length) || models[0];
  const keys = eligibleTestKeys(keySource, model?.groups);
  const key = keys.find(item => item.id === selectedKey) || keys[0];
  const ready = Boolean(model && key && (mode === 'text' ? prompt.trim() : reference));

  async function generate(event: FormEvent) {
    event.preventDefault();
    if (!model || !key || !ready || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setResult(undefined); setPreviewFailed(false);
    try {
      const secret = await keySource.getSecret(key.id);
      const headers: Record<string, string> = { Authorization: 'Bearer ' + secret };
      const options = {
        model: model.id, size, n: 1,
        prompt: prompt.trim() || t('保留参考图的主要主体，生成一版新的构图。', 'Preserve the main subject and create a new composition based on the reference.')
      };
      let body: BodyInit = JSON.stringify(options);
      if (mode === 'reference' && reference) {
        const form = new FormData();
        for (const [name, value] of Object.entries(options)) form.append(name, String(value));
        form.append('image', reference, reference.name || 'reference.png');
        body = form;
      } else headers['Content-Type'] = 'application/json';
      const response = await fetch(base + '/v1/images/' + (mode === 'reference' ? 'edits' : 'generations'), {
        method: 'POST', body, headers, credentials: 'omit', cache: 'no-store', signal: controller.signal
      });
      const payload = (await response.json().catch(() => undefined)) || {};
      if (!response.ok) throw new Error(payload.error?.message || payload.error || t('生成请求失败，请检查余额或稍后重试。', 'The request failed. Check your balance or try again later.'));
      onCharged();
      const image = await imageResult(payload, controller.signal);
      if (!image) throw new Error(t('渠道未返回可用图片，请先查看调用日志和结算记录。', 'No usable image was returned. Check the request log and charge history.'));
      if (!controller.signal.aborted) setResult(image);
    } catch (e) {
      if (!controller.signal.aborted) setError((e as Error).message);
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  if (!model) return <Card as="section" className="grid gap-3 p-5 sm:p-6">
    <h2 className="m-0 text-xl font-semibold">{t('图片创作', 'Image studio')}</h2>
    <p className="m-0 text-sm text-muted-foreground" role={catalogFailed ? 'alert' : 'status'}>
      {catalogFailed ? t('暂时无法查询图像模型，请稍后重试。', 'Could not load image models. Please try again.')
        : catalog ? t('图像模型暂未开放。开放后，你可以在这里根据描述或参考图生成图片。', 'Image models are not available yet. Once published, you can create images from text or a reference here.')
          : t('正在查看可用图像模型…', 'Checking available image models…')}
    </p>
    {(catalog || catalogFailed) && <Button className="w-fit" variant="outline" type="button" onClick={() => setRetry(n => n + 1)}>{t('刷新', 'Refresh')}</Button>}
  </Card>;

  const price = catalog?.prices[model.id]?.image;
  const extension = result && 'blob' in result && result.blob.type === 'image/jpeg' ? 'jpg'
    : result && 'blob' in result && result.blob.type === 'image/webp' ? 'webp' : 'png';
  return <section className="grid min-w-0 gap-4" aria-labelledby="image-studio-title">
    <div>
      <h2 id="image-studio-title" className="m-0 text-xl font-semibold">{t('图片创作', 'Image studio')}</h2>
      <p className="mt-1 mb-0 text-sm text-muted-foreground">{t('输入描述，或粘贴一张参考图。每次生成一张。', 'Describe an image or paste a reference. Create one image per request.')}</p>
    </div>
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <Card className="min-w-0 p-4 sm:p-5">
        <form className="grid min-w-0 gap-4" onSubmit={generate} aria-busy={busy}>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1" role="group" aria-label={t('创作方式', 'Creation mode')}>
            <Button type="button" size="sm" variant={mode === 'text' ? 'outline' : 'ghost'} disabled={busy} aria-pressed={mode === 'text'} onClick={() => { setMode('text'); setError(''); }}>
              {t('文字生图', 'Text to image')}
            </Button>
            <Button type="button" size="sm" variant={mode === 'reference' ? 'outline' : 'ghost'} disabled={busy} aria-pressed={mode === 'reference'} onClick={() => { setMode('reference'); setError(''); }}>
              {t('参考图片', 'Reference image')}
            </Button>
          </div>
          {mode === 'reference' && <div className="grid min-w-0 gap-2" onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); useReference(e.dataTransfer.files[0]); }}>
            <input ref={input} type="file" accept={formats.join(',')} hidden onChange={e => { useReference(e.target.files?.[0]); e.target.value = ''; }} />
            {reference && referenceUrl ? <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border p-2">
              <img className="size-12 shrink-0 rounded-md object-cover" src={referenceUrl} alt={t('参考图', 'Reference image')} />
              <span className="min-w-0 flex-1 wrap-anywhere text-sm">{reference.name || t('粘贴的图片', 'Pasted image')}</span>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => input.current?.click()}>{t('更换', 'Replace')}</Button>
              <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setReference(null)}>{t('移除', 'Remove')}</Button>
            </div> : <Button type="button" variant="outline" className="h-auto min-h-20 flex-col whitespace-normal border-dashed bg-muted/50 py-3" disabled={busy} onClick={() => input.current?.click()}>
              <Upload aria-hidden="true" />{t('粘贴、拖入或上传图片', 'Paste, drop, or upload an image')}
              <span className="text-xs font-normal text-muted-foreground">PNG / JPG / WebP · ≤ 10 MB</span>
            </Button>}
          </div>}
          <label className="grid gap-1.5 text-sm font-medium">
            {mode === 'text' ? t('图片描述', 'Image description') : t('想怎么改？（选填）', 'What would you like to change? (Optional)')}
            <Textarea value={prompt} maxLength={1000} onChange={e => setPrompt(e.target.value)} disabled={busy} rows={4}
              className="min-h-28" placeholder={mode === 'text' ? t('例如：日落时的海边公路，墨蓝海面，暖橙色天空。', 'For example: a coastal road at sunset, with a deep blue sea and a warm orange sky.') : t('例如：保留主体，换成傍晚的光线。', 'For example: keep the subject and change the lighting to dusk.')} />
          </label>
          {mode === 'reference' && <p className="m-0 text-xs text-muted-foreground">
            {t('不填时，将使用「保留主体，换一种构图」作为指令。', 'If left blank, the prompt asks the model to keep the subject and change the composition.')}
          </p>}
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              {t('生图模型', 'Image model')}
              <SelectField aria-label={t('生图模型', 'Image model')} value={model.id} disabled={busy} onValueChange={setSelectedModel}>
                {models.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
              </SelectField>
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              {t('图片比例', 'Aspect ratio')}
              <SelectField aria-label={t('图片比例', 'Aspect ratio')} value={size} disabled={busy} onValueChange={value => {
                const option = sizes.find(([, dimension]) => dimension === value);
                if (option) setSize(option[1]);
              }}>
                {sizes.map(([ratio, dimension]) => <option key={ratio} value={dimension}>{ratio}</option>)}
              </SelectField>
            </label>
          </div>
          <SavedTestKey source={keySource} keys={keys} selected={key?.id || ''} onSelect={setSelectedKey} disabled={busy} t={t} />
          {error && <p role="alert" className="m-0 wrap-anywhere text-sm text-destructive">{error}</p>}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <div className="grid gap-0.5">
              <span className="text-xs text-muted-foreground">{t('本次费用（当前售价）', 'Current price per request')}</span>
              <strong className="tabular-nums">¥{price?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 10 })}</strong>
            </div>
            <Button type="submit" disabled={busy || !ready}>{busy ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}{busy ? t('生成中…', 'Generating…') : t('生成图片', 'Generate image')}</Button>
          </div>
        </form>
      </Card>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-base font-semibold">{t('生成结果', 'Generated image')}</h3>
          {resultUrl && !previewFailed && <Button asChild variant="outline" size="sm"><a href={resultUrl} download={'wormhole-image.' + extension}><Download aria-hidden="true" />{t('下载图片', 'Download image')}</a></Button>}
        </div>
        <div aria-live="polite" className="grid min-h-64 min-w-0 place-items-center overflow-hidden rounded-lg bg-muted/65 p-4 sm:min-h-80">
          {resultUrl && !previewFailed ? <img className="max-h-[32rem] max-w-full rounded-md object-contain" src={resultUrl} alt={t('生成的图片', 'Generated image')} onError={() => setPreviewFailed(true)} />
            : result && 'link' in result ? <div className="grid justify-items-center gap-3 text-center text-sm">
              <p className="m-0 text-muted-foreground">{t('渠道返回了图片链接，当前页面无法直接预览。', 'The channel returned a link that cannot be previewed here.')}</p>
              <Button asChild variant="outline" size="sm"><a href={result.link} target="_blank" rel="noreferrer">{t('打开原图', 'Open original image')}</a></Button>
            </div> : <div className="grid justify-items-center gap-2 text-center text-sm text-muted-foreground">
              {busy ? <LoaderCircle size={24} className="motion-safe:animate-spin" aria-hidden="true" /> : <Images size={24} aria-hidden="true" />}
              <p className="m-0">{busy ? t('正在生成图片，请稍候。', 'Generating your image. Please wait.')
                : previewFailed ? t('图片无法预览，请查看调用日志。', 'The image could not be displayed. Check the request log.')
                  : t('生成后，图片会在这里显示。', 'Your image will appear here.')}</p>
            </div>}
        </div>
        <p className="m-0 text-xs text-muted-foreground">{t('图片不会自动保存。离开页面前可下载。', 'Images are not saved automatically. Download before leaving the page.')}</p>
      </Card>
    </div>
  </section>;
}

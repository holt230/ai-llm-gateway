import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { SelectField } from './components/ui/select-field';
import { Input } from './components/ui/input';
import { Button } from './components/ui/button';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Play, Send } from 'lucide-react';
import type { CustomerDashboard } from './customer-session';

type Model = CustomerDashboard['models'][number];
export function TestModelCall({
  base,
  models,
  issued,
  english,
  onCharged
}: {
  base: string;
  models: Model[];
  issued?: string;
  english: boolean;
  onCharged: () => void;
}) {
  const t = (zh: string, en: string) => (english ? en : zh);
  const choices = models.filter((m) => m.endpoints.some((e) => ['*', 'chat', 'responses', 'embeddings'].includes(e)));
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const model = choices.find((m) => m.id === choice) || choices[0];
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const key = (issued || inputKey).trim();
    if (!model || !key || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setOutput('');
    try {
      const chat = model.endpoints.some((v) => v === '*' || v === 'chat');
      const endpoint = chat ? 'chat/completions' : model.endpoints.includes('responses') ? 'responses' : 'embeddings';
      const prompt = 'Hello';
      const data = chat
        ? { model: model.id, messages: [{ role: 'user', content: prompt }] }
        : { model: model.id, input: prompt };
      const res = await fetch(base + '/v1/' + endpoint, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        signal: abort.signal,
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      const body = await res.json();
      if (!res.ok) throw Error(body.error?.message || body.error || String(res.status));
      const answer = body.choices?.[0]?.message?.content || body.output_text || body.output?.[0]?.content?.[0]?.text;
      setOutput(
        t('调用成功', 'Request succeeded') +
          ' · ' +
          model.id +
          (typeof answer === 'string' ? '\n' + answer.slice(0, 800) : '')
      );
      onCharged();
    } catch (e) {
      if (!abort.signal.aborted) setOutput((e as Error).message);
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  if (!model) return null;
  return (
    <>
      <Button variant="outline" type="button" onClick={() => setOpen(true)}>{t('在网页测试调用', 'Test a request here')}</Button>
      {open && <FormDialog title={t('在网页测试调用', 'Test a request here')} closeLabel={t('关闭', 'Close')} busy={busy}
        description={t('发送一条 Hello 到当前网关。成功调用按所选模型的用量计费。', 'Send a Hello message. Successful requests are charged at the model rate.')}
        onClose={() => { setOpen(false); setInputKey(''); setOutput(''); }}>
        <form className={dialogForm} onSubmit={send}>
          <div data-slot="dialog-body" className={dialogBody}>
        <label>
          {t('测试模型', 'Model')}
          <SelectField value={model.id} onValueChange={(value) => setChoice(value)}>
            {choices.map((m) => (
              <option key={m.id} value={m.id}>{m.id}</option>
            ))}
          </SelectField>
        </label>
        {issued ? (
          <p>{t('使用刚创建的密钥', 'Using your newly created key')}</p>
        ) : (
          <label>
            API Key
            <Input
              type="password"
              autoComplete="off"
              required
              value={inputKey}
              placeholder="gw_live_…"
              onChange={(e) => setInputKey(e.target.value)}
            />
          </label>
        )}
            {output && <pre role="status" className="max-w-full overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere">{output}</pre>}
          </div>
          <div data-slot="dialog-footer" className={dialogFooter}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
              {t('关闭', 'Close')}
            </Button>
            <Button variant="default" type="submit" disabled={busy || !(issued || inputKey.trim())}>
              <Send size={15} />
              {busy ? t('调用中…', 'Sending…') : t('发送测试请求', 'Send test request')}
            </Button>
          </div>
        </form>
      </FormDialog>}
    </>
  );
}

import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { SelectField } from './components/ui/select-field';
import { SavedTestKey, eligibleTestKeys, type TestKeySource } from './SavedTestKey';
import { Button } from './components/ui/button';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { CustomerDashboard } from './customer-session';

type Model = CustomerDashboard['models'][number];
export function TestModelCall({
  base,
  models,
  keySource,
  english,
  onCharged
}: {
  base: string;
  models: Model[];
  keySource: TestKeySource;
  english: boolean;
  onCharged: () => void;
}) {
  const t = (zh: string, en: string) => (english ? en : zh);
  const choices = models.filter((m) => m.endpoints.some((e) => ['*', 'chat', 'responses', 'embeddings'].includes(e)));
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState('');
  const [keyId, setKeyId] = useState('');
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const model = choices.find(m => m.id === choice) || choices.find(m => eligibleTestKeys(keySource, m.groups).length) || choices[0];
  const keys = eligibleTestKeys(keySource, model?.groups);
  const selectedKey = keys.find(key => key.id === keyId) || keys[0];
  const close = () => { setOpen(false); setOutput(''); };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!model || !selectedKey || busy) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setOutput('');
    try {
      const key = await keySource.getSecret(selectedKey.id);
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
        onClose={close}>
        <form className={dialogForm} onSubmit={send}>
          <div data-slot="dialog-body" className={dialogBody}>
            <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
              {t('测试模型', 'Model')}
              <SelectField aria-label={t('测试模型', 'Model')} value={model.id} disabled={busy} onValueChange={setChoice}>
                {choices.map(m => <option key={m.id} value={m.id}>{m.id}</option>)}
              </SelectField>
            </label>
            <SavedTestKey source={keySource} keys={keys} selected={selectedKey?.id || ''} onSelect={setKeyId} disabled={busy} t={t} />
            {output && <pre role="status" className="max-w-full overflow-auto rounded-md bg-muted p-3 text-sm whitespace-pre-wrap wrap-anywhere">{output}</pre>}
          </div>
          <div data-slot="dialog-footer" className={dialogFooter}>
            <Button type="button" variant="outline" disabled={busy} onClick={close}>
              {t('关闭', 'Close')}
            </Button>
            <Button variant="default" type="submit" disabled={busy || !selectedKey}>
              <Send size={15} />
              {busy ? t('调用中…', 'Sending…') : t('发送测试请求', 'Send test request')}
            </Button>
          </div>
        </form>
      </FormDialog>}
    </>
  );
}

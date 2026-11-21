import { FormDialog, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Button } from './components/ui/button';
import { useState } from 'react';
import { ccSwitchLink, ccSwitchTargets, type CCSwitchTarget } from './cc-switch';
import type { CustomerDashboard, CustomerKey } from './customer-session';

export function CCSwitchImport({
  apiBase,
  record,
  models,
  issued,
  getKey,
  onClose,
  t
}: {
  apiBase: string;
  record: CustomerKey;
  models: CustomerDashboard['models'];
  issued?: string;
  getKey: () => Promise<string>;
  onClose: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targets = ccSwitchTargets(models, record.modelGroup);
  async function open(target: CCSwitchTarget) {
    setBusy(true);
    setError('');
    try {
      const secret = issued || (await getKey());
      window.location.assign(ccSwitchLink(apiBase, record.name, secret, target));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <FormDialog title={t('导入 CC Switch', 'Import to CC Switch')} description={record.name} busy={busy} closeLabel={t('关闭', 'Close')} onClose={onClose}>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className={dialogBody}>
        {targets.length ? (
          <>
            <p>
              {t(
                '选择客户端，在 CC Switch 弹出的窗口中确认导入。',
                'Choose a client, then confirm the import in CC Switch.'
              )}
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="row-actions">
              {targets.map((target) => (
                <Button
                  key={target.client}
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void open(target)}
                >
                  {target.client === 'codex'
                    ? t('导入 Codex', 'Import Codex')
                    : t('导入 Claude Code', 'Import Claude Code')}
                </Button>
              ))}
            </div>
            {targets.some((target) => target.client === 'codex' && target.format === 'openai_responses') && (
              <small>
                {t(
                  '切换到导入的供应商后，Codex 会读取此 Key 分组内的 Responses 模型。',
                  'After selecting this provider, Codex loads the Responses models permitted by this key.'
                )}
              </small>
            )}
            {targets.some((target) => target.localRouting) && (
              <small>
                {targets
                  .filter((target) => target.localRouting)
                  .map((target) => (target.client === 'codex' ? 'Codex' : 'Claude Code'))
                  .join(' / ')}{' '}
                {t('需在 CC Switch 开启本地路由。', 'requires local routing in CC Switch.')}
              </small>
            )}
          </>
        ) : (
          <p>
            {t(
              '此分组暂时没有可导入 Codex 或 Claude Code 的模型。',
              'This group has no models compatible with Codex or Claude Code.'
            )}
          </p>
        )}
        </div>
        <div data-slot="dialog-footer" className={dialogFooter}>
          <Button variant="outline" type="button" onClick={onClose}>{t('关闭', 'Close')}</Button>
        </div>
      </div>
    </FormDialog>
  );
}

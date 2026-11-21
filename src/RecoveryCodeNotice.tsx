import { useState } from 'react';
import { Copy, ShieldCheck } from 'lucide-react';
import { Button } from './components/ui/button';
import { FormDialog, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { writeClipboard } from './clipboard';

export function RecoveryCodeNotice({ code, english, onSaved }: { code: string; english: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(true);
  const [feedback, setFeedback] = useState('');
  const t = (zh: string, en: string) => english ? en : zh;
  async function copyRecovery() {
    try {
      await writeClipboard(code);
      setFeedback(t('已复制。请保存到密码管理器或其他安全位置。', 'Copied. Save it in a password manager or another safe place.'));
    } catch {
      setFeedback(t('请选择恢复码并手动复制。', 'Select the recovery code and copy it manually.'));
    }
  }
  return open ? (
    <FormDialog title={t('请保存恢复码', 'Save your recovery code')} closeLabel={t('稍后保存', 'Save later')} onClose={() => setOpen(false)}
      description={t('忘记密码时可用它找回账号。离开或刷新页面后，无法再查看这份恢复码。', 'Use this code if you forget your password. It will no longer be visible after you leave or refresh.')}>
      <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
        <div className={dialogBody}>
          <code className="select-all wrap-anywhere rounded-lg border border-border bg-muted p-3 text-sm">{code}</code>
          <p className="text-sm text-muted-foreground" role="status">{feedback || t('请勿把恢复码发送给任何人，包括客服。', 'Never share your recovery code, including with support.')}</p>
        </div>
        <div className={dialogFooter}>
          <Button variant="outline" type="button" onClick={() => void copyRecovery()}><Copy aria-hidden="true" />{t('复制恢复码', 'Copy recovery code')}</Button>
          <Button type="button" onClick={onSaved}>{t('我已保存', 'I saved it')}</Button>
        </div>
      </div>
    </FormDialog>
  ) : (
    <Button type="button" variant="outline" className="w-fit" onClick={() => setOpen(true)}>
      <ShieldCheck aria-hidden="true" />{t('查看并保存恢复码', 'View and save your recovery code')}
    </Button>
  );
}

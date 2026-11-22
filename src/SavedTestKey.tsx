import { useId } from 'react';
import type { CustomerKey } from './customer-session';
import { Button } from './components/ui/button';
import { SelectField } from './components/ui/select-field';

export type TestKeySource = {
  keys: CustomerKey[];
  groupLabel: (group: string) => string;
  getSecret: (id: string) => Promise<string>;
  onManage?: () => void;
};

type Labels = (zh: string, en: string) => string;

export function eligibleTestKeys(source: TestKeySource, groups: string[] = []) {
  return source.keys.filter(key => key.secretAvailable && groups.includes(key.modelGroup));
}

export function SavedTestKey({ source, keys, selected, onSelect, disabled, t }: {
  source: TestKeySource;
  keys: CustomerKey[];
  selected: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  t: Labels;
}) {
  const fieldId = useId();
  const label = t('API 密钥', 'API key');
  return <div className="grid min-w-0 gap-1.5">
    <label htmlFor={fieldId} className="text-xs font-medium text-muted-foreground">{label}</label>
    <SelectField id={fieldId} aria-label={label} value={selected} onValueChange={onSelect} disabled={disabled || !keys.length}>
      {keys.length ? keys.map(key => <option key={key.id} value={key.id}>
        {key.name} · {source.groupLabel(key.modelGroup)} · {key.preview}
      </option>) : <option value="">{t('没有可选密钥', 'No available key')}</option>}
    </SelectField>
    {!keys.length && <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      <span>{t('请在 API 密钥页创建或更换模型同组的密钥。', 'Create or replace a key in the same group as this model on the API keys page.')}</span>
      {source.onManage && <Button type="button" variant="link" size="xs" className="p-0" onClick={source.onManage}>
        {t('管理 API 密钥', 'Manage API keys')}
      </Button>}
    </div>}
  </div>;
}

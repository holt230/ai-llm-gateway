import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './components/ui/table';
import { FormDialog, dialogForm, dialogBody, dialogFooter } from './components/ui/form-dialog';
import { Checkbox } from './components/ui/checkbox';
import { useConfirmation } from './components/ui/confirmation';
import { Card } from './components/ui/card';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { SelectField } from './components/ui/select-field';
import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Pencil, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { Price, Tier, WalletPrices } from './WalletPricing';

type Label = (zh: string, en: string) => string;
type AdminRequest = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;
export type ManagedGroup = { id: string; name: string | null; channels: { id: string; name: string }[]; modelCount: number };

export function GroupsAdmin({ request, t, onChannels, renderModels }: {
  request: AdminRequest; t: Label; onChannels: () => void;
  renderModels: (group: ManagedGroup, reload: () => void) => ReactNode;
}) {
  const askConfirmation = useConfirmation();
  const [groups, setGroups] = useState<ManagedGroup[]>();
  const [selectedId, setSelectedId] = useState<string>();
  const [form, setForm] = useState<{ id?: string; name: string }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeForm = () => { setForm(undefined); setError(''); };
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<{ data: ManagedGroup[] }>('/admin/model-groups').then(({ data }) => {
      if (active) setGroups(data);
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [request, attempt]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    setSaving(true);
    setError('');
    try {
      const { data } = await request<{ data: ManagedGroup[] }>('/admin/model-groups', {
        method: form.id ? 'PUT' : 'POST', body: form
      });
      setGroups(data);
      setForm(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(group: ManagedGroup) {
    setError('');
    if (group.channels.length) {
      setError(t('请先将此分组的通道移到其他分组。', 'Move this group’s channels to another group first.'));
      return;
    }
    if (!await askConfirmation(t(`删除分组「${group.name}」？`, `Delete the group “${group.name}”?`))) return;
    setSaving(true);
    try {
      const { data } = await request<{ data: ManagedGroup[] }>('/admin/model-groups?id=' + encodeURIComponent(group.id), { method: 'DELETE' });
      setGroups(data);
      if (form?.id === group.id) setForm(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const selected = groups?.find(group => group.id === selectedId);
  if (selected) return <div className="group-settings">
    <Card as="section" className="panel">
      <div className="console-section-head">
        <div>
          <h2>{selected.name || t('默认分组', 'Default group')}</h2>
          <p>{selected.channels.map(channel => channel.name).join('、') || t('分组暂无通道。请先将一个通道加入此分组，再配置模型。', 'Assign a channel to this group before configuring models.')}</p>
        </div>
        <div className="row-actions">
          <Button variant="outline" type="button" onClick={() => setSelectedId(undefined)}><ArrowLeft size={15} />{t('返回分组', 'Back to groups')}</Button>
          {!selected.channels.length && <Button variant="default" type="button" onClick={onChannels}>{t('管理通道', 'Manage channels')}<ArrowRight size={15} /></Button>}
        </div>
      </div>
      {error && <p className="work-notice" role="alert">{error}</p>}
    </Card>
    {selected.channels.length > 0 && renderModels(selected, () => setAttempt(current => current + 1))}
  </div>;

  return <Card as="section" className="panel">
    <div className="console-section-head">
      <p>{t('在分组内配置模型。用户只会看到有可用模型的分组。',
        'Configure models within a group. Users see groups with available models.')}</p>
      <div className="row-actions">
        <Button variant="outline" type="button" onClick={onChannels}>{t('管理通道', 'Manage channels')} <ArrowRight size={15} /></Button>
        <Button variant="default" type="button" disabled={!groups || saving} onClick={() => { setError(''); setForm({ name: '' }); }}>
          <Plus size={16} />{t('新建分组', 'New group')}
        </Button>
      </div>
    </div>
    {form && <FormDialog title={form.id ? t('编辑分组名称', 'Edit group name') : t('新建分组', 'New group')} closeLabel={t('关闭', 'Close')} busy={saving} onClose={closeForm}>
      <form className={dialogForm} onSubmit={save}>
        <div data-slot="dialog-body" className={dialogBody}>
      <label>{t('分组名称', 'Group name')}
        <Input value={form.name} autoFocus maxLength={48} required disabled={saving}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
          {error && <p role="alert" className="work-notice">{error}</p>}
        </div>
        <div data-slot="dialog-footer" className={dialogFooter}>
        <Button type="button" variant="outline" disabled={saving} onClick={closeForm}>{t('取消', 'Cancel')}</Button>
        <Button variant="default" disabled={saving || !form.name.trim()}>{t('保存分组', 'Save group')}</Button>
      </div>
      </form>
    </FormDialog>}
    {error && !form && <p className="work-notice" role="alert">{error}{!groups && <Button variant="outline" onClick={() => { setError(''); setAttempt(attempt + 1); }}>{t('重试', 'Retry')}</Button>}</p>}
    {groups ? (
      <Table className="console-data operations-group-table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">{t('分组名称', 'Group name')}</TableHead>
            <TableHead scope="col">{t('绑定通道', 'Assigned channels')}</TableHead>
            <TableHead scope="col">{t('可用模型', 'Models')}</TableHead>
            <TableHead scope="col" className="text-right">{t('操作', 'Actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow key={group.id}>
              <TableHead scope="row">
                <div className="font-semibold text-sm">{group.name || t('默认分组', 'Default group')}</div>
                <code className="text-xs text-muted-foreground">{group.id}</code>
              </TableHead>
              <TableCell>
                {group.channels.length ? (
                  <div className="flex flex-wrap gap-1">
                    {group.channels.map(({ id, name }) => (
                      <span key={id} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">{t('待分配通道', 'No channels assigned')}</span>
                )}
              </TableCell>
              <TableCell>
                <span className={`status-badge ${group.modelCount ? 'active' : 'paused'}`}>
                  {group.modelCount ? `${group.modelCount} ${t('个可用模型', 'available models')}` : t('未开放', 'Unavailable')}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-primary hover:bg-primary/10"
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setError(''); setForm(undefined); setSelectedId(group.id);
                    }}
                    title={t('配置模型', 'Configure models')}
                    aria-label={t('配置模型', 'Configure models')}
                  >
                    <SlidersHorizontal size={15} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      setError(''); setForm({ id: group.id, name: group.name || t('默认分组', 'Default group') });
                    }}
                    title={t('编辑名称', 'Edit name')}
                    aria-label={t('编辑名称', 'Edit name')}
                  >
                    <Pencil size={15} />
                  </Button>
                  {group.id !== 'default' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      type="button"
                      disabled={saving}
                      onClick={() => void remove(group)}
                      title={t('删除', 'Delete')}
                      aria-label={t('删除', 'Delete')}
                    >
                      <Trash2 size={15} />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    ) : !error && <p role="status">{t('正在读取分组…', 'Loading groups…')}</p>}
  </Card>;
}

type TierDraft = Record<keyof Tier, string>;
const tierFields = ['input', 'read', 'write', 'output'] as const;
const draftTier = (tier?: Tier): TierDraft => ({
  input: String(tier?.input ?? ''), read: String(tier?.read ?? 0),
  write: tier?.write == null ? '' : String(tier.write), output: String(tier?.output ?? '')
});
const readTier = (form: TierDraft): Tier => ({
  input: Number(form.input), read: Number(form.read), write: form.write === '' ? null : Number(form.write), output: Number(form.output)
});
type Pricing = { prices: WalletPrices; version: string };
type PriceForm = { model: string; editing: boolean; unit: 'token' | 'image'; image: string; standard: TierDraft; long?: TierDraft };

export function CnyPricingAdmin({ request, t, aliases }: { request: AdminRequest; t: Label; aliases: string[] }) {
  const askConfirmation = useConfirmation();
  const [data, setData] = useState<Pricing>();
  const [form, setForm] = useState<PriceForm>();
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const closeForm = () => { setForm(undefined); setError(''); };
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    request<Pricing>('/admin/cny-pricing').then((result) => {
      if (active) setData(result);
    }).catch((e: Error) => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [request, attempt]);

  function open(model = '', price?: Price) {
    setError('');
    setForm({ model, editing: Boolean(price), unit: price?.image ? 'image' : 'token',
      image: price?.image === undefined ? '' : String(price.image), standard: draftTier(price?.standard),
      long: price?.long && draftTier(price.long) });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form || saving) return;
    const model = form.model.trim();
    if (!form.editing && data && Object.prototype.hasOwnProperty.call(data.prices, model)) {
      setError(t('该模型已有售价，请从列表进入编辑。', 'This model already has a price. Edit it from the list.'));
      return;
    }
    const price: Price = form.unit === 'image' ? { image: Number(form.image) }
      : { standard: readTier(form.standard), ...(form.long && { long: readTier(form.long) }) };
    setSaving(true);
    setError('');
    try {
      setData(await request<Pricing>('/admin/cny-pricing', { method: 'PUT', body: { model, price } }));
      setQuery(model);
      setForm(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(model: string) {
    if (!await askConfirmation(t(`删除「${model}」的售价？`, `Delete the price for “${model}”?`))) return;
    setSaving(true);
    setError('');
    try {
      setData(await request<Pricing>('/admin/cny-pricing?model=' + encodeURIComponent(model), { method: 'DELETE' }));
      if (form?.model === model) setForm(undefined);
      if (query === model) setQuery('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const prices = Object.entries(data?.prices ?? {}).filter(([id]) => id.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(([left], [right]) => left.localeCompare(right));
  const labels = { input: t('输入', 'Input'), read: t('缓存读取', 'Cache read'), write: t('缓存写入', 'Cache write'), output: t('输出', 'Output') };
  const fields = (tier: TierDraft, onChange: (tier: TierDraft) => void, focus = false) => <div className="form-grid">
    {tierFields.map((field) => <label key={field}>{labels[field]}
      <Input type="number" min="0" max="1000000" step="0.0001" required={field !== 'write'} autoFocus={focus && field === 'input'}
        placeholder={field === 'write' ? t('留空表示不支持', 'Blank if unsupported') : undefined}
        value={tier[field]} onChange={(e) => onChange({ ...tier, [field]: e.target.value })} />
    </label>)}
  </div>;

  return <Card as="section" className="panel">
    <div className="console-section-head">
      <div><p>{t('普通用户钱包按此售价扣款。保存后，新请求使用更新后的售价。',
        'User wallets are charged at these rates. Saved prices apply to new requests.')}</p>
        {data && <small className="panel-note">{t('最近更新', 'Last updated')} {data.version.slice(0, 10)}</small>}</div>
      <Button variant="default" type="button" disabled={!data || saving} onClick={() => open()}><Plus size={16} />{t('新增售价', 'Add price')}</Button>
    </div>
    {form && <FormDialog title={form.editing ? t('编辑售价', 'Edit price') : t('新增售价', 'Add price')} closeLabel={t('关闭', 'Close')} busy={saving} onClose={closeForm} drawer>
      <form className={dialogForm} onSubmit={save}>
        <div data-slot="dialog-body" className={dialogBody}>
      <div className="form-grid">
        <label>{t('模型别名', 'Model alias')}<Input value={form.model} list="price-aliases" maxLength={128} required disabled={form.editing || saving}
          autoFocus={!form.editing} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <datalist id="price-aliases">{aliases.map(alias => <option value={alias} key={alias} />)}</datalist>
        </label>
        <label>{t('计费单位', 'Billing unit')}
          <SelectField value={form.unit} disabled={form.editing || saving} onValueChange={(value) => setForm({ ...form, unit: value as PriceForm['unit'] })}>
            <option value="token">{t('元 / 百万 Token', 'CNY / million tokens')}</option><option value="image">{t('元 / 次图像请求', 'CNY / image request')}</option>
          </SelectField>
        </label>
      </div>
      {form.unit === 'image' ? <label>{t('每次成功请求价格', 'Price per successful request')}
        <Input type="number" min="0.0001" max="1000000" step="0.0001" required value={form.image} autoFocus={form.editing}
          onChange={(e) => setForm({ ...form, image: e.target.value })} />
      </label> : <>
        <fieldset className="admin-fields" disabled={saving}><legend>{t('标准档', 'Standard tier')}</legend>
          {fields(form.standard, standard => setForm({ ...form, standard }), form.editing)}
        </fieldset>
        <label className="console-option"><Checkbox checked={Boolean(form.long)} disabled={saving}
          onCheckedChange={(checked) => setForm({ ...form, long: checked ? { ...form.standard } : undefined })} />
          {t('输入超过 272,000 Token 时使用长上下文价', 'Use long-context rates above 272,000 input tokens')}
        </label>
        {form.long && <fieldset className="admin-fields" disabled={saving}><legend>{t('长上下文档', 'Long-context tier')}</legend>
          {fields(form.long, long => setForm({ ...form, long }))}
        </fieldset>}
      </>}
          {error && <p role="alert" className="work-notice">{error}</p>}
        </div>
        <div data-slot="dialog-footer" className={dialogFooter}>
        <Button variant="outline" type="button" disabled={saving} onClick={closeForm}>{t('取消', 'Cancel')}</Button>
        <Button variant="default" disabled={saving || !form.model.trim()}>{t('保存售价', 'Save price')}</Button>
      </div>
      </form>
    </FormDialog>}
    {error && !form && <p className="work-notice" role="alert">{error}{!data && <Button variant="outline" onClick={() => { setError(''); setAttempt(attempt + 1); }}>{t('重试', 'Retry')}</Button>}</p>}
    {data ? <>
      <div className="console-search-bar"><Input type="search" value={query} onChange={(e) => setQuery(e.target.value)}
        aria-label={t('搜索模型', 'Search models')} placeholder={t('搜索模型', 'Search models')} /></div>
      {prices.length ? <Table className="console-data price-admin-table">
        <TableHeader><TableRow><TableHead scope="col">{t('模型', 'Model')}</TableHead><TableHead scope="col">{t('计费单位', 'Unit')}</TableHead>
          {tierFields.map(field => <TableHead scope="col" key={field}>{labels[field]}</TableHead>)}<TableHead scope="col" className="text-right">{t('操作', 'Actions')}</TableHead></TableRow></TableHeader>
        <TableBody>{prices.map(([id, price]) => <TableRow key={id}>
          <TableHead scope="row"><code>{id}</code>{price.long && <small>{t('含长上下文档', 'Long-context tier')}</small>}</TableHead>
          <TableCell>{price.image ? t('元 / 次', 'CNY / request') : t('元 / 百万 Token', 'CNY / million tokens')}</TableCell>
          {tierFields.map((field, index) => <TableCell key={field}>{price.standard?.[field] ?? (index === 0 ? price.image : undefined) ?? '—'}</TableCell>)}
          <TableCell className="text-right"><div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:text-foreground" type="button" disabled={saving} onClick={() => open(id, price)} title={t('编辑', 'Edit')} aria-label={t('编辑', 'Edit')}>
              <Pencil size={15} />
            </Button>
            <Button variant="ghost" size="icon-sm" className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" type="button" disabled={saving} onClick={() => void remove(id)} title={t('删除', 'Delete')} aria-label={t('删除', 'Delete')}>
              <Trash2 size={15} />
            </Button>
          </div></TableCell>
        </TableRow>)}</TableBody>
      </Table> : <p>{t('没有匹配的模型。', 'No matching models.')}</p>}
    </> : !error && <p role="status">{t('正在读取售价…', 'Loading prices…')}</p>}
  </Card>;
}

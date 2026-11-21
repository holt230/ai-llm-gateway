import { useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import { accountRequest } from './account-api';
import { Button } from './components/ui/button';
import { Card } from './components/ui/card';
import { FormDialog, dialogBody, dialogFooter, dialogForm } from './components/ui/form-dialog';
import { Input } from './components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { Textarea } from './components/ui/textarea';
import { useConfirmation } from './components/ui/confirmation';
import { RecoveryCodeNotice } from './RecoveryCodeNotice';

export const openSupport = () => window.dispatchEvent(new Event('wormhole-support-open'));
type Message = { seq: number; sender: 'admin' | 'user'; text: string; created: string };
type Reset = { username: string; expires: string };
type Status = 'pending' | 'replied' | 'resolved' | 'expired';
type ThreadInfo = { id: string; status: Status; scope: 'account' | 'guest'; latestSeq: number; unread: boolean };
type Thread = ThreadInfo & { messages: Message[]; reset: Reset | null; username?: string };
type Ticket = Pick<ThreadInfo, 'id' | 'status' | 'scope'> & { updated: string; username?: string | null; preview: string };
type Label = (zh: string, en: string) => string;
type AdminRequest = <T>(path: string, options?: { method?: string; body?: unknown }) => Promise<T>;

function statusText(status: Status, t: Label) {
  if (status === 'pending') return t('待回复', 'Awaiting reply');
  if (status === 'replied') return t('已回复', 'Replied');
  return status === 'resolved' ? t('已解决', 'Resolved') : t('已过期', 'Expired');
}

function SupportStatus({ status, t }: { status: Status; t: Label }) {
  return <span className={'inline-flex whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium ' +
    (status === 'pending' ? 'bg-accent text-accent-foreground' : 'bg-muted text-muted-foreground')}>{statusText(status, t)}</span>;
}


function Messages({ thread, t }: { thread: Thread; t: Label }) {
  const bottom = useRef<HTMLDivElement>(null);
  const last = thread.messages[thread.messages.length - 1]?.seq;
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [thread.id, last]);
  return <div className="space-y-3" role="log" aria-label={t('对话消息', 'Conversation messages')}>
    {thread.messages.map(message => <div key={message.seq} className={message.sender === 'admin' ? 'me-auto max-w-[85%]' : 'ms-auto max-w-[85%]'}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <span className="font-medium">{message.sender === 'admin' ? t('客服', 'Support') : t('用户', 'Customer')}</span>
        <time dateTime={message.created}>{new Date(message.created).toLocaleString()}</time>
      </div>
      <p className={'m-0 rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere ' + (message.sender === 'admin' ? 'bg-accent' : 'bg-muted')}>{message.text}</p>
    </div>)}
    <div ref={bottom} />
  </div>;
}

export function SupportBubble({ base, english, signedIn }: { base: string; english: boolean; signedIn: boolean }) {
  const t = (zh: string, en: string) => english ? en : zh;
  const ask = useConfirmation();
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Thread | null | undefined>();
  const [attention, setAttention] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('wormhole-support-open', show);
    return () => window.removeEventListener('wormhole-support-open', show);
  }, []);
  useEffect(() => {
    if (busy || code) return;
    let active = true;
    let reading = false;
    async function read() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        if (!open) {
          const { data } = await accountRequest<{ data: { unread: boolean; reset: boolean } | null }>(base, 'support?summary=true');
          if (active) setAttention(Boolean(data?.unread || data?.reset));
          return;
        }
        const { data } = await accountRequest<{ data: Thread | null }>(base, 'support');
        if (!active) return;
        setLoadError('');
        setThread(data);
        setAttention(Boolean(data?.reset));
        if (data?.unread && !resetting) await accountRequest(base, 'support/read', { seq: data.latestSeq });
      } catch (e) {
        if (active && open) setLoadError((e as Error).message);
      } finally { reading = false; }
    }
    void read();
    const timer = window.setInterval(read, open ? 6000 : 15000);
    document.addEventListener('visibilitychange', read);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener('visibilitychange', read); };
  }, [open, busy, base, code, resetting]);

  function exitReset() {
    setResetting(false);
    setPassword('');
    setConfirm('');
    setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError('');
    if (resetting && password !== confirm) {
      setError(t('两次输入的密码不一致。', 'The passwords do not match.'));
      return;
    }
    setBusy(true);
    try {
      if (resetting) {
        const result = await accountRequest<{ recoveryCode: string }>(base, 'support/reset', { password });
        exitReset();
        setThread(current => current ? { ...current, reset: null } : current);
        setOpen(false);
        setCode(result.recoveryCode);
      } else {
        const { data } = await accountRequest<{ data: Thread }>(base, 'support', { message });
        setThread(data);
        setMessage('');
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function endGuest() {
    if (!await ask(t('结束后，此浏览器将不能再查看这段访客对话或使用其中的重置授权。确认结束？', 'Ending this conversation removes access to its messages and reset approval from this browser. End it?'))) return;
    setBusy(true);
    setError('');
    try {
      await accountRequest(base, 'support/end', {});
      setThread(null);
      setMessage('');
      setAttention(false);
      setOpen(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <>
    <div className="fixed right-4 bottom-4 z-30 flex max-w-[calc(100%-2rem)] flex-wrap items-center justify-end gap-2 sm:right-6 sm:bottom-6">
      {code && <RecoveryCodeNotice code={code} english={english} onSaved={() => { setCode(''); window.dispatchEvent(new Event('gateway-session-check')); }} />}
      <Button ref={button} className="rounded-full shadow-md" type="button" size="lg" aria-haspopup="dialog" onClick={openSupport}>
        <MessageCircle aria-hidden="true" />{t('联系客服', 'Contact support')}
        {attention && <span role="status" className="rounded-full bg-primary-foreground px-2 py-0.5 text-xs text-primary">{t('新消息', 'New')}</span>}
      </Button>
    </div>
    {open && !code && <FormDialog title={resetting ? t('设置新密码', 'Set a new password') : t('站内客服', 'Customer support')}
      closeLabel={t('关闭', 'Close')} busy={busy} returnFocus={() => button.current}
      description={resetting ? thread?.reset?.username : signedIn
        ? t('此对话归属于当前账号。请勿发送密码、恢复码或 API 密钥。', 'This conversation belongs to this account. Never send passwords, recovery codes, or API keys.')
        : t('访客回复只能在此浏览器未登录时查看。请勿发送密码、恢复码或 API 密钥。', 'To view guest replies, return to this browser while signed out. Never send passwords, recovery codes, or API keys.')}
      onClose={() => { setOpen(false); exitReset(); }}>
      <form className={dialogForm} onSubmit={submit}>
        <div className={dialogBody}>
          {(error || loadError) && <p className="text-sm text-destructive" role="alert">{error || loadError}</p>}
          {resetting ? <>
            <label className="grid gap-1.5 text-sm">{t('新密码（至少 12 位）', 'New password (at least 12 characters)')}
              <Input type="password" name="new-password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} />
            </label>
            <label className="grid gap-1.5 text-sm">{t('确认新密码', 'Confirm new password')}
              <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={confirm} onChange={e => setConfirm(e.target.value)} />
            </label>
            <p className="text-sm text-muted-foreground">{t('重置会撤销原有登录会话、API 密钥和恢复码。余额与调用记录不变。', 'Resetting revokes your existing sessions, API keys, and recovery code. Your balance and request history stay intact.')}</p>
          </> : <>
            {thread ? <>
              <div className="flex flex-wrap items-center justify-between gap-2"><SupportStatus status={thread.status} t={t} />
                {thread.status === 'resolved' && <span className="text-xs text-muted-foreground">{t('如需跟进，可直接发新消息。', 'Send a message to reopen the conversation.')}</span>}
              </div>
              <Messages thread={thread} t={t} />
            </> : <p className="text-sm text-muted-foreground">
              {thread === undefined ? t('正在查看会话…', 'Checking for an existing conversation…') : t('请描述你的问题。找回账号时，请提供用户名，等待客服核实。', 'Tell us what happened. For account recovery, include your username and wait for support to verify ownership.')}
            </p>}
            {thread?.reset && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent p-3 text-sm">
              <div>
                <p className="m-0 font-medium">{t('客服已授权重置密码', 'Support authorized a password reset')}</p>
                <small className="text-muted-foreground">{thread.reset.username} · {t('有效至', 'Expires at')} {new Date(thread.reset.expires).toLocaleTimeString()}</small>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={() => { setError(''); setResetting(true); }}>{t('设置新密码', 'Set a new password')}</Button>
            </div>}
          </>}
        </div>
        {resetting ? <div className={dialogFooter}>
          <Button variant="outline" type="button" disabled={busy} onClick={exitReset}>{t('返回对话', 'Back to conversation')}</Button>
          <Button type="submit" disabled={busy}>{t('重置密码', 'Reset password')}</Button>
        </div> : <div className={dialogFooter}>
          <Textarea className="min-h-16 resize-none" value={message} maxLength={2000} onChange={e => setMessage(e.target.value)}
            aria-label={t('消息', 'Message')} placeholder={t('输入消息…', 'Write a message…')} />
          {!signedIn && thread && <Button variant="ghost" size="sm" type="button" className="me-auto" disabled={busy} onClick={() => void endGuest()}>
            {t('结束访客会话', 'End guest conversation')}
          </Button>}
          <Button type="submit" disabled={busy || thread === undefined || !message.trim()}><Send aria-hidden="true" />{t('发送消息', 'Send message')}</Button>
        </div>}
      </form>
    </FormDialog>}
  </>;
}

export function SupportAdmin({ request, english }: { request: AdminRequest; english: boolean }) {
  const t = (zh: string, en: string) => english ? en : zh;
  const ask = useConfirmation();
  const [tickets, setTickets] = useState<Ticket[]>();
  const [filter, setFilter] = useState<'all' | Status>('all');
  const [revision, setRevision] = useState(0);
  const [listError, setListError] = useState('');
  const [thread, setThread] = useState<Thread>();
  const [message, setMessage] = useState('');
  const [grant, setGrant] = useState(false);
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const currentId = thread?.id;
  useEffect(() => {
    if (busy) return;
    let active = true;
    let reading = false;
    async function refresh() {
      if (reading || document.hidden) return;
      reading = true;
      try {
        if (currentId) {
          const { data } = await request<{ data: Thread }>(`/admin/support/${currentId}`);
          if (active) setThread(data);
        } else {
          const { data } = await request<{ data: Ticket[] }>('/admin/support');
          if (active) { setTickets(data); setListError(''); }
        }
      } catch (e) {
        if (active) {
          if (currentId) setError((e as Error).message);
          else setListError((e as Error).message);
        }
      } finally { reading = false; }
    }
    void refresh();
    const timer = window.setInterval(refresh, currentId ? 6000 : 15000);
    return () => { active = false; window.clearInterval(timer); };
  }, [request, revision, busy, currentId]);

  async function open(id: string) {
    setBusy(true);
    setError('');
    setGrant(false);
    setMessage('');
    setUsername('');
    try { setThread((await request<{ data: Thread }>(`/admin/support/${id}`)).data); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!thread || busy) return;
    setError('');
    if (grant && !await ask(t(`确认已核实账号「${username.trim()}」的归属？此会话将获得一次性密码重置权限。`, `Confirm you verified ownership of “${username.trim()}”. This conversation will receive one-time reset access.`))) return;
    setBusy(true);
    try {
      if (grant) {
        const { reset } = await request<{ reset: Reset }>(`/admin/support/${thread.id}/reset`, { method: 'POST', body: { username: username.trim() } });
        setThread({ ...thread, reset });
        setGrant(false);
      } else {
        const { data } = await request<{ data: Thread }>(`/admin/support/${thread.id}`, { method: 'POST', body: { message } });
        setThread(data);
        setMessage('');
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function resolveThread() {
    if (!thread || busy) return;
    setBusy(true);
    setError('');
    try { setThread((await request<{ data: Thread }>(`/admin/support/${thread.id}/resolve`, { method: 'POST', body: {} })).data); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  const expired = thread?.status === 'expired';
  const rows = tickets?.filter(row => filter === 'all' || row.status === filter);
  return <Card className="panel">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <p className="m-0 text-sm text-muted-foreground">{t('打开会话可回复用户；处理完成后标为已解决。', 'Open a conversation to reply, then mark it resolved when you are done.')}</p>
      <Button variant="outline" type="button" disabled={busy} onClick={() => setRevision(current => current + 1)}>{t('刷新', 'Refresh')}</Button>
    </div>
    <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label={t('会话状态', 'Conversation status')}>
      {(['all', 'pending', 'replied', 'resolved'] as const).map(status => <Button key={status} type="button" size="sm"
        variant={filter === status ? 'secondary' : 'ghost'} aria-pressed={filter === status} onClick={() => setFilter(status)}>
        {status === 'all' ? t('全部', 'All') : statusText(status, t)}
        {status === 'pending' && tickets && <span className="tabular-nums">{tickets.filter(row => row.status === 'pending').length}</span>}
      </Button>)}
    </div>
    {(listError || error && !thread) && <p className="text-sm text-destructive" role="alert">{listError || error}</p>}
    {rows?.length ? <Table className="min-w-[32rem]">
      <TableHeader><TableRow>{[t('用户', 'Customer'), t('状态', 'Status'), t('最新消息', 'Latest message'), t('更新时间', 'Updated'), t('操作', 'Actions')].map(label => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{rows.map(row => <TableRow key={row.id}>
        <TableCell><strong>{row.username || t('访客', 'Guest')}</strong><small className="block text-xs text-muted-foreground">{row.id.slice(0, 8)}</small></TableCell>
        <TableCell><SupportStatus status={row.status} t={t} /></TableCell>
        <TableCell className="max-w-[24rem] wrap-anywhere">{row.preview.slice(0, 100)}</TableCell>
        <TableCell className="whitespace-nowrap">{new Date(row.updated).toLocaleString()}</TableCell>
        <TableCell><Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => void open(row.id)}>
          {row.status === 'pending' ? t('处理并回复', 'Open and reply') : t('查看会话', 'View conversation')}
        </Button></TableCell>
      </TableRow>)}</TableBody>
    </Table> : !listError && <p className="text-sm text-muted-foreground" role="status">{tickets ? t('当前筛选下没有会话。', 'No conversations match this filter.') : t('正在加载会话…', 'Loading conversations…')}</p>}
    {thread && <FormDialog title={t('客服会话', 'Support conversation')} description={`${thread.username || t('访客', 'Guest')} · ${thread.id.slice(0, 8)}`}  drawer busy={busy} closeLabel={t('关闭', 'Close')}
      onClose={() => { setThread(undefined); setError(''); }}>
      <form className={dialogForm} onSubmit={submit}>
        <div className={dialogBody}>
          <div><SupportStatus status={thread.status} t={t} /></div>
          <Messages thread={thread} t={t} />
          {thread.reset && <p className="rounded-lg bg-accent p-3 text-sm" role="status">{t('已授权重置', 'Reset authorized')} · {thread.reset.username} · {t('有效至', 'Expires at')} {new Date(thread.reset.expires).toLocaleTimeString()}</p>}
          {expired && <p className="text-sm text-muted-foreground">{t('此会话已过期。', 'This conversation has expired.')}</p>}
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
        </div>
        {grant ? <div className={dialogFooter}>
          <label className="grid w-full gap-1.5 text-sm">{t('已核实的用户名', 'Verified username')}
            <Input autoComplete="off" required minLength={3} maxLength={48} value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <p className="m-0 w-full text-xs text-muted-foreground">{t('核实账号归属后才能授权。权限最长 15 分钟，且只可使用一次。', 'Verify ownership before granting access. The reset is valid for at most 15 minutes and works once.')}</p>
          <Button variant="outline" type="button" disabled={busy} onClick={() => { setGrant(false); setError(''); }}>{t('取消', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !username.trim() || expired}>{t('授权重置密码', 'Authorize password reset')}</Button>
        </div> : <div className={dialogFooter}>
          <label className="grid w-full gap-1.5 text-sm font-medium">{t('回复内容', 'Reply')}
            <Textarea className="min-h-16 resize-none" value={message} maxLength={2000} disabled={expired} onChange={e => setMessage(e.target.value)}
              placeholder={t('输入发给该用户的回复…', 'Write a reply to this customer…')} />
          </label>
          {!expired && thread.status !== 'resolved' && <Button variant="ghost" size="sm" type="button" disabled={busy} onClick={() => void resolveThread()}>{t('标为已解决', 'Mark as resolved')}</Button>}
          <Button variant="outline" size="sm" type="button" disabled={busy || expired} onClick={() => { setUsername(thread.username ?? ''); setGrant(true); setError(''); }}>{t('协助重置密码', 'Help reset password')}</Button>
          <Button type="submit" disabled={busy || !message.trim() || expired}><Send aria-hidden="true" />{t('发送回复', 'Send reply')}</Button>
        </div>}
      </form>
    </FormDialog>}
  </Card>;
}

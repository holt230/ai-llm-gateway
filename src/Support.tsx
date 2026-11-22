import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { MessageCircle, Minus, Send } from 'lucide-react';
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


function Messages({ thread, viewer, t }: { thread: Thread; viewer: Message['sender']; t: Label }) {
  const log = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);
  const previousThread = useRef<string | undefined>(undefined);
  const last = thread.messages[thread.messages.length - 1];
  const locale = t('zh-CN', 'en');
  useEffect(() => {
    if (log.current && (previousThread.current !== thread.id || atEnd.current || last?.sender === viewer)) {
      log.current.scrollTop = log.current.scrollHeight;
      atEnd.current = true;
    }
    previousThread.current = thread.id;
  }, [thread.id, last?.seq, last?.sender, viewer]);

  return <div ref={log} role="log" aria-label={t('对话消息', 'Conversation messages')} tabIndex={0}
    className="min-h-0 space-y-3 overflow-y-auto overscroll-contain p-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    onScroll={event => {
      const { scrollHeight, scrollTop, clientHeight } = event.currentTarget;
      atEnd.current = scrollHeight - scrollTop - clientHeight < 48;
    }}>
    {thread.messages.map((message, index) => {
      const mine = message.sender === viewer;
      const time = new Date(message.created);
      const prior = thread.messages[index - 1];
      const newDay = !prior || new Date(prior.created).toDateString() !== time.toDateString();
      return <div key={message.seq} className="grid gap-2">
        {newDay && <div className="py-0.5 text-center text-xs text-muted-foreground">
          {time.toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' })}
        </div>}
        <div className={mine ? 'ms-auto max-w-[86%]' : 'me-auto max-w-[86%]'}>
          <div className={'mb-1 flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground ' + (mine ? 'justify-end' : '')}>
            <span className="font-medium wrap-anywhere">{mine ? t('我', 'You') : viewer === 'user'
              ? t('客服', 'Support') : thread.username || (thread.scope === 'guest' ? t('访客', 'Guest') : t('用户', 'Customer'))}</span>
            <time dateTime={message.created}>{time.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
          <p className={'m-0 rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere ' + (mine
            ? 'rounded-br-sm bg-primary text-primary-foreground' : 'rounded-bl-sm border border-border bg-background text-foreground')}>{message.text}</p>
        </div>
      </div>;
    })}
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
  const heading = useRef<HTMLHeadingElement>(null);
  const panelId = useId();
  const expanded = open && !code;

  useEffect(() => {
    if (expanded) heading.current?.focus({ preventScroll: true });
  }, [expanded]);
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
  function closeChat() {
    if (busy) return;
    setOpen(false);
    exitReset();
    button.current?.focus({ preventScroll: true });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (!resetting && (thread === undefined || !message.trim()))) return;
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

  return <div className="fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex max-w-[calc(100%-2rem)] flex-col-reverse items-end gap-3 sm:right-6 sm:bottom-6">
    <Button ref={button} className="rounded-full shadow-md" type="button" size="lg" aria-expanded={expanded}
      aria-controls={expanded ? panelId : undefined} disabled={busy && expanded} onClick={expanded ? closeChat : openSupport}>
      {expanded ? <Minus aria-hidden="true" /> : <MessageCircle aria-hidden="true" />}
      {expanded ? t('收起客服', 'Minimize support') : t('联系客服', 'Contact support')}
      {!expanded && attention && <span role="status" className="rounded-full bg-primary-foreground px-2 py-0.5 text-xs text-primary">{t('新消息', 'New')}</span>}
    </Button>
    {code && <RecoveryCodeNotice code={code} english={english} onSaved={() => { setCode(''); window.dispatchEvent(new Event('gateway-session-check')); }} />}
    {expanded && <Card as="section" id={panelId} aria-labelledby={panelId + '-title'} aria-busy={busy}
      className="grid h-[min(35rem,calc(100dvh-5rem))] w-[26rem] max-w-full grid-rows-[auto_minmax(0,1fr)] overflow-hidden shadow-xl"
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !busy) {
          event.stopPropagation();
          closeChat();
        }
      }}>
      <header className="flex items-start gap-3 border-b border-border px-4 py-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><MessageCircle size={18} aria-hidden="true" /></span>
        <div className="min-w-0 flex-1">
          <h2 id={panelId + '-title'} ref={heading} tabIndex={-1} className="m-0 text-base font-semibold outline-none">
            {resetting ? t('设置新密码', 'Set a new password') : t('站内客服', 'Customer support')}
          </h2>
          <p className="mt-0.5 mb-0 text-xs leading-relaxed text-muted-foreground wrap-anywhere">
            {resetting ? thread?.reset?.username : signedIn
              ? t('登录此账号可继续对话', 'Sign in to this account to continue the conversation')
              : t('访客对话 · 仅在此浏览器未登录时可见', 'Guest conversation · visible here while signed out')}
          </p>
        </div>
        {!resetting && thread && <SupportStatus status={thread.status} t={t} />}
      </header>
      <form className={dialogForm} onSubmit={submit}>
        {resetting ? <div className={dialogBody}>
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <label className="grid gap-1.5 text-sm">{t('新密码（至少 12 位）', 'New password (at least 12 characters)')}
            <Input type="password" name="new-password" autoComplete="new-password" minLength={12} maxLength={256} required value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <label className="grid gap-1.5 text-sm">{t('确认新密码', 'Confirm new password')}
            <Input type="password" autoComplete="new-password" minLength={12} maxLength={256} required value={confirm} onChange={e => setConfirm(e.target.value)} />
          </label>
          <p className="text-sm text-muted-foreground">{t('重置会撤销原有登录会话、API 密钥和恢复码。余额与调用记录不变。', 'Resetting revokes your existing sessions, API keys, and recovery code. Your balance and request history stay intact.')}</p>
        </div> : <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-muted/50">
          {thread ? <Messages thread={thread} viewer="user" t={t} /> : <div className="grid min-h-0 place-content-center overflow-y-auto p-4 text-center">
            <p className="m-0 text-sm font-medium">{thread === undefined ? t('正在加载会话…', 'Loading conversation…') : t('你好，需要什么帮助？', 'Hi, how can we help?')}</p>
            {thread === null && <p className="mt-1 mb-0 max-w-[36ch] text-xs leading-relaxed text-muted-foreground">
              {t('请描述遇到的问题。找回账号时，请提供用户名供客服核实。', 'Tell us what happened. For account recovery, provide the username for support to verify.')}
            </p>}
          </div>}
          <div className="space-y-2 px-4 empty:hidden">
            {(error || loadError) && <p className="m-0 pb-2 text-sm text-destructive wrap-anywhere" role="alert">{error || loadError}</p>}
            {thread?.reset && <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-accent p-3 text-sm">
              <div className="min-w-0 wrap-anywhere">
                <p className="m-0 font-medium">{t('客服已授权重置密码', 'Support authorized a password reset')}</p>
                <small className="text-muted-foreground">{thread.reset.username} · {t('有效至', 'Expires at')} {new Date(thread.reset.expires).toLocaleTimeString()}</small>
              </div>
              <Button variant="outline" size="sm" type="button" disabled={busy} onClick={() => { setError(''); setResetting(true); }}>{t('设置新密码', 'Set a new password')}</Button>
            </div>}
            {thread?.status === 'resolved' && <p className="m-0 pb-2 text-xs text-muted-foreground">{t('如需跟进，可直接发新消息。', 'Send a message to reopen the conversation.')}</p>}
          </div>
        </div>}
        {resetting ? <div className={dialogFooter}>
          <Button variant="outline" type="button" disabled={busy} onClick={exitReset}>{t('返回对话', 'Back to conversation')}</Button>
          <Button type="submit" disabled={busy}>{t('重置密码', 'Reset password')}</Button>
        </div> : <div className="grid min-w-0 gap-1 border-t border-border px-4 py-3">
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
            <Textarea className="min-h-10 max-h-24 resize-none overflow-y-auto" rows={1} value={message} maxLength={2000} onChange={e => setMessage(e.target.value)}
              aria-label={t('消息', 'Message')} placeholder={t('输入消息…', 'Write a message…')} />
            <Button type="submit" size="icon-lg" aria-label={t('发送消息', 'Send message')} title={t('发送消息', 'Send message')}
              disabled={busy || thread === undefined || !message.trim()}><Send aria-hidden="true" /></Button>
          </div>
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-2">
            <p className="m-0 text-xs text-muted-foreground">{t('请勿发送密码、恢复码或 API 密钥。', 'Never share passwords, recovery codes, or API keys.')}</p>
            {!signedIn && thread && <Button variant="ghost" size="xs" type="button" className="ms-auto text-muted-foreground" disabled={busy} onClick={() => void endGuest()}>
              {t('结束访客会话', 'End guest conversation')}
            </Button>}
          </div>
        </div>}
      </form>
    </Card>}
  </div>;
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
    if (!thread || busy || thread.status === 'expired' || (!grant && !message.trim())) return;
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
    {thread && <FormDialog title={t('客服会话', 'Support conversation')}
      description={`${thread.username || t('访客', 'Guest')} · ${thread.id.slice(0, 8)}`} drawer busy={busy} closeLabel={t('关闭', 'Close')}
      onClose={() => { setThread(undefined); setError(''); }}>
      <form className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto]" onSubmit={submit}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 sm:px-6">
          <SupportStatus status={thread.status} t={t} />
          {!expired && <div className="flex flex-wrap items-center gap-1.5">
            {thread.status !== 'resolved' && <Button variant="ghost" size="sm" type="button" disabled={busy || grant} onClick={() => void resolveThread()}>{t('标为已解决', 'Mark as resolved')}</Button>}
            <Button variant="outline" size="sm" type="button" disabled={busy || grant} onClick={() => { setUsername(thread.username ?? ''); setGrant(true); setError(''); }}>{t('协助重置密码', 'Help reset password')}</Button>
          </div>}
        </div>
        <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] bg-muted/50">
          <Messages thread={thread} viewer="admin" t={t} />
          <div className="space-y-2 px-4 pb-3 empty:hidden sm:px-6">
            {thread.reset && <p className="m-0 rounded-lg bg-accent p-3 text-sm wrap-anywhere" role="status">{t('已授权重置', 'Reset authorized')} · {thread.reset.username} · {t('有效至', 'Expires at')} {new Date(thread.reset.expires).toLocaleTimeString()}</p>}
            {error && <p className="m-0 text-sm text-destructive wrap-anywhere" role="alert">{error}</p>}
          </div>
        </div>
        {grant ? <div className={dialogFooter}>
          <label className="grid w-full gap-1.5 text-sm">{t('已核实的用户名', 'Verified username')}
            <Input autoComplete="off" required minLength={3} maxLength={48} value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <p className="m-0 w-full text-xs text-muted-foreground">{t('核实账号归属后才能授权。权限最长 15 分钟，且只可使用一次。', 'Verify ownership before granting access. The reset is valid for at most 15 minutes and works once.')}</p>
          <Button variant="outline" type="button" disabled={busy} onClick={() => { setGrant(false); setError(''); }}>{t('取消', 'Cancel')}</Button>
          <Button type="submit" disabled={busy || !username.trim() || expired}>{t('授权重置密码', 'Authorize password reset')}</Button>
        </div> : expired ? <div className={dialogFooter}>
          <p className="m-0 me-auto text-sm text-muted-foreground">{t('此会话已过期，无法回复。', 'This conversation has expired and cannot be replied to.')}</p>
        </div> : <div className={dialogFooter}>
          <label className="grid w-full gap-1.5 text-sm font-medium">{t('回复内容', 'Reply')}
            <Textarea className="min-h-16 max-h-32 resize-none overflow-y-auto" rows={2} value={message} maxLength={2000} onChange={e => setMessage(e.target.value)}
              placeholder={t('输入发给该用户的回复…', 'Write a reply to this customer…')} />
          </label>
          <Button type="submit" disabled={busy || !message.trim()}><Send aria-hidden="true" />{t('发送回复', 'Send reply')}</Button>
        </div>}
      </form>
    </FormDialog>}
  </Card>;
}

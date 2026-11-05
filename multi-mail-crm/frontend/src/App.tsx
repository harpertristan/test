import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Button, Checkbox, Drawer, Empty, Form, Input, List, Popover, Space, Spin, Tag, Tooltip, Typography, message } from 'antd';
import { BellOutlined, ReloadOutlined, SettingOutlined, TeamOutlined } from '@ant-design/icons';
import { type Account, type Company, type CRMTask, type Mail, type Notice, type RealtimeEvent, type User, api, post, labels, colors, dateTime, mailBase } from './api/client';
import { AccountList } from './components/AccountList';
import { MessageFeed } from './components/MessageFeed';
import { CompanyCard } from './components/CompanyCard';
import { notify } from './components/NotificationToast';
import { useWebSocket } from './hooks/useWebSocket';
import { Settings } from './pages/Settings';
const Admin = lazy(() => import('./pages/Admin').then(module => ({ default: module.Admin })));
import './style.css';

export default function App() {
  const [user, setUser] = useState<User | null>(null), [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState('');
  const load = useCallback(() => { setBooting(true); setBootError(''); api<User>('/workspace').then(setUser).catch(e => setBootError(e.message)).finally(() => setBooting(false)); }, []);
  useEffect(load, [load]);
  return booting ? <div className="login"><Spin size="large" /></div> : user ? <Workspace user={user} onUser={setUser} /> : <div className="login"><Space direction="vertical"><Alert type="error" message={bootError || 'CRM недоступна'} /><Button onClick={load}>Повторить подключение</Button></Space></div>;
}

function Workspace({ user, onUser }: { user: User; onUser: (value: User | null) => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]), [companies, setCompanies] = useState<Company[]>([]), [notices, setNotices] = useState<Notice[]>([]), [noticeCount, setNoticeCount] = useState(0);
  const [accountId, setAccountId] = useState<string | null>(null), [companyId, setCompanyId] = useState<string | null>(null), [detail, setDetail] = useState<Mail | null>(null);
  const [mails, setMails] = useState<Mail[]>([]), [cursor, setCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [drawer, setDrawer] = useState<'settings' | 'admin' | null>(null), [sound, setSound] = useState(localStorage.getItem('crm-sound') === 'true');
  const [reply, setReply] = useState(''), [sending, setSending] = useState(false), [taskTitle, setTaskTitle] = useState(''), [tasks, setTasks] = useState<CRMTask[]>([]), [threadOnly, setThreadOnly] = useState(false);
  const [mobilePane, setMobilePane] = useState('accounts'), [revision, setRevision] = useState(0);
  const debounce = useRef<ReturnType<typeof setTimeout>>(), seen = useRef(new Set<string>()), requestId = useRef(0), detailRequest = useRef(0), workspaceRequest = useRef(0), paginationBusy = useRef(false), refreshMail = useRef(false), replyKey = useRef(crypto.randomUUID());
  const loadWorkspace = useCallback(async () => { const request = ++workspaceRequest.current; try { const [a, c, n] = await Promise.all([api<Account[]>('/accounts'), api<Company[]>('/companies'), api<{items: Notice[]; unseen_count: number}>('/notifications')]); if (request !== workspaceRequest.current) return; setAccounts(a); setCompanies(c); setNotices(n.items); setNoticeCount(n.unseen_count); setError(''); } catch (e) { setError((e as Error).message); } }, []);
  useEffect(() => { void loadWorkspace(); }, [loadWorkspace, revision]);
  useEffect(() => { if (!accountId && !companyId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId, companyId]);
  const openMail = useCallback(async (id: string, navigate = false) => { const request = ++detailRequest.current; try { const result = await api<Mail>('/messages/' + id); if (request !== detailRequest.current) return; if (navigate) { setAccountId(result.mail_account_id); setCompanyId(null); setThreadOnly(false); } setDetail(result); setReply(''); replyKey.current = crypto.randomUUID(); setMobilePane('detail'); } catch (e) { message.error((e as Error).message); } }, []);
  useEffect(() => { const id = new URLSearchParams(location.search).get('message'); if (id) void openMail(id, true); }, [openMail]);
  const realtime = useCallback((event: RealtimeEvent) => {
    if (['heartbeat', 'pong'].includes(event.type)) return;
    if (event.type === 'notification' && event.notification_id && !seen.current.has(event.notification_id)) {
      seen.current.add(event.notification_id); if (seen.current.size > 2000) seen.current.delete(seen.current.values().next().value!);
      notify(event, id => void openMail(id, true), sound);
    }
    const relevant = event.type === 'connected' || event.type === 'pending.changed' ||
      (event.account_id ? event.account_id === accountId || !!companyId && accounts.some(a => a.id === event.account_id && a.company_id === companyId) :
        event.company_id ? event.company_id === companyId || event.company_id === activeCompanyId() : event.message_id === detail?.id);
    refreshMail.current = refreshMail.current || relevant;
    if (!debounce.current) debounce.current = setTimeout(() => {
      debounce.current = undefined;
      if (refreshMail.current) { refreshMail.current = false; setRevision(v => v + 1); }
      else void loadWorkspace();
    }, 1000);
    function activeCompanyId() { return accounts.find(a => a.id === accountId)?.company_id; }
  }, [openMail, sound, accountId, companyId, accounts, detail?.id, loadWorkspace]);
  const connected = useWebSocket(user.id, realtime);
  useEffect(() => { const timer = setInterval(() => setRevision(v => v + 1), 60000); return () => { clearInterval(timer); clearTimeout(debounce.current); }; }, []);
  const activeAccount = accounts.find(a => a.id === accountId), activeCompany = companies.find(c => c.id === (companyId || activeAccount?.company_id || detail?.company_id));
  const selectedThread = threadOnly ? detail?.thread_id : undefined;
  const query = useCallback((next?: string | null) => { const q = new URLSearchParams(); if (accountId) q.set('account_id', accountId); else if (companyId) q.set('company_id', companyId); if (selectedThread) q.set('thread_id', selectedThread); if (next) q.set('cursor', next); return '/messages?' + q.toString(); }, [accountId, companyId, selectedThread]);
  useEffect(() => {
    const id = ++requestId.current; setLoading(true); paginationBusy.current = true;
    api<{ items: Mail[]; next_cursor: string | null }>(query()).then(result => { if (id === requestId.current) { setMails(result.items); setCursor(result.next_cursor); } }).catch(e => setError(e.message)).finally(() => { if (id === requestId.current) { setLoading(false); paginationBusy.current = false; } });
  }, [query, revision]);
  useEffect(() => { if (detail) api<Mail>('/messages/' + detail.id).then(fresh => setDetail(current => current?.id === fresh.id ? fresh : current)).catch(() => {}); }, [revision]); // refresh only after server events
  useEffect(() => { const id = detail?.company_id || activeCompany?.id; if (id) api<CRMTask[]>('/tasks?company_id=' + id).then(setTasks).catch(() => {}); }, [detail?.company_id, activeCompany?.id, revision]);
  const loadMore = async () => { if (!cursor || paginationBusy.current) return; paginationBusy.current = true; setLoading(true); const id = requestId.current; try { const result = await api<{ items: Mail[]; next_cursor: string | null }>(query(cursor)); if (id === requestId.current) { setMails(existing => [...existing, ...result.items.filter(m => !existing.some(e => e.id === m.id))]); setCursor(result.next_cursor); } } catch (e) { message.error((e as Error).message); } finally { if (id === requestId.current) { paginationBusy.current = false; setLoading(false); } } };
  const action = async (path: string, value: unknown = {}, text = 'Сохранено') => { try { await post(path, value); setRevision(v => v + 1); message.success(text); } catch (e) { message.error((e as Error).message); } };
  const selectAccount = (id: string) => { detailRequest.current++; setAccountId(id); setCompanyId(null); setDetail(null); setThreadOnly(false); setMobilePane('feed'); };
  const selectCompany = (id: string) => { detailRequest.current++; setCompanyId(id); setAccountId(null); setDetail(null); setThreadOnly(false); setMobilePane('feed'); };
  const send = async () => { if (!detail || !reply.trim()) return; setSending(true); try { await post(`/messages/${detail.id}/reply`, { body: reply, idempotency_key: replyKey.current }); setReply(''); replyKey.current = crypto.randomUUID(); setRevision(v => v + 1); message.success('Ответ поставлен в очередь. Статус отправки появится в переписке.'); } catch (e) { message.error((e as Error).message); } finally { setSending(false); } };
  const noticesContent = <div style={{ width: 340, maxHeight: 420, overflow: 'auto' }}><Button size="small" onClick={() => action('/notifications/seen')}>Отметить уведомления просмотренными</Button><List dataSource={notices} renderItem={n => <List.Item onClick={() => void openMail(n.message_id, true)} style={{ cursor: 'pointer', background: n.is_seen ? '' : '#f0f7ff' }}><List.Item.Meta title={n.email} description={n.subject || '(Без темы)'} /></List.Item>} /></div>;
  return <div className="workspace"><nav className="tool-navigation" aria-label="Инструменты"><a href="/crm">Play Scout</a><a href="/assistant/">Помощник</a><a href={mailBase + '/'} aria-current="page">Почтовая CRM</a></nav><header className="topbar"><div><strong>Мультипочтовая CRM</strong><Tooltip title={connected ? 'Обновления в реальном времени' : 'Переподключаемся; резервное обновление раз в минуту'}><span className={`connection ${connected ? 'online' : ''}`} /></Tooltip></div><Space wrap size="small"><Popover trigger="click" content={noticesContent} placement="bottomRight"><Badge count={noticeCount}><Button icon={<BellOutlined />} aria-label="Уведомления" /></Badge></Popover><Button icon={<ReloadOutlined />} aria-label="Обновить" onClick={() => setRevision(v => v + 1)} /><Button icon={<SettingOutlined />} onClick={() => setDrawer('settings')}>Настройки</Button>{user.role === 'admin' && <Button icon={<TeamOutlined />} onClick={() => setDrawer('admin')}>Управление</Button>}</Space></header>
    {error && <Alert type="error" showIcon message={error} closable onClose={() => setError('')} />}
    <nav className="mobile-nav"><Button onClick={() => setMobilePane('accounts')}>Ящики</Button><Button onClick={() => setMobilePane('feed')}>Переписка</Button><Button onClick={() => setMobilePane('detail')}>Письмо</Button></nav>
    <section className="mail-hero" aria-label="Почтовая CRM"><div><span className="hero-eyebrow">PLAY SCOUT · ПОЧТА</span><h1>Вся переписка. Под контролем.</h1><p>Компании, почтовые ящики и ответы — в одном месте.</p></div></section>
    <main className={`columns show-${mobilePane}`}>
      <AccountList accounts={accounts} selected={accountId} company={companyId} onSelect={selectAccount} onCompany={selectCompany} onFavorite={a => void action(`/accounts/${a.id}/favorite`, { value: !a.is_favorite })} />
      <MessageFeed title={activeAccount?.email || activeCompany?.name || 'Все письма'} messages={mails} selected={detail?.id ?? null} loading={loading} hasMore={!!cursor} onMore={() => void loadMore()} onSelect={m => void openMail(m.id)} />
      <section className="detail-pane">{!detail ? activeCompany ? <CompanyCard company={activeCompany} accounts={accounts.filter(a => a.company_id === activeCompany.id)} onAccount={selectAccount} onReplied={() => void action(`/companies/${activeCompany.id}/replied`)} onFlag={() => void action(`/companies/${activeCompany.id}/flag`, { value: !activeCompany.is_flagged })} /> : <Empty description={accounts.length ? 'Выберите письмо' : 'Администратору: добавьте компанию и почтовый ящик в разделе «Управление»'} /> : <>
        <div className="detail-header"><p className="hint">Ящик: {accounts.find(a => a.id === detail.mail_account_id)?.email}</p><Typography.Title level={3}>{detail.subject || '(Без темы)'}</Typography.Title><div>{detail.from_name} &lt;{detail.from_email}&gt;</div><div className="hint">Кому: {detail.to_emails.join(', ')} · {dateTime(detail.received_at)}</div><Space wrap>{detail.category && <Tooltip title={`${Math.round((detail.category_conf ?? 0) * 100)}% · ${detail.category_reason ?? ''}`}><Tag color={colors[detail.category]}>{labels[detail.category]}</Tag></Tooltip>}{detail.replied_at && <Tag color="green">Ответили {dateTime(detail.replied_at)}</Tag>}</Space>
          <Space wrap style={{ marginTop: 12 }}>
            {detail.direction === 'in' && <><Button onClick={() => void action(`/messages/${detail.id}/read`, { value: !detail.is_read }, 'Изменение флага поставлено в очередь')}>{detail.is_read ? 'Сделать непрочитанным' : 'Прочитано'}</Button><Button onClick={() => void action(`/messages/${detail.id}/replied`)}>Отметить: ответил</Button></>}
            <Button onClick={() => void action(`/companies/${detail.company_id}/flag`, { value: !companies.find(c => c.id === detail.company_id)?.is_flagged })}>Пометить компанию</Button>
            <Button onClick={() => selectCompany(detail.company_id)}>Карточка фирмы</Button>
          </Space>
          <div style={{ marginTop: 12 }}><Checkbox checked={threadOnly} onChange={e => setThreadOnly(e.target.checked)}>Показать только этот тред</Checkbox></div>
        </div>
        {detail.send_error && <Alert type="warning" message={detail.send_error} />}
        <article className="mail-body">{detail.body_text || 'Текстовая часть письма пуста. Вложения в текущей версии не импортируются.'}</article>
        {detail.direction === 'in' && <div className="reply-box"><h3>Ответить</h3><Input.TextArea rows={6} value={reply} onChange={e => setReply(e.target.value)} placeholder="Текст ответа" maxLength={100000} /><Button type="primary" onClick={() => void send()} disabled={!reply.trim()} loading={sending} style={{ marginTop: 10 }}>Отправить из CRM</Button></div>}
        <div className="task-box"><h3>Задачи компании</h3><Space.Compact style={{ width: '100%' }}><Input value={taskTitle} onChange={e => setTaskTitle(e.target.value)} placeholder="Новая задача" /><Button disabled={!taskTitle.trim()} onClick={async () => { try { await post('/tasks', { company_id: detail.company_id, message_id: detail.id, title: taskTitle }); setTaskTitle(''); setRevision(v => v + 1); } catch (e) { message.error((e as Error).message); } }}>Создать</Button></Space.Compact><List dataSource={tasks} renderItem={task => <List.Item><Checkbox checked={task.is_done} onChange={e => void action(`/tasks/${task.id}/done`, { value: e.target.checked })}>{task.title}</Checkbox></List.Item>} /></div>
      </>}</section>
    </main>
    <Drawer title={drawer === 'settings' ? 'Настройки CRM' : 'Управление CRM'} open={!!drawer} onClose={() => setDrawer(null)} width={drawer === 'admin' ? 1080 : 600} destroyOnClose>{drawer === 'settings' ? <Settings user={user} onUser={onUser} sound={sound} onSound={value => { setSound(value); localStorage.setItem('crm-sound', String(value)); }} /> : drawer === 'admin' && <Suspense fallback={<Spin />}><Admin companies={companies} accounts={accounts} reload={() => setRevision(v => v + 1)} /></Suspense>}</Drawer>
  </div>;
}

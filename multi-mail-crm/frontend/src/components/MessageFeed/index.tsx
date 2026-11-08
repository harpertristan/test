import { useEffect, useRef } from 'react';
import { Button, Empty, Spin, Tag } from 'antd';
import { type Mail, colors, labels, dateTime } from '../../api/client';

export function ageClass(message: Mail) {
  if (!message.needs_reply || message.replied_at || !['add_request', 'other'].includes(message.category ?? '') || message.direction !== 'in') return '';
  const days = (Date.now() - new Date(message.received_at).getTime()) / 86400000;
  return days > 2 ? 'age-overdue' : days >= 2 ? 'age-two' : days >= 1 ? 'age-one' : '';
}

type Props = { title: string; messages: Mail[]; selected: string | null; loading: boolean; hasMore: boolean; onMore: () => void; onSelect: (message: Mail) => void };
export function MessageFeed({ title, messages, selected, loading, hasMore, onMore, onSelect }: Props) {
  const sentinel = useRef<HTMLDivElement>(null), root = useRef<HTMLDivElement>(null), callback = useRef(onMore); callback.current = onMore;
  useEffect(() => { const observer = new IntersectionObserver(entries => { if (entries[0].isIntersecting && hasMore && !loading) callback.current(); }, { root: root.current, rootMargin: '120px' }); if (sentinel.current) observer.observe(sentinel.current); return () => observer.disconnect(); }, [hasMore, loading]);
  return <section className="feed-pane"><div className="pane-title">{title || 'Переписка'}</div><div className="message-scroll" ref={root}>
    {!messages.length && !loading && <Empty description="Писем пока нет" />}
    {messages.map(m => <button key={m.id} onClick={() => onSelect(m)} className={`message-row ${ageClass(m)} ${selected === m.id ? 'active' : ''} ${!m.is_read && m.direction === 'in' ? 'unread' : ''}`}>
      <div className="message-line"><strong>{m.direction === 'out' ? `Вы → ${m.to_emails.join(', ')}` : m.from_name || m.from_email}</strong><time>{dateTime(m.received_at)}</time></div>
      <div className="message-subject">{m.subject || '(Без темы)'}</div>
      <div className="message-tags">{m.category && <Tag color={colors[m.category]}>{labels[m.category]}</Tag>}{m.replied_at && <Tag color="green">Ответили</Tag>}{m.direction === 'out' && <Tag color={m.send_state === 'sent' ? 'green' : m.send_state === 'uncertain' ? 'red' : 'blue'}>{m.send_state === 'sent' ? 'Отправлено' : m.send_state === 'uncertain' ? 'Результат неизвестен' : m.send_state === 'failed' ? 'Ошибка отправки' : 'Отправляется'}</Tag>}</div>
    </button>)}
    <div className="load-more" ref={sentinel}>{loading ? <Spin /> : hasMore && <Button onClick={onMore}>Загрузить ещё</Button>}</div>
  </div></section>;
}

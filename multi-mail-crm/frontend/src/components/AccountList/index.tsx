import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Empty, Input, Tag, Tooltip } from 'antd';
import { StarFilled, StarOutlined } from '@ant-design/icons';
import { VariableSizeList, type ListChildComponentProps } from 'react-window';
import { type Account, daysOld, labels, colors } from '../../api/client';

type Row = { kind: 'group'; id: string; title: string } | { kind: 'account'; account: Account };
type Props = { accounts: Account[]; selected: string | null; company: string | null; onSelect: (id: string) => void; onCompany: (id: string) => void; onFavorite: (account: Account) => void };

export function AccountList({ accounts, selected, company, onSelect, onCompany, onFavorite }: Props) {
  const [search, setSearch] = useState(''), [unread, setUnread] = useState(false), [pending, setPending] = useState(false);
  const box = useRef<HTMLDivElement>(null), list = useRef<VariableSizeList>(null);
  const [size, setSize] = useState({ width: 280, height: 500 });
  useEffect(() => { const observer = new ResizeObserver(entries => { const r = entries[0].contentRect; setSize({ width: r.width, height: r.height }); }); if (box.current) observer.observe(box.current); return () => observer.disconnect(); }, []);
  const rows = useMemo(() => {
    const filtered = accounts.filter(a => (!unread || a.unread_count > 0) && (!pending || a.pending_count > 0) && `${a.email} ${a.display_name ?? ''} ${a.company_name}`.toLowerCase().includes(search.toLowerCase()));
    const result: Row[] = [], favorites = filtered.filter(a => a.is_favorite);
    if (favorites.length) { result.push({ kind: 'group', id: '', title: 'Избранное' }); favorites.forEach(account => result.push({ kind: 'account', account })); }
    const grouped = new Map<string, Account[]>();
    filtered.filter(a => !a.is_favorite).forEach(a => grouped.set(a.company_id, [...(grouped.get(a.company_id) ?? []), a]));
    grouped.forEach((items, id) => { result.push({ kind: 'group', id, title: items[0].company_name }); items.forEach(account => result.push({ kind: 'account', account })); });
    return result;
  }, [accounts, search, unread, pending]);
  useEffect(() => list.current?.resetAfterIndex(0), [rows]);
  const RowView = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    if (row.kind === 'group') return <div style={style} className={`account-group ${row.id === company ? 'active' : ''}`}>
      <button disabled={!row.id} onClick={() => onCompany(row.id)} title="Вся переписка компании">{row.title}</button>
    </div>;
    const a = row.account;
    return <div style={style} className={`account-row ${selected === a.id ? 'active' : ''} ${!a.is_active ? 'inactive' : ''}`}>
      <Button size="small" type="text" aria-label={a.is_favorite ? 'Убрать из избранного' : 'В избранное'} icon={a.is_favorite ? <StarFilled style={{ color: '#d9a413' }} /> : <StarOutlined />} onClick={() => onFavorite(a)} />
      <button className="account-select" onClick={() => onSelect(a.id)}>
        <span className="account-email"><span title={a.email}>{a.email}</span>
          {a.pending_count > 0 && <Tooltip title={`${a.pending_count} писем без ответа, самое старое — ${daysOld(a.oldest_pending_at!)} дней`}><span className="overdue-dot" aria-label="Есть письма без ответа более двух дней" /></Tooltip>}
          {a.last_error && <Tooltip title={a.last_error}><span className="sync-error" aria-label="Ошибка синхронизации">!</span></Tooltip>}
          <Badge count={a.unread_count} overflowCount={9999} size="small" />
        </span>
        <span className="account-meta">{a.current_status && a.unread_count > 0 ? <Tag color={colors[a.current_status]}>{labels[a.current_status]}</Tag> : <span>{a.unread_count > 0 ? 'Классифицируется' : a.connected ? 'Нет непрочитанных' : 'Не подключён'}</span>}</span>
      </button>
    </div>;
  };
  return <aside className="account-pane"><div className="pane-title">Почтовые ящики <span>{accounts.length}</span></div>
    <div className="account-filters"><Input.Search placeholder="Почта или компания" allowClear value={search} onChange={e => setSearch(e.target.value)} />
      <Checkbox checked={unread} onChange={e => setUnread(e.target.checked)}>Непрочитанные</Checkbox>
      <Checkbox checked={pending} onChange={e => setPending(e.target.checked)}>Без ответа &gt;2 дней</Checkbox>
    </div>
    <div ref={box} className="account-viewport">{rows.length ? <VariableSizeList ref={list} width={size.width} height={size.height} itemCount={rows.length} estimatedItemSize={68} itemSize={index => rows[index].kind === 'group' ? 34 : 68} overscanCount={6} itemKey={index => rows[index].kind === 'group' ? `group-${(rows[index] as {id: string}).id}` : (rows[index] as {account: Account}).account.id}>{RowView}</VariableSizeList> : <Empty description="Ящики не найдены" />}</div>
  </aside>;
}

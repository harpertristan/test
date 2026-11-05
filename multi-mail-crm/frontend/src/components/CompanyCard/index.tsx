import { Button, Descriptions, Space, Tag } from 'antd';
import { type Account, type Company } from '../../api/client';

type Props = { company: Company; accounts: Account[]; onAccount: (id: string) => void; onReplied: () => void; onFlag: () => void };
export function CompanyCard({ company, accounts, onAccount, onReplied, onFlag }: Props) {
  return <div className="company-card"><h2>{company.name} {company.is_flagged && <Tag color="gold">Отмечена</Tag>}</h2>
    <Descriptions column={1} size="small" items={[
      { key: 'inn', label: 'ИНН', children: company.inn || '—' }, { key: 'site', label: 'Сайт', children: company.website || '—' },
      { key: 'phone', label: 'Телефон', children: company.phone || '—' }, { key: 'address', label: 'Адрес', children: company.address || '—' },
      { key: 'notes', label: 'Заметки', children: <span style={{ whiteSpace: 'pre-wrap' }}>{company.notes || '—'}</span> },
    ]} />
    <Space wrap>{accounts.map(a => <Button key={a.id} size="small" onClick={() => onAccount(a.id)}>{a.email} {a.unread_count ? `(${a.unread_count})` : ''}</Button>)}</Space>
    <Space wrap style={{ marginTop: 16 }}><Button onClick={onReplied}>Отметить: ответили компании</Button><Button onClick={onFlag}>{company.is_flagged ? 'Снять отметку компании' : 'Пометить компанию'}</Button></Space>
  </div>;
}

import { useState } from 'react';
import { Alert, Button, Drawer, Form, Input, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from 'antd';
import { type Account, type Company, api, post, dateTime } from '../api/client';

type Editor = { kind: 'company' | 'account'; id?: string; values?: Record<string, unknown> };
export function Admin({ companies, accounts, reload }: { companies: Company[]; accounts: Account[]; reload: () => void }) {
  const [editor, setEditor] = useState<Editor | null>(null), [busy, setBusy] = useState(false);
  const [form] = Form.useForm();
  const selectedProvider = Form.useWatch('provider', form) as string | undefined;
  const edit = (value: Editor) => { setEditor(value); form.resetFields(); form.setFieldsValue(value.values ?? { provider: 'inbox_eu', is_active: true }); };
  const perform = async (action: () => Promise<unknown>) => { try { await action(); reload(); message.success('Сохранено'); } catch (e) { message.error((e as Error).message); } };
  const save = async (value: Record<string, unknown>) => {
    if (!editor) return; setBusy(true);
    try {
      const path = editor.kind === 'company' ? '/companies' : '/accounts';
      const payload = Object.fromEntries(Object.entries(value).filter(([key, v]) => v !== undefined && !((key === 'password' || key === 'imap_password') && !v)));
      if (editor.kind === 'account') {
        if (selectedProvider !== 'inbox_eu') { delete payload.imap_password; delete payload.imap_user; }
        if (selectedProvider !== 'zoho_eu') delete payload.organization_id;
      }
      if (editor.kind === 'company' && editor.id) {
        for (const key of ['inn', 'website', 'phone', 'address', 'notes']) {
          if (editor.values?.[key] !== undefined) payload[key] = editor.values[key];
        }
      }
      await api(path + (editor.id ? '/' + editor.id : ''), { method: editor.id ? editor.kind === 'company' ? 'PUT' : 'PATCH' : 'POST', body: JSON.stringify(payload) });
      setEditor(null); reload(); message.success('Сохранено');
    } catch (e) { message.error((e as Error).message); } finally { setBusy(false); }
  };
  return <><Tabs items={[
    { key: 'companies', label: 'Компании', children: <><Button type="primary" onClick={() => edit({ kind: 'company' })}>Добавить компанию</Button><Table rowKey="id" size="small" dataSource={companies} pagination={{ pageSize: 15 }} columns={[
      { title: 'Компания', dataIndex: 'name' }, { title: 'Действия', render: (_, c: Company) => <Space><Button size="small" onClick={() => edit({ kind: 'company', id: c.id, values: { ...c } })}>Изменить</Button><Popconfirm title="Удалить компанию? Сначала нужно удалить её ящики." onConfirm={() => perform(() => api('/companies/' + c.id, { method: 'DELETE' }))}><Button size="small" danger>Удалить</Button></Popconfirm></Space> },
    ]} /></> },
    { key: 'accounts', label: 'Почтовые ящики', children: <><Button type="primary" disabled={!companies.length} onClick={() => edit({ kind: 'account' })}>Добавить ящик</Button>{!companies.length && <p>Сначала добавьте компанию.</p>}<Table rowKey="id" size="small" dataSource={accounts} pagination={{ pageSize: 15 }} scroll={{ x: 800 }} columns={[
      { title: 'Ящик', render: (_, a: Account) => <><strong>{a.email}</strong><div>{a.company_name}</div><Tag>{{ inbox_eu: 'Inbox.eu', gmail: 'Google / Gmail', zoho_eu: 'Zoho Mail EU' }[a.provider] ?? 'Архив: старый провайдер'}</Tag><Tag color={a.connected ? 'green' : 'orange'}>{a.connected ? 'Подключён' : 'Не подключён'}</Tag></> },
      { title: 'Синхронизация', render: (_, a: Account) => <><div>{a.last_sync_at ? dateTime(a.last_sync_at) : 'Ещё не выполнялась'}</div><Typography.Text type="danger">{a.last_error}</Typography.Text></> },
      { title: 'Действия', render: (_, a: Account) => <Space wrap>
        <Button size="small" onClick={() => edit({ kind: 'account', id: a.id, values: { ...a } })}>Изменить</Button>
        {['gmail', 'zoho_eu'].includes(a.provider) && <Button size="small" onClick={async () => { try { const result = await post<{ url: string }>(`/accounts/${a.id}/oauth/start`); location.assign(result.url); } catch (e) { message.error((e as Error).message); } }}>Подключить {a.provider === 'gmail' ? 'Google' : 'Zoho'}</Button>}
        <Button size="small" onClick={() => perform(() => post(`/accounts/${a.id}/sync`))}>Синхронизировать</Button>
        <Popconfirm title="Удалить ящик и всю его переписку из CRM? Исходная почта сохранится." onConfirm={() => perform(() => api('/accounts/' + a.id, { method: 'DELETE' }))}><Button size="small" danger>Удалить</Button></Popconfirm>
      </Space> },
    ]} /></> },
  ]} />
    <Drawer title={editor ? `${editor.id ? 'Изменить' : 'Добавить'}: ${{ company: 'компанию', account: 'ящик' }[editor.kind]}` : ''} open={!!editor} onClose={() => setEditor(null)} width={520} destroyOnClose>
      <Form form={form} layout="vertical" onFinish={save}>
        {editor?.kind === 'company' && <Form.Item name="name" label="Название" rules={[{ required: true, whitespace: true, message: 'Введите название компании' }]}><Input /></Form.Item>}
        {editor?.kind === 'account' && <>
          <Form.Item name="company_id" label="Компания" rules={[{ required: true }]}><Select options={companies.map(c => ({ value: c.id, label: c.name }))} showSearch optionFilterProp="label" /></Form.Item>
          {!editor.id && <Form.Item name="provider" label="Провайдер" rules={[{ required: true }]}><Select options={[{ value: 'zoho_eu', label: 'Zoho Mail EU' }, { value: 'gmail', label: 'Google / Gmail' }, { value: 'inbox_eu', label: 'Inbox.eu' }]} /></Form.Item>}
          <Form.Item name="email" label={selectedProvider === 'inbox_eu' ? 'Адрес почты — ваш логин Inbox.eu' : 'Адрес электронной почты'} rules={[{ required: true, type: 'email' }]}><Input disabled={!!editor.id} placeholder={selectedProvider === 'inbox_eu' ? 'name@inbox.eu' : selectedProvider === 'gmail' ? 'name@gmail.com' : 'name@company.com'} autoComplete="email" /></Form.Item>
          <Form.Item name="display_name" label="Отображаемое имя"><Input /></Form.Item>
          {selectedProvider === 'zoho_eu' && <Form.Item name="organization_id" label="ID организации Zoho EU" extra="Выдаётся в панели администратора Zoho. Если настроен на сервере CRM, оставьте пустым."><Input /></Form.Item>}
          {selectedProvider === 'inbox_eu' ? <>
            <Alert type="info" showIcon message="Подключение Inbox.eu" description="Логин — полный адрес почты, указанный выше. В настройках Inbox.eu разрешите доступ почтовым программам по IMAP. Если выдан отдельный пароль для почтовой программы, используйте его." style={{ marginBottom: 18 }} />
            <Form.Item name="imap_password" label={editor.id ? 'Новый пароль почты Inbox.eu' : 'Пароль почты Inbox.eu'} extra={editor.id ? 'Оставьте пустым, чтобы сохранить текущий пароль.' : 'Введите пароль для доступа к почте через IMAP. CRM сохранит его в зашифрованном виде.'} rules={editor.id ? [] : [{ required: true, message: 'Введите пароль почты Inbox.eu' }]}><Input.Password autoComplete="new-password" placeholder={editor.id ? 'Текущий пароль сохранён' : 'Пароль для почтовой программы'} /></Form.Item>
          </> : ['gmail', 'zoho_eu'].includes(selectedProvider ?? '') && <Alert type="info" showIcon message="Пароль почты вводить здесь не нужно" description={`Сохраните ящик и нажмите «Подключить ${selectedProvider === 'gmail' ? 'Google' : 'Zoho'}» в списке. Вход и разрешение доступа выполняются на сайте почтового сервиса.`} style={{ marginBottom: 18 }} />}
          <Form.Item name="is_active" label="Синхронизация включена" valuePropName="checked"><Switch /></Form.Item>
        </>}
        <Button type="primary" htmlType="submit" loading={busy}>Сохранить</Button>
      </Form>
    </Drawer>
  </>;
}

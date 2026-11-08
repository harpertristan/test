import { useState } from 'react';
import { Alert, Button, Card, Space, Switch, Typography, message } from 'antd';
import { type User, api, post } from '../api/client';

export function Settings({ user, onUser, sound, onSound }: { user: User; onUser: (user: User) => void; sound: boolean; onSound: (value: boolean) => void }) {
  const [link, setLink] = useState<{ token: string; url: string } | null>(null), [busy, setBusy] = useState(false);
  const createLink = async () => { setBusy(true); try { setLink(await post('/settings/telegram-link')); } catch (e) { message.error((e as Error).message); } finally { setBusy(false); } };
  return <Space direction="vertical" style={{ width: '100%' }} size="large"><Card title="Telegram">
    <p className="hint">Привязка Telegram общая для всех, кто открывает эту CRM.</p><p>{user.telegram_id ? `Привязан Telegram ID ${user.telegram_id}` : 'Telegram пока не привязан'}</p>
    <Space wrap><Button onClick={createLink} loading={busy}>Получить одноразовый код</Button>
      <Button onClick={async () => { await onRefresh(); }}>Проверить привязку</Button>
      {user.telegram_id && <Button danger onClick={async () => { try { await api('/settings/telegram-link', { method: 'DELETE' }); setLink(null); await onRefresh(); } catch (e) { message.error((e as Error).message); } }}>Отвязать</Button>}
    </Space>
    {link && <Alert style={{ marginTop: 16 }} type="info" message="Код действует 10 минут и используется один раз" description={<><p>Откройте бота и отправьте:</p><Typography.Text code copyable>{`/start ${link.token}`}</Typography.Text><p><a href={link.url} target="_blank" rel="noreferrer">Открыть бота в Telegram</a></p></>} />}
    <p className="hint">Уведомления приходят с задержкой до 60 секунд: это позволяет объединить поток писем в сводку.</p>
  </Card><Card title="Автоматическая очистка"><p>Письма от <Typography.Text code>support@inbox.eu</Typography.Text> с темой <Typography.Text code>New sign in from … to your email</Typography.Text> автоматически переносятся в корзину почтового сервиса для любой страны.</p><p className="hint">Также удаляются письма от orders@inbox.eu с темой «Thank you! Premium subscription activated!». Оба правила действуют для старых и новых писем без подтверждения. Эти письма отмечаются прочитанными, не увеличивают счётчик непрочитанных, не классифицируются и не вызывают уведомлений в CRM и Telegram. Восстановить письмо можно в корзине почтового сервиса.</p></Card><Card title="Уведомления браузера"><Space direction="vertical"><span>Звук <Switch checked={sound} onChange={onSound} /></span><Button onClick={async () => { if (!('Notification' in window)) { message.info('Браузер не поддерживает уведомления'); return; } const permission = await Notification.requestPermission(); message.info(permission === 'granted' ? 'Уведомления разрешены' : 'Разрешение не получено'); }}>Разрешить уведомления для фоновой вкладки</Button><p className="hint">Вкладка CRM должна оставаться открытой. Уведомления при полностью закрытом браузере приходят через Telegram.</p></Space></Card></Space>;
  async function onRefresh() { try { onUser(await api<User>('/workspace')); } catch (e) { message.error((e as Error).message); } }
}

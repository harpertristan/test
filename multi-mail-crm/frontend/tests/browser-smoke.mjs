import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: process.env.CI ? ['--no-sandbox'] : [] });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const user = { id: '00000000-0000-4000-8000-000000000001', email: 'admin@example.com', full_name: 'Тестовый оператор', role: 'admin', telegram_id: null, is_active: true };
const companies = Array.from({ length: 16 }, (_, i) => ({ id: `company-${i}`, name: `Компания ${String(i).padStart(2, '0')}`, inn: '7700000000', website: 'example.com', phone: '+7 000 000-00-00', address: 'Тестовый адрес', notes: 'Тестовые данные браузерной проверки', is_flagged: false }));
const accounts = Array.from({ length: 320 }, (_, i) => ({ id: `account-${i}`, company_id: `company-${Math.floor(i / 20)}`, company_name: companies[Math.floor(i / 20)].name, provider: 'imap_inbox', email: `box${String(i).padStart(3, '0')}@example.com`, is_active: true, connected: true, unread_count: i === 0 ? 3 : 0, current_status: i === 0 ? 'add_request' : null, is_favorite: false, pending_count: i === 0 ? 1 : 0, oldest_pending_at: new Date(Date.now() - 3 * 86400000).toISOString(), last_sync_at: new Date().toISOString(), last_error: null }));
const mail = { id: 'mail-1', mail_account_id: 'account-0', company_id: 'company-0', direction: 'in', from_email: 'client@example.com', from_name: 'Клиент', to_emails: [accounts[0].email], subject: 'Нужна цена', received_at: new Date(Date.now() - 3 * 86400000).toISOString(), is_read: false, category: 'add_request', category_conf: 0.95, category_reason: 'Запрашивает цену', replied_at: null, needs_reply: true, thread_id: 'root-thread', body_text: 'Пришлите коммерческое предложение.\n<script>malicious()</script>', is_flagged: false, send_state: null };
let readRequests = 0, ws;
const notices = [];
await page.routeWebSocket('**/ws/notifications/**', socket => { ws = socket; setTimeout(() => socket.send(JSON.stringify({ type: 'connected' })), 20); });
await page.route('**/api/**', async route => {
  const url = new URL(route.request().url()), path = url.pathname.replace(/^\/api/, ''), method = route.request().method();
  let body = {}, status = 200;
  if (path === '/workspace') body = user;
  else if (path === '/accounts') body = accounts;
  else if (path === '/companies') body = companies;
  else if (path === '/notifications') body = { items: notices, unseen_count: notices.filter(n => !n.is_seen).length };
  else if (path === '/users') body = [user];
  else if (path === '/tasks') body = [];
  else if (path === '/messages') body = { items: !url.searchParams.get('account_id') || url.searchParams.get('account_id') === 'account-0' ? [mail] : [], next_cursor: null };
  else if (path === '/messages/mail-1' && method === 'GET') body = mail;
  else if (path === '/messages/mail-319' && method === 'GET') body = { ...mail, id: 'mail-319', mail_account_id: 'account-319', company_id: 'company-15', subject: 'Письмо другого ящика' };
  else if (path === '/messages/mail-1/read') { readRequests++; mail.is_read = route.request().postDataJSON().value; status = 202; }
  else if (path === '/messages/mail-1/replied') { mail.replied_at = new Date().toISOString(); mail.needs_reply = false; status = 204; }
  else if (path.endsWith('/favorite')) { const account = accounts.find(a => a.id === path.split('/')[2]); account.is_favorite = route.request().postDataJSON().value; status = 204; }
  else if (path === '/settings/telegram-link') body = { token: 'one-time-test-token', url: 'https://t.me/example_bot?start=one-time-test-token', expires_in: 600 };
  else throw Error(`Unexpected API request: ${method} ${path}`);
  await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? undefined : JSON.stringify(body) });
});
try {
  await page.goto(process.env.CRM_BASE_URL || 'http://127.0.0.1:8080');
  assert.equal(await page.getByRole('button', { name: 'Войти', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Выйти', exact: true }).count(), 0);
  await page.locator('.tool-navigation').getByRole('link', { name: 'Почтовая CRM', exact: true }).waitFor();
  await page.locator('.account-pane').getByRole('button', { name: /box000@example.com/ }).waitFor();
  const mounted = await page.locator('.account-row').count();
  assert(mounted > 0 && mounted < 30, `Virtualization broken: ${mounted} rows for 320 accounts`);
  assert.equal(await page.locator('.overdue-dot').count(), 1);
  for (let step = 0; step < 4; step++) { await page.locator('.account-viewport > div').evaluate(element => { element.scrollTop = element.scrollHeight; }); await page.waitForTimeout(100); }
  await page.locator('.account-pane').getByRole('button', { name: /box319@example.com/ }).waitFor();
  await page.getByPlaceholder('Почта или компания').fill('box000');
  await page.locator('.account-pane').getByRole('button', { name: /box000@example.com/ }).click();
  await page.getByRole('button', { name: /Нужна цена/ }).click();
  await page.locator('.mail-body').waitFor();
  assert((await page.locator('.mail-body').innerText()).includes('<script>malicious()</script>'));
  assert.equal(await page.locator('.mail-body script').count(), 0);
  assert.equal(readRequests, 0, 'Opening a message must never implicitly mark it read');
  await page.getByRole('button', { name: 'Прочитано', exact: true }).click();
  await page.waitForResponse(response => response.url().endsWith('/accounts') && response.ok());
  assert.equal(readRequests, 1);
  await page.getByRole('button', { name: 'Отметить: ответил', exact: true }).click();
  await page.getByText(/^Ответили /).waitFor();
  await page.getByRole('button', { name: /Настройки/ }).click();
  await page.getByRole('button', { name: 'Получить одноразовый код' }).click();
  await page.getByText('/start one-time-test-token', { exact: true }).waitFor();
  await page.locator('.ant-drawer-close').click();
  ws.send(JSON.stringify({ type: 'notification', notification_id: 'notice-1', message_id: mail.id, email: accounts[0].email, category: 'add_request', subject: 'Новое письмо из WebSocket' }));
  await page.getByText('Доп. запрос: Новое письмо из WebSocket').waitFor();
  ws.send(JSON.stringify({ type: 'notification', notification_id: 'notice-319', message_id: 'mail-319', account_id: 'account-319', email: accounts[319].email, category: 'add_request', subject: 'Другая почта' }));
  await page.getByText('Доп. запрос: Другая почта', { exact: true }).click();
  await page.locator('.feed-pane .pane-title').getByText('box319@example.com', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Ящики', exact: true }).click();
  await page.locator('.account-pane').getByRole('button', { name: /box000@example.com/ }).click();
  await page.getByRole('button', { name: /Нужна цена/ }).click();
  await page.locator('.mail-body').waitFor({ state: 'visible' });
  assert.equal(errors.length, 0, errors.join('\n'));
  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });
  console.log(JSON.stringify({ accounts: accounts.length, mountedRows: mounted, virtualization: 'passed', searchLastAccount: 'passed', readIsExplicit: 'passed', replyTrackingUI: 'passed', telegramSettings: 'passed', websocketToast: 'passed', notificationNavigation: 'passed', mobile: 'passed', pageErrors: errors.length }));
} finally { await browser.close(); }

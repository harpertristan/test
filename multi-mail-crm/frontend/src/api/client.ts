export type User = { id: string; email: string; full_name: string | null; role: 'admin' | 'operator'; telegram_id: number | null; is_active: boolean };
export type Company = { id: string; name: string; inn: string | null; website: string | null; phone: string | null; address: string | null; notes: string | null; is_flagged: boolean };
export type Account = { id: string; company_id: string; provider: string; trash_pending_count?: number; trash_error_count?: number; email: string; display_name: string | null; company_name: string; is_active: boolean; unread_count: number; current_status: string | null; is_favorite: boolean; pending_count: number; oldest_pending_at: string | null; last_sync_at: string | null; last_error: string | null; connected: boolean; organization_id: string | null };
export type Mail = { id: string; mail_account_id: string; company_id: string; direction: 'in' | 'out'; from_email: string; from_name: string; to_emails: string[]; subject: string; received_at: string; is_read: boolean; is_flagged: boolean; category: string | null; category_conf: number | null; category_reason: string | null; replied_at: string | null; needs_reply: boolean; thread_id: string | null; send_state: string | null; send_error: string | null; body_text?: string; body_html?: string };
export type Notice = { id: string; message_id: string; account_id: string; email: string; subject: string; category: string; is_seen: boolean; created_at: string };
export type CRMTask = { id: string; title: string; company_id: string; message_id: string | null; is_done: boolean; due_at: string | null };
export type RealtimeEvent = { type: string; event_id?: string; notification_id?: string; message_id?: string; account_id?: string; company_id?: string; email?: string; subject?: string; category?: string };

export class APIError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const mailBase = location.pathname === '/mail-crm' || location.pathname.startsWith('/mail-crm/') ? '/mail-crm' : '';

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(mailBase + '/api' + path, { ...options, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...options.headers } });
  if (!response.ok) {
    let detail = 'Ошибка сервера';
    try { const body = await response.json(); detail = typeof body.detail === 'string' ? body.detail : 'Проверьте заполненные поля'; } catch { /* non-JSON upstream error */ }
    throw new APIError(response.status, detail);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
export const post = <T,>(path: string, value: unknown = {}) => api<T>(path, { method: 'POST', body: JSON.stringify(value) });
export const labels: Record<string, string> = { ad: 'Реклама', add_request: 'Доп. запрос', approve: 'Одобрение', decline: 'Отказ', other: 'Другое' };
export const colors: Record<string, string> = { ad: 'default', add_request: 'gold', approve: 'green', decline: 'red', other: 'blue' };
export const dateTime = (value: string) => new Date(value).toLocaleString('ru-RU');
export const daysOld = (value: string) => Math.floor((Date.now() - new Date(value).getTime()) / 86400000);

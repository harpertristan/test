import { notification } from 'antd';
import type { RealtimeEvent } from '../../api/client';
import { labels } from '../../api/client';

export function notify(event: RealtimeEvent, open: (id: string) => void, sound: boolean) {
  notification.info({ key: event.notification_id, message: `Новое письмо · ${event.email ?? ''}`, description: `${labels[event.category ?? 'other']}: ${event.subject || '(Без темы)'}`, duration: 5, onClick: () => event.message_id && open(event.message_id) });
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const item = new Notification('Новое письмо в CRM', { body: `${event.email}: ${event.subject}`, tag: event.notification_id });
    item.onclick = () => { window.focus(); if (event.message_id) open(event.message_id); item.close(); };
  }
  if (sound) {
    try { const context = new AudioContext(), oscillator = context.createOscillator(), gain = context.createGain(); oscillator.connect(gain); gain.connect(context.destination); gain.gain.value = 0.05; oscillator.frequency.value = 660; oscillator.start(); oscillator.stop(context.currentTime + 0.15); oscillator.onended = () => { void context.close(); }; } catch { /* sound is optional and may be blocked by browser */ }
  }
}

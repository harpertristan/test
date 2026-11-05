import { useEffect, useRef, useState } from 'react';
import { mailBase, type RealtimeEvent } from '../api/client';

export function useWebSocket(userId: string, onEvent: (event: RealtimeEvent) => void) {
  const callback = useRef(onEvent); callback.current = onEvent;
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined;
    let stopped = false, attempt = 0;
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${mailBase}/ws/notifications/${userId}`);
      socket.onopen = () => { attempt = 0; setConnected(true); };
      socket.onmessage = event => { try { callback.current(JSON.parse(event.data) as RealtimeEvent); } catch { /* ignore malformed frame */ } };
      socket.onerror = () => socket?.close();
      socket.onclose = event => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, Math.min(30000, 1000 * 2 ** attempt++) + Math.random() * 500);
      };
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); socket?.close(); };
  }, [userId]);
  return connected;
}

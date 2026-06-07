import axios from 'axios';

const http = axios.create({ baseURL: '/api', withCredentials: true });

export const fetchTasks    = () => http.get('/clickup/tasks');
export const fetchCalendar = () => http.get('/google/calendar');
export const fetchGmail    = () => http.get('/google/gmail');
export const fetchStatus   = () => http.get('/auth/status');

export async function streamChat(messages, context, onChunk) {
  const res = await fetch('/api/claude/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ messages, context }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      const raw = part.slice(6).trim();
      if (raw === '[DONE]') return;
      try {
        const d = JSON.parse(raw);
        if (d.text) onChunk(d.text);
        if (d.error) throw new Error(d.error);
      } catch (e) {
        if (e.message && !e.message.includes('JSON')) throw e;
      }
    }
  }
}

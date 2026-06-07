import React, { useState, useRef, useEffect } from 'react';
import { streamChat } from '../api.js';

const QUICK = [
  { label: '☀️ สรุปเช้า',  prompt: 'สรุปงานเช้าวันนี้ให้หน่อยนะค่า ดูตารางนัด Prae\'s To Do งานด่วน และอีเมลค้าง' },
  { label: '🌙 สรุปเย็น',  prompt: 'สรุปงานทั้งหมดวันนี้ค่า ทำเสร็จแล้วอะไรบ้าง ยังค้างอะไร และแผนพรุ่งนี้' },
  { label: '🚨 งานด่วน',   prompt: 'มีงานด่วน/overdue อะไรบ้าง จัดลำดับความสำคัญให้หน่อยนะค่า' },
  { label: '📢 บอกทีม',   prompt: 'ร่างข้อความบอกทีมเรื่องงานและตารางสำคัญวันนี้ให้หน่อยค่า' },
  { label: '📧 อีเมล',     prompt: 'สรุปอีเมลค้างและร่างอีเมลตอบให้หน่อยนะค่า' },
];

const STORAGE_KEY = 'peepz_lekha_chat';

function loadHistory() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

export default function Chat({ dashboardData }) {
  const [msgs, setMsgs] = useState(loadHistory);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  // persist last 60 messages
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs.slice(-60)));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  const send = async (text = input.trim()) => {
    if (!text || busy) return;
    setInput('');
    setBusy(true);

    const userMsg = { role: 'user', content: text, id: Date.now() };
    const history = [...msgs, userMsg];
    setMsgs(history);

    const aId = Date.now() + 1;
    setMsgs((prev) => [...prev, { role: 'assistant', content: '', id: aId, streaming: true }]);

    const apiMsgs = history.map(({ role, content }) => ({ role, content }));

    try {
      await streamChat(apiMsgs, dashboardData, (chunk) => {
        setMsgs((prev) =>
          prev.map((m) => (m.id === aId ? { ...m, content: m.content + chunk } : m))
        );
      });
    } catch (err) {
      setMsgs((prev) =>
        prev.map((m) =>
          m.id === aId
            ? { ...m, content: `⚠️ ${err.message}`, error: true }
            : m
        )
      );
    } finally {
      setMsgs((prev) => prev.map((m) => (m.id === aId ? { ...m, streaming: false } : m)));
      setBusy(false);
      textareaRef.current?.focus();
    }
  };

  const clear = () => {
    if (window.confirm('ล้างประวัติการสนทนาทั้งหมด?')) {
      setMsgs([]);
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* chat header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-surface-elevated flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center font-bold text-white text-sm select-none">
            ล
          </div>
          <div>
            <p className="text-sm font-medium leading-none">เลขา AI</p>
            <p className="text-[11px] text-gray-500 mt-0.5">เลขาส่วนตัวของแพร</p>
          </div>
        </div>
        <button
          onClick={clear}
          className="text-[11px] text-gray-600 hover:text-gray-400 px-2 py-1 rounded hover:bg-surface-elevated transition-colors"
        >
          ล้างประวัติ
        </button>
      </div>

      {/* quick actions */}
      <div className="px-3 py-2 flex gap-1.5 flex-wrap border-b border-surface-elevated flex-shrink-0">
        {QUICK.map((q) => (
          <button
            key={q.label}
            onClick={() => send(q.prompt)}
            disabled={busy}
            className="px-2.5 py-1 text-[11px] rounded-full bg-surface-elevated hover:bg-accent hover:text-white text-gray-300 transition-all disabled:opacity-40 whitespace-nowrap"
          >
            {q.label}
          </button>
        ))}
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-600 py-10">
            <span className="text-4xl">🍊</span>
            <p className="text-sm text-center leading-relaxed">
              สวัสดีค่า! เลขาพร้อมช่วยแพรแล้ว<br />
              กด Quick Action หรือพิมพ์ถามได้เลยนะค่า
            </p>
          </div>
        )}

        {msgs.map((msg) => (
          <Bubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* input */}
      <div className="px-3 py-2.5 border-t border-surface-elevated flex-shrink-0">
        <div className="flex items-end gap-2 bg-surface-elevated rounded-xl px-3 py-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="พิมพ์ถามเลขา…  (Enter ส่ง · Shift+Enter ขึ้นบรรทัด)"
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder-gray-600 outline-none resize-none min-h-[22px] max-h-28 leading-relaxed"
            disabled={busy}
          />
          <button
            onClick={() => send()}
            disabled={!input.trim() || busy}
            className="w-7 h-7 flex items-center justify-center rounded-lg bg-accent text-white text-sm disabled:opacity-35 hover:bg-orange-500 transition-colors flex-shrink-0 mb-0.5"
          >
            {busy ? '…' : '↑'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Bubble({ msg }) {
  const isUser = msg.role === 'user';
  return (
    <div className={`flex items-end gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser && (
        <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0">
          ล
        </div>
      )}
      <div
        className={`max-w-[86%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
          isUser
            ? 'bg-accent text-white rounded-br-sm'
            : `bg-surface-elevated text-gray-100 rounded-bl-sm ${msg.error ? 'border border-red-500/40' : ''}`
        }`}
      >
        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
        {msg.streaming && (
          <span className="inline-block w-1.5 h-3.5 bg-accent rounded-sm animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  );
}

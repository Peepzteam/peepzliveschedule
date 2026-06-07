import React, { useState } from 'react';

export default function CalendarCard({ events, loading, error }) {
  const [open, setOpen] = useState(true);

  const now = new Date();
  const todayStr = now.toDateString();
  const todayEvts = events.filter((e) => new Date(e.start).toDateString() === todayStr);
  const laterEvts  = events.filter((e) => new Date(e.start).toDateString() !== todayStr);

  return (
    <div className="bg-surface rounded-xl border border-surface-elevated overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-elevated/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>📅</span>
          <span className="text-[13px] font-medium">ตารางนัด</span>
          {todayEvts.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
              วันนี้ {todayEvts.length}
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {error && !loading ? (
            <p className="text-xs text-yellow-500/80 text-center py-3">{error}</p>
          ) : loading && events.length === 0 ? (
            <div className="space-y-1.5 py-1">
              {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-surface-elevated animate-pulse" />)}
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-3">ไม่มีนัดสัปดาห์นี้ค่า 🎉</p>
          ) : (
            <div className="space-y-0.5 max-h-56 overflow-y-auto">
              {todayEvts.length > 0 && (
                <>
                  <p className="text-[10px] text-blue-400 font-medium px-2 pt-1 pb-0.5">วันนี้</p>
                  {todayEvts.map((e) => <EventRow key={e.id} event={e} isToday />)}
                </>
              )}
              {laterEvts.length > 0 && (
                <>
                  <p className="text-[10px] text-gray-600 font-medium px-2 pt-2 pb-0.5">สัปดาห์นี้</p>
                  {laterEvts.map((e) => <EventRow key={e.id} event={e} />)}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EventRow({ event, isToday }) {
  const start = new Date(event.start);
  const time = event.isAllDay
    ? 'ทั้งวัน'
    : start.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const dayLabel = isToday
    ? null
    : start.toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });

  return (
    <div
      className={`flex items-start gap-2 px-2 py-1.5 rounded-lg transition-colors ${
        isToday ? 'bg-blue-500/10' : 'hover:bg-surface-elevated'
      }`}
    >
      <div className={`text-[11px] font-mono w-16 flex-shrink-0 mt-0.5 ${isToday ? 'text-blue-400' : 'text-gray-600'}`}>
        {dayLabel || time}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-gray-200 truncate">{event.title}</p>
        <div className="flex items-center gap-1.5 mt-0.5">
          {dayLabel && <span className="text-[10px] text-gray-600">{time}</span>}
          {event.meetLink && <span className="text-[10px] text-green-400">📹 Meet</span>}
          {event.location && !event.meetLink && (
            <span className="text-[10px] text-gray-600 truncate">📍 {event.location}</span>
          )}
        </div>
      </div>
    </div>
  );
}

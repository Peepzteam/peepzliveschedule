import React, { useState } from 'react';

export default function EmailCard({ emails, loading, error }) {
  const [open, setOpen] = useState(true);

  return (
    <div className="bg-surface rounded-xl border border-surface-elevated overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-elevated/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span>📧</span>
          <span className="text-[13px] font-medium">อีเมลค้าง</span>
          {emails.length > 0 && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400">
              {emails.length}
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {error && !loading ? (
            <p className="text-xs text-yellow-500/80 text-center py-3">{error}</p>
          ) : loading && emails.length === 0 ? (
            <div className="space-y-1.5 py-1">
              {[1, 2].map((i) => <div key={i} className="h-10 rounded-lg bg-surface-elevated animate-pulse" />)}
            </div>
          ) : emails.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-3">ไม่มีอีเมลค้างค่า ✉️</p>
          ) : (
            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {emails.map((email) => <EmailRow key={email.id} email={email} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmailRow({ email }) {
  const dateStr = email.date
    ? new Date(email.date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })
    : '';

  return (
    <div className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-elevated transition-colors">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 mt-2 ${email.isImportant ? 'bg-accent' : 'bg-yellow-400'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-gray-300 truncate">{email.from}</span>
          {dateStr && <span className="text-[10px] text-gray-600 flex-shrink-0">{dateStr}</span>}
        </div>
        <p className="text-[11px] text-gray-500 truncate mt-0.5">{email.subject}</p>
        {email.snippet && (
          <p className="text-[10px] text-gray-700 truncate mt-0.5">{email.snippet}</p>
        )}
      </div>
    </div>
  );
}

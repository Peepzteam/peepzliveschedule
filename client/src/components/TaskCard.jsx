import React, { useState } from 'react';

const PRIORITY_ICON = { urgent: '🔴', high: '🟠', normal: '🟡', low: '🔵' };

function relDue(ts) {
  if (!ts) return null;
  const now = Date.now();
  const diff = ts - now;
  const days = Math.round(diff / 86400000);
  if (days < -1) return { label: `${Math.abs(days)}d ago`, over: true };
  if (days === -1) return { label: 'เมื่อวาน', over: true };
  if (days === 0) return { label: 'วันนี้', over: false };
  if (days === 1) return { label: 'พรุ่งนี้', over: false };
  return { label: `${days}d`, over: false };
}

export default function TaskCard({ title, emoji, tasks, loading, empty, accent }) {
  const [open, setOpen] = useState(true);

  const borderCls =
    accent === 'red'    ? 'border-red-500/25'    :
    accent === 'purple' ? 'border-purple-500/25' :
    'border-surface-elevated';

  const countBg =
    accent === 'red'    ? 'bg-red-500/15 text-red-400'       :
    accent === 'purple' ? 'bg-purple-500/15 text-purple-400' :
    'bg-accent/15 text-accent';

  return (
    <div className={`bg-surface rounded-xl border ${borderCls} overflow-hidden`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-elevated/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-base">{emoji}</span>
          <span className="text-[13px] font-medium">{title}</span>
          {tasks.length > 0 && (
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${countBg}`}>
              {tasks.length}
            </span>
          )}
        </div>
        <span className="text-gray-600 text-xs">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading && tasks.length === 0 ? (
            <Skeleton />
          ) : tasks.length === 0 ? (
            <p className="text-xs text-gray-600 text-center py-3">{empty}</p>
          ) : (
            <div className="space-y-0.5 max-h-52 overflow-y-auto">
              {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task }) {
  const due = relDue(task.dueDate);
  const pIcon = PRIORITY_ICON[task.priority?.toLowerCase()] || '';

  return (
    <a
      href={task.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-surface-elevated transition-colors group"
    >
      <span
        className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5 ring-0"
        style={{ backgroundColor: task.statusColor || '#555' }}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1">
          {pIcon && <span className="text-[10px] leading-none">{pIcon}</span>}
          <span className="text-xs text-gray-200 truncate group-hover:text-white">{task.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          <span className="text-[10px] text-gray-600">{task.status}</span>
          {due && (
            <span className={`text-[10px] ${due.over ? 'text-red-400' : 'text-gray-500'}`}>
              · {due.label}
            </span>
          )}
          {task.assignees.length > 0 && (
            <span className="text-[10px] text-gray-600 truncate">
              · {task.assignees.slice(0, 2).join(', ')}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

function Skeleton() {
  return (
    <div className="space-y-1.5 py-1">
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-8 rounded-lg bg-surface-elevated animate-pulse" />
      ))}
    </div>
  );
}

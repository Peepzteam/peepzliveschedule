import React from 'react';
import TaskCard from './TaskCard.jsx';
import CalendarCard from './CalendarCard.jsx';
import EmailCard from './EmailCard.jsx';

export default function Dashboard({ data, auth, loading }) {
  const { clickup, calendar, gmail } = data;

  return (
    <div className="p-4 space-y-3">
      {/* Google connect banner */}
      {!auth.google && (
        <div className="flex items-center justify-between bg-surface rounded-xl border border-accent/25 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-accent">เชื่อมต่อ Google</p>
            <p className="text-xs text-gray-500 mt-0.5">เพื่อดู Calendar และ Gmail ค่า</p>
          </div>
          <a
            href="/auth/google"
            className="px-3 py-1.5 bg-accent text-white text-xs rounded-lg hover:bg-orange-500 transition-colors"
          >
            เชื่อมต่อ →
          </a>
        </div>
      )}

      {/* ClickUp not configured */}
      {!auth.clickup && (
        <div className="flex items-center gap-3 bg-surface rounded-xl border border-surface-elevated px-4 py-3">
          <span className="text-lg">⚙️</span>
          <p className="text-xs text-gray-500">
            ยังไม่ได้ตั้งค่า <code className="text-accent">CLICKUP_API_TOKEN</code> ใน .env ค่า
          </p>
        </div>
      )}

      {/* row 1 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <CalendarCard events={calendar?.events ?? []} loading={loading} error={calendar?.error} />
        <TaskCard
          title="Prae's To Do"
          emoji="📋"
          tasks={clickup?.prae ?? []}
          loading={loading}
          empty="ไม่มีงานที่มอบหมายค่า ✨"
        />
      </div>

      {/* row 2 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <TaskCard
          title="งานด่วน / Overdue"
          emoji="🚨"
          tasks={clickup?.overdue ?? []}
          loading={loading}
          empty="ไม่มีงานค้างค่า 🎉"
          accent="red"
        />
        <TaskCard
          title="งานวันนี้"
          emoji="✅"
          tasks={clickup?.today ?? []}
          loading={loading}
          empty="ไม่มีงาน due วันนี้ค่า"
        />
      </div>

      {/* row 3 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        <TaskCard
          title="RAWE Board"
          emoji="🎨"
          tasks={clickup?.rawe ?? []}
          loading={loading}
          empty="ไม่มีงานใน RAWE ค่า"
          accent="purple"
        />
        <EmailCard emails={gmail?.emails ?? []} loading={loading} error={gmail?.error} />
      </div>
    </div>
  );
}

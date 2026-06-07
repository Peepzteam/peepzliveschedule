import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Login from './components/Login.jsx';
import ScheduleBoard from './components/ScheduleBoard.jsx';

const teamHttp = axios.create({ baseURL: '/api/team', withCredentials: true });

export default function App() {
  const [authed, setAuthed] = useState(null); // null=loading, true/false

  useEffect(() => {
    teamHttp.get('/check')
      .then(r => setAuthed(r.data.authed))
      .catch(() => setAuthed(false));
  }, []);

  async function logout() {
    await teamHttp.post('/logout');
    setAuthed(false);
  }

  if (authed === null) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-gray-400 text-sm">กำลังโหลด...</div>
      </div>
    );
  }

  if (!authed) {
    return <Login onSuccess={() => setAuthed(true)} />;
  }

  return (
    <div className="h-screen flex flex-col bg-bg overflow-hidden">
      <header className="h-13 min-h-[52px] flex items-center justify-between px-5 border-b border-border bg-white shadow-sm flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center text-white text-lg font-bold select-none">P</div>
          <div>
            <h1 className="text-[15px] font-bold leading-none text-gray-900">ตารางไลฟ์</h1>
            <p className="text-[11px] text-gray-400 leading-none mt-0.5">Peepz Team</p>
          </div>
        </div>
        <button onClick={logout} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1 rounded hover:bg-gray-100 transition-colors">
          ออกจากระบบ
        </button>
      </header>
      <div className="flex flex-1 min-h-0">
        <ScheduleBoard />
      </div>
    </div>
  );
}

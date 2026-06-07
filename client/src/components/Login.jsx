import React, { useState } from 'react';
import axios from 'axios';

const http = axios.create({ baseURL: '/api/team', withCredentials: true });

export default function Login({ onSuccess }) {
  const [pw, setPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!pw.trim()) return;
    setLoading(true);
    setError('');
    try {
      await http.post('/login', { password: pw });
      onSuccess();
    } catch {
      setError('รหัสผ่านไม่ถูกต้อง');
      setPw('');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-accent flex items-center justify-center text-white text-xl font-bold">P</div>
          <div>
            <div className="font-bold text-gray-900 text-lg leading-none">ตารางไลฟ์</div>
            <div className="text-gray-400 text-xs leading-none mt-0.5">Peepz Team</div>
          </div>
        </div>

        <h2 className="text-gray-700 font-semibold mb-1">เข้าสู่ระบบ</h2>
        <p className="text-gray-400 text-sm mb-6">ใส่รหัสผ่านทีมเพื่อเข้าใช้งาน</p>

        <form onSubmit={submit} className="flex flex-col gap-3">
          <input
            type="password"
            value={pw}
            onChange={e => setPw(e.target.value)}
            placeholder="รหัสผ่าน"
            className="input w-full text-base py-3"
            autoFocus
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button type="submit" disabled={loading || !pw.trim()}
            className="py-3 rounded-xl bg-accent text-white font-bold text-sm hover:opacity-90 disabled:opacity-50 transition-all">
            {loading ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบ →'}
          </button>
        </form>
      </div>
    </div>
  );
}

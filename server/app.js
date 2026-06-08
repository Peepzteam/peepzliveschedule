/**
 * Express app — ใช้ทั้ง Railway (server/index.js) และ Netlify Functions (netlify/functions/api.js)
 * ไม่มี app.listen() ที่นี่
 */
const express = require('express');
const cors = require('cors');

const app = express();

const allowedOrigins = [
  'https://peepzliveschedule.netlify.app',
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use(cors({
  origin: (origin, cb) => {
    // allow requests with no origin (curl, Netlify Functions internal)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, true); // allow all for now — protected by token auth anyway
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// ── Routes ──────────────────────────────────────────────────
const { router: teamAuthRouter, requireTeamAuth } = require('./routes/team-auth');

app.use('/api/team',     teamAuthRouter);
app.use('/api/schedule', requireTeamAuth, require('./routes/schedule'));
app.use('/api/clickup',  require('./routes/clickup'));
app.use('/api/google',   require('./routes/google'));
app.use('/api/claude',   require('./routes/claude'));
app.use('/auth',         require('./routes/auth'));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: '🍊 Peepz Live Schedule — Netlify Functions' });
});

module.exports = app;

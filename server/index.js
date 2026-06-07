const path = require('path');
const fs = require('fs');
const dotenv = require('dotenv');
const envFile = path.join(__dirname, '../.env');
if (fs.existsSync(envFile)) {
  const parsed = dotenv.parse(fs.readFileSync(envFile));
  for (const [k, v] of Object.entries(parsed)) {
    if (!process.env[k]) process.env[k] = v;
  }
}
const express = require('express');
const session = require('express-session');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

const isProd = process.env.NODE_ENV === 'production';
const allowedOrigins = isProd
  ? [process.env.FRONTEND_URL].filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'peepz_live_schedule_2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: isProd,
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: isProd ? 'none' : 'lax',
  },
}));

const { router: teamAuthRouter, requireTeamAuth } = require('./routes/team-auth');

app.use('/api/team', teamAuthRouter);
app.use('/api/schedule', requireTeamAuth, require('./routes/schedule'));
app.use('/api/clickup', require('./routes/clickup'));
app.use('/api/google', require('./routes/google'));
app.use('/api/claude', require('./routes/claude'));
app.use('/auth', require('./routes/auth'));

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: '🍊 Peepz Live Schedule' });
});

if (isProd) {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`\n🍊 Server → http://localhost:${PORT}\n`);
});

const express = require('express');
const router = express.Router();

const TEAM_PASSWORD = process.env.TEAM_PASSWORD || 'peepz2026';

// POST /api/team/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === TEAM_PASSWORD) {
    req.session.teamAuthed = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }
});

// GET /api/team/check
router.get('/check', (req, res) => {
  res.json({ authed: !!req.session.teamAuthed });
});

// POST /api/team/logout
router.post('/logout', (req, res) => {
  req.session.teamAuthed = false;
  res.json({ ok: true });
});

// middleware export — ใช้ protect schedule routes
function requireTeamAuth(req, res, next) {
  if (req.session.teamAuthed) return next();
  res.status(401).json({ error: 'กรุณา login ก่อน' });
}

module.exports = { router, requireTeamAuth };

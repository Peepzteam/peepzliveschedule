const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();

const TEAM_PASSWORD = process.env.TEAM_PASSWORD || 'peepz2026';
const TOKEN_SECRET  = process.env.SESSION_SECRET || 'peepzsecret2026';

function makeToken() {
  return crypto.createHmac('sha256', TOKEN_SECRET)
    .update(TEAM_PASSWORD + ':authed')
    .digest('hex');
}

const VALID_TOKEN = makeToken();

// POST /api/team/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === TEAM_PASSWORD) {
    res.json({ ok: true, token: VALID_TOKEN });
  } else {
    res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
  }
});

function extractToken(req) {
  // Support both Authorization: Bearer <token> and x-team-token header
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return req.headers['x-team-token'] || '';
}

// GET /api/team/check
router.get('/check', (req, res) => {
  const token = extractToken(req);
  res.json({ authed: token === VALID_TOKEN });
});

// POST /api/team/logout
router.post('/logout', (req, res) => {
  res.json({ ok: true });
});

// middleware — protect schedule routes
function requireTeamAuth(req, res, next) {
  const token = extractToken(req);
  if (token === VALID_TOKEN) return next();
  res.status(401).json({ error: 'กรุณา login ก่อน' });
}

module.exports = { router, requireTeamAuth };

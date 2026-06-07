const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback'
  );
}

// GET /auth/google — เริ่ม OAuth flow
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID' });
  }
  const oauth2Client = getOAuth2Client();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });
  res.redirect(url);
});

// GET /auth/callback — Google OAuth callback
router.get('/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = process.env.NODE_ENV === 'production' ? '/' : 'http://localhost:5173/';

  if (error || !code) {
    return res.redirect(frontendUrl + '?error=auth_cancelled');
  }

  try {
    const oauth2Client = getOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);
    req.session.googleTokens = tokens;
    // explicit save before redirect to ensure session persists
    await new Promise((resolve, reject) =>
      req.session.save(err => err ? reject(err) : resolve())
    );
    console.log('✅ Google tokens saved to session, scopes:', tokens.scope);
    res.redirect(frontendUrl + '?auth=success');
  } catch (err) {
    console.error('OAuth callback error:', err.message);
    res.redirect(frontendUrl + '?error=auth_failed');
  }
});

// GET /auth/status — ตรวจสอบ auth status
router.get('/status', (req, res) => {
  res.json({
    google: !!req.session.googleTokens,
    clickup: !!process.env.CLICKUP_API_TOKEN,
    claude: !!process.env.ANTHROPIC_API_KEY,
  });
});

// POST /auth/logout — logout Google
router.post('/logout', (req, res) => {
  req.session.googleTokens = null;
  res.json({ success: true });
});

module.exports = router;

const express = require('express');
const { google } = require('googleapis');
const router = express.Router();

function getAuthClient(tokens) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return client;
}

// GET /api/google/calendar
router.get('/calendar', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.json({ error: 'ยังไม่ได้เชื่อมต่อ Google', events: [] });
  }

  try {
    const auth = getAuthClient(req.session.googleTokens);
    const calendar = google.calendar({ version: 'v3', auth });

    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + 7);
    endOfWeek.setHours(23, 59, 59, 999);

    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin: startOfToday.toISOString(),
      timeMax: endOfWeek.toISOString(),
      maxResults: 20,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const today = new Date().toDateString();
    const events = (data.items || []).map((e) => ({
      id: e.id,
      title: e.summary || '(ไม่มีชื่อ)',
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      isAllDay: !e.start?.dateTime,
      location: e.location || '',
      meetLink: e.hangoutLink || '',
      description: (e.description || '').slice(0, 200),
      isToday: new Date(e.start?.dateTime || e.start?.date).toDateString() === today,
    }));

    res.json({ events });
  } catch (err) {
    console.error('Calendar error:', err.message);
    if (err.code === 401 || err.status === 401) {
      req.session.googleTokens = null;
      return res.json({ error: 'Token หมดอายุ กรุณาเชื่อมต่อ Google ใหม่', events: [] });
    }
    res.status(500).json({ error: 'ดึงข้อมูล Calendar ไม่ได้ค่า', events: [] });
  }
});

// GET /api/google/gmail
router.get('/gmail', async (req, res) => {
  if (!req.session.googleTokens) {
    return res.json({ error: 'ยังไม่ได้เชื่อมต่อ Google', emails: [] });
  }

  try {
    const auth = getAuthClient(req.session.googleTokens);
    const gmail = google.gmail({ version: 'v1', auth });

    const { data: list } = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread in:inbox -from:me -category:promotions -category:social',
      maxResults: 12,
    });

    const messages = list.messages || [];

    const emails = (
      await Promise.all(
        messages.map(async ({ id }) => {
          try {
            const { data } = await gmail.users.messages.get({
              userId: 'me',
              id,
              format: 'metadata',
              metadataHeaders: ['From', 'Subject', 'Date'],
            });

            const h = (name) =>
              (data.payload?.headers || []).find((x) => x.name === name)?.value || '';

            const from = h('From');
            const match = from.match(/^"?(.+?)"?\s*<(.+?)>$/) || [null, from, from];

            return {
              id: data.id,
              threadId: data.threadId,
              from: (match[1] || from).replace(/"/g, '').trim(),
              fromEmail: (match[2] || from).trim(),
              subject: h('Subject') || '(ไม่มีหัวข้อ)',
              date: h('Date') ? new Date(h('Date')).toISOString() : null,
              snippet: (data.snippet || '').slice(0, 120),
              isImportant: data.labelIds?.includes('IMPORTANT') || false,
            };
          } catch {
            return null;
          }
        })
      )
    ).filter(Boolean);

    res.json({ emails });
  } catch (err) {
    console.error('Gmail error:', err.message);
    if (err.code === 401 || err.status === 401) {
      req.session.googleTokens = null;
      return res.json({ error: 'Token หมดอายุ กรุณาเชื่อมต่อ Google ใหม่', emails: [] });
    }
    res.status(500).json({ error: 'ดึงข้อมูล Gmail ไม่ได้ค่า', emails: [] });
  }
});

module.exports = router;

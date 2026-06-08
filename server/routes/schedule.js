const express = require('express');
const router = express.Router();
const { randomUUID } = require('crypto');
const { google } = require('googleapis');
const { readData, writeData } = require('../lib/db');

function addHistory(data, action, detail) {
  if (!data.history) data.history = [];
  data.history.unshift({ id: randomUUID(), at: new Date().toISOString(), action, detail });
  if (data.history.length > 200) data.history = data.history.slice(0, 200);
}

// ─── helpers ────────────────────────────────────────────────
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function minutesToTime(m) {
  return `${String(Math.floor(m / 60) % 24).padStart(2,'0')}:${String(m % 60).padStart(2,'0')}`;
}

function detectConflicts(slots) {
  const conflicts = new Set();
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      if (!a.streamerId || !b.streamerId) continue;
      if (a.streamerId !== b.streamerId || a.date !== b.date) continue;
      const aS = timeToMinutes(a.startTime), aE = timeToMinutes(a.endTime);
      const bS = timeToMinutes(b.startTime), bE = timeToMinutes(b.endTime);
      if (aS < bE && bS < aE) { conflicts.add(a.id); conflicts.add(b.id); }
    }
  }
  return [...conflicts];
}

function calcFifiHours(slots, year, month) {
  const fs = slots.filter(s => {
    if (s.streamerId !== 'fifi') return false;
    const d = new Date(s.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });
  const byDate = {};
  for (const s of fs) {
    const dur = (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)) / 60;
    byDate[s.date] = (byDate[s.date] || 0) + dur;
  }
  const totalHours = Object.values(byDate).reduce((a, b) => a + b, 0);
  const otDays = Object.entries(byDate).filter(([, h]) => h > 9).map(([date, hours]) => ({ date, hours, ot: hours - 9 }));
  return { totalHours, byDate, otDays, limit: 100 };
}

// ─── GET all data ────────────────────────────────────────────
router.get('/data', async (req, res) => {
  try {
    const data = await readData();
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    res.json({ ...data, conflicts: detectConflicts(data.slots), fifiHours: calcFifiHours(data.slots, y, m) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Slots ───────────────────────────────────────────────────
router.post('/slots', async (req, res) => {
  try {
    const data = await readData();
    const base = {
      id: randomUUID(), brandId: req.body.brandId, streamerId: req.body.streamerId || null,
      streamerName: req.body.streamerName || '',
      date: req.body.date, startTime: req.body.startTime, endTime: req.body.endTime,
      platform: req.body.platform || '', liveType: req.body.liveType || '',
      notes: req.body.notes || '', status: req.body.status || 'pending',
      location: req.body.location || null, createdAt: new Date().toISOString(),
    };
    const dur = (timeToMinutes(base.endTime) - timeToMinutes(base.startTime)) / 60;
    if (dur > 3) {
      const sessions = []; let cur = timeToMinutes(base.startTime); const end = timeToMinutes(base.endTime); let n = 1;
      while (cur < end) {
        const se = Math.min(cur + 180, end);
        sessions.push({ ...base, id: randomUUID(), startTime: minutesToTime(cur), endTime: minutesToTime(se), notes: `${base.notes} (Session ${n++})`.trim() });
        if (se < end) cur = se + 15; else break;
      }
      data.slots.push(...sessions);
      await writeData(data);
      return res.json({ slots: sessions, autoSplit: true });
    }
    data.slots.push(base);
    addHistory(data, 'เพิ่ม Slot', `${base.date} ${base.startTime}-${base.endTime}`);
    await writeData(data);
    res.json({ slot: base });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/slots/:id', async (req, res) => {
  try {
    const data = await readData();
    const idx = data.slots.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบ slot' });
    data.slots[idx] = { ...data.slots[idx], ...req.body, id: req.params.id };
    addHistory(data, 'แก้ไข Slot', `${data.slots[idx].date} ${data.slots[idx].startTime}-${data.slots[idx].endTime}`);
    await writeData(data);
    res.json({ slot: data.slots[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/slots/:id', async (req, res) => {
  try {
    const data = await readData();
    const slot = data.slots.find(s => s.id === req.params.id);
    data.slots = data.slots.filter(s => s.id !== req.params.id);
    if (slot) addHistory(data, 'ลบ Slot', `${slot.date} ${slot.startTime}-${slot.endTime}`);
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Streamers ───────────────────────────────────────────────
router.get('/streamers', async (req, res) => {
  try { res.json((await readData()).streamers); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/streamers', async (req, res) => {
  try {
    const data = await readData();
    const streamer = {
      id: randomUUID(), name: req.body.name,
      type: req.body.type || 'freelance-remote',
      color: req.body.color || '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),
      agencyAdmin: req.body.agencyAdmin || null,
      monthlyHourLimit: req.body.monthlyHourLimit || null,
      dailyHourLimit: req.body.dailyHourLimit || null,
    };
    data.streamers.push(streamer);
    await writeData(data);
    res.json({ streamer });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/streamers/:id', async (req, res) => {
  try {
    const data = await readData();
    const idx = data.streamers.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบนักไลฟ์' });
    data.streamers[idx] = { ...data.streamers[idx], ...req.body, id: req.params.id };
    await writeData(data);
    res.json({ streamer: data.streamers[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/streamers/:id', async (req, res) => {
  try {
    const data = await readData();
    data.streamers = data.streamers.filter(s => s.id !== req.params.id);
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Brands ──────────────────────────────────────────────────
router.get('/brands', async (req, res) => {
  try { res.json((await readData()).brands); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/brands', async (req, res) => {
  try {
    const data = await readData();
    const brand = {
      id: randomUUID(), name: req.body.name,
      color: req.body.color || '#' + Math.floor(Math.random()*0xffffff).toString(16).padStart(6,'0'),
      sheetLink: req.body.sheetLink || '',
    };
    data.brands.push(brand);
    await writeData(data);
    res.json({ brand });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/brands/:id', async (req, res) => {
  try {
    const data = await readData();
    const idx = data.brands.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบแบรนด์' });
    data.brands[idx] = { ...data.brands[idx], ...req.body, id: req.params.id };
    await writeData(data);
    res.json({ brand: data.brands[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/brands/:id', async (req, res) => {
  try {
    const data = await readData();
    data.brands = data.brands.filter(b => b.id !== req.params.id);
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Availability ────────────────────────────────────────────
router.post('/availability', async (req, res) => {
  try {
    const data = await readData();
    data.availability = data.availability.filter(a => !(a.streamerId === req.body.streamerId && a.date === req.body.date));
    if (req.body.availableFrom) data.availability.push({ streamerId: req.body.streamerId, date: req.body.date, availableFrom: req.body.availableFrom, availableTo: req.body.availableTo });
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Brand Status ────────────────────────────────────────────
router.put('/brand-status', async (req, res) => {
  try {
    const data = await readData();
    if (!data.brandStatus) data.brandStatus = {};
    const { brandId, yearMonth, status } = req.body;
    const key = `${brandId}_${yearMonth}`;
    if (status === 'pending') delete data.brandStatus[key]; else data.brandStatus[key] = status;
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Agencies ────────────────────────────────────────────────
router.get('/agencies', async (req, res) => {
  try { res.json((await readData()).agencies || []); } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/agencies', async (req, res) => {
  try {
    const data = await readData();
    if (!data.agencies) data.agencies = [];
    const agency = { id: randomUUID(), name: req.body.name || '', contactPerson: req.body.contactPerson || '', phone: req.body.phone || '' };
    data.agencies.push(agency);
    addHistory(data, 'เพิ่ม Agency', agency.name);
    await writeData(data);
    res.json({ agency });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/agencies/:id', async (req, res) => {
  try {
    const data = await readData();
    if (!data.agencies) data.agencies = [];
    const idx = data.agencies.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบ Agency' });
    data.agencies[idx] = { ...data.agencies[idx], ...req.body, id: req.params.id };
    addHistory(data, 'แก้ไข Agency', data.agencies[idx].name);
    await writeData(data);
    res.json({ agency: data.agencies[idx] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/agencies/:id', async (req, res) => {
  try {
    const data = await readData();
    if (!data.agencies) data.agencies = [];
    data.agencies = data.agencies.filter(a => a.id !== req.params.id);
    await writeData(data);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Export TSV ──────────────────────────────────────────────
router.get('/export', async (req, res) => {
  try {
    const data = await readData();
    const { brandId, year, month } = req.query;
    const y = parseInt(year), m = parseInt(month);
    const brand = data.brands.find(b => b.id === brandId);
    if (!brand) return res.status(404).json({ error: 'ไม่พบแบรนด์' });
    const sById = Object.fromEntries(data.streamers.map(s => [s.id, s]));
    const slots = data.slots.filter(s => { if (s.brandId !== brandId) return false; const d = new Date(s.date); return d.getFullYear()===y && d.getMonth()+1===m; })
      .sort((a,b) => a.date !== b.date ? a.date.localeCompare(b.date) : timeToMinutes(a.startTime)-timeToMinutes(b.startTime));
    const fmtDate = ds => new Date(ds+'T00:00:00').toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric',year:'numeric'});
    const calcH = (s,e) => ((timeToMinutes(e)-timeToMinutes(s))/60).toFixed(1);
    const header = ['Slot','Date','Start Time','End Time','Total Hours','Platform','Live Type','Admin','คนไลฟ์','Remark'];
    const rows = slots.map((s,i) => [i+1,fmtDate(s.date),s.startTime,s.endTime,calcH(s.startTime,s.endTime),s.platform||'',s.liveType||'','',s.streamerName||sById[s.streamerId]?.name||'',s.notes||''].join('\t'));
    const tsv = [header.join('\t'),...rows].join('\n');
    res.setHeader('Content-Type','text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="${brand.name}_${year}-${String(m).padStart(2,'0')}.tsv"`);
    res.send(tsv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Google Sheets Import ────────────────────────────────────
function getAuthClient(tokens) {
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials(tokens);
  return client;
}
function parseDateStr(str) {
  if (!str) return null;
  const d = new Date(str.trim());
  if (!isNaN(d.getTime())) return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  return null;
}
function normalizeTime(t) {
  if (!t) return null;
  const clean = t.toString().trim().replace('.',':');
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  return match ? `${String(parseInt(match[1])).padStart(2,'0')}:${match[2]}` : null;
}
function parseSheetRows(rows) {
  const slots = []; let inTable = false; let colMap = {};
  for (const row of rows) {
    if (!row || !row.length) continue;
    const lr = row.map(c => (c||'').toString().toLowerCase().trim());
    if (lr.includes('date') && lr.includes('start time') && lr.includes('end time')) {
      inTable = true;
      colMap = { date: lr.indexOf('date'), start: lr.findIndex(c=>c==='start time'), end: lr.findIndex(c=>c==='end time'), platform: lr.findIndex(c=>c.includes('platform')), streamer: lr.findIndex(c=>c==='คนไลฟ์'||c==='host'||c==='streamer'), liveType: lr.findIndex(c=>c.includes('live type')||c==='type'), notes: lr.findIndex(c=>c==='remark'||c==='หมายเหตุ') };
      continue;
    }
    if (!inTable) continue;
    const date = parseDateStr(row[colMap.date]), startTime = normalizeTime(row[colMap.start]), endTime = normalizeTime(row[colMap.end]);
    if (!date || !startTime || !endTime) continue;
    slots.push({ date, startTime, endTime, platform: colMap.platform>=0?(row[colMap.platform]||'').toString().trim():'', streamerName: colMap.streamer>=0?(row[colMap.streamer]||'').toString().trim():'', liveType: colMap.liveType>=0?(row[colMap.liveType]||'').toString().trim():'', notes: colMap.notes>=0?(row[colMap.notes]||'').toString().trim():'' });
  }
  return slots;
}

router.post('/import-preview', async (req, res) => {
  if (!req.session?.googleTokens) return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ Google' });
  const { sheetLink, brandId } = req.body;
  if (!sheetLink) return res.status(400).json({ error: 'ต้องระบุ sheetLink' });
  const match = sheetLink.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return res.status(400).json({ error: 'link ไม่ถูกต้อง' });
  try {
    const auth = getAuthClient(req.session.googleTokens);
    const sheets = google.sheets({ version: 'v4', auth });
    const meta = await sheets.spreadsheets.get({ spreadsheetId: match[1] });
    let allRows = [];
    for (const tab of meta.data.sheets.map(s => s.properties.title)) {
      try { const r = await sheets.spreadsheets.values.get({ spreadsheetId: match[1], range: `'${tab}'` }); if (r.data.values) allRows = allRows.concat(r.data.values); } catch {}
    }
    const parsed = parseSheetRows(allRows);
    const data = await readData();
    const matched = parsed.map(s => { const found = data.streamers.find(st => st.name.toLowerCase() === s.streamerName.toLowerCase()); return { ...s, streamerId: found?.id || null }; });
    res.json({ slots: matched, streamers: data.streamers, brands: data.brands });
  } catch (e) {
    if (e.code === 403) return res.status(403).json({ error: 'ไม่มีสิทธิ์อ่าน Sheet นี้' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/import-confirm', async (req, res) => {
  try {
    const data = await readData();
    const saved = [];
    for (const s of req.body.slots) {
      if (!s.brandId || !s.date || !s.startTime || !s.endTime) continue;
      const slot = { id: randomUUID(), brandId: s.brandId, streamerId: s.streamerId||null, streamerName: s.streamerName||'', date: s.date, startTime: s.startTime, endTime: s.endTime, platform: s.platform||'', liveType: s.liveType||'', notes: s.notes||'', status: 'pending', createdAt: new Date().toISOString() };
      data.slots.push(slot); saved.push(slot);
    }
    await writeData(data);
    res.json({ saved: saved.length, slots: saved });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

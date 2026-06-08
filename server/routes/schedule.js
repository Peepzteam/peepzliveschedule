const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { randomUUID } = require('crypto');
const { google } = require('googleapis');

const DATA_FILE = path.join(__dirname, '../data/schedule.json');

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function addHistory(data, action, detail) {
  if (!data.history) data.history = [];
  data.history.unshift({
    id: randomUUID(),
    at: new Date().toISOString(),
    action,
    detail,
  });
  // keep last 200 entries
  if (data.history.length > 200) data.history = data.history.slice(0, 200);
}

// ─── helpers ────────────────────────────────────────────────
function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

function detectConflicts(slots) {
  const conflicts = new Set();
  for (let i = 0; i < slots.length; i++) {
    for (let j = i + 1; j < slots.length; j++) {
      const a = slots[i], b = slots[j];
      // ถ้ายังไม่มีนักไลฟ์ assigned ยังไม่นับว่าชน
      if (!a.streamerId || !b.streamerId) continue;
      if (a.streamerId !== b.streamerId || a.date !== b.date) continue;
      const aStart = timeToMinutes(a.startTime), aEnd = timeToMinutes(a.endTime);
      const bStart = timeToMinutes(b.startTime), bEnd = timeToMinutes(b.endTime);
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.add(a.id);
        conflicts.add(b.id);
      }
    }
  }
  return [...conflicts];
}

function calcFifiHours(slots, year, month) {
  const fifiSlots = slots.filter(s => {
    if (s.streamerId !== 'fifi') return false;
    const d = new Date(s.date);
    return d.getFullYear() === year && d.getMonth() + 1 === month;
  });

  const byDate = {};
  for (const s of fifiSlots) {
    const dur = (timeToMinutes(s.endTime) - timeToMinutes(s.startTime)) / 60;
    byDate[s.date] = (byDate[s.date] || 0) + dur;
  }

  const totalHours = Object.values(byDate).reduce((a, b) => a + b, 0);
  const otDays = Object.entries(byDate)
    .filter(([, h]) => h > 9)
    .map(([date, hours]) => ({ date, hours, ot: hours - 9 }));

  return { totalHours, byDate, otDays, limit: 100 };
}

// ─── GET all data ────────────────────────────────────────────
router.get('/data', (req, res) => {
  try {
    const data = readData();
    if (!data.agencies) data.agencies = [];
    const { year, month } = req.query;
    const y = parseInt(year) || new Date().getFullYear();
    const m = parseInt(month) || new Date().getMonth() + 1;
    const conflicts = detectConflicts(data.slots);
    const fifiHours = calcFifiHours(data.slots, y, m);
    res.json({ ...data, conflicts, fifiHours, history: data.history || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Slots ───────────────────────────────────────────────────
router.post('/slots', (req, res) => {
  try {
    const data = readData();
    const slot = {
      id: randomUUID(),
      brandId: req.body.brandId,
      streamerId: req.body.streamerId,
      date: req.body.date,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      platform: req.body.platform || '',
      notes: req.body.notes || '',
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    // auto-split if > 3 hours
    const dur = (timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime)) / 60;
    if (dur > 3) {
      const sessions = [];
      let cur = timeToMinutes(slot.startTime);
      const end = timeToMinutes(slot.endTime);
      let sessionNum = 1;
      while (cur < end) {
        const sessionEnd = Math.min(cur + 180, end); // 3 hrs
        sessions.push({
          ...slot,
          id: randomUUID(),
          startTime: minutesToTime(cur),
          endTime: minutesToTime(sessionEnd),
          notes: `${slot.notes} (Session ${sessionNum++})`.trim(),
        });
        if (sessionEnd < end) cur = sessionEnd + 15; // 15 min break
        else break;
      }
      data.slots.push(...sessions);
      writeData(data);
      return res.json({ slots: sessions, autoSplit: true });
    }

    data.slots.push(slot);
    addHistory(data, 'เพิ่ม Slot', `${slot.date} ${slot.startTime}-${slot.endTime} (brandId: ${slot.brandId})`);
    writeData(data);
    res.json({ slot });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function minutesToTime(m) {
  const h = Math.floor(m / 60) % 24;
  const min = m % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

router.put('/slots/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data.slots.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบ slot' });
    const old = data.slots[idx];
    data.slots[idx] = { ...old, ...req.body, id: req.params.id };
    addHistory(data, 'แก้ไข Slot', `${data.slots[idx].date} ${data.slots[idx].startTime}-${data.slots[idx].endTime} (brandId: ${data.slots[idx].brandId})`);
    writeData(data);
    res.json({ slot: data.slots[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/slots/:id', (req, res) => {
  try {
    const data = readData();
    const slot = data.slots.find(s => s.id === req.params.id);
    data.slots = data.slots.filter(s => s.id !== req.params.id);
    if (slot) addHistory(data, 'ลบ Slot', `${slot.date} ${slot.startTime}-${slot.endTime} (brandId: ${slot.brandId})`);
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Streamers ───────────────────────────────────────────────
router.get('/streamers', (req, res) => {
  res.json(readData().streamers);
});

router.post('/streamers', (req, res) => {
  try {
    const data = readData();
    const streamer = {
      id: randomUUID(),
      name: req.body.name,
      type: req.body.type || 'freelance-remote',
      color: req.body.color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
      agencyAdmin: req.body.agencyAdmin || null,
      monthlyHourLimit: req.body.monthlyHourLimit || null,
      dailyHourLimit: req.body.dailyHourLimit || null,
    };
    data.streamers.push(streamer);
    writeData(data);
    res.json({ streamer });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/streamers/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data.streamers.findIndex(s => s.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบนักไลฟ์' });
    data.streamers[idx] = { ...data.streamers[idx], ...req.body, id: req.params.id };
    writeData(data);
    res.json({ streamer: data.streamers[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/streamers/:id', (req, res) => {
  try {
    const data = readData();
    data.streamers = data.streamers.filter(s => s.id !== req.params.id);
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Brands ──────────────────────────────────────────────────
router.get('/brands', (req, res) => {
  res.json(readData().brands);
});

router.post('/brands', (req, res) => {
  try {
    const data = readData();
    const brand = {
      id: randomUUID(),
      name: req.body.name,
      color: req.body.color || '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
      sheetLink: req.body.sheetLink || '',
    };
    data.brands.push(brand);
    writeData(data);
    res.json({ brand });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/brands/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data.brands.findIndex(b => b.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบแบรนด์' });
    data.brands[idx] = { ...data.brands[idx], ...req.body, id: req.params.id };
    writeData(data);
    res.json({ brand: data.brands[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/brands/:id', (req, res) => {
  try {
    const data = readData();
    data.brands = data.brands.filter(b => b.id !== req.params.id);
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Availability ────────────────────────────────────────────
router.post('/availability', (req, res) => {
  try {
    const data = readData();
    data.availability = data.availability.filter(
      a => !(a.streamerId === req.body.streamerId && a.date === req.body.date)
    );
    if (req.body.availableFrom) {
      data.availability.push({
        streamerId: req.body.streamerId,
        date: req.body.date,
        availableFrom: req.body.availableFrom,
        availableTo: req.body.availableTo,
      });
    }
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Brand Status ────────────────────────────────────────────
// key: "brandId_YYYY-MM"  value: 'done' | 'pending'
router.put('/brand-status', (req, res) => {
  try {
    const data = readData();
    if (!data.brandStatus) data.brandStatus = {};
    const { brandId, yearMonth, status } = req.body; // yearMonth = "2026-06"
    const key = `${brandId}_${yearMonth}`;
    if (status === 'pending') delete data.brandStatus[key];
    else data.brandStatus[key] = status;
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Export brand slots as TSV ───────────────────────────────
router.get('/export', (req, res) => {
  try {
    const data = readData();
    const { brandId, year, month } = req.query;
    const y = parseInt(year), m = parseInt(month);

    const brand = data.brands.find(b => b.id === brandId);
    if (!brand) return res.status(404).json({ error: 'ไม่พบแบรนด์' });

    const streamerById = Object.fromEntries(data.streamers.map(s => [s.id, s]));

    const slots = data.slots
      .filter(s => {
        if (s.brandId !== brandId) return false;
        const d = new Date(s.date);
        return d.getFullYear() === y && d.getMonth() + 1 === m;
      })
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return timeToMinutes(a.startTime) - timeToMinutes(b.startTime);
      });

    // format date like "Fri, Jun 5, 2026"
    function fmtDate(dateStr) {
      const d = new Date(dateStr + 'T00:00:00');
      return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    }

    function calcHours(start, end) {
      const diff = timeToMinutes(end) - timeToMinutes(start);
      return (diff / 60).toFixed(1);
    }

    // TSV header — match existing sheet format
    const header = ['Slot', 'Date', 'Start Time', 'End Time', 'Total Hours', 'Platform', 'Live Type', 'Admin', 'คนไลฟ์', 'Remark'];
    const rows = slots.map((s, i) => {
      const streamer = streamerById[s.streamerId];
      return [
        i + 1,
        fmtDate(s.date),
        s.startTime,
        s.endTime,
        calcHours(s.startTime, s.endTime),
        s.platform || '',
        s.liveType || '',
        '',  // admin — ใส่เองใน sheet
        s.streamerName || streamer?.name || '',
        s.notes || '',
      ].join('\t');
    });

    const tsv = [header.join('\t'), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${brand.name}_${year}-${String(m).padStart(2,'0')}.tsv"`);
    res.send(tsv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Google Sheets Import ────────────────────────────────────
function getAuthClient(tokens) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials(tokens);
  return client;
}

function parseDateStr(str) {
  if (!str) return null;
  // "Fri, Jun 5, 2026" or "Mon, May 4, 2026"
  const d = new Date(str.trim());
  if (!isNaN(d.getTime())) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

function normalizeTime(t) {
  if (!t) return null;
  const clean = t.toString().trim().replace('.', ':');
  const match = clean.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return `${String(parseInt(match[1])).padStart(2, '0')}:${match[2]}`;
}

function parseSheetRows(rows) {
  const slots = [];
  let inTable = false;
  let colMap = {};

  for (const row of rows) {
    if (!row || row.length === 0) continue;

    // detect header row — look for "Date", "Start Time", "End Time"
    const lowerRow = row.map(c => (c || '').toString().toLowerCase().trim());
    if (lowerRow.includes('date') && lowerRow.includes('start time') && lowerRow.includes('end time')) {
      inTable = true;
      colMap = {
        date: lowerRow.indexOf('date'),
        start: lowerRow.findIndex(c => c === 'start time'),
        end: lowerRow.findIndex(c => c === 'end time'),
        platform: lowerRow.findIndex(c => c.includes('platform')),
        streamer: lowerRow.findIndex(c => c === 'คนไลฟ์' || c === 'host' || c === 'streamer'),
        admin: lowerRow.findIndex(c => c === 'admin' || c === 'แอดมิน'),
        liveType: lowerRow.findIndex(c => c.includes('live type') || c.includes('type')),
        notes: lowerRow.findIndex(c => c === 'remark' || c === 'หมายเหตุ'),
      };
      continue;
    }

    if (!inTable) continue;

    const dateStr = parseDateStr(row[colMap.date]);
    const startTime = normalizeTime(row[colMap.start]);
    const endTime = normalizeTime(row[colMap.end]);

    if (!dateStr || !startTime || !endTime) continue;

    slots.push({
      date: dateStr,
      startTime,
      endTime,
      platform: colMap.platform >= 0 ? (row[colMap.platform] || '').toString().trim() : '',
      streamerName: colMap.streamer >= 0 ? (row[colMap.streamer] || '').toString().trim() : '',
      adminName: colMap.admin >= 0 ? (row[colMap.admin] || '').toString().trim() : '',
      liveType: colMap.liveType >= 0 ? (row[colMap.liveType] || '').toString().trim() : '',
      notes: colMap.notes >= 0 ? (row[colMap.notes] || '').toString().trim() : '',
    });
  }

  return slots;
}

// POST /api/schedule/import-preview — read sheet, return parsed slots
router.post('/import-preview', async (req, res) => {
  if (!req.session?.googleTokens) {
    return res.status(401).json({ error: 'ยังไม่ได้เชื่อมต่อ Google — กรุณา reconnect และอนุมัติ Sheets permission' });
  }

  const { sheetLink, brandId } = req.body;
  if (!sheetLink) return res.status(400).json({ error: 'ต้องระบุ sheetLink' });

  // extract spreadsheet ID from URL
  const match = sheetLink.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!match) return res.status(400).json({ error: 'link ไม่ถูกต้อง' });
  const spreadsheetId = match[1];

  try {
    const auth = getAuthClient(req.session.googleTokens);
    const sheets = google.sheets({ version: 'v4', auth });

    // get list of sheet tabs
    const meta = await sheets.spreadsheets.get({ spreadsheetId });
    const sheetTabs = meta.data.sheets.map(s => s.properties.title);

    // read all tabs and collect rows
    let allRows = [];
    for (const tab of sheetTabs) {
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range: `'${tab}'`,
        });
        if (r.data.values) allRows = allRows.concat(r.data.values);
      } catch (e) {
        // skip tabs that can't be read
      }
    }

    const parsed = parseSheetRows(allRows);
    const data = readData();

    // try to match streamer names to existing streamers
    const matched = parsed.map(s => {
      const nameLC = s.streamerName.toLowerCase();
      const found = data.streamers.find(st => st.name.toLowerCase() === nameLC);
      return { ...s, streamerId: found?.id || null };
    });

    res.json({ slots: matched, streamers: data.streamers, brands: data.brands });
  } catch (e) {
    console.error('Sheet import error:', e.message);
    if (e.code === 403) return res.status(403).json({ error: 'ไม่มีสิทธิ์อ่าน Sheet นี้ หรือต้อง reconnect Google เพื่อขอ Sheets permission ใหม่' });
    res.status(500).json({ error: e.message });
  }
});

// POST /api/schedule/import-confirm — save imported slots
router.post('/import-confirm', (req, res) => {
  try {
    const data = readData();
    const { slots } = req.body; // array of slot objects ready to save

    const saved = [];
    for (const s of slots) {
      if (!s.brandId || !s.date || !s.startTime || !s.endTime) continue;
      const slot = {
        id: randomUUID(),
        brandId: s.brandId,
        streamerId: s.streamerId || null,
        streamerName: s.streamerName || '',
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        platform: s.platform || '',
        liveType: s.liveType || '',
        notes: s.notes || '',
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      data.slots.push(slot);
      saved.push(slot);
    }

    writeData(data);
    res.json({ saved: saved.length, slots: saved });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Agencies (external agency contacts) ─────────────────────
router.get('/agencies', (req, res) => {
  try {
    const data = readData();
    res.json(data.agencies || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/agencies', (req, res) => {
  try {
    const data = readData();
    if (!data.agencies) data.agencies = [];
    const agency = {
      id: randomUUID(),
      name: req.body.name || '',
      contactPerson: req.body.contactPerson || '',
      phone: req.body.phone || '',
    };
    data.agencies.push(agency);
    addHistory(data, 'add-agency', agency.name);
    writeData(data);
    res.json({ agency });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/agencies/:id', (req, res) => {
  try {
    const data = readData();
    if (!data.agencies) data.agencies = [];
    const idx = data.agencies.findIndex(a => a.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'ไม่พบ Agency' });
    data.agencies[idx] = { ...data.agencies[idx], ...req.body, id: req.params.id };
    addHistory(data, 'edit-agency', data.agencies[idx].name);
    writeData(data);
    res.json({ agency: data.agencies[idx] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/agencies/:id', (req, res) => {
  try {
    const data = readData();
    if (!data.agencies) data.agencies = [];
    data.agencies = data.agencies.filter(a => a.id !== req.params.id);
    writeData(data);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `คุณคือ "เลขา" เลขาส่วนตัวของแพร เจ้าของ Peepz Team (Live Commerce, Influencer Review, Event)
ทีม: พลอย (co-founder), ใบเตย (staff), มอส (content), ท้อป (freelance)
พนักงานประจำไม่ทำงานเสาร์-อาทิตย์
ประชุมจันทร์ = Google Meet, พฤหัส = ออฟฟิศ Pier 111
ClickUp account ของแพร: Pimchanok Sanpenpraw และ Peepz Team by Haus of Mumu
RAWE Space ID: 901810934101
เวลาสรุปงานให้มีครบ: ตารางนัด, Prae's To Do, งานด่วน, RAWE Board, อีเมลค้าง, next step, แผนละเอียด, ข้อความบอกทีม
ร่างอีเมลและข้อความบอกทีมมาให้เลยโดยไม่ต้องถาม
สไตล์การพิมพ์: เป็นกันเอง ภาษาไทย ใช้ emoji ลงท้ายด้วย "ค่า" วันที่ใช้ format "16 MAY 2026"`;

function buildContextString(context) {
  if (!context) return '';

  const now = new Date();
  const months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const dateStr = `${String(now.getDate()).padStart(2,'0')} ${months[now.getMonth()]} ${now.getFullYear()}`;

  let ctx = `\n\n━━━ ข้อมูล Dashboard ณ ${dateStr} ━━━`;

  const { calendar, clickup, gmail } = context;

  if (calendar?.events?.length) {
    ctx += '\n\n📅 ตารางนัด:';
    calendar.events.forEach((e) => {
      const time = e.isAllDay
        ? 'ทั้งวัน'
        : new Date(e.start).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
      const day = e.isToday ? 'วันนี้' : new Date(e.start).toLocaleDateString('th-TH', { weekday: 'short', day: 'numeric', month: 'short' });
      const link = e.meetLink ? ' 📹 Google Meet' : e.location ? ` 📍 ${e.location}` : '';
      ctx += `\n• ${day} ${time} — ${e.title}${link}`;
    });
  } else {
    ctx += '\n\n📅 ตารางนัด: ไม่มีนัดสัปดาห์นี้';
  }

  if (clickup?.prae?.length) {
    ctx += `\n\n📋 Prae's To Do (${clickup.prae.length} งาน):`;
    clickup.prae.slice(0, 15).forEach((t) => {
      const due = t.dueDate ? ` [due: ${new Date(t.dueDate).toLocaleDateString('th-TH')}]` : '';
      ctx += `\n• [${t.status}] ${t.name}${due}`;
    });
  }

  if (clickup?.overdue?.length) {
    ctx += `\n\n🚨 งานด่วน/Overdue (${clickup.overdue.length} งาน):`;
    clickup.overdue.forEach((t) => {
      const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('th-TH') : '?';
      ctx += `\n• [${t.status}] ${t.name} — ครบ ${due}`;
    });
  } else {
    ctx += '\n\n🚨 งานด่วน/Overdue: ไม่มีค่า';
  }

  if (clickup?.today?.length) {
    ctx += `\n\n✅ งานวันนี้ (${clickup.today.length} งาน):`;
    clickup.today.forEach((t) => {
      ctx += `\n• [${t.status}] ${t.name}`;
    });
  }

  if (clickup?.rawe?.length) {
    ctx += `\n\n🎨 RAWE Board (${clickup.rawe.length} งาน):`;
    clickup.rawe.slice(0, 10).forEach((t) => {
      ctx += `\n• [${t.status}] ${t.name}`;
    });
  }

  if (gmail?.emails?.length) {
    ctx += `\n\n📧 อีเมลค้าง (${gmail.emails.length} ฉบับ):`;
    gmail.emails.forEach((e) => {
      ctx += `\n• จาก: ${e.from} | ${e.subject}`;
    });
  } else {
    ctx += '\n\n📧 อีเมลค้าง: ไม่มีค่า';
  }

  ctx += '\n━━━━━━━━━━━━━━━━━━━━━━━━━━';
  return ctx;
}

// POST /api/claude/chat  (streaming SSE)
router.post('/chat', async (req, res) => {
  const { messages, context } = req.body;

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY ค่า' });
  }

  if (!messages?.length) {
    return res.status(400).json({ error: 'ไม่มี messages' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // inject context into last user message
  const contextStr = buildContextString(context);
  const apiMessages = messages.map(({ role, content }, idx) => ({
    role,
    content:
      role === 'user' && idx === messages.length - 1 && contextStr
        ? content + contextStr
        : content,
  }));

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const safeWrite = (data) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  const safeEnd = () => {
    if (!res.writableEnded) res.end();
  };

  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: apiMessages,
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        safeWrite({ text: event.delta.text });
      }
    }

    if (!res.writableEnded) { res.write('data: [DONE]\n\n'); res.end(); }
  } catch (err) {
    console.error('Claude error:', err.message);
    safeWrite({ error: 'เลขาตอบไม่ได้ตอนนี้ค่า: ' + err.message });
    safeEnd();
  }
});

module.exports = router;

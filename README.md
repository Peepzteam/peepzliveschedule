# 🍊 เลขา — Peepz Team Secretary

AI เลขาส่วนตัวของแพร เชื่อมต่อ ClickUp + Gmail + Google Calendar + Claude

---

## ✨ Features

| Feature | รายละเอียด |
|---------|-----------|
| 💬 AI Chat | คุยกับเลขา AI (Claude) ภาษาไทย |
| 📋 ClickUp | ดึง Tasks, Prae's To Do, Overdue, RAWE Board |
| 📅 Calendar | ตารางนัดวันนี้และสัปดาห์นี้ |
| 📧 Gmail | อีเมลที่ยังไม่ได้ตอบ |
| ⚡ Quick Actions | สรุปเช้า · สรุปเย็น · งานด่วน · บอกทีม · อีเมล |

---

## 🚀 วิธี Setup และรัน

### Step 1 — Clone / ดาวน์โหลดโปรเจกต์

```bash
cd peepz-secretary
```

### Step 2 — ตั้งค่า Environment Variables

```bash
npm run setup
# หรือ: cp .env.example .env
```

แก้ไขไฟล์ `.env` ใส่ค่าจริง (ดูรายละเอียดในแต่ละ section ด้านล่าง)

---

### ⚙️ ClickUp API Token

1. เข้า ClickUp → คลิกรูป Profile ขวาบน → **Apps**
2. ในส่วน **API Token** → คลิก **Generate** (ถ้ายังไม่มี)
3. Copy token ที่ขึ้นต้นด้วย `pk_...`
4. ใส่ใน `.env`:
   ```
   CLICKUP_API_TOKEN=pk_xxxxxxxx
   ```

---

### 🤖 Anthropic API Key

1. ไปที่ [console.anthropic.com/keys](https://console.anthropic.com/keys)
2. **Create Key** → Copy key ที่ขึ้นต้นด้วย `sk-ant-...`
3. ใส่ใน `.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
   ```

---

### 📧 Google OAuth2 (Gmail + Calendar)

1. ไปที่ [Google Cloud Console](https://console.cloud.google.com)
2. สร้าง Project ใหม่ หรือเลือก Project ที่มีอยู่
3. **APIs & Services → Library** → เปิด:
   - ✅ Gmail API
   - ✅ Google Calendar API
4. **APIs & Services → OAuth consent screen**:
   - User Type: **External**
   - App name: `เลขา Peepz Team`
   - ใส่ email ของแพร (`contact@peepzteam.com`)
   - Scopes: เพิ่ม `gmail.readonly` + `calendar.readonly`
   - Test users: เพิ่ม email ของแพร
5. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client IDs**:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/auth/callback`
   - **Create** → Copy **Client ID** และ **Client Secret**
6. ใส่ใน `.env`:
   ```
   GOOGLE_CLIENT_ID=xxxxxx.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxx
   ```

---

### Step 3 — ติดตั้ง Dependencies

```bash
npm run install:all
```

คำสั่งนี้จะ install ทั้ง root + server + client ในครั้งเดียว (ใช้เวลา ~1-2 นาที)

---

### Step 4 — รัน Development Server

```bash
npm run dev
```

จะเปิด 2 server พร้อมกัน:
- 🍊 **Backend** → http://localhost:3000
- ⚛️  **Frontend** → http://localhost:5173

เปิด browser ที่ **http://localhost:5173**

---

### Step 5 — เชื่อมต่อ Google (Gmail + Calendar)

1. เปิด app ที่ http://localhost:5173
2. คลิก **"เชื่อมต่อ Google"** ใน Dashboard
3. เลือก Google account ของแพร
4. Allow permissions
5. App จะ redirect กลับมาพร้อมข้อมูล Calendar + Gmail ✅

---

## 📁 โครงสร้างโปรเจกต์

```
peepz-secretary/
├── .env                    ← API keys (ไม่ commit!)
├── .env.example            ← Template
├── package.json            ← Root scripts
├── server/
│   ├── index.js            ← Express server (port 3000)
│   └── routes/
│       ├── auth.js         ← Google OAuth2
│       ├── clickup.js      ← ClickUp API
│       ├── google.js       ← Gmail + Calendar
│       └── claude.js       ← Claude AI (streaming)
└── client/
    ├── src/
    │   ├── App.jsx         ← Layout หลัก
    │   ├── api.js          ← API calls
    │   └── components/
    │       ├── Chat.jsx        ← AI Chat
    │       ├── Dashboard.jsx   ← Dashboard wrapper
    │       ├── TaskCard.jsx    ← ClickUp task cards
    │       ├── CalendarCard.jsx
    │       └── EmailCard.jsx
    └── ...
```

---

## 🛠️ Scripts

| Script | ใช้งาน |
|--------|--------|
| `npm run dev` | รัน dev mode (server + client) |
| `npm run build` | Build frontend สำหรับ production |
| `npm start` | รัน production server |
| `npm run install:all` | ติดตั้ง dependencies ทั้งหมด |

---

## 🔧 Troubleshooting

**ClickUp ดึงข้อมูลไม่ได้**
- ตรวจว่า `CLICKUP_API_TOKEN` ถูกต้อง (ขึ้นต้นด้วย `pk_`)
- Token ต้องเป็นของ account ที่มี access ใน space IDs ที่กำหนด

**Google auth ไม่ทำงาน**
- Redirect URI ใน Google Console ต้องตรงกับ `.env` (`http://localhost:3000/auth/callback`)
- ต้องเพิ่ม email เป็น Test User ถ้า app ยังเป็น External + Testing

**Claude ตอบไม่ได้**
- ตรวจ `ANTHROPIC_API_KEY` ใน `.env`
- ดู log ที่ terminal ของ server

**Port ชน**
- ถ้า port 3000 ถูกใช้อยู่: เปลี่ยน `PORT=3001` ใน `.env` และ `GOOGLE_REDIRECT_URI` ให้ตรงกัน

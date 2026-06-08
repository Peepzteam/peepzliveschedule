/**
 * รัน 1 ครั้งเพื่อ:
 * 1. สร้าง table live_schedule ใน Supabase
 * 2. ย้ายข้อมูลจาก schedule.seed.json ขึ้น Supabase
 *
 * วิธีรัน (จาก root project):
 *   cd server && node scripts/migrate_to_supabase.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function main() {
  console.log('🔗 เชื่อม Supabase:', process.env.SUPABASE_URL);

  // 1. สร้าง table (ถ้ายังไม่มี) — ต้องรัน SQL นี้ใน Supabase dashboard ก่อน
  //    ดู server/supabase_setup.sql

  // 2. โหลดข้อมูลจาก seed file
  const seedPath = path.join(__dirname, '../data/schedule.seed.json');
  if (!fs.existsSync(seedPath)) {
    console.error('❌ ไม่พบ schedule.seed.json');
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  console.log(`📦 โหลดข้อมูล: ${payload.streamers?.length} นักไลฟ์, ${payload.brands?.length} แบรนด์, ${payload.slots?.length} slot`);

  // 3. upsert ข้อมูลขึ้น Supabase
  const { error } = await supabase
    .from('live_schedule')
    .upsert({ id: 'main', payload, updated_at: new Date().toISOString() });

  if (error) {
    console.error('❌ บันทึกไม่ได้:', error.message);
    console.log('\n💡 ถ้ายังไม่ได้สร้าง table ให้รัน SQL ใน Supabase dashboard ก่อน:');
    console.log('   https://supabase.com/dashboard/project/kldiltgxkmqhiqphnqzm/sql');
    console.log('   แล้ว copy ไฟล์ server/supabase_setup.sql ไปวาง\n');
    process.exit(1);
  }

  console.log('✅ ย้ายข้อมูลขึ้น Supabase สำเร็จ!');
  console.log('✅ ตอนนี้ข้อมูลอยู่บน Supabase ไม่หายแน่นอน ไม่ว่าจะ deploy กี่ครั้ง');
}

main().catch(e => { console.error(e); process.exit(1); });

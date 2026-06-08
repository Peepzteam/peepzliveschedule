-- รัน SQL นี้ใน Supabase Dashboard → SQL Editor
-- สร้าง 1 ครั้งเท่านั้น

create table if not exists live_schedule (
  id text primary key default 'main',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ปิด Row Level Security (app ใช้ service key อยู่แล้ว)
alter table live_schedule disable row level security;

-- ใส่ข้อมูลเริ่มต้น (ถ้ายังไม่มี)
insert into live_schedule (id, payload)
values ('main', '{
  "streamers": [],
  "brands": [],
  "slots": [],
  "availability": [],
  "brandStatus": {},
  "agencies": [],
  "history": []
}'::jsonb)
on conflict (id) do nothing;

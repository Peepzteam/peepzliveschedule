const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    realtime: { transport: WebSocket },
  }
);

const ROW_ID = 'main';

async function readData() {
  const { data, error } = await supabase
    .from('live_schedule')
    .select('payload')
    .eq('id', ROW_ID)
    .single();

  if (error) throw new Error('อ่านข้อมูลไม่ได้: ' + error.message);

  const d = data.payload;
  // ตรวจให้ครบทุก field
  return {
    streamers:    d.streamers    || [],
    brands:       d.brands       || [],
    slots:        d.slots        || [],
    availability: d.availability || [],
    brandStatus:  d.brandStatus  || {},
    agencies:     d.agencies     || [],
    history:      d.history      || [],
  };
}

async function writeData(payload) {
  const { error } = await supabase
    .from('live_schedule')
    .upsert({ id: ROW_ID, payload, updated_at: new Date().toISOString() });

  if (error) throw new Error('บันทึกข้อมูลไม่ได้: ' + error.message);
}

module.exports = { readData, writeData };

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

// ใช้ relative URL → ผ่าน Vite proxy → session cookie ถูกส่งถูกต้อง
const http = axios.create({ baseURL: '/api/schedule' });
http.interceptors.request.use(cfg => {
  cfg.headers['x-team-token'] = localStorage.getItem('peepz_token') || '';
  return cfg;
});
const API_get  = (p, cfg) => http.get(p, cfg);
const API_post = (p, d)   => http.post(p, d);
const API_put  = (p, d)   => http.put(p, d);
const API_del  = (p)      => http.delete(p);

const HOURS = ['00:00','01:00','02:00','03:00','04:00','05:00','06:00','07:00',
               '08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00',
               '16:00','17:00','18:00','19:00','20:00','21:00','22:00','23:00'];

const STATUS_LABEL = { pending: 'รอยืนยัน', confirmed: 'ยืนยันแล้ว', approved: 'อนุมัติ' };
const STATUS_CLS   = { pending: 'badge-pending', confirmed: 'badge-confirmed', approved: 'badge-approved' };

function timeToMinutes(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}
function getDaysInMonth(year, month) {
  const days = [], date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
  return days;
}
function ds(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

const DAY_TH   = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const MONTH_TH = ['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
const EMPTY_ROW = () => ({ date:'', startTime:'', endTime:'', streamerId:'', platform:'', liveType:'', notes:'' });

const PRESET_COLORS = [
  '#FF6B6B','#FF9F43','#FECA57','#48DBFB','#1DD1A1',
  '#6C5CE7','#FD79A8','#00B894','#E17055','#74B9FF',
  '#A29BFE','#55EFC4','#FAB1A0','#81ECEC','#636E72',
  '#E84393','#00CEC9','#FDCB6E','#6D214F','#182C61',
];
function pickUniqueColor(existingColors) {
  const used = new Set((existingColors||[]).map(c=>(c||'').toLowerCase()));
  return PRESET_COLORS.find(c => !used.has(c.toLowerCase())) || PRESET_COLORS[Math.floor(Math.random()*PRESET_COLORS.length)];
}

// ─── Mouse tooltip ───────────────────────────────────────────
function CellTooltip({ info }) {
  if (!info) return null;
  const { x, y, date, hour, slot, brand, streamer } = info;

  // Slot hover — show full slot info
  if (slot) {
    const color = brand?.color || '#9ca3af';
    return (
      <div className="fixed z-50 pointer-events-none"
        style={{ left: x + 14, top: y - 8, transform: 'translateY(-100%)' }}>
        <div className="bg-gray-900 text-white text-xs px-3 py-2 rounded-xl shadow-xl whitespace-nowrap flex flex-col gap-0.5">
          <span className="font-bold" style={{color}}>{brand?.name || slot.brandId}</span>
          <span className="text-gray-200 font-semibold">{slot.startTime} – {slot.endTime}</span>
          {streamer && <span className="text-gray-400">{streamer.name}</span>}
          {slot.location==='studio1' && <span className="text-purple-400 text-[10px]">🎬 Studio 1</span>}
          {slot.location==='studio2' && <span className="text-blue-400 text-[10px]">🎥 Studio 2</span>}
        </div>
      </div>
    );
  }

  // Empty cell hover — show date/hour
  const d = new Date(date + 'T00:00:00');
  const dayName = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'][d.getDay()];
  const dateLabel = `${dayName} ${d.getDate()} ${['','ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'][d.getMonth()+1]} ${d.getFullYear()}`;
  return (
    <div className="fixed z-50 pointer-events-none"
      style={{ left: x + 14, top: y - 8, transform: 'translateY(-100%)' }}>
      <div className="bg-gray-900 text-white text-xs px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap flex items-center gap-2">
        <span className="font-semibold text-accent">{hour}</span>
        <span className="text-gray-300">{dateLabel}</span>
      </div>
    </div>
  );
}

// ─── Drag hook (shared between grids) ────────────────────────
function useDrag(onEmpty) {
  const drag = useRef(null); // { date, startIdx, endIdx }
  const [sel, setSel] = useState(null); // { date, startIdx, endIdx }

  useEffect(() => {
    function onMouseUp() {
      if (!drag.current) return;
      const { date, startIdx, endIdx } = drag.current;
      drag.current = null;
      document.body.style.userSelect = '';
      const lo = Math.min(startIdx, endIdx);
      const hi = Math.max(startIdx, endIdx);
      const startTime = HOURS[lo];
      const nextIdx = hi + 1;
      const endTime = nextIdx < HOURS.length ? HOURS[nextIdx] : '23:59';
      setSel(null);
      onEmpty(date, startTime, endTime);
    }
    window.addEventListener('mouseup', onMouseUp);
    return () => window.removeEventListener('mouseup', onMouseUp);
  }, [onEmpty]);

  function cellDown(date, hIdx, hasSlots) {
    if (hasSlots) return;
    drag.current = { date, startIdx: hIdx, endIdx: hIdx };
    setSel({ date, startIdx: hIdx, endIdx: hIdx });
    document.body.style.userSelect = 'none';
  }
  function cellEnter(date, hIdx) {
    if (!drag.current || drag.current.date !== date) return;
    drag.current.endIdx = hIdx;
    setSel({ date, startIdx: drag.current.startIdx, endIdx: hIdx });
  }
  function isSelected(date, hIdx) {
    if (!sel || sel.date !== date) return false;
    const lo = Math.min(sel.startIdx, sel.endIdx);
    const hi = Math.max(sel.startIdx, sel.endIdx);
    return hIdx >= lo && hIdx <= hi;
  }
  return { cellDown, cellEnter, isSelected, dragging: !!sel };
}

// ─── Cell block — renders one slot segment in a cell ─────────
function CellBlock({ slot: s, pos, sById, bById, conflictSet, onSlot, onHover }) {
  const streamer = sById[s.streamerId], brand = bById[s.brandId];
  const noStreamer = !s.streamerId && !s.streamerName;
  const isConflict = conflictSet.has(s.id);
  const color = brand?.color || streamer?.color || '#9ca3af';
  const isStart = pos === 'start' || pos === 'single';
  const isEnd   = pos === 'end'   || pos === 'single';
  return (
    <div onClick={e=>{e.stopPropagation();onSlot(s);}}
      onMouseEnter={e=>{e.stopPropagation();onHover&&onHover({x:e.clientX,y:e.clientY,slot:s,brand,streamer});}}
      onMouseLeave={e=>{e.stopPropagation();onHover&&onHover(null);}}
      className={`w-full h-full cursor-pointer overflow-hidden transition-all hover:brightness-95 ${isConflict?'ring-1 ring-red-500':''}`}
      style={{
        backgroundColor: color + (isStart||pos==='single' ? '30' : '20'),
        borderLeft: `3px solid ${color}`,
        borderTop:    isStart ? `2px solid ${color}` : 'none',
        borderBottom: isEnd   ? `2px solid ${color}` : 'none',
        borderRadius: isStart&&isEnd ? '6px' : isStart ? '6px 6px 0 0' : isEnd ? '0 0 6px 6px' : '0',
        paddingLeft: 4, paddingRight: 2,
      }}>
      {isStart && <>
        <div className="font-bold truncate text-[10px] leading-tight pt-0.5" style={{color}}>{brand?.name||s.brandId}</div>
        {noStreamer
          ? <div className="text-amber-500 text-[9px] leading-tight">⚠ รอจัดคน</div>
          : <div className="text-gray-600 text-[9px] leading-tight truncate">{s.streamerName||streamer?.name}</div>}
        {s.location==='studio1'&&<div className="text-[8px] leading-tight text-purple-600 font-medium">🎬 Studio 1</div>}
        {s.location==='studio2'&&<div className="text-[8px] leading-tight text-blue-600 font-medium">🎥 Studio 2</div>}
        <div className="text-[9px] leading-tight" style={{color:color+'cc'}}>{s.startTime}</div>
      </>}
      {isEnd && !isStart && (
        <div className="text-[9px] absolute bottom-0.5 left-1" style={{color:color+'cc'}}>{s.endTime}</div>
      )}
    </div>
  );
}

// ─── build cell maps — each hour cell knows which slots cover it
function buildCellMap(slots, dates, filterFn) {
  // cellMap[date_hIdx] = [{ slot, position: 'start'|'mid'|'end'|'single' }]
  const cellMap = {};
  const relevant = filterFn ? slots.filter(filterFn) : slots;

  for (const s of relevant) {
    if (!dates.includes(s.date)) continue;
    const si = HOURS.indexOf(s.startTime);
    if (si === -1) continue;
    let ei = HOURS.indexOf(s.endTime);
    if (ei === -1) ei = HOURS.length;
    const span = Math.max(ei - si, 1);

    for (let i = si; i < si + span; i++) {
      const key = `${s.date}_${i}`;
      if (!cellMap[key]) cellMap[key] = [];
      let pos = 'mid';
      if (i === si && span === 1) pos = 'single';
      else if (i === si) pos = 'start';
      else if (i === si + span - 1) pos = 'end';
      cellMap[key].push({ slot: s, pos });
    }
  }
  return cellMap;
}

// ─── Studio View ─────────────────────────────────────────────
function StudioView({ year, month, data, onSlot }) {
  const today = ds(new Date());
  const days = getDaysInMonth(year, month);
  const [selDate, setSelDate] = React.useState(days.includes(today) ? today : days[0]);

  const sById = React.useMemo(()=>Object.fromEntries((data.streamers||[]).map(s=>[s.id,s])),[ data.streamers]);
  const bById = React.useMemo(()=>Object.fromEntries((data.brands||[]).map(b=>[b.id,b])),[data.brands]);

  const studioSlots = React.useMemo(()=>
    (data.slots||[]).filter(s => s.date === selDate && (s.location === 'studio1' || s.location === 'studio2'))
  ,[data.slots, selDate]);

  const s1 = studioSlots.filter(s=>s.location==='studio1').sort((a,b)=>a.startTime.localeCompare(b.startTime));
  const s2 = studioSlots.filter(s=>s.location==='studio2').sort((a,b)=>a.startTime.localeCompare(b.startTime));

  function SlotCard({ s }) {
    const brand = bById[s.brandId];
    const streamer = sById[s.streamerId];
    const color = brand?.color || '#9ca3af';
    return (
      <div onClick={()=>onSlot(s)} className="rounded-xl border-l-4 p-3 mb-2 cursor-pointer hover:brightness-95 transition-all"
        style={{borderLeftColor: color, backgroundColor: color+'18'}}>
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold" style={{color}}>{brand?.name || '-'}</span>
          <span className="text-[10px] text-gray-400 font-mono">{s.startTime} – {s.endTime}</span>
        </div>
        <div className="text-[11px] text-gray-600">{streamer?.name || <span className="text-amber-500">⚠ รอจัดคน</span>}</div>
        {s.notes && <div className="text-[10px] text-gray-400 mt-0.5 truncate">{s.notes}</div>}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">
      {/* date picker */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-white overflow-x-auto flex-shrink-0">
        {days.map(d=>{
          const dd = parseInt(d.slice(8));
          const dow = DAY_TH[new Date(d).getDay()];
          const isToday = d===today;
          return (
            <button key={d} onClick={()=>setSelDate(d)}
              className={`flex flex-col items-center min-w-[36px] px-1.5 py-1 rounded-lg text-xs transition-all flex-shrink-0 ${
                selDate===d ? 'bg-accent text-white font-bold' : isToday ? 'border border-accent text-accent font-semibold' : 'text-gray-500 hover:bg-gray-100'
              }`}>
              <span className="text-[9px] leading-tight">{dow}</span>
              <span className="leading-tight">{dd}</span>
            </button>
          );
        })}
      </div>

      {/* studio columns */}
      <div className="flex flex-1 overflow-auto gap-4 p-4">
        {[{id:'studio1',label:'🎬 Studio 1',slots:s1},{id:'studio2',label:'🎥 Studio 2',slots:s2}].map(studio=>(
          <div key={studio.id} className="flex-1 min-w-[260px]">
            <div className={`text-sm font-bold mb-3 px-3 py-2 rounded-xl ${studio.id==='studio1'?'bg-purple-50 text-purple-700':'bg-blue-50 text-blue-700'}`}>
              {studio.label}
              <span className="ml-2 text-[11px] font-normal opacity-70">{studio.slots.length} slot</span>
            </div>
            {studio.slots.length===0
              ? <div className="text-center text-gray-300 text-sm py-10">ไม่มีการใช้ห้องวันนี้</div>
              : studio.slots.map(s=><SlotCard key={s.id} s={s}/>)
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Month Grid ───────────────────────────────────────────────
function MonthGrid({ year, month, data, conflictSet, onSlot, onEmpty, onHover }) {
  const days = getDaysInMonth(year, month);
  const today = ds(new Date());
  const sById = Object.fromEntries(data.streamers.map(s=>[s.id,s]));
  const bById = Object.fromEntries(data.brands.map(b=>[b.id,b]));
  const dateStrs = days.map(d => ds(d));
  const cellMap = buildCellMap(data.slots, dateStrs);

  const onEmptyWithEnd = useCallback((date, startTime, endTime) => onEmpty(date, startTime, endTime), [onEmpty]);
  const { cellDown, cellEnter, isSelected, dragging } = useDrag(onEmptyWithEnd);

  return (
    <div className="overflow-auto flex-1" style={{cursor: dragging?'ns-resize':'default'}}>
      <table className="text-[10px] border-collapse select-none" style={{minWidth:`${days.length*72+52}px`}}>
        <thead className="sticky top-0 z-20 bg-white shadow-sm">
          <tr>
            <th className="sticky left-0 z-30 bg-white w-12 border-b border-r border-border text-gray-400 font-normal px-1 py-1.5 text-right">เวลา</th>
            {days.map(d=>{
              const dstr=ds(d), isT=dstr===today;
              return (
                <th key={dstr} style={{minWidth:72}} className={`border-b border-r border-border px-0.5 py-1 text-center ${isT?'bg-orange-50':''}`}>
                  <div className={`text-[9px] ${isT?'text-accent font-bold':'text-gray-400'}`}>{DAY_TH[d.getDay()]}</div>
                  <div className={`text-sm font-bold leading-none ${isT?'text-accent':'text-gray-700'}`}>{d.getDate()}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour, hIdx)=>(
            <tr key={hour} style={{height:36}}>
              <td className="sticky left-0 z-10 bg-white px-1 text-gray-400 text-right border-r border-b border-border w-12">{hour}</td>
              {days.map(d=>{
                const dstr=ds(d), isT=dstr===today;
                const key=`${dstr}_${hIdx}`;
                const entries=cellMap[key]||[];
                const hasSlot=entries.length>0;
                const selected=isSelected(dstr,hIdx);
                return (
                  <td key={dstr}
                    className={`border-r border-b border-border p-0 relative transition-colors
                      ${selected?'bg-accent/20':isT&&!hasSlot?'bg-orange-50/60':!hasSlot?'hover:bg-gray-50':''}`}
                    style={{minWidth:72, height:36}}
                    onMouseDown={()=>cellDown(dstr,hIdx,hasSlot)}
                    onMouseEnter={e=>{cellEnter(dstr,hIdx);onHover({x:e.clientX,y:e.clientY,date:dstr,hour});}}
                    onMouseLeave={()=>onHover(null)}>
                    {hasSlot && (
                      <div className="flex flex-row h-full w-full" style={{gap:1}}>
                        {entries.map(({slot:s,pos})=>(
                          <div key={s.id} className="flex-1 min-w-0 h-full">
                            <CellBlock slot={s} pos={pos} sById={sById} bById={bById} conflictSet={conflictSet} onSlot={onSlot} onHover={onHover}/>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Week Grid ────────────────────────────────────────────────
function WeekGrid({ week, data, conflictSet, fStreamer, fBrand, onSlot, onEmpty, onHover }) {
  const today = ds(new Date());
  const sById = Object.fromEntries(data.streamers.map(s=>[s.id,s]));
  const bById = Object.fromEntries(data.brands.map(b=>[b.id,b]));
  const dateStrs = week.map(d => ds(d));
  const cellMap = buildCellMap(data.slots, dateStrs, s => {
    if (fStreamer !== 'all' && s.streamerId !== fStreamer) return false;
    if (fBrand !== 'all' && s.brandId !== fBrand) return false;
    return true;
  });

  const onEmptyWithEnd = useCallback((date, startTime, endTime) => onEmpty(date, startTime, endTime), [onEmpty]);
  const { cellDown, cellEnter, isSelected, dragging } = useDrag(onEmptyWithEnd);

  return (
    <div className="flex-1 overflow-auto" style={{cursor: dragging?'ns-resize':'default'}}>
      <table className="text-xs border-collapse w-full select-none" style={{minWidth:`${week.length*140+56}px`}}>
        <thead className="sticky top-0 z-10 bg-white shadow-sm">
          <tr>
            <th className="sticky left-0 z-20 bg-white w-14 px-2 py-2 text-gray-400 font-normal text-right border-b border-r border-border">เวลา</th>
            {week.map(d=>{
              const dstr=ds(d), isT=dstr===today;
              return (
                <th key={dstr} className={`px-2 py-2 border-b border-r border-border font-medium min-w-[140px] text-center ${isT?'bg-orange-50':''}`}>
                  <div className={`text-[10px] ${isT?'text-accent':'text-gray-400'}`}>{DAY_TH[d.getDay()]}</div>
                  <div className={`text-base font-bold ${isT?'text-accent':'text-gray-700'}`}>{d.getDate()}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour, hIdx)=>(
            <tr key={hour} style={{height:40}}>
              <td className="sticky left-0 z-10 bg-white px-2 text-gray-400 text-right border-r border-b border-border w-14">{hour}</td>
              {week.map(d=>{
                const dstr=ds(d);
                const key=`${dstr}_${hIdx}`;
                const entries=cellMap[key]||[];
                const hasSlot=entries.length>0;
                const selected=isSelected(dstr,hIdx);
                return (
                  <td key={dstr}
                    className={`border-r border-b border-border p-0 relative transition-colors
                      ${selected?'bg-accent/20':!hasSlot?'hover:bg-gray-50':''}`}
                    style={{height:40}}
                    onMouseDown={()=>cellDown(dstr,hIdx,hasSlot)}
                    onMouseEnter={e=>{cellEnter(dstr,hIdx);onHover({x:e.clientX,y:e.clientY,date:dstr,hour});}}
                    onMouseLeave={()=>onHover(null)}>
                    {hasSlot && (
                      <div className="flex flex-row h-full w-full" style={{gap:1}}>
                        {entries.map(({slot:s,pos})=>(
                          <div key={s.id} className="flex-1 min-w-0 h-full">
                            <CellBlock slot={s} pos={pos} sById={sById} bById={bById} conflictSet={conflictSet} onSlot={onSlot} onHover={onHover}/>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────
export default function ScheduleBoard() {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()+1);
  const [weekOff, setWeekOff] = useState(0);
  const [view, setView]   = useState(()=>{
    const h = window.location.hash.replace('#','');
    return ['month','week','studio'].includes(h) ? h : 'month';
  });
  const [hoverInfo, setHoverInfo] = useState(null);

  // sync URL hash with view
  useEffect(()=>{ window.location.hash = view; },[view]);
  const [data, setData]   = useState({streamers:[],brands:[],slots:[],conflicts:[],fifiHours:null});
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [form, setForm]   = useState({});
  const [fS, setFS] = useState('all');
  const [fB, setFB] = useState('all');
  const [toast, setToast] = useState(null);

  // import
  const [impBrand, setImpBrand] = useState('');
  const [impLink,  setImpLink]  = useState('');
  const [impLoad,  setImpLoad]  = useState(false);
  const [impPrev,  setImpPrev]  = useState(null);
  const [impNeedAuth, setImpNeedAuth] = useState(false);
  const [impSel,   setImpSel]   = useState(new Set());
  const [impMap,   setImpMap]   = useState({});

  // bulk
  const [bulkBrand, setBulkBrand] = useState('');
  const [bulkRows,  setBulkRows]  = useState([EMPTY_ROW()]);

  // export
  const [exportModal, setExportModal] = useState(null); // { brand, slots, tsv }
  const [copied, setCopied] = useState(false);

  const load = useCallback(async()=>{
    setLoading(true);
    try { const r=await API_get(`/data?year=${year}&month=${month}`); setData(r.data); }
    catch(e){ toast_show('โหลดไม่ได้ '+e.message,'err'); }
    finally { setLoading(false); }
  },[year,month]);

  useEffect(()=>{load();},[load]);

  function toast_show(msg,type='ok'){setToast({msg,type});setTimeout(()=>setToast(null),4000);}

  // week nav
  const allDays=getDaysInMonth(year,month);
  const weeks=[]; let w=[];
  for(const d of allDays){if(w.length===7){weeks.push(w);w=[];}w.push(d);}
  if(w.length) weeks.push(w);
  const curWeek=weeks[Math.min(weekOff,weeks.length-1)]||[];

  const conflictSet=new Set(data.conflicts||[]);
  const sById=Object.fromEntries(data.streamers.map(s=>[s.id,s]));
  const bById=Object.fromEntries(data.brands.map(b=>[b.id,b]));
  const unassigned=data.slots.filter(s=>!s.streamerId&&!s.streamerName);
  const fifi=data.fifiHours;
  const fifiPct=fifi?Math.min((fifi.totalHours/fifi.limit)*100,100):0;

  // ── slot CRUD ──────────────────────────────────────────────
  async function saveSlot(){
    if(!form.brandId||!form.date||!form.startTime||!form.endTime) return toast_show('กรอกข้อมูลให้ครบ','err');
    try{
      if(modal?.slot){ await API_put(`/slots/${modal.slot.id}`, form); toast_show('แก้ไขแล้ว'); }
      else {
        const r=await API_post('/slots', form);
        toast_show(r.data.autoSplit?`แบ่งเป็น ${r.data.slots.length} sessions อัตโนมัติ`:'เพิ่ม slot แล้ว');
      }
      setModal(null); load();
    }catch(e){toast_show(e.response?.data?.error||e.message,'err');}
  }
  async function deleteSlot(id){if(!confirm('ลบ slot?'))return;await API_del(`/slots/${id}`);toast_show('ลบแล้ว');setModal(null);load();}

  // ── streamer CRUD ──────────────────────────────────────────
  async function saveStreamer(){
    if(!form.name) return toast_show('ใส่ชื่อ','err');
    if(modal?.item){ await API_put(`/streamers/${modal.item.id}`, form); toast_show('แก้ไขนักไลฟ์แล้ว'); }
    else { await API_post('/streamers', form); toast_show('เพิ่มนักไลฟ์แล้ว'); }
    setModal(null); load();
  }
  async function deleteStreamer(id){
    if(!confirm('ลบนักไลฟ์คนนี้?')) return;
    await API_del(`/streamers/${id}`); toast_show('ลบแล้ว'); setModal(null); load();
  }

  // ── brand CRUD ────────────────────────────────────────────
  async function saveBrand(){
    if(!form.name) return toast_show('ใส่ชื่อแบรนด์','err');
    if(modal?.item){ await API_put(`/brands/${modal.item.id}`, form); toast_show('แก้ไขแบรนด์แล้ว'); }
    else { await API_post('/brands', form); toast_show('เพิ่มแบรนด์แล้ว'); }
    setModal(null); load();
  }
  async function deleteBrand(id){
    if(!confirm('ลบแบรนด์นี้?')) return;
    await API_del(`/brands/${id}`); toast_show('ลบแล้ว'); setModal(null); load();
  }

  // ── bulk add ──────────────────────────────────────────────
  function updateRow(i,k,v){setBulkRows(rows=>rows.map((r,j)=>j===i?{...r,[k]:v}:r));}
  async function submitBulk(){
    if(!bulkBrand) return toast_show('เลือกแบรนด์','err');
    const valid=bulkRows.filter(r=>r.date&&r.startTime&&r.endTime);
    if(!valid.length) return toast_show('ต้องมีอย่างน้อย 1 แถว','err');
    let total=0;
    for(const r of valid){try{const res=await API_post('/slots', {...r,brandId:bulkBrand,status:'pending'});total+=res.data.autoSplit?res.data.slots.length:1;}catch{}}
    toast_show(`เพิ่ม ${total} slot แล้ว`);setModal(null);setBulkRows([EMPTY_ROW()]);load();
  }

  // ── parse pasted TSV from Google Sheets ──────────────────
  const [pasteText, setPasteText] = useState('');

  function parsePaste(text) {
    const rows = text.split('\n').map(r => r.split('\t'));
    const slots = [];
    let colMap = null;

    for (const row of rows) {
      const lower = row.map(c => (c||'').toLowerCase().trim());

      // detect header row
      if (lower.includes('date') && lower.includes('start time') && lower.includes('end time')) {
        colMap = {
          date:     lower.findIndex(c => c === 'date'),
          start:    lower.findIndex(c => c === 'start time'),
          end:      lower.findIndex(c => c === 'end time'),
          platform: lower.findIndex(c => c.includes('platform')),
          streamer: lower.findIndex(c => c === 'คนไลฟ์' || c === 'host' || c === 'streamer'),
          liveType: lower.findIndex(c => c.includes('live type') || c === 'type'),
          notes:    lower.findIndex(c => c === 'remark' || c === 'หมายเหตุ'),
        };
        continue;
      }
      if (!colMap) continue;

      const rawDate = (row[colMap.date] || '').trim();
      const rawStart = (row[colMap.start] || '').trim();
      const rawEnd = (row[colMap.end] || '').trim();
      if (!rawDate || !rawStart || !rawEnd) continue;

      // parse date "Fri, Jun 5, 2026" or "2026-06-05"
      let dateStr = null;
      const d = new Date(rawDate);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
        dateStr = `${y}-${m}-${day}`;
      }
      if (!dateStr) continue;

      // normalize time "14:00", "14.00", "2:00 PM"
      function normTime(t) {
        const clean = t.replace('.', ':');
        const m = clean.match(/^(\d{1,2}):(\d{2})/);
        return m ? `${String(parseInt(m[1])).padStart(2,'0')}:${m[2]}` : null;
      }
      const startTime = normTime(rawStart);
      const endTime   = normTime(rawEnd);
      if (!startTime || !endTime) continue;

      const streamerName = colMap.streamer >= 0 ? (row[colMap.streamer]||'').trim() : '';
      const found = data.streamers.find(s => s.name.toLowerCase() === streamerName.toLowerCase());

      slots.push({
        date: dateStr, startTime, endTime,
        platform:    colMap.platform >= 0 ? (row[colMap.platform]||'').trim() : '',
        liveType:    colMap.liveType  >= 0 ? (row[colMap.liveType]||'').trim()  : '',
        notes:       colMap.notes     >= 0 ? (row[colMap.notes]||'').trim()     : '',
        streamerName,
        streamerId:  found?.id || null,
      });
    }
    return slots;
  }

  function runPasteParse() {
    if (!impBrand) return toast_show('เลือกแบรนด์ก่อน', 'err');
    if (!pasteText.trim()) return toast_show('วางข้อมูลจากชีทก่อน', 'err');
    const slots = parsePaste(pasteText);
    if (!slots.length) return toast_show('ไม่พบข้อมูล slot — ตรวจสอบว่า copy header row (Slot/Date/Start Time/End Time) มาด้วย', 'err');
    setImpPrev({ slots });
    setImpSel(new Set(slots.map((_,i)=>i)));
    const m = {};
    slots.forEach(s => { if (s.streamerId) m[s.streamerName] = s.streamerId; });
    setImpMap(m);
  }

  // ── import ────────────────────────────────────────────────
  async function runPreview(){
    if(!impBrand) return toast_show('เลือกแบรนด์','err');
    const link=impLink||bById[impBrand]?.sheetLink;
    if(!link) return toast_show('ใส่ link ชีท','err');
    setImpLoad(true);
    try{
      const r=await API_post('/import-preview', {sheetLink:link,brandId:impBrand});
      setImpPrev(r.data);setImpSel(new Set(r.data.slots.map((_,i)=>i)));
      const m={};r.data.slots.forEach(s=>{if(s.streamerId)m[s.streamerName]=s.streamerId;});setImpMap(m);
    }catch(e){
      const status = e.response?.status;
      if(status===401||status===403){ setImpNeedAuth(true); }
      else { toast_show(e.response?.data?.error||e.message,'err'); }
    }
    finally{setImpLoad(false);}
  }
  async function confirmImport(){
    const toSave=[...impSel].map(i=>{const s=impPrev.slots[i];return{...s,brandId:impBrand,streamerId:impMap[s.streamerName]||s.streamerId||null};});
    try{
      const r=await API_post('/import-confirm', {slots:toSave});
      toast_show(`Import ${r.data.saved} slot สำเร็จ`);setModal(null);setImpPrev(null);setImpSel(new Set());load();
    }catch(e){toast_show(e.response?.data?.error||e.message,'err');}
  }

  // ── brand status ──────────────────────────────────────────
  const yearMonth = `${year}-${String(month).padStart(2,'0')}`;
  function brandDone(brandId) { return data.brandStatus?.[`${brandId}_${yearMonth}`] === 'done'; }
  async function toggleBrandDone(brandId) {
    const newStatus = brandDone(brandId) ? 'pending' : 'done';
    await API_put('/brand-status', { brandId, yearMonth, status: newStatus });
    load();
  }

  // ── export ────────────────────────────────────────────────
  function fmtDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  }
  function calcHours(start, end) {
    const diff = timeToMinutes(end) - timeToMinutes(start);
    return diff > 0 ? (diff/60).toFixed(1) : '0';
  }
  function openExport(brand) {
    const slots = data.slots
      .filter(s => {
        if (s.brandId !== brand.id) return false;
        const d = new Date(s.date);
        return d.getFullYear() === year && d.getMonth()+1 === month;
      })
      .sort((a,b) => a.date !== b.date ? a.date.localeCompare(b.date) : timeToMinutes(a.startTime)-timeToMinutes(b.startTime));

    const header = ['Slot','Date','Start Time','End Time','Total Hours','Platform','Live Type','Admin','คนไลฟ์','Remark'];
    const rows = slots.map((s,i) => [
      i+1, fmtDate(s.date), s.startTime, s.endTime,
      calcHours(s.startTime, s.endTime),
      s.platform||'', s.liveType||'', '',
      s.streamerName || sById[s.streamerId]?.name || '',
      s.notes||''
    ]);
    const tsv = [header, ...rows].map(r => r.join('\t')).join('\n');
    setExportModal({ brand, slots, rows, header, tsv });
    setCopied(false);
  }
  async function copyTSV() {
    await navigator.clipboard.writeText(exportModal.tsv);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  function openSlot(s){setForm({...s});setModal({type:'slot',slot:s});}
  function openEmpty(dstr, startTime, endTime=''){setForm({date:dstr,startTime,endTime,status:'pending'});setModal({type:'slot'});}

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-white flex-shrink-0">
        {/* month nav */}
        <div className="flex items-center gap-1">
          <button onClick={()=>{if(month===1){setMonth(12);setYear(y=>y-1);}else setMonth(m=>m-1);setWeekOff(0);}}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 text-sm">◀</button>
          <span className="text-sm font-bold text-gray-800 w-20 text-center">{MONTH_TH[month]} {year}</span>
          <button onClick={()=>{if(month===12){setMonth(1);setYear(y=>y+1);}else setMonth(m=>m+1);setWeekOff(0);}}
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-500 text-sm">▶</button>
        </div>

        {/* view toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5 gap-0.5">
          {[['month','รายเดือน'],['week','รายสัปดาห์'],['studio','🎬 ห้อง Studio']].map(([v,l])=>(
            <button key={v} onClick={()=>setView(v)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${view===v?'bg-white text-accent shadow-sm':'text-gray-500 hover:text-gray-700'}`}>{l}</button>
          ))}
        </div>

        {view==='week'&&(
          <div className="flex items-center gap-1">
            <button disabled={weekOff===0} onClick={()=>setWeekOff(w=>w-1)} className="px-2 py-1 rounded hover:bg-gray-100 text-gray-400 text-xs disabled:opacity-30">◀</button>
            <span className="text-xs text-gray-400">สัปดาห์ {weekOff+1}/{weeks.length}</span>
            <button disabled={weekOff>=weeks.length-1} onClick={()=>setWeekOff(w=>w+1)} className="px-2 py-1 rounded hover:bg-gray-100 text-gray-400 text-xs disabled:opacity-30">▶</button>
          </div>
        )}

        <div className="flex-1"/>

        {view==='week'&&<>
          <select value={fS} onChange={e=>setFS(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5 text-gray-600 bg-white">
            <option value="all">นักไลฟ์ทุกคน</option>
            {data.streamers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={fB} onChange={e=>setFB(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5 text-gray-600 bg-white">
            <option value="all">ทุกแบรนด์</option>
            {data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </>}

        <Btn onClick={()=>{setForm({status:'pending'});setModal({type:'slot'});}} primary>+ Slot</Btn>
        <Btn onClick={()=>{setBulkBrand('');setBulkRows([EMPTY_ROW()]);setModal({type:'bulk'});}}>+ หลาย Slot</Btn>
        <Btn onClick={()=>{setImpBrand('');setImpLink('');setImpPrev(null);setModal({type:'import'});}}>↓ Import ชีท</Btn>
        <Btn onClick={()=>{setModal({type:'manage'});}}>⚙ จัดการ</Btn>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar ── */}
        <div className="w-52 flex-shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-3 bg-white">

          {/* Fifi */}
          {fifi&&(
            <div className="rounded-xl border border-border p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{backgroundColor:sById['fifi']?.color||'#f97316'}}/>
                <span className="text-xs font-bold text-gray-700">Fifi — {MONTH_TH[month]}</span>
              </div>
              <div className="text-[11px] text-gray-500 mb-1">{fifi.totalHours.toFixed(1)} / {fifi.limit} ชม.</div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden mb-1.5">
                <div className="h-full rounded-full transition-all" style={{width:`${fifiPct}%`,backgroundColor:fifiPct>90?'#ef4444':fifiPct>70?'#f59e0b':'#22c55e'}}/>
              </div>
              <div className="text-[11px] text-gray-400">เหลือ {(fifi.limit-fifi.totalHours).toFixed(1)} ชม.</div>
              {fifi.otDays.length>0&&(
                <div className="mt-2 pt-2 border-t border-border">
                  <div className="text-[10px] text-red-500 font-bold mb-1">OT ({fifi.otDays.length} วัน)</div>
                  {fifi.otDays.map(d=>(
                    <div key={d.date} className="text-[10px] text-gray-500">{d.date.slice(8)} — {d.hours.toFixed(1)} ชม. <span className="text-red-400">(+{d.ot.toFixed(1)})</span></div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Brand status */}
          <div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-1.5">สถานะแบรนด์ — {MONTH_TH[month]}</div>
            {data.brands.map(b => {
              const done = brandDone(b.id);
              const slotCount = data.slots.filter(s => {
                if (s.brandId !== b.id) return false;
                const d = new Date(s.date);
                return d.getFullYear()===year && d.getMonth()+1===month;
              }).length;
              return (
                <div key={b.id} className={`flex items-center gap-1.5 mb-1 px-2 py-1.5 rounded-lg border transition-all ${done?'bg-green-50 border-green-200':'border-border bg-white'}`}>
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{backgroundColor:b.color}}/>
                  <span className="text-[11px] text-gray-700 flex-1 truncate">{b.name}</span>
                  <span className="text-[10px] text-gray-400">{slotCount} slot</span>
                  <button onClick={()=>toggleBrandDone(b.id)} title={done?'ยกเลิกเสร็จ':'ทำเครื่องหมายเสร็จแล้ว'}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] flex-shrink-0 transition-all ${done?'bg-green-500 text-white':'border-2 border-gray-300 hover:border-green-400'}`}>
                    {done?'✓':''}
                  </button>
                  {slotCount>0&&<button onClick={()=>openExport(b)} title="Export ออก Sheets"
                    className="text-[10px] text-gray-400 hover:text-accent px-0.5">↗</button>}
                </div>
              );
            })}
            {data.brands.filter(b=>brandDone(b.id)).length===data.brands.length&&data.brands.length>0&&(
              <div className="mt-1.5 text-center text-[11px] text-green-600 font-semibold">🎉 จัดครบทุกแบรนด์แล้ว!</div>
            )}
          </div>

          {/* รอจัดคน */}
          {unassigned.length>0&&(
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-2">
              <div className="text-[11px] text-amber-600 font-bold mb-1.5">⚠ รอจัดคน ({unassigned.length})</div>
              {unassigned.slice(0,6).map(s=>(
                <button key={s.id} onClick={()=>openSlot(s)}
                  className="w-full text-left rounded-lg px-2 py-1 hover:bg-amber-100 transition-colors mb-0.5">
                  <div className="text-[11px] text-gray-700 font-medium truncate">{bById[s.brandId]?.name||s.brandId}</div>
                  <div className="text-[10px] text-gray-500">{s.date} · {s.startTime}–{s.endTime}</div>
                </button>
              ))}
              {unassigned.length>6&&<div className="text-[10px] text-gray-400 text-center">+{unassigned.length-6} เพิ่มเติม</div>}
            </div>
          )}

          {/* Conflicts */}
          {conflictSet.size>0&&(
            <div className="rounded-xl border border-red-200 bg-red-50 p-2">
              <div className="text-[11px] text-red-600 font-bold">⚠ ชนกัน {conflictSet.size} slot</div>
              <div className="text-[10px] text-gray-500 mt-0.5">ดูกรอบแดงในตาราง</div>
            </div>
          )}

          {/* Legend */}
          <div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-1.5">นักไลฟ์</div>
            {data.streamers.map(s=>(
              <div key={s.id} className="flex items-center gap-2 mb-1">
                <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{backgroundColor:s.color}}/>
                <span className="text-[11px] text-gray-700 truncate flex-1">{s.name}</span>
                <span className="text-[9px] text-gray-400">{s.type==='employee'?'ประจำ':s.type==='freelance-office'?'FL/ออฟ':s.type==='freelance-agency'?'Agency':'FL'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Calendar ── */}
        {loading?(
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">กำลังโหลด...</div>
        ):view==='month'?(
          <MonthGrid year={year} month={month} data={data} conflictSet={conflictSet} onSlot={openSlot} onEmpty={openEmpty} onHover={setHoverInfo}/>
        ):view==='studio'?(
          <StudioView year={year} month={month} data={data} onSlot={openSlot}/>
        ):(
          <WeekGrid week={curWeek} data={data} conflictSet={conflictSet} fStreamer={fS} fBrand={fB} onSlot={openSlot} onEmpty={openEmpty} onHover={setHoverInfo}/>
        )}
      </div>

      {/* ── Modal: Add/Edit Slot ── */}
      {modal?.type==='slot'&&(
        <Modal title={modal.slot?'แก้ไข Slot':'เพิ่ม Slot'} onClose={()=>setModal(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="แบรนด์">
              <select value={form.brandId||''} onChange={e=>setForm(f=>({...f,brandId:e.target.value}))} className="input w-full">
                <option value="">-- เลือกแบรนด์ --</option>
                {data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="นักไลฟ์">
              <select value={form.streamerId||''} onChange={e=>setForm(f=>({...f,streamerId:e.target.value}))} className="input w-full">
                <option value="">-- ยังไม่ระบุ --</option>
                {data.streamers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="วันที่">
              <input type="date" value={form.date||''} onChange={e=>setForm(f=>({...f,date:e.target.value}))} className="input w-full"/>
            </Field>
            <Field label="Platform">
              <select value={form.platform||''} onChange={e=>setForm(f=>({...f,platform:e.target.value}))} className="input w-full">
                <option value="">-</option>
                <option>Shopee</option><option>TikTok</option><option>Lazada</option><option>Facebook</option>
              </select>
            </Field>
            <Field label="เริ่ม"><input type="time" value={form.startTime||''} onChange={e=>setForm(f=>({...f,startTime:e.target.value}))} className="input w-full"/></Field>
            <Field label="สิ้นสุด"><input type="time" value={form.endTime||''} onChange={e=>setForm(f=>({...f,endTime:e.target.value}))} className="input w-full"/></Field>
            {modal.slot&&<Field label="Status">
              <select value={form.status||'pending'} onChange={e=>setForm(f=>({...f,status:e.target.value}))} className="input w-full">
                <option value="pending">รอยืนยัน</option>
                <option value="confirmed">ยืนยันแล้ว</option>
                <option value="approved">อนุมัติ</option>
              </select>
            </Field>}
            <Field label="สถานที่ไลฟ์" className="col-span-2">
              <div className="flex gap-2">
                <button type="button"
                  onClick={()=>setForm(f=>({...f,location:f.location?null:null}))}
                  className="sr-only">-</button>
                {[{val:'',label:'ไม่ระบุ'},{val:'studio1',label:'🎬 Studio 1'},{val:'studio2',label:'🎥 Studio 2'}].map(opt=>(
                  <button key={opt.val} type="button"
                    onClick={()=>setForm(f=>({...f,location:opt.val||null}))}
                    className={`flex-1 py-2 rounded-lg text-xs font-medium border transition-all ${
                      (form.location||'')===(opt.val)
                        ? 'bg-accent text-white border-accent'
                        : 'bg-white text-gray-600 border-border hover:border-accent'
                    }`}>
                    {opt.label}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="หมายเหตุ" className="col-span-2">
              <input type="text" value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="input w-full"/>
            </Field>
          </div>
          {form.startTime&&form.endTime&&(()=>{const dur=(timeToMinutes(form.endTime)-timeToMinutes(form.startTime))/60;if(dur>3)return <p className="mt-2 text-amber-500 text-xs">⚠ {dur} ชม. — จะแบ่ง session อัตโนมัติ</p>;})()}
          <div className="flex gap-2 mt-5 justify-end">
            {modal.slot&&<button onClick={()=>deleteSlot(modal.slot.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบ slot</button>}
            <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveSlot} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90">บันทึก</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Manage brands & streamers ── */}
      {modal?.type==='manage'&&(
        <Modal title="จัดการแบรนด์และนักไลฟ์" onClose={()=>setModal(null)} wide>
          <div className="grid grid-cols-2 gap-6">
            {/* Brands */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-700">แบรนด์</h3>
                <button onClick={()=>{setForm({});setModal({type:'brand'});}} className="text-xs text-accent font-semibold hover:opacity-70">+ เพิ่ม</button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {data.brands.map(b=>(
                  <div key={b.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-accent/30 bg-white transition-colors">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:b.color}}/>
                    <span className="text-sm text-gray-700 flex-1 truncate">{b.name}</span>
                    <button onClick={()=>{setForm({...b});setModal({type:'brand',item:b});}} className="text-[11px] text-gray-400 hover:text-accent px-1">แก้ไข</button>
                    <button onClick={()=>deleteBrand(b.id)} className="text-[11px] text-gray-400 hover:text-red-500 px-1">ลบ</button>
                  </div>
                ))}
              </div>
            </div>
            {/* Streamers */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-gray-700">นักไลฟ์</h3>
                <button onClick={()=>{const autoColor=pickUniqueColor(data.streamers.map(s=>s.color));setForm({color:autoColor});setModal({type:'streamer'});}} className="text-xs text-accent font-semibold hover:opacity-70">+ เพิ่ม</button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                {data.streamers.map(s=>(
                  <div key={s.id} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border hover:border-accent/30 bg-white transition-colors">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:s.color}}/>
                    <span className="text-sm text-gray-700 flex-1 truncate">{s.name}</span>
                    <span className="text-[10px] text-gray-400">{s.type==='employee'?'ประจำ':s.type==='freelance-office'?'FL/ออฟ':s.type==='freelance-agency'?'Agency':'FL'}</span>
                    <button onClick={()=>{setForm({...s});setModal({type:'streamer',item:s});}} className="text-[11px] text-gray-400 hover:text-accent px-1">แก้ไข</button>
                    <button onClick={()=>deleteStreamer(s.id)} className="text-[11px] text-gray-400 hover:text-red-500 px-1">ลบ</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ปิด</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Brand form ── */}
      {modal?.type==='brand'&&(
        <Modal title={modal.item?'แก้ไขแบรนด์':'เพิ่มแบรนด์'} onClose={()=>setModal({type:'manage'})}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชื่อแบรนด์" className="col-span-2"><input type="text" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="input w-full" placeholder="ชื่อแบรนด์"/></Field>
            <Field label="สีแบรนด์"><input type="color" value={form.color||'#6366f1'} onChange={e=>setForm(f=>({...f,color:e.target.value}))} className="h-9 w-full rounded-lg cursor-pointer border border-border"/></Field>
            <Field label="Google Sheet Link"><input type="text" value={form.sheetLink||''} onChange={e=>setForm(f=>({...f,sheetLink:e.target.value}))} className="input w-full" placeholder="https://..."/></Field>
          </div>
          <div className="flex gap-2 mt-4 justify-end">
            {modal.item&&<button onClick={()=>deleteBrand(modal.item.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบแบรนด์</button>}
            <button onClick={()=>setModal({type:'manage'})} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveBrand} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90">บันทึก</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Streamer form ── */}
      {modal?.type==='streamer'&&(
        <Modal title={modal.item?'แก้ไขนักไลฟ์':'เพิ่มนักไลฟ์'} onClose={()=>setModal({type:'manage'})}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="ชื่อ" className="col-span-2"><input type="text" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="input w-full" placeholder="ชื่อนักไลฟ์"/></Field>
            <Field label="ประเภท">
              <select value={form.type||'freelance-remote'} onChange={e=>setForm(f=>({...f,type:e.target.value}))} className="input w-full">
                <option value="employee">พนักงานประจำ</option>
                <option value="freelance-office">Freelance (มาออฟฟิศ)</option>
                <option value="freelance-remote">Freelance (Remote)</option>
                <option value="freelance-agency">Freelance (Agency)</option>
              </select>
            </Field>
            <Field label="สีประจำตัว"><input type="color" value={form.color||'#888888'} onChange={e=>setForm(f=>({...f,color:e.target.value}))} className="h-9 w-full rounded-lg cursor-pointer border border-border"/></Field>
            {form.type==='freelance-agency'&&<Field label="Agency Admin" className="col-span-2"><input type="text" value={form.agencyAdmin||''} onChange={e=>setForm(f=>({...f,agencyAdmin:e.target.value}))} className="input w-full"/></Field>}
          </div>
          <div className="flex gap-2 mt-4 justify-end">
            {modal.item&&<button onClick={()=>deleteStreamer(modal.item.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบนักไลฟ์</button>}
            <button onClick={()=>setModal({type:'manage'})} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveStreamer} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90">บันทึก</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Bulk Add ── */}
      {modal?.type==='bulk'&&(
        <Modal title="เพิ่มหลาย Slot" onClose={()=>setModal(null)} wide>
          <Field label="แบรนด์ (ใช้กับทุกแถว)" className="mb-3">
            <select value={bulkBrand} onChange={e=>setBulkBrand(e.target.value)} className="input w-full">
              <option value="">-- เลือกแบรนด์ --</option>
              {data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 border-b border-border text-left">
                <th className="pb-2 pr-2">วันที่</th><th className="pb-2 pr-2">เริ่ม</th><th className="pb-2 pr-2">สิ้นสุด</th>
                <th className="pb-2 pr-2">นักไลฟ์</th><th className="pb-2 pr-2">Platform</th><th className="pb-2 pr-2">Live Type</th><th className="pb-2">หมายเหตุ</th><th></th>
              </tr></thead>
              <tbody>
                {bulkRows.map((row,i)=>(
                  <tr key={i} className="border-b border-border/50">
                    <td className="py-1 pr-1"><input type="date" value={row.date} onChange={e=>updateRow(i,'date',e.target.value)} className="input w-32"/></td>
                    <td className="py-1 pr-1"><input type="time" value={row.startTime} onChange={e=>updateRow(i,'startTime',e.target.value)} className="input w-24"/></td>
                    <td className="py-1 pr-1"><input type="time" value={row.endTime} onChange={e=>updateRow(i,'endTime',e.target.value)} className="input w-24"/></td>
                    <td className="py-1 pr-1"><select value={row.streamerId} onChange={e=>updateRow(i,'streamerId',e.target.value)} className="input w-28"><option value="">-</option>{data.streamers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
                    <td className="py-1 pr-1"><select value={row.platform} onChange={e=>updateRow(i,'platform',e.target.value)} className="input w-24"><option value="">-</option><option>Shopee</option><option>TikTok</option><option>Lazada</option><option>Facebook</option></select></td>
                    <td className="py-1 pr-1"><select value={row.liveType} onChange={e=>updateRow(i,'liveType',e.target.value)} className="input w-24"><option value="">-</option><option>Normal</option><option>D-DAY</option><option>Mid Month</option><option>PAYDAY</option></select></td>
                    <td className="py-1 pr-1"><input type="text" value={row.notes} onChange={e=>updateRow(i,'notes',e.target.value)} className="input w-28"/></td>
                    <td className="py-1 pl-1"><button onClick={()=>setBulkRows(rows=>rows.filter((_,j)=>j!==i))} className="text-gray-300 hover:text-red-400 text-sm">✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex justify-between mt-3">
            <button onClick={()=>setBulkRows(r=>[...r,EMPTY_ROW()])} className="px-3 py-2 rounded-lg text-xs text-gray-500 border border-border hover:border-accent hover:text-accent transition-colors">+ เพิ่มแถว</button>
            <div className="flex gap-2">
              <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
              <button onClick={submitBulk} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90">บันทึกทั้งหมด</button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Modal: Import ── */}
      {modal?.type==='import'&&(
        <Modal title="Import จาก Google Sheet" onClose={()=>{setModal(null);setImpPrev(null);setPasteText('');}} wide>
          {!impPrev?(
            <>
              {/* Steps */}
              <div className="flex gap-3 mb-4">
                {['1. เปิดชีทแบรนด์', '2. เลือกแถวทั้งหมด (Ctrl+A)', '3. Copy (Ctrl+C)', '4. Paste ที่นี่'].map((s,i)=>(
                  <div key={i} className="flex-1 text-center">
                    <div className="w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center mx-auto mb-1">{i+1}</div>
                    <div className="text-[11px] text-gray-500">{s.slice(3)}</div>
                  </div>
                ))}
              </div>

              <Field label="แบรนด์" className="mb-3">
                <select value={impBrand} onChange={e=>setImpBrand(e.target.value)} className="input w-full">
                  <option value="">-- เลือกแบรนด์ที่จะ import --</option>
                  {data.brands.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>

              <Field label="วางข้อมูลจาก Google Sheet (Ctrl+V)">
                <textarea
                  value={pasteText}
                  onChange={e=>setPasteText(e.target.value)}
                  onPaste={e=>{
                    // auto-parse on paste
                    setTimeout(()=>{}, 50);
                  }}
                  placeholder={'วางข้อมูลจาก Google Sheet ที่นี่\n\nวิธี: เปิดชีท → เลือกทุก row (รวม header Slot/Date/Start Time/End Time) → Ctrl+C → คลิกที่นี่ → Ctrl+V'}
                  className="input w-full font-mono text-[11px] leading-relaxed"
                  style={{minHeight: 140, resize: 'vertical'}}
                />
              </Field>

              {pasteText && (
                <p className="text-xs text-gray-400 mt-1">{pasteText.trim().split('\n').length} แถว</p>
              )}

              <div className="flex gap-2 mt-4 justify-end">
                <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
                <button onClick={runPasteParse} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90">
                  อ่านข้อมูล →
                </button>
              </div>
            </>
          ):(
            <div className="flex flex-col" style={{maxHeight:'70vh'}}>
              {/* Header — fixed */}
              <div className="flex items-center justify-between mb-2 flex-shrink-0">
                <span className="text-sm text-gray-700 font-semibold">พบ <span className="text-accent">{impPrev.slots.length}</span> slot</span>
                <div className="flex gap-3">
                  <button onClick={()=>setImpSel(new Set(impPrev.slots.map((_,i)=>i)))} className="text-xs text-accent font-semibold">เลือกทั้งหมด</button>
                  <button onClick={()=>setImpSel(new Set())} className="text-xs text-gray-400">ล้างทั้งหมด</button>
                </div>
              </div>

              {/* Streamer map — fixed */}
              {(()=>{
                const unm=[...new Set(impPrev.slots.filter(s=>!s.streamerId).map(s=>s.streamerName))].filter(Boolean);
                if(!unm.length) return null;
                return(
                  <div className="mb-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs flex-shrink-0">
                    <p className="text-amber-600 font-bold mb-1.5">จับคู่นักไลฟ์</p>
                    {unm.map(name=>(
                      <div key={name} className="flex items-center gap-2 mb-1">
                        <span className="text-gray-600 w-20 truncate font-medium">"{name}"</span>
                        <span className="text-gray-400">→</span>
                        <select value={impMap[name]||''} onChange={e=>setImpMap(m=>({...m,[name]:e.target.value}))} className="input flex-1">
                          <option value="">ข้ามไป</option>
                          {data.streamers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Slot list — scrollable */}
              <div className="overflow-auto flex-1 border border-border rounded-xl min-h-0">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 z-10">
                    <tr className="text-gray-400 border-b border-border">
                      <th className="p-2 w-8">
                        <input type="checkbox"
                          checked={impSel.size===impPrev.slots.length}
                          onChange={e=>setImpSel(e.target.checked ? new Set(impPrev.slots.map((_,i)=>i)) : new Set())}
                          className="accent-accent"/>
                      </th>
                      <th className="p-2 text-left">วันที่</th>
                      <th className="p-2 text-left">เวลา</th>
                      <th className="p-2 text-left">Type</th>
                      <th className="p-2 text-left">นักไลฟ์</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impPrev.slots.map((s,i)=>(
                      <tr key={i}
                        className={`border-b border-border/40 cursor-pointer transition-colors ${impSel.has(i)?'bg-orange-50':'hover:bg-gray-50 opacity-50'}`}
                        onClick={()=>setImpSel(sel=>{const n=new Set(sel);n.has(i)?n.delete(i):n.add(i);return n;})}>
                        <td className="p-2 text-center"><input type="checkbox" readOnly checked={impSel.has(i)} className="accent-accent"/></td>
                        <td className="p-2 text-gray-700 whitespace-nowrap">{s.date}</td>
                        <td className="p-2 text-gray-700 whitespace-nowrap font-medium">{s.startTime}–{s.endTime}</td>
                        <td className="p-2 text-gray-500">{s.liveType||s.platform||'-'}</td>
                        <td className="p-2">{s.streamerId?<span className="text-green-600 font-medium">{sById[s.streamerId]?.name||s.streamerName}</span>:<span className="text-amber-500">{s.streamerName||'-'}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Actions — fixed at bottom */}
              <div className="flex justify-between mt-3 items-center flex-shrink-0 pt-3 border-t border-border">
                <button onClick={()=>setImpPrev(null)} className="text-xs text-gray-400 hover:text-gray-600">← กลับแก้ไข</button>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500">เลือก <b>{impSel.size}</b> / {impPrev.slots.length} slot</span>
                  <button onClick={confirmImport} disabled={impSel.size===0}
                    className="px-5 py-2 rounded-lg bg-accent text-white text-sm font-bold hover:opacity-90 disabled:opacity-40 shadow-sm">
                    Import {impSel.size} slot →
                  </button>
                </div>
              </div>
            </div>
          )}
        </Modal>
      )}

      {/* ── Modal: Export ── */}
      {exportModal&&(
        <Modal title={`Export — ${exportModal.brand.name} ${MONTH_TH[month]} ${year}`} onClose={()=>setExportModal(null)} wide>
          {exportModal.slots.length===0?(
            <div className="text-center py-8 text-gray-400">ไม่มี slot ในเดือนนี้</div>
          ):(
            <>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-gray-600">{exportModal.slots.length} slot · พร้อม paste ลง Google Sheets ได้เลย</p>
                <button onClick={copyTSV}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${copied?'bg-green-500 text-white':'bg-accent text-white hover:opacity-90'}`}>
                  {copied?'✓ Copied!':'Copy ทั้งหมด'}
                </button>
              </div>

              {/* Instructions */}
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700 flex gap-2">
                <span className="flex-shrink-0 text-blue-500">💡</span>
                <span>กด <b>Copy ทั้งหมด</b> → เปิด Google Sheets → คลิกช่อง A1 → <b>Ctrl+V</b> (หรือ Cmd+V บน Mac) → ข้อมูลจะลงครบทุกช่องอัตโนมัติ</span>
              </div>

              {/* Preview table */}
              <div className="overflow-auto max-h-72 border border-border rounded-xl">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-border">
                    <tr>
                      {exportModal.header.map(h=>(
                        <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {exportModal.rows.map((row,i)=>(
                      <tr key={i} className="border-b border-border/50 hover:bg-gray-50">
                        {row.map((cell,j)=>(
                          <td key={j} className="px-3 py-2 text-gray-700 whitespace-nowrap">{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-between mt-4 items-center">
                <button onClick={()=>toggleBrandDone(exportModal.brand.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${brandDone(exportModal.brand.id)?'bg-green-100 text-green-700 border border-green-300':'border border-border text-gray-600 hover:border-green-400 hover:text-green-600'}`}>
                  <span>{brandDone(exportModal.brand.id)?'✓ เสร็จแล้ว':'ทำเครื่องหมายว่าเสร็จแล้ว'}</span>
                </button>
                <button onClick={()=>setExportModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ปิด</button>
              </div>
            </>
          )}
        </Modal>
      )}

      <CellTooltip info={hoverInfo}/>

      {/* Toast */}
      {toast&&(
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-xl text-sm shadow-lg font-medium ${toast.type==='err'?'bg-red-500 text-white':'bg-gray-900 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────
function Btn({onClick,children,primary}){
  return(
    <button onClick={onClick} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${primary?'bg-accent text-white hover:opacity-90 shadow-sm':'bg-white border border-border text-gray-600 hover:border-accent hover:text-accent'}`}>
      {children}
    </button>
  );
}

function Modal({title,onClose,children,wide}){
  return(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl mx-4 p-6 ${wide?'w-full max-w-3xl':'w-full max-w-md'}`} onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-bold text-gray-800 text-base">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-gray-100 text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({label,children,className=''}){
  return(
    <div className={className}>
      <label className="block text-[11px] text-gray-400 font-semibold mb-1 uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import axios from 'axios';

// ใช้ relative URL → ผ่าน Vite proxy → session cookie ถูกส่งถูกต้อง
const http = axios.create({ baseURL: '/api/schedule' });
http.interceptors.request.use(cfg => {
  const t = localStorage.getItem('peepz_token') || '';
  if (t) cfg.headers['Authorization'] = `Bearer ${t}`;
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

const DAY_LABELS = ['อา','จ','อ','พ','พฤ','ศ','ส'];
const DAY_LABELS_FULL = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];

// ─── Availability helpers ─────────────────────────────────────
// คืน list ของ streamer พร้อม avail status: 'free'|'busy'|'off'|'unknown'
function getAvailableStreamers(data, date, startTime, endTime, excludeSlotId = null) {
  if (!date || !startTime || !endTime) return [];
  const dow = new Date(date + 'T00:00:00').getDay(); // 0=Sun
  const sStart = timeToMinutes(startTime);
  const sEnd   = timeToMinutes(endTime);

  return (data.streamers || []).map(streamer => {
    // 1. เช็ค conflict กับ slot ที่มีอยู่ (same brand = ไม่ busy เพราะ multi-platform)
    const busy = (data.slots || []).some(s => {
      if (s.streamerId !== streamer.id) return false;
      if (s.date !== date) return false;
      if (s.id === excludeSlotId) return false;
      // same brand = OK (streaming same brand on multiple platforms simultaneously)
      // *** brandId ของ slot ที่กำลังเพิ่ม/แก้ต้องส่งมาด้วยถ้าจะใช้ feature นี้ ***
      // ตอนนี้ไม่มีข้อมูล brandId ของ slot ใหม่ใน scope นี้ → ยังเช็คแบบเดิม
      const sE = timeToMinutes(s.endTime);
      const sS2 = timeToMinutes(s.startTime);
      const adjEnd = sE <= sS2 ? sE + 1440 : sE; // overnight fix
      const adjNew = sEnd <= sStart ? sEnd + 1440 : sEnd;
      return !(adjEnd <= sStart || sS2 >= adjNew);
    });
    if (busy) return { ...streamer, avail: 'busy' };

    // 2. เช็ค availability schedule
    const avails = (data.availability || []).filter(a => a.streamerId === streamer.id);
    if (avails.length === 0) return { ...streamer, avail: 'unknown' };

    const covered = avails.some(a => {
      const timeOk = timeToMinutes(a.startTime) <= sStart && timeToMinutes(a.endTime) >= sEnd;
      if (a.type === 'dates') return (a.dates||[]).includes(date) && timeOk;
      return (a.days||[]).includes(dow) && timeOk; // weekly
    });
    return { ...streamer, avail: covered ? 'free' : 'off' };
  });
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

// เรียงไทยก่อน อังกฤษทีหลัง
function thSort(a, b) {
  const isTh = s => /^[ก-๙]/.test(s);
  if (isTh(a) && !isTh(b)) return -1;
  if (!isTh(a) && isTh(b)) return 1;
  return a.localeCompare(b, 'th');
}
function sortByName(arr) { return [...arr].sort((a,b) => thSort(a.name||'', b.name||'')); }

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
// platform → short emoji label
const PLAT_ICON = { Shopee:'🟠', TikTok:'🎵', Lazada:'🔵', Facebook:'📘' };
// status → dot color
const STATUS_DOT = { pending:'#f59e0b', confirmed:'#3b82f6', approved:'#22c55e' };

function CellBlock({ slot: s, pos, sById, bById, conflictSet, onSlot, onHover, selectMode, selected, toggleSelect }) {
  const streamer = sById[s.streamerId], brand = bById[s.brandId];
  const noStreamer = !s.streamerId && !s.streamerName;
  const isConflict = conflictSet.has(s.id);
  const color = brand?.color || streamer?.color || '#9ca3af';
  const isStart = pos === 'start' || pos === 'single';
  const isEnd   = pos === 'end'   || pos === 'single';
  const isSingle = pos === 'single';
  const dotColor = STATUS_DOT[s.status] || STATUS_DOT.pending;
  const isSelected = selectMode && selected?.has(s.id);

  // hex → rgb helper for gradient
  const hex2rgb = (hex) => {
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return `${r},${g},${b}`;
  };
  const rgb = hex2rgb(color.length===7 ? color : '#9ca3af');

  return (
    <div onClick={e=>{e.stopPropagation(); selectMode ? toggleSelect(s.id) : onSlot(s);}}
      onMouseEnter={e=>{e.stopPropagation();onHover&&onHover({x:e.clientX,y:e.clientY,slot:s,brand,streamer});}}
      onMouseLeave={e=>{e.stopPropagation();onHover&&onHover(null);}}
      className={`relative w-full h-full cursor-pointer overflow-hidden transition-all group
        ${isConflict&&!isSelected?'outline outline-1 outline-red-400 outline-offset-[-1px]':''}
        ${isSelected?'outline outline-2 outline-accent outline-offset-[-2px]':''}`}
      style={{
        background: isSelected
          ? `rgba(${rgb},0.35)`
          : isStart
            ? `linear-gradient(135deg, rgba(${rgb},0.18) 0%, rgba(${rgb},0.10) 100%)`
            : `rgba(${rgb},0.08)`,
        borderLeft: `3px solid ${isSelected?color:color}`,
        borderTop:    isStart ? `1.5px solid rgba(${rgb},0.35)` : 'none',
        borderBottom: isEnd   ? `1.5px solid rgba(${rgb},0.20)` : 'none',
        borderRight:  '1.5px solid transparent',
        borderRadius: isSingle ? '7px' : isStart ? '7px 7px 0 0' : isEnd ? '0 0 7px 7px' : '0',
        paddingLeft: 5, paddingRight: 3,
        boxShadow: isStart ? `inset 0 1px 0 rgba(255,255,255,0.6)` : 'none',
      }}>
      {isStart && (
        <div className="flex flex-col h-full justify-start pt-[3px] gap-[1px]">
          {/* Brand name + status dot */}
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-bold truncate text-[10px] leading-tight flex-1" style={{color}}>{brand?.name||s.brandId}</span>
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{backgroundColor:dotColor}}/>
          </div>
          {/* Streamer */}
          {noStreamer
            ? <div className="text-[9px] leading-tight font-medium" style={{color:'#f59e0b'}}>⚠ รอจัดคน</div>
            : <div className="text-[9px] leading-tight truncate" style={{color:`rgba(${rgb},1)`, opacity:0.75}}>{s.streamerName||streamer?.name}</div>}
          {/* start time + platform (bottom of start cell) */}
          <div className="flex items-center gap-1 mt-auto pb-[2px]">
            <span className="text-[8px] font-mono leading-none" style={{color:`rgba(${rgb},0.85)`}}>{s.startTime}</span>
            {s.platform&&PLAT_ICON[s.platform]&&<span className="text-[8px] leading-none">{PLAT_ICON[s.platform]}</span>}
            {(s.location==='studio1'||s.location==='studio2')&&(
              <span className="text-[7px] leading-none px-1 rounded-full font-semibold"
                style={{backgroundColor:s.location==='studio1'?'#ede9fe':'#dbeafe', color:s.location==='studio1'?'#7c3aed':'#1d4ed8'}}>
                {s.location==='studio1'?'S1':'S2'}
              </span>
            )}
          </div>
        </div>
      )}
      {/* select checkmark */}
      {selectMode && isStart && (
        <div className={`absolute top-[3px] right-[3px] w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold border transition-all ${
          isSelected ? 'bg-accent border-accent text-white' : 'bg-white/80 border-gray-300 text-transparent'
        }`}>✓</div>
      )}
      {/* end time — absolute inside relative wrapper, clipped by overflow-hidden */}
      {isEnd && !isStart && (
        <div className="absolute bottom-[3px] left-[5px] text-[8px] font-mono leading-none"
          style={{color:`rgba(${rgb},0.8)`}}>
          {s.endTime}
        </div>
      )}
    </div>
  );
}

// ─── build cell maps — each hour cell knows which slots cover it
function buildCellMap(slots, dates, filterFn) {
  // cellMap[date_hIdx] = [{ slot, position: 'start'|'mid'|'end'|'single' }]
  const cellMap = {};
  const relevant = filterFn ? slots.filter(filterFn) : slots;

  function addCells(date, fromIdx, toIdx, slotObj, posStart, posEnd, totalOffset) {
    // adds cells for date from fromIdx (inclusive) to toIdx (exclusive)
    for (let i = fromIdx; i < toIdx; i++) {
      const key = `${date}_${i}`;
      if (!cellMap[key]) cellMap[key] = [];
      const cellNum = totalOffset + (i - fromIdx);
      let pos = 'mid';
      if (posStart && cellNum === 0 && posEnd) pos = 'single';
      else if (posStart && cellNum === 0) pos = 'start';
      else if (posEnd && i === toIdx - 1) pos = 'end';
      cellMap[key].push({ slot: slotObj, pos });
    }
  }

  for (const s of relevant) {
    const dateIdx = dates.indexOf(s.date);
    if (dateIdx === -1) continue;
    const si = HOURS.indexOf(s.startTime);
    if (si === -1) continue;
    let ei = HOURS.indexOf(s.endTime);
    if (ei === -1) ei = HOURS.length; // unknown end → go to end of day

    const crossesMidnight = ei < si; // endTime is earlier than startTime in HOURS
    const endsMidnight    = ei === 0;  // ends exactly at 00:00

    if (crossesMidnight || endsMidnight) {
      // Part 1: current date from si → end of day (HOURS.length)
      const part1Len = HOURS.length - si;
      const part2Len = ei; // cells on next day (0 if ends at 00:00)
      const hasNextDay = part2Len > 0 && dateIdx + 1 < dates.length;

      addCells(s.date, si, HOURS.length, s, true, !hasNextDay, 0);

      // Part 2: next date from 0 → ei
      if (hasNextDay) {
        addCells(dates[dateIdx + 1], 0, ei, s, false, true, part1Len);
      }
    } else {
      // Normal same-day slot
      const span = Math.max(ei - si, 1);
      addCells(s.date, si, si + span, s, true, true, 0);
    }
  }
  return cellMap;
}

// ─── Studio View ─────────────────────────────────────────────
// Hours shown in studio grid (07:00 → 02:00 next day)
const STUDIO_HOURS = [
  '07:00','08:00','09:00','10:00','11:00','12:00',
  '13:00','14:00','15:00','16:00','17:00','18:00',
  '19:00','20:00','21:00','22:00','23:00','00:00','01:00','02:00'
];
const COL_W  = 46;  // px per day column
const ROW_H  = 26;  // px per hour row
const TIME_W = 46;  // px for time label column

function StudioView({ year, month, data, onSlot, onEmpty }) {
  const today  = ds(new Date());
  const days   = getDaysInMonth(year, month);
  const dayStrs = React.useMemo(() => days.map(ds), [year, month]);

  const sById = React.useMemo(() => Object.fromEntries((data.streamers||[]).map(s=>[s.id,s])), [data.streamers]);
  const bById = React.useMemo(() => Object.fromEntries((data.brands||[]).map(b=>[b.id,b])), [data.brands]);

  // Build occupancy map: `${roomId}_${date}_${hour}` → slot
  const cellMap = React.useMemo(() => {
    const map = {};
    const studioSlots = (data.slots||[]).filter(s => s.location === 'studio1' || s.location === 'studio2');
    const addRange = (roomId, date, fromHIdx, toHIdx, slot) => {
      for (let h = fromHIdx; h < toHIdx; h++) {
        const key = `${roomId}_${date}_${HOURS[h]}`;
        if (!map[key]) map[key] = slot;
      }
    };
    for (const s of studioSlots) {
      const si = HOURS.indexOf(s.startTime);
      if (si === -1) continue;
      let ei = HOURS.indexOf(s.endTime);
      if (ei === -1) ei = HOURS.length;
      if (ei < si) { // crosses midnight
        addRange(s.location, s.date, si, HOURS.length, s);
        const dIdx = dayStrs.indexOf(s.date);
        if (dIdx >= 0 && dIdx + 1 < dayStrs.length) addRange(s.location, dayStrs[dIdx+1], 0, ei, s);
      } else {
        addRange(s.location, s.date, si, ei, s);
      }
    }
    return map;
  }, [data.slots, dayStrs]);

  function RoomGrid({ roomId, roomLabel, roomColor }) {
    // Count slots this month for this room
    const count = (data.slots||[]).filter(s=>s.location===roomId && dayStrs.includes(s.date)).length;
    return (
      <div>
        {/* Room section header */}
        <div className="flex items-center gap-2 border-y border-border"
          style={{borderLeft:`3px solid ${roomColor}`, paddingLeft:8, paddingTop:4, paddingBottom:4, backgroundColor: roomColor+'10'}}>
          <span className="text-xs font-bold" style={{color:roomColor}}>{roomLabel}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{backgroundColor:roomColor+'20',color:roomColor}}>{count} slot</span>
        </div>
        {/* Hour rows */}
        {STUDIO_HOURS.map((hour, hIdx) => {
          const isNight = ['00:00','01:00','02:00'].includes(hour);
          return (
            <div key={hour} className="flex"
              style={{height:ROW_H, borderBottom:`1px solid ${isNight?'#e2dcd5':'#ece7e1'}`}}>
              {/* Time label — sticky left */}
              <div className="flex-shrink-0 flex items-center justify-end pr-1.5 border-r border-gray-200 sticky left-0 z-10"
                style={{width:TIME_W, backgroundColor:isNight?'#f5f3f0':'#f8f7f5', fontSize:9, color:'#9ca3af', fontFamily:'monospace'}}>
                {hour}
              </div>
              {/* Day cells */}
              {dayStrs.map(d => {
                const key = `${roomId}_${d}_${hour}`;
                const slot = cellMap[key];
                const streamer = slot ? sById[slot.streamerId] : null;
                const sColor   = streamer?.color || '#9ca3af';
                const name     = slot ? (slot.streamerName || streamer?.name || '?') : null;
                const shortName = name ? name.split(' ')[0] : null;

                // Show label only at first visible row of this slot
                const prevHour = hIdx > 0 ? STUDIO_HOURS[hIdx-1] : null;
                const prevKey  = prevHour ? `${roomId}_${d}_${prevHour}` : null;
                const prevSlot = prevKey ? cellMap[prevKey] : null;
                const isFirst  = slot && (!prevSlot || prevSlot.id !== slot.id);

                const isToday  = d === today;
                const dotColor = STATUS_DOT[slot?.status] || STATUS_DOT.pending;

                return (
                  <div key={d}
                    title={slot ? `${name} | ${slot.platform||''} | ${slot.startTime}–${slot.endTime}` : `คลิกเพิ่ม slot ${d} ${hour}`}
                    className="flex-shrink-0 border-r border-gray-100 cursor-pointer hover:brightness-[0.93] transition-all relative overflow-hidden"
                    style={{
                      width: COL_W,
                      backgroundColor: slot ? sColor+'2e' : isToday ? '#fff8f5' : undefined,
                    }}
                    onClick={() => slot ? onSlot(slot) : onEmpty && onEmpty(d, hour, STUDIO_HOURS[hIdx+1]||'02:00', roomId)}>
                    {slot && isFirst && (
                      <div className="absolute inset-x-0 top-0 flex flex-col px-0.5 pt-0.5 overflow-hidden"
                        style={{borderTop:`2px solid ${sColor}`}}>
                        <span className="text-[8px] font-bold leading-tight truncate" style={{color:sColor}}>{shortName}</span>
                        {slot.platform&&<span className="text-[7px] leading-none truncate opacity-75" style={{color:sColor}}>{slot.platform}</span>}
                      </div>
                    )}
                    {/* Status dot on last row */}
                    {slot && (() => {
                      const nextHour = STUDIO_HOURS[hIdx+1];
                      const nextKey  = nextHour ? `${roomId}_${d}_${nextHour}` : null;
                      const nextSlot = nextKey ? cellMap[nextKey] : null;
                      const isLast   = !nextSlot || nextSlot.id !== slot.id;
                      return isLast ? (
                        <div className="absolute bottom-[2px] right-[2px] w-1.5 h-1.5 rounded-full"
                          style={{backgroundColor:dotColor}}/>
                      ) : null;
                    })()}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg">
      <div className="flex-1 overflow-auto">
        {/* Sticky column+day header */}
        <div className="flex sticky top-0 z-30 border-b-2 border-border bg-white shadow-sm">
          {/* Corner */}
          <div className="flex-shrink-0 sticky left-0 z-40 bg-white border-r border-gray-200 flex items-end justify-center pb-1"
            style={{width:TIME_W}}>
            <span className="text-[9px] text-gray-300 font-bold">HR</span>
          </div>
          {/* Day columns */}
          {dayStrs.map(d => {
            const dt   = new Date(d+'T00:00:00');
            const dd   = dt.getDate();
            const dow  = DAY_LABELS[dt.getDay()];
            const isSun = dt.getDay()===0, isSat = dt.getDay()===6;
            const isToday = d===today;
            // count studio slots this day
            const dayCnt = (data.slots||[]).filter(s=>s.date===d&&(s.location==='studio1'||s.location==='studio2')).length;
            return (
              <div key={d} className="flex-shrink-0 flex flex-col items-center justify-end pb-0.5 border-r border-gray-100"
                style={{width:COL_W, backgroundColor: isToday?'#fff3ee': undefined}}>
                <span className="text-[8px] leading-none" style={{color:isSun?'#ef4444':isSat?'#3b82f6':'#c4bdb6'}}>{dow}</span>
                <span className="text-[11px] font-bold leading-tight" style={{color:isToday?'#ff6b35':isSun?'#ef4444':isSat?'#3b82f6':'#1a1a1a'}}>{dd}</span>
                {dayCnt>0&&<span className="text-[7px] leading-none text-gray-300">{dayCnt}</span>}
              </div>
            );
          })}
        </div>

        {/* S Room */}
        <RoomGrid roomId="studio1" roomLabel="🎬 S Room" roomColor="#7c3aed"/>
        {/* spacer */}
        <div style={{height:6, backgroundColor:'#f0ede9'}}/>
        {/* M Room */}
        <RoomGrid roomId="studio2" roomLabel="🎥 M Room" roomColor="#1d4ed8"/>
      </div>
    </div>
  );
}

// ─── Month Grid ───────────────────────────────────────────────
function MonthGrid({ year, month, data, conflictSet, onSlot, onEmpty, onHover, fBrands, selectMode, selected, toggleSelect }) {
  const days = getDaysInMonth(year, month);
  const today = ds(new Date());
  const sById = Object.fromEntries(data.streamers.map(s=>[s.id,s]));
  const bById = Object.fromEntries(data.brands.map(b=>[b.id,b]));
  const dateStrs = days.map(d => ds(d));
  const cellMap = buildCellMap(data.slots, dateStrs,
    fBrands?.size > 0 ? s => fBrands.has(s.brandId) : null
  );

  const onEmptyWithEnd = useCallback((date, startTime, endTime) => onEmpty(date, startTime, endTime), [onEmpty]);
  const { cellDown, cellEnter, isSelected, dragging } = useDrag(onEmptyWithEnd);

  return (
    <div className="overflow-auto flex-1" style={{cursor: dragging?'ns-resize':'default'}}>
      <table className="text-[10px] border-collapse select-none" style={{minWidth:`${days.length*72+52}px`}}>
        <thead className="sticky top-0 z-20 bg-white" style={{boxShadow:'0 1px 0 #e2dcd5, 0 2px 8px rgba(0,0,0,0.04)'}}>
          <tr>
            <th className="sticky left-0 z-30 bg-white w-12 border-r border-border text-[9px] text-gray-300 font-medium px-1 py-2 text-right">เวลา</th>
            {days.map(d=>{
              const dstr=ds(d), isT=dstr===today;
              return (
                <th key={dstr} style={{minWidth:72}} className={`border-r border-border px-1 py-2 text-center ${isT?'bg-orange-50':''}`}>
                  <div className={`text-[9px] mb-1 ${isT?'text-accent font-semibold':'text-gray-400'}`}>{DAY_TH[d.getDay()]}</div>
                  <div className={`inline-flex items-center justify-center w-6 h-6 text-xs font-bold rounded-full leading-none ${isT?'bg-accent text-white':'text-gray-700'}`}>{d.getDate()}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour, hIdx)=>(
            <tr key={hour} style={{height:36}}>
              <td className="sticky left-0 z-10 bg-white px-2 text-[9px] font-medium text-gray-300 text-right border-r border-b border-border w-12 align-top pt-[3px]">{hour}</td>
              {days.map(d=>{
                const dstr=ds(d), isT=dstr===today;
                const key=`${dstr}_${hIdx}`;
                const entries=cellMap[key]||[];
                const hasSlot=entries.length>0;
                const selected=isSelected(dstr,hIdx);
                return (
                  <td key={dstr}
                    className={`border-r p-0 relative transition-colors
                      ${selected?'bg-accent/15':isT&&!hasSlot?'bg-orange-50/40':!hasSlot?'hover:bg-gray-50/70':''}`}
                    style={{minWidth:72, height:36, borderBottom:`1px solid ${hIdx%2===1?'#e2dcd5':'#ece7e1'}`}}
                    onMouseDown={()=>cellDown(dstr,hIdx,hasSlot)}
                    onMouseEnter={e=>{cellEnter(dstr,hIdx);onHover({x:e.clientX,y:e.clientY,date:dstr,hour});}}
                    onMouseLeave={()=>onHover(null)}>
                    {hasSlot && (
                      <div className="flex flex-row h-full w-full" style={{gap:1, padding:'1px 1px 0'}}>
                        {entries.map(({slot:s,pos})=>(
                          <div key={s.id} className="flex-1 min-w-0 h-full">
                            <CellBlock slot={s} pos={pos} sById={sById} bById={bById} conflictSet={conflictSet} onSlot={onSlot} onHover={onHover} selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}/>
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
function WeekGrid({ week, data, conflictSet, fStreamer, fBrands, onSlot, onEmpty, onHover, selectMode, selected, toggleSelect }) {
  const today = ds(new Date());
  const sById = Object.fromEntries(data.streamers.map(s=>[s.id,s]));
  const bById = Object.fromEntries(data.brands.map(b=>[b.id,b]));
  const dateStrs = week.map(d => ds(d));
  const cellMap = buildCellMap(data.slots, dateStrs, s => {
    if (fStreamer !== 'all' && s.streamerId !== fStreamer) return false;
    if (fBrands?.size > 0 && !fBrands.has(s.brandId)) return false;
    return true;
  });

  const onEmptyWithEnd = useCallback((date, startTime, endTime) => onEmpty(date, startTime, endTime), [onEmpty]);
  const { cellDown, cellEnter, isSelected, dragging } = useDrag(onEmptyWithEnd);

  return (
    <div className="flex-1 overflow-auto" style={{cursor: dragging?'ns-resize':'default'}}>
      <table className="text-xs border-collapse w-full select-none" style={{minWidth:`${week.length*140+56}px`}}>
        <thead className="sticky top-0 z-10 bg-white" style={{boxShadow:'0 1px 0 #e2dcd5, 0 2px 8px rgba(0,0,0,0.04)'}}>
          <tr>
            <th className="sticky left-0 z-20 bg-white w-14 px-2 py-2.5 text-[9px] font-medium text-gray-300 text-right border-r border-border">เวลา</th>
            {week.map(d=>{
              const dstr=ds(d), isT=dstr===today;
              return (
                <th key={dstr} className={`px-2 py-2.5 border-r border-border font-medium min-w-[140px] text-center ${isT?'bg-orange-50':''}`}>
                  <div className={`text-[10px] mb-1 ${isT?'text-accent font-semibold':'text-gray-400'}`}>{DAY_TH[d.getDay()]}</div>
                  <div className={`inline-flex items-center justify-center w-7 h-7 text-sm font-bold rounded-full ${isT?'bg-accent text-white':'text-gray-700'}`}>{d.getDate()}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {HOURS.map((hour, hIdx)=>(
            <tr key={hour} style={{height:40}}>
              <td className="sticky left-0 z-10 bg-white px-2 text-[9px] font-medium text-gray-300 text-right border-r border-border w-14 align-top pt-1"
                style={{borderBottom:`1px solid ${hIdx%2===1?'#e2dcd5':'#ece7e1'}`}}>{hour}</td>
              {week.map(d=>{
                const dstr=ds(d);
                const key=`${dstr}_${hIdx}`;
                const entries=cellMap[key]||[];
                const hasSlot=entries.length>0;
                const selected=isSelected(dstr,hIdx);
                return (
                  <td key={dstr}
                    className={`border-r p-0 relative transition-colors
                      ${selected?'bg-accent/15':!hasSlot?'hover:bg-gray-50/70':''}`}
                    style={{height:40, borderBottom:`1px solid ${hIdx%2===1?'#e2dcd5':'#ece7e1'}`}}
                    onMouseDown={()=>cellDown(dstr,hIdx,hasSlot)}
                    onMouseEnter={e=>{cellEnter(dstr,hIdx);onHover({x:e.clientX,y:e.clientY,date:dstr,hour});}}
                    onMouseLeave={()=>onHover(null)}>
                    {hasSlot && (
                      <div className="flex flex-row h-full w-full" style={{gap:1, padding:'1px 1px 0'}}>
                        {entries.map(({slot:s,pos})=>(
                          <div key={s.id} className="flex-1 min-w-0 h-full">
                            <CellBlock slot={s} pos={pos} sById={sById} bById={bById} conflictSet={conflictSet} onSlot={onSlot} onHover={onHover} selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}/>
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

// ─── Quick Edit Panel ─────────────────────────────────────────
function QuickEditPanel({ slot, data, bById, onClose, onSave, onDelete, onFullEdit }) {
  const [form, setForm] = useState({...slot});
  useEffect(()=>{ setForm({...slot}); },[slot?.id]);
  const brand = bById[form.brandId];
  const color = brand?.color || '#9ca3af';
  const d = new Date((form.date||'2000-01-01')+'T00:00:00');
  const dateLabel = d.toLocaleDateString('th-TH',{weekday:'short',day:'numeric',month:'short'});
  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/10" onClick={onClose}/>
      <div className="fixed right-0 top-0 h-full w-80 bg-white shadow-2xl z-40 flex flex-col border-l border-border">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border flex-shrink-0" style={{backgroundColor:color+'18'}}>
          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{backgroundColor:color}}/>
          <span className="font-bold text-sm flex-1 truncate text-gray-800">{brand?.name||form.brandId||'—'}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-base leading-none">✕</button>
        </div>
        {/* Date/Time */}
        <div className="px-4 py-2.5 border-b border-border/50 bg-gray-50 flex-shrink-0">
          <div className="text-[11px] text-gray-400">{dateLabel}</div>
          <div className="text-base font-bold text-gray-800">{form.startTime} – {form.endTime}</div>
        </div>
        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          <div>
            <div className="text-[11px] text-gray-400 font-medium mb-1">นักไลฟ์</div>
            <select value={form.streamerId||''} onChange={e=>setForm(f=>({...f,streamerId:e.target.value}))} className="input w-full">
              <option value="">-- ยังไม่ระบุ --</option>
              {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-medium mb-1">สถานะ</div>
            <div className="flex gap-1.5">
              {[['pending','รอยืนยัน'],['confirmed','ยืนยัน'],['approved','อนุมัติ']].map(([v,l])=>(
                <button key={v} onClick={()=>setForm(f=>({...f,status:v}))}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${(form.status||'pending')===v?'bg-accent text-white border-accent':'bg-white text-gray-600 border-border hover:border-accent'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-medium mb-1">ห้องไลฟ์</div>
            <div className="flex gap-1.5">
              {[{val:null,label:'ไม่ระบุ'},{val:'studio1',label:'🎬 S1'},{val:'studio2',label:'🎥 S2'}].map(opt=>(
                <button key={opt.val||'none'} onClick={()=>setForm(f=>({...f,location:opt.val}))}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${(form.location||null)===opt.val?'bg-accent text-white border-accent':'bg-white text-gray-600 border-border hover:border-accent'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-medium mb-1">Platform</div>
            <select value={form.platform||''} onChange={e=>setForm(f=>({...f,platform:e.target.value}))} className="input w-full">
              <option value="">-</option>
              <option>Shopee</option><option>TikTok</option><option>Lazada</option><option>Facebook</option>
            </select>
          </div>
          <div>
            <div className="text-[11px] text-gray-400 font-medium mb-1">หมายเหตุ</div>
            <input type="text" value={form.notes||''} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} className="input w-full" placeholder="หมายเหตุ (ถ้ามี)"/>
          </div>
        </div>
        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex flex-col gap-2 flex-shrink-0">
          <button onClick={()=>onSave(form)} className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-bold hover:opacity-90 shadow-sm transition-all">💾 บันทึก</button>
          <div className="flex gap-2">
            <button onClick={onFullEdit} className="flex-1 py-2 rounded-lg border border-border text-xs text-gray-600 hover:border-accent hover:text-accent transition-all">แก้ไขทั้งหมด →</button>
            <button onClick={onDelete} className="py-2 px-3 rounded-lg border border-red-200 text-xs text-red-400 hover:bg-red-50 transition-all">ลบ</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Auto-link helper ─────────────────────────────────────────
function buildAutoLinks(slotsWithName, streamers) {
  const norm = s => (s||'').toLowerCase().replace(/\s+/g,'');
  const matches = {};
  const names = [...new Set(slotsWithName.map(s=>s.streamerName))].filter(Boolean);
  for (const name of names) {
    const n = norm(name);
    let found = streamers.find(s=>norm(s.name)===n);
    if (!found) found = streamers.find(s=>norm(s.name).includes(n)||n.includes(norm(s.name)));
    matches[name] = found ? { streamerId: found.id, streamerName: found.name, auto: true } : { streamerId:'', auto:false };
  }
  return matches;
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
  const [data, setData]   = useState({streamers:[],brands:[],slots:[],conflicts:[],fifiHours:null,agencies:[]});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false); // mutation in progress
  const [modal, setModal] = useState(null);
  const [form, setForm]   = useState({});
  const [quickSlot, setQuickSlot] = useState(null); // quick-edit panel
  const [autoLinkOpen, setAutoLinkOpen] = useState(false);
  const [autoLinkMap, setAutoLinkMap] = useState({});
  const [fS, setFS] = useState('all');
  const [fBrands, setFBrands] = useState(new Set()); // empty = show all
  const toggleBrand = (id) => setFBrands(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  // ── multi-select ───────────────────────────────────────────
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected]     = useState(new Set()); // slot ids
  const toggleSelect = (id) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()); };
  const [bulkModal, setBulkModal] = useState(null); // 'status'|'streamer'|'delete'
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

  // ── localStorage cache key ──────────────────────────────────
  const cacheKey = `peepz_data_${year}_${month}`;

  const load = useCallback(async(silent=false)=>{
    // instant display from cache
    if(!silent){
      try{
        const cached = localStorage.getItem(cacheKey);
        if(cached){ setData(JSON.parse(cached)); }
        else { setLoading(true); }
      }catch{ setLoading(true); }
    }
    try {
      const r = await API_get(`/data?year=${year}&month=${month}`);
      setData(r.data);
      try{ localStorage.setItem(cacheKey, JSON.stringify(r.data)); }catch{}
    }
    catch(e){ if(!silent) toast_show('โหลดไม่ได้ '+e.message,'err'); }
    finally { setLoading(false); }
  },[year,month,cacheKey]);

  // helper: wrap any mutation with saving state + silent reload
  const withSaving = useCallback(async(fn)=>{
    setSaving(true);
    try { await fn(); }
    finally { setSaving(false); }
  },[]);

  useEffect(()=>{load();},[load]);

  function toast_show(msg,type='ok'){setToast({msg,type});setTimeout(()=>setToast(null),3500);}

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
    await withSaving(async()=>{
      try{
        if(modal?.slot){ await API_put(`/slots/${modal.slot.id}`, form); toast_show('✓ แก้ไขแล้ว'); }
        else {
          await API_post('/slots', form);
          toast_show('✓ เพิ่ม slot แล้ว');
        }
        setModal(null); load(true);
      }catch(e){toast_show(e.response?.data?.error||e.message,'err');}
    });
  }
  async function deleteSlot(id){
    if(!confirm('ลบ slot?'))return;
    await withSaving(async()=>{await API_del(`/slots/${id}`);toast_show('✓ ลบแล้ว');setModal(null);load(true);});
  }

  // ── streamer CRUD ──────────────────────────────────────────
  async function saveStreamer(){
    if(!form.name) return toast_show('ใส่ชื่อ','err');
    await withSaving(async()=>{
      if(modal?.item){ await API_put(`/streamers/${modal.item.id}`, form); toast_show('✓ แก้ไขนักไลฟ์แล้ว'); }
      else { await API_post('/streamers', form); toast_show('✓ เพิ่มนักไลฟ์แล้ว'); }
      setModal(null); load(true);
    });
  }
  async function deleteStreamer(id){
    const streamer = data.streamers.find(s=>s.id===id);
    const slotCount = data.slots.filter(s=>s.streamerId===id).length;
    const msg = slotCount > 0
      ? `ลบนักไลฟ์ "${streamer?.name}" และ slot ที่จองไว้ ${slotCount} รายการด้วยไหม?`
      : `ลบนักไลฟ์ "${streamer?.name}"?`;
    if(!confirm(msg)) return;
    await withSaving(async()=>{
      const r = await API_del(`/streamers/${id}`);
      toast_show(`✓ ลบแล้ว${r.data.slotsRemoved>0?` (ลบ ${r.data.slotsRemoved} slots ด้วย)`:''}`);
      setModal(null); load(true);
    });
  }

  // ── availability CRUD ─────────────────────────────────────
  const [availForm, setAvailForm] = useState({}); // { streamerId, availType:'weekly'|'dates', days:[], dates:[], startTime, endTime }
  const [availEditId, setAvailEditId] = useState(null);

  async function saveAvail() {
    const t = availForm.availType || 'weekly';
    if (!availForm.streamerId) return toast_show('เลือกนักไลฟ์ก่อน', 'err');
    if (t === 'weekly' && !availForm.days?.length) return toast_show('เลือกวันในสัปดาห์ด้วย', 'err');
    if (t === 'dates'  && !availForm.dates?.length) return toast_show('เลือกวันจากปฏิทินด้วย', 'err');
    if (!availForm.startTime || !availForm.endTime) return toast_show('ใส่ช่วงเวลาด้วย', 'err');
    await withSaving(async()=>{
      const payload = { streamerId: availForm.streamerId, type: t,
        days:  t==='weekly' ? (availForm.days||[]) : [],
        dates: t==='dates'  ? (availForm.dates||[]) : [],
        startTime: availForm.startTime, endTime: availForm.endTime };
      if (availEditId) { await API_put(`/availability/${availEditId}`, payload); toast_show('✓ แก้ไขตารางว่างแล้ว'); }
      else { await API_post('/availability', payload); toast_show('✓ บันทึกตารางว่างแล้ว'); }
      setAvailForm({}); setAvailEditId(null); load(true);
    });
  }
  async function deleteAvail(id) {
    await withSaving(async()=>{await API_del(`/availability/${id}`); toast_show('✓ ลบแล้ว'); load(true);});
  }

  // ── brand CRUD ────────────────────────────────────────────
  async function saveBrand(){
    if(!form.name) return toast_show('ใส่ชื่อแบรนด์','err');
    await withSaving(async()=>{
      if(modal?.item){ await API_put(`/brands/${modal.item.id}`, form); toast_show('✓ แก้ไขแบรนด์แล้ว'); }
      else { await API_post('/brands', form); toast_show('✓ เพิ่มแบรนด์แล้ว'); }
      setModal(null); load(true);
    });
  }
  async function deleteBrand(id){
    const brand = data.brands.find(b=>b.id===id);
    const slotCount = data.slots.filter(s=>s.brandId===id).length;
    const msg = slotCount > 0
      ? `ลบแบรนด์ "${brand?.name}" และ slot ทั้งหมด ${slotCount} รายการด้วยไหม?`
      : `ลบแบรนด์ "${brand?.name}"?`;
    if(!confirm(msg)) return;
    await withSaving(async()=>{
      const r = await API_del(`/brands/${id}`);
      toast_show(`✓ ลบแล้ว${r.data.slotsRemoved>0?` (ลบ ${r.data.slotsRemoved} slots ด้วย)`:''}`);
      setModal(null); load(true);
    });
  }

  // ── agency CRUD ───────────────────────────────────────────
  async function saveAgency(){
    if(!form.name) return toast_show('ใส่ชื่อ Agency','err');
    await withSaving(async()=>{
      if(modal?.item){ await API_put(`/agencies/${modal.item.id}`, form); toast_show('✓ แก้ไข Agency แล้ว'); }
      else { await API_post('/agencies', form); toast_show('✓ เพิ่ม Agency แล้ว'); }
      setModal({type:'manage'}); load(true);
    });
  }
  async function deleteAgency(id){
    if(!confirm('ลบ Agency นี้?')) return;
    await withSaving(async()=>{await API_del(`/agencies/${id}`); toast_show('✓ ลบแล้ว'); setModal({type:'manage'}); load(true);});
  }

  // ── bulk actions on selected slots ───────────────────────
  async function bulkSetStatus(status) {
    await withSaving(async()=>{
      await Promise.all([...selected].map(id => API_put(`/slots/${id}`, {status})));
      toast_show(`✓ เปลี่ยนสถานะ ${selected.size} slot แล้ว`);
      exitSelect(); setBulkModal(null); load(true);
    });
  }
  async function bulkSetStreamer(streamerId) {
    await withSaving(async()=>{
      await Promise.all([...selected].map(id => API_put(`/slots/${id}`, {streamerId: streamerId||null, streamerName:''})));
      toast_show(`✓ เปลี่ยนนักไลฟ์ ${selected.size} slot แล้ว`);
      exitSelect(); setBulkModal(null); load(true);
    });
  }
  async function bulkSetLocation(location) {
    await withSaving(async()=>{
      await Promise.all([...selected].map(id => API_put(`/slots/${id}`, {location: location||null})));
      toast_show(`✓ กำหนดห้อง ${selected.size} slot แล้ว`);
      exitSelect(); setBulkModal(null); load(true);
    });
  }
  async function bulkDelete() {
    if(!confirm(`ลบ ${selected.size} slot ที่เลือกทั้งหมด?`)) return;
    await withSaving(async()=>{
      await Promise.all([...selected].map(id => API_del(`/slots/${id}`)));
      toast_show(`✓ ลบ ${selected.size} slot แล้ว`);
      exitSelect(); load(true);
    });
  }

  // ── bulk add ──────────────────────────────────────────────
  function updateRow(i,k,v){setBulkRows(rows=>rows.map((r,j)=>j===i?{...r,[k]:v}:r));}
  async function submitBulk(){
    if(!bulkBrand) return toast_show('เลือกแบรนด์','err');
    const valid=bulkRows.filter(r=>r.date&&r.startTime&&r.endTime);
    if(!valid.length) return toast_show('ต้องมีอย่างน้อย 1 แถว','err');
    await withSaving(async()=>{
      let total=0;
      for(const r of valid){try{const res=await API_post('/slots', {...r,brandId:bulkBrand,status:'pending'});total+=res.data.autoSplit?res.data.slots.length:1;}catch{}}
      toast_show(`✓ เพิ่ม ${total} slot แล้ว`);setModal(null);setBulkRows([EMPTY_ROW()]);load(true);
    });
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

  // quick-edit panel for existing slots; full modal for new slots
  function openSlot(s){ setQuickSlot(s); }
  function openEmpty(dstr, startTime, endTime='', location=''){setForm({date:dstr,startTime,endTime,status:'pending',...(location?{location}:{})});setModal({type:'slot'});}

  async function quickSave(slotData) {
    try {
      await API_put(`/slots/${slotData.id}`, slotData);
      toast_show('บันทึกแล้ว ✓');
      setQuickSlot(null);
      load();
    } catch(e) { toast_show(e.response?.data?.error||e.message,'err'); }
  }
  async function quickDelete(id) {
    if(!confirm('ลบ slot นี้?')) return;
    await API_del(`/slots/${id}`); toast_show('ลบแล้ว'); setQuickSlot(null); load();
  }
  function quickToFull() {
    if(!quickSlot) return;
    setForm({...quickSlot}); setModal({type:'slot',slot:quickSlot}); setQuickSlot(null);
  }

  // auto-link: slots that have streamerName but no streamerId
  const needsLink = data.slots.filter(s => !s.streamerId && s.streamerName);
  function openAutoLink() {
    const m = buildAutoLinks(needsLink, data.streamers);
    setAutoLinkMap(m);
    setAutoLinkOpen(true);
  }
  async function confirmAutoLink() {
    let saved = 0;
    for (const s of needsLink) {
      const match = autoLinkMap[s.streamerName];
      if (match?.streamerId) {
        try { await API_put(`/slots/${s.id}`, {...s, streamerId: match.streamerId}); saved++; }
        catch {}
      }
    }
    toast_show(`เชื่อมนักไลฟ์ ${saved} slot แล้ว`);
    setAutoLinkOpen(false);
    load();
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg">

      {/* ── Toolbar ── */}
      <div className="mobile-toolbar-scroll flex flex-wrap items-center gap-2 px-4 py-2 border-b border-border bg-white flex-shrink-0">
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

        {/* ── Brand filter chips (all views) ── */}
        {data.brands.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={()=>setFBrands(new Set())}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                fBrands.size===0
                  ? 'bg-gray-800 text-white border-gray-800'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}>
              ทั้งหมด
            </button>
            {sortByName(data.brands).map(b=>(
              <button key={b.id} onClick={()=>toggleBrand(b.id)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-all ${
                  fBrands.has(b.id)
                    ? 'text-white border-transparent shadow-sm'
                    : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                }`}
                style={fBrands.has(b.id)?{backgroundColor:b.color,borderColor:b.color}:{}}>
                <span className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{backgroundColor: fBrands.has(b.id) ? 'rgba(255,255,255,0.7)' : b.color}}/>
                {b.name}
              </button>
            ))}
          </div>
        )}

        {/* ── Streamer filter (week only) ── */}
        {view==='week'&&(
          <select value={fS} onChange={e=>setFS(e.target.value)} className="text-xs border border-border rounded-lg px-2 py-1.5 text-gray-600 bg-white flex-shrink-0">
            <option value="all">นักไลฟ์ทุกคน</option>
            {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}

        {/* select mode toggle */}
        <button onClick={()=>{ if(selectMode) exitSelect(); else setSelectMode(true); }}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
            selectMode
              ? 'bg-accent text-white border-accent shadow-sm'
              : 'bg-white text-gray-600 border-border hover:border-accent hover:text-accent'
          }`}>
          {selectMode ? `☑ เลือกอยู่ (${selected.size})` : '☐ เลือก'}
        </button>

        <Btn onClick={()=>{setForm({status:'pending'});setModal({type:'slot'});}} primary>+ Slot</Btn>
        <Btn onClick={()=>{setBulkBrand('');setBulkRows([EMPTY_ROW()]);setModal({type:'bulk'});}}>+ หลาย Slot</Btn>
        <Btn onClick={()=>{setImpBrand('');setImpLink('');setImpPrev(null);setModal({type:'import'});}}>↓ Import ชีท</Btn>
        <Btn onClick={()=>{
          const el = document.getElementById('print-view');
          if(el){ el.style.display='block'; window.print(); el.style.display='none'; }
        }}>🖨 PDF</Btn>
        <Btn onClick={()=>setModal({type:'history'})}>📋 ประวัติ</Btn>
        <Btn onClick={()=>{setModal({type:'manage'});}}>⚙ จัดการ</Btn>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── Sidebar ── */}
        <div className="mobile-sidebar w-52 flex-shrink-0 border-r border-border overflow-y-auto p-3 flex flex-col gap-3 bg-white">

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
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-2">สถานะแบรนด์ — {MONTH_TH[month]}</div>
            {data.brands.map(b => {
              const done = brandDone(b.id);
              const brandSlots = data.slots.filter(s => {
                if (s.brandId !== b.id) return false;
                const d = new Date(s.date);
                return d.getFullYear()===year && d.getMonth()+1===month;
              });
              const counts = { pending: brandSlots.filter(s=>s.status==='pending'||!s.status).length, confirmed: brandSlots.filter(s=>s.status==='confirmed').length, approved: brandSlots.filter(s=>s.status==='approved').length };
              const isFiltered = fBrands.has(b.id);
              return (
                <div key={b.id} className={`mb-1.5 rounded-xl border transition-all overflow-hidden ${done?'border-green-200':'border-border'} ${isFiltered?'ring-2 ring-accent/40':''}`}
                  style={{backgroundColor: isFiltered ? b.color+'0d' : done ? '#f0fdf4' : 'white'}}>
                  {/* top row */}
                  <div className="flex items-center gap-1.5 px-2.5 py-2">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{backgroundColor:b.color}}/>
                    {/* click name → filter */}
                    <button onClick={()=>{ if(isFiltered){ setFBrands(new Set()); } else { setFBrands(new Set([b.id])); }}}
                      className="text-[11px] font-semibold text-gray-700 flex-1 truncate text-left hover:opacity-70 transition-opacity">
                      {b.name}
                    </button>
                    <span className="text-[10px] text-gray-400 flex-shrink-0">{brandSlots.length}</span>
                    {/* done toggle */}
                    <button onClick={()=>toggleBrandDone(b.id)} title={done?'ยกเลิกเสร็จ':'ทำเครื่องหมายเสร็จ'}
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] flex-shrink-0 transition-all ${done?'bg-green-500 text-white':'border-2 border-gray-200 hover:border-green-400'}`}>
                      {done&&'✓'}
                    </button>
                  </div>
                  {/* status pills row */}
                  {brandSlots.length>0&&(
                    <div className="flex gap-1 px-2.5 pb-2">
                      {counts.pending>0&&(
                        <button onClick={async()=>{ if(!confirm(`เปลี่ยน ${counts.pending} slot รอยืนยัน → ยืนยันแล้ว?`))return; await withSaving(async()=>{ await Promise.all(brandSlots.filter(s=>s.status==='pending'||!s.status).map(s=>API_put(`/slots/${s.id}`,{status:'confirmed'}))); toast_show('✓ เปลี่ยนสถานะแล้ว'); load(true); }); }}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-200 hover:bg-amber-100 transition-colors font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>{counts.pending} รอ
                        </button>
                      )}
                      {counts.confirmed>0&&(
                        <button onClick={async()=>{ if(!confirm(`เปลี่ยน ${counts.confirmed} slot → อนุมัติ?`))return; await withSaving(async()=>{ await Promise.all(brandSlots.filter(s=>s.status==='confirmed').map(s=>API_put(`/slots/${s.id}`,{status:'approved'}))); toast_show('✓ เปลี่ยนสถานะแล้ว'); load(true); }); }}
                          className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-200 hover:bg-green-100 transition-colors font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"/>{counts.confirmed} ยืนยัน
                        </button>
                      )}
                      {counts.approved>0&&(
                        <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-200 font-medium">
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"/>{counts.approved} อนุมัติ
                        </span>
                      )}
                      {/* select all this brand */}
                      <button onClick={()=>{ setSelectMode(true); setSelected(new Set(brandSlots.map(s=>s.id))); }}
                        title="เลือก slot ทั้งหมดของแบรนด์นี้"
                        className="ml-auto text-[10px] text-gray-400 hover:text-accent px-1 transition-colors">☐</button>
                      {brandSlots.length>0&&<button onClick={()=>openExport(b)} title="Export" className="text-[10px] text-gray-400 hover:text-accent transition-colors">↗</button>}
                    </div>
                  )}
                </div>
              );
            })}
            {data.brands.filter(b=>brandDone(b.id)).length===data.brands.length&&data.brands.length>0&&(
              <div className="mt-1 text-center text-[11px] text-green-600 font-semibold">🎉 จัดครบทุกแบรนด์แล้ว!</div>
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

          {/* Auto-link — มีชื่อแต่ยังไม่เชื่อมระบบ */}
          {needsLink.length>0&&(
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-2">
              <div className="text-[11px] text-blue-600 font-bold mb-1">🔗 ยังไม่เชื่อมนักไลฟ์ ({needsLink.length})</div>
              <div className="text-[10px] text-gray-500 mb-2">มีชื่อใน import แต่ยังไม่ลิงก์ระบบ</div>
              <button onClick={openAutoLink}
                className="w-full py-1.5 rounded-lg bg-blue-500 text-white text-[11px] font-bold hover:bg-blue-600 transition-all">
                เชื่อมอัตโนมัติ →
              </button>
            </div>
          )}

          {/* Conflicts */}
          {conflictSet.size>0&&(
            <div className="rounded-xl border border-red-200 bg-red-50 p-2">
              <div className="text-[11px] text-red-600 font-bold">⚠ ชนกัน {conflictSet.size} slot</div>
              <div className="text-[10px] text-gray-500 mt-0.5">ดูกรอบแดงในตาราง</div>
            </div>
          )}

          {/* Streamers */}
          <div>
            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wide mb-2">นักไลฟ์</div>
            {data.streamers.map(s=>{
              const sSlots = data.slots.filter(sl => {
                if (sl.streamerId !== s.id) return false;
                const d = new Date(sl.date);
                return d.getFullYear()===year && d.getMonth()+1===month;
              });
              const isFiltered = fS === s.id;
              const typeLabel = s.type==='employee'?'ประจำ':s.type==='freelance-office'?'FL/ออฟ':s.type==='freelance-agency'?'Agency':'FL';
              return (
                <div key={s.id}
                  className={`mb-1.5 rounded-xl border transition-all overflow-hidden ${isFiltered?'ring-2 ring-accent/40 border-transparent':'border-border'}`}
                  style={{backgroundColor: isFiltered ? s.color+'14' : 'white'}}>
                  <div className="flex items-center gap-1.5 px-2.5 py-2">
                    <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{backgroundColor:s.color}}/>
                    {/* click name → filter week view by this streamer */}
                    <button onClick={()=>{ setFS(isFiltered ? 'all' : s.id); if(view!=='week') {} }}
                      className="text-[11px] font-semibold text-gray-700 flex-1 truncate text-left hover:opacity-70 transition-opacity">
                      {s.name}
                    </button>
                    <span className="text-[10px] text-gray-400 flex-shrink-0 font-mono">{sSlots.length}</span>
                    {/* select all slots of this streamer */}
                    {sSlots.length>0&&(
                      <button onClick={()=>{ setSelectMode(true); setSelected(new Set(sSlots.map(sl=>sl.id))); }}
                        title="เลือก slot ทั้งหมดของนักไลฟ์นี้"
                        className="text-[10px] text-gray-400 hover:text-accent transition-colors">☐</button>
                    )}
                  </div>
                  {sSlots.length>0&&(()=>{
                    const sc = { pending: sSlots.filter(sl=>sl.status==='pending'||!sl.status).length, confirmed: sSlots.filter(sl=>sl.status==='confirmed').length, approved: sSlots.filter(sl=>sl.status==='approved').length };
                    return (
                      <div className="flex gap-1 px-2.5 pb-2 flex-wrap">
                        <span className="text-[9px] text-gray-400 font-medium">{typeLabel}</span>
                        <span className="flex-1"/>
                        {sc.pending>0&&<span className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full bg-amber-50 text-amber-600 border border-amber-100"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block"/>{sc.pending}</span>}
                        {sc.confirmed>0&&<span className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full bg-green-50 text-green-600 border border-green-100"><span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"/>{sc.confirmed}</span>}
                        {sc.approved>0&&<span className="flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded-full bg-blue-50 text-blue-600 border border-blue-100"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 inline-block"/>{sc.approved}</span>}
                      </div>
                    );
                  })()}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Calendar ── */}
        <div className="flex-1 min-w-0 relative flex flex-col">
          {/* first-load spinner (no cache yet) */}
          {loading&&!data.slots.length&&(
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-gray-400 text-sm bg-bg z-10 pointer-events-none">
              <svg className="animate-spin w-8 h-8 text-accent/60" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
              </svg>
              <span>กำลังโหลดข้อมูล...</span>
            </div>
          )}
          {/* background refresh shimmer */}
          {loading&&data.slots.length>0&&(
            <div className="absolute top-0 left-0 right-0 h-0.5 z-20 overflow-hidden pointer-events-none">
              <div className="h-full bg-accent/60" style={{animation:'loadbar 1.2s ease-in-out infinite'}}/>
            </div>
          )}
          {view==='month'?(
            <MonthGrid year={year} month={month} data={data} conflictSet={conflictSet} fBrands={fBrands} onSlot={openSlot} onEmpty={openEmpty} onHover={setHoverInfo} selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}/>
          ):view==='studio'?(
            <StudioView year={year} month={month} data={data} onSlot={openSlot} onEmpty={openEmpty}/>
          ):(
            <WeekGrid week={curWeek} data={data} conflictSet={conflictSet} fStreamer={fS} fBrands={fBrands} onSlot={openSlot} onEmpty={openEmpty} onHover={setHoverInfo} selectMode={selectMode} selected={selected} toggleSelect={toggleSelect}/>
          )}
        </div>
      </div>

      {/* ── Modal: Add/Edit Slot ── */}
      {modal?.type==='slot'&&(
        <Modal title={modal.slot?'แก้ไข Slot':'เพิ่ม Slot'} onClose={()=>setModal(null)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="แบรนด์">
              <select value={form.brandId||''} onChange={e=>setForm(f=>({...f,brandId:e.target.value}))} className="input w-full">
                <option value="">-- เลือกแบรนด์ --</option>
                {sortByName(data.brands).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="นักไลฟ์">
              <select value={form.streamerId||''} onChange={e=>setForm(f=>({...f,streamerId:e.target.value}))} className="input w-full">
                <option value="">-- ยังไม่ระบุ --</option>
                {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
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
          {/* ── Streamer suggestions ── */}
          {form.date&&form.startTime&&form.endTime&&(()=>{
            const suggestions = getAvailableStreamers(data, form.date, form.startTime, form.endTime, modal.slot?.id);
            if(!suggestions.length) return null;
            const statusIcon = {free:'🟢',busy:'🔴',off:'⚫',unknown:'❔'};
            const statusLabel = {free:'ว่าง',busy:'ติดงาน',off:'ไม่ว่าง',unknown:'ไม่มีข้อมูล'};
            return (
              <div className="mt-3 p-3 bg-gray-50 rounded-xl border border-border">
                <p className="text-xs font-semibold text-gray-500 mb-2">นักไลฟ์ที่ว่าง</p>
                <div className="flex flex-wrap gap-2">
                  {suggestions.map(s=>(
                    <button key={s.id} type="button"
                      onClick={()=>s.avail==='free'&&setForm(f=>({...f,streamerId:s.id}))}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                        form.streamerId===s.id
                          ? 'bg-accent text-white border-accent shadow'
                          : s.avail==='free'
                            ? 'bg-white border-green-300 text-green-700 hover:border-green-500 hover:bg-green-50 cursor-pointer'
                            : s.avail==='busy'
                              ? 'bg-white border-red-200 text-red-400 cursor-not-allowed opacity-70'
                              : 'bg-white border-gray-200 text-gray-400 cursor-default opacity-60'
                      }`}>
                      <span>{statusIcon[s.avail]}</span>
                      <span style={{color:form.streamerId===s.id?'white':s.color||'inherit'}}>{s.name}</span>
                      {form.streamerId!==s.id&&<span className="opacity-60 text-[10px]">{statusLabel[s.avail]}</span>}
                    </button>
                  ))}
                </div>
              </div>
            );
          })()}
          <div className="flex gap-2 mt-5 justify-end">
            {modal.slot&&<button onClick={()=>deleteSlot(modal.slot.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบ slot</button>}
            <button onClick={()=>setModal(null)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveSlot} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
              {saving&&<svg className="animate-spin w-3 h-3" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
              {saving?'กำลังบันทึก...':'บันทึก'}
            </button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Manage brands & streamers ── */}
      {modal?.type==='manage'&&(
        <Modal title="จัดการแบรนด์ / นักไลฟ์ / Agency" onClose={()=>setModal(null)} xl>
          {/* ── Top row: แบรนด์ | นักไลฟ์ | เอเจนซี่ ── */}
          <div className="grid grid-cols-3 gap-5 mb-5">
            {/* Brands */}
            <div className="bg-gray-50 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">🏷 แบรนด์</h3>
                <button onClick={()=>{setForm({});setModal({type:'brand'});}}
                  className="text-xs bg-accent text-white px-3 py-1 rounded-full font-semibold hover:opacity-80 transition-opacity">+ เพิ่ม</button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                {sortByName(data.brands).map(b=>(
                  <div key={b.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-border hover:border-accent/40 hover:shadow-sm transition-all group">
                    <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm" style={{backgroundColor:b.color}}/>
                    <span className="text-sm text-gray-800 font-medium flex-1 min-w-0 truncate">{b.name}</span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={()=>{setForm({...b});setModal({type:'brand',item:b});}}
                        className="text-[11px] text-accent hover:text-accent/70 px-1.5 py-0.5 rounded hover:bg-accent/10">แก้ไข</button>
                      <button onClick={()=>deleteBrand(b.id)}
                        className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">ลบ</button>
                    </div>
                  </div>
                ))}
                {!data.brands.length&&<p className="text-xs text-gray-400 text-center py-4">ยังไม่มีแบรนด์</p>}
              </div>
            </div>
            {/* Streamers */}
            <div className="bg-gray-50 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">🎤 นักไลฟ์</h3>
                <button onClick={()=>{const autoColor=pickUniqueColor(data.streamers.map(s=>s.color));setForm({color:autoColor});setModal({type:'streamer'});}}
                  className="text-xs bg-accent text-white px-3 py-1 rounded-full font-semibold hover:opacity-80 transition-opacity">+ เพิ่ม</button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                {sortByName(data.streamers).map(s=>(
                  <div key={s.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-border hover:border-accent/40 hover:shadow-sm transition-all group">
                    <div className="w-3.5 h-3.5 rounded-full flex-shrink-0 shadow-sm" style={{backgroundColor:s.color}}/>
                    <span className="text-sm text-gray-800 font-medium flex-1 min-w-0 truncate">{s.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0 whitespace-nowrap">
                      {s.type==='employee'?'ประจำ':s.type==='freelance-office'?'FL/ออฟ':s.type==='freelance-agency'?'Agency':'FL'}
                    </span>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={()=>{setForm({...s});setModal({type:'streamer',item:s});}}
                        className="text-[11px] text-accent hover:text-accent/70 px-1.5 py-0.5 rounded hover:bg-accent/10">แก้ไข</button>
                      <button onClick={()=>deleteStreamer(s.id)}
                        className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">ลบ</button>
                    </div>
                  </div>
                ))}
                {!data.streamers.length&&<p className="text-xs text-gray-400 text-center py-4">ยังไม่มีนักไลฟ์</p>}
              </div>
            </div>
            {/* Agencies */}
            <div className="bg-gray-50 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold text-gray-700">🏢 เอเจนซี่</h3>
                <button onClick={()=>{setForm({});setModal({type:'agency'});}}
                  className="text-xs bg-accent text-white px-3 py-1 rounded-full font-semibold hover:opacity-80 transition-opacity">+ เพิ่ม</button>
              </div>
              <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                {sortByName(data.agencies||[]).map(a=>(
                  <div key={a.id} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-border hover:border-accent/40 hover:shadow-sm transition-all group">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-800 font-medium truncate block">{a.name}</span>
                      {a.contactPerson&&<span className="text-[11px] text-gray-400 truncate block">{a.contactPerson}</span>}
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button onClick={()=>{setForm({...a});setModal({type:'agency',item:a});}}
                        className="text-[11px] text-accent hover:text-accent/70 px-1.5 py-0.5 rounded hover:bg-accent/10">แก้ไข</button>
                      <button onClick={()=>deleteAgency(a.id)}
                        className="text-[11px] text-red-400 hover:text-red-600 px-1.5 py-0.5 rounded hover:bg-red-50">ลบ</button>
                    </div>
                  </div>
                ))}
                {!(data.agencies||[]).length&&<p className="text-xs text-gray-400 text-center py-4">ยังไม่มี Agency</p>}
              </div>
            </div>
          </div>

          {/* ── Bottom: ตารางว่าง (full width) ── */}
          <div className="bg-gray-50 rounded-2xl border border-border p-4">
            <h3 className="text-sm font-bold text-gray-700 mb-4">📅 ตารางว่างนักไลฟ์</h3>
            <div className="grid grid-cols-2 gap-5">
              {/* Left: add form */}
              <div>
                <p className="text-xs text-gray-500 font-semibold mb-3">{availEditId?'✏️ แก้ไขช่วงเวลา':'➕ เพิ่มช่วงเวลาว่าง'}</p>
                <div className="bg-white rounded-xl border border-border p-4 flex flex-col gap-3">
                  {/* streamer */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1 block">นักไลฟ์</label>
                    <select value={availForm.streamerId||''} onChange={e=>setAvailForm(f=>({...f,streamerId:e.target.value}))}
                      className="input w-full">
                      <option value="">เลือกนักไลฟ์</option>
                      {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  {/* type toggle */}
                  <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
                    {[['weekly','ทุกสัปดาห์'],['dates','เลือกวันจากปฏิทิน']].map(([v,l])=>(
                      <button key={v} type="button" onClick={()=>setAvailForm(f=>({...f,availType:v}))}
                        className={`flex-1 py-1.5 rounded-md text-xs font-semibold transition-all ${
                          (availForm.availType||'weekly')===v ? 'bg-white shadow text-accent' : 'text-gray-500 hover:text-gray-700'
                        }`}>{l}</button>
                    ))}
                  </div>
                  {/* weekly: day buttons */}
                  {(availForm.availType||'weekly')==='weekly'&&(
                    <div>
                      <label className="text-xs text-gray-500 font-medium mb-1.5 block">วันในสัปดาห์</label>
                      <div className="flex gap-1.5 flex-wrap">
                        {DAY_LABELS_FULL.map((lbl,i)=>(
                          <button key={i} type="button"
                            onClick={()=>setAvailForm(f=>{const d2=(f.days||[]);return {...f,days:d2.includes(i)?d2.filter(d=>d!==i):[...d2,i]};})}
                            className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                              (availForm.days||[]).includes(i)
                                ? 'bg-accent text-white border-accent shadow-sm'
                                : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-accent hover:text-accent'
                            }`}>{lbl}</button>
                        ))}
                      </div>
                    </div>
                  )}
                  {/* dates: mini calendar */}
                  {availForm.availType==='dates'&&(()=>{
                    const calDays = getDaysInMonth(year, month);
                    const firstDow = calDays[0].getDay(); // 0=Sun
                    const selDates = availForm.dates||[];
                    return (
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-xs text-gray-500 font-medium">คลิกเลือกวัน ({MONTH_TH[month]})</label>
                          {selDates.length>0&&<button type="button" onClick={()=>setAvailForm(f=>({...f,dates:[]}))}
                            className="text-[10px] text-gray-400 hover:text-red-400">ล้าง</button>}
                        </div>
                        <div className="grid grid-cols-7 gap-0.5">
                          {DAY_LABELS.map(d=><div key={d} className="text-center text-[9px] text-gray-400 font-bold py-0.5">{d}</div>)}
                          {Array(firstDow).fill(null).map((_,i)=><div key={'e'+i}/>)}
                          {calDays.map(date=>{
                            const dStr = ds(date);
                            const isSel = selDates.includes(dStr);
                            const dow2  = date.getDay();
                            return (
                              <button key={dStr} type="button"
                                onClick={()=>setAvailForm(f=>{const d2=f.dates||[];return {...f,dates:d2.includes(dStr)?d2.filter(x=>x!==dStr):[...d2,dStr]};})}
                                className={`aspect-square rounded-lg text-[11px] font-semibold transition-all ${
                                  isSel ? 'bg-accent text-white shadow-sm' :
                                  dow2===0||dow2===6 ? 'text-blue-400 hover:bg-blue-50' :
                                  'text-gray-600 hover:bg-gray-100'
                                }`}>
                                {date.getDate()}
                              </button>
                            );
                          })}
                        </div>
                        {selDates.length>0&&(
                          <div className="mt-1.5 text-[10px] text-accent font-semibold">
                            เลือก {selDates.length} วัน
                          </div>
                        )}
                      </div>
                    );
                  })()}
                  {/* time */}
                  <div>
                    <label className="text-xs text-gray-500 font-medium mb-1 block">ช่วงเวลา</label>
                    <div className="flex items-center gap-2">
                      <input type="time" value={availForm.startTime||''} onChange={e=>setAvailForm(f=>({...f,startTime:e.target.value}))}
                        className="input flex-1"/>
                      <span className="text-gray-400 font-medium">–</span>
                      <input type="time" value={availForm.endTime||''} onChange={e=>setAvailForm(f=>({...f,endTime:e.target.value}))}
                        className="input flex-1"/>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button onClick={saveAvail} disabled={saving}
                      className="flex-1 py-2 bg-accent text-white text-sm rounded-xl font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5">
                      {saving&&<svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>}
                      {saving?'กำลังบันทึก...':(availEditId?'💾 บันทึก':'+ เพิ่มตารางว่าง')}
                    </button>
                    {availEditId&&<button onClick={()=>{setAvailForm({});setAvailEditId(null);}}
                      className="px-4 py-2 text-sm text-gray-500 hover:bg-gray-100 rounded-xl transition-colors">ยกเลิก</button>}
                  </div>
                </div>
              </div>
              {/* Right: records per streamer */}
              <div>
                <p className="text-xs text-gray-500 font-semibold mb-3">ตารางว่างที่บันทึกไว้</p>
                <div className="flex flex-col gap-3 max-h-56 overflow-y-auto pr-1">
                  {data.streamers.filter(s=>(data.availability||[]).some(a=>a.streamerId===s.id)).map(s=>{
                    const avails = (data.availability||[]).filter(a=>a.streamerId===s.id);
                    return (
                      <div key={s.id} className="bg-white rounded-xl border border-border p-3">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:s.color}}/>
                          <span className="text-sm font-semibold text-gray-800">{s.name}</span>
                          <span className="ml-auto text-[10px] text-gray-400">{avails.length} ช่วง</span>
                        </div>
                        <div className="flex flex-col gap-1.5">
                          {avails.map(a=>(
                            <div key={a.id} className="flex items-start gap-2 px-2.5 py-1.5 bg-gray-50 rounded-lg group">
                              <div className="flex-1 min-w-0">
                                {/* weekly type */}
                                {(a.type==='weekly'||!a.type)&&(
                                  <div className="flex flex-wrap gap-1 mb-0.5">
                                    {(a.days||[]).sort((x,y)=>x-y).map(d=>(
                                      <span key={d} className="text-[10px] px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">{DAY_LABELS[d]}</span>
                                    ))}
                                    <span className="text-[9px] text-gray-400 self-center">ทุกสัปดาห์</span>
                                  </div>
                                )}
                                {/* dates type */}
                                {a.type==='dates'&&(
                                  <div className="flex flex-wrap gap-0.5 mb-0.5">
                                    {(a.dates||[]).sort().slice(0,8).map(d=>(
                                      <span key={d} className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                                        {parseInt(d.slice(8))}
                                      </span>
                                    ))}
                                    {(a.dates||[]).length>8&&<span className="text-[9px] text-gray-400">+{(a.dates||[]).length-8}</span>}
                                  </div>
                                )}
                                <span className="text-[11px] text-gray-500">{a.startTime} – {a.endTime}</span>
                              </div>
                              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button onClick={()=>{setAvailForm({streamerId:a.streamerId,availType:a.type||'weekly',days:a.days||[],dates:a.dates||[],startTime:a.startTime,endTime:a.endTime});setAvailEditId(a.id);}}
                                  className="text-[11px] text-accent px-1.5 py-0.5 rounded hover:bg-accent/10">แก้</button>
                                <button onClick={()=>deleteAvail(a.id)}
                                  className="text-[11px] text-red-400 px-1.5 py-0.5 rounded hover:bg-red-50">ลบ</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {!(data.availability||[]).length&&(
                    <div className="text-center py-8 text-gray-400">
                      <p className="text-2xl mb-2">📭</p>
                      <p className="text-xs">ยังไม่มีตารางว่าง</p>
                      <p className="text-xs opacity-70">เพิ่มด้านซ้ายได้เลยค่ะ</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end mt-4">
            <button onClick={()=>setModal(null)} className="px-5 py-2 rounded-xl text-sm text-gray-500 hover:bg-gray-100">ปิด</button>
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
            <button onClick={saveBrand} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">{saving?'กำลังบันทึก...':'บันทึก'}</button>
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
            {form.type==='freelance-agency'&&(
              <Field label="เอเจนซี่ (ต้นสังกัด)" className="col-span-2">
                <select value={form.agencyAdmin||''} onChange={e=>setForm(f=>({...f,agencyAdmin:e.target.value}))} className="input w-full">
                  <option value="">-- เลือกเอเจนซี่ --</option>
                  {sortByName(data.agencies||[]).map(a=>(
                    <option key={a.id} value={a.name}>{a.name}{a.contactPerson?` (${a.contactPerson})`:''}</option>
                  ))}
                </select>
                {(data.agencies||[]).length===0&&(
                  <p className="text-[11px] text-gray-400 mt-1">ยังไม่มีเอเจนซี่ — ไปที่ ⚙ จัดการ → เอเจนซี่ เพื่อเพิ่มก่อนนะคะ</p>
                )}
              </Field>
            )}
          </div>
          <div className="flex gap-2 mt-4 justify-end">
            {modal.item&&<button onClick={()=>deleteStreamer(modal.item.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบนักไลฟ์</button>}
            <button onClick={()=>setModal({type:'manage'})} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveStreamer} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">{saving?'กำลังบันทึก...':'บันทึก'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Agency form ── */}
      {modal?.type==='agency'&&(
        <Modal title={modal.item?'แก้ไขเอเจนซี่':'เพิ่มเอเจนซี่'} onClose={()=>setModal({type:'manage'})}>
          <div className="flex flex-col gap-3">
            <Field label="ชื่อเอเจนซี่">
              <input type="text" value={form.name||''} onChange={e=>setForm(f=>({...f,name:e.target.value}))} className="input w-full" placeholder="ชื่อบริษัทเอเจนซี่"/>
            </Field>
            <Field label="ผู้ติดต่อ (Contact Person)">
              <input type="text" value={form.contactPerson||''} onChange={e=>setForm(f=>({...f,contactPerson:e.target.value}))} className="input w-full" placeholder="ชื่อคนติดต่อจากเอเจนซี่"/>
            </Field>
            <Field label="เบอร์โทร / Line">
              <input type="text" value={form.phone||''} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} className="input w-full" placeholder="เบอร์โทรหรือ Line ID (ถ้ามี)"/>
            </Field>
          </div>
          <div className="flex gap-2 mt-4 justify-end">
            {modal.item&&<button onClick={()=>deleteAgency(modal.item.id)} className="mr-auto text-xs text-red-400 hover:text-red-600 px-2">ลบเอเจนซี่</button>}
            <button onClick={()=>setModal({type:'manage'})} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
            <button onClick={saveAgency} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">{saving?'กำลังบันทึก...':'บันทึก'}</button>
          </div>
        </Modal>
      )}

      {/* ── Modal: Bulk Add ── */}
      {modal?.type==='bulk'&&(
        <Modal title="เพิ่มหลาย Slot" onClose={()=>setModal(null)} wide>
          <Field label="แบรนด์ (ใช้กับทุกแถว)" className="mb-3">
            <select value={bulkBrand} onChange={e=>setBulkBrand(e.target.value)} className="input w-full">
              <option value="">-- เลือกแบรนด์ --</option>
              {sortByName(data.brands).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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
                    <td className="py-1 pr-1"><select value={row.streamerId} onChange={e=>updateRow(i,'streamerId',e.target.value)} className="input w-28"><option value="">-</option>{sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
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
              <button onClick={submitBulk} disabled={saving} className="px-4 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:opacity-90 disabled:opacity-50">{saving?'กำลังบันทึก...':'บันทึกทั้งหมด'}</button>
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
                  {sortByName(data.brands).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
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
                          {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
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

      {/* ── Modal: History ── */}
      {modal?.type==='history'&&(
        <Modal title="📋 ประวัติการแก้ไข" onClose={()=>setModal(null)} wide>
          {(!data.history||data.history.length===0)
            ? <div className="text-center text-gray-400 py-8 text-sm">ยังไม่มีประวัติการแก้ไขค่ะ</div>
            : (
              <div className="overflow-y-auto max-h-[60vh] divide-y divide-border">
                {data.history.map(h=>{
                  const d = new Date(h.at);
                  const dateStr = `${d.getDate()}/${d.getMonth()+1}/${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
                  const actionColor = h.action.includes('เพิ่ม') ? 'text-green-600 bg-green-50' : h.action.includes('ลบ') ? 'text-red-500 bg-red-50' : 'text-blue-600 bg-blue-50';
                  return (
                    <div key={h.id} className="flex items-start gap-3 py-2.5 px-1">
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 mt-0.5 ${actionColor}`}>{h.action}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-700 truncate">{h.detail}</div>
                        <div className="text-[10px] text-gray-400 mt-0.5">{dateStr}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          }
        </Modal>
      )}

      {/* ── Quick Edit Panel ── */}
      {quickSlot&&(
        <QuickEditPanel
          slot={quickSlot}
          data={data}
          bById={bById}
          onClose={()=>setQuickSlot(null)}
          onSave={quickSave}
          onDelete={()=>quickDelete(quickSlot.id)}
          onFullEdit={quickToFull}
        />
      )}

      {/* ── Auto-link Modal ── */}
      {autoLinkOpen&&(
        <Modal title="🔗 เชื่อมนักไลฟ์อัตโนมัติ" onClose={()=>setAutoLinkOpen(false)} wide>
          <p className="text-xs text-gray-500 mb-3">ระบบจับคู่ชื่อจาก Import กับนักไลฟ์ในระบบ — ตรวจสอบแล้วกด <b>ยืนยันเชื่อม</b></p>
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {Object.entries(autoLinkMap).map(([name, match])=>(
              <div key={name} className="flex items-center gap-3 px-3 py-2 rounded-xl border border-border bg-white">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-gray-700 truncate">"{name}"</div>
                  <div className="text-[10px] text-gray-400">
                    {needsLink.filter(s=>s.streamerName===name).length} slot
                  </div>
                </div>
                <span className="text-gray-300 text-xs">→</span>
                <select
                  value={autoLinkMap[name]?.streamerId||''}
                  onChange={e=>setAutoLinkMap(m=>({...m,[name]:{...m[name],streamerId:e.target.value}}))}
                  className="input w-40 flex-shrink-0">
                  <option value="">ข้ามไป</option>
                  {sortByName(data.streamers).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                {match.auto&&match.streamerId
                  ? <span className="text-[10px] text-green-600 font-bold bg-green-50 px-2 py-0.5 rounded-full flex-shrink-0">✓ จับคู่แล้ว</span>
                  : <span className="text-[10px] text-amber-500 bg-amber-50 px-2 py-0.5 rounded-full flex-shrink-0">เลือกเอง</span>
                }
              </div>
            ))}
          </div>
          <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
            <span className="text-xs text-gray-400">
              จับคู่อัตโนมัติ {Object.values(autoLinkMap).filter(m=>m.auto&&m.streamerId).length} / {Object.keys(autoLinkMap).length} ชื่อ
            </span>
            <div className="flex gap-2">
              <button onClick={()=>setAutoLinkOpen(false)} className="px-4 py-2 rounded-lg text-xs text-gray-500 hover:bg-gray-100">ยกเลิก</button>
              <button onClick={confirmAutoLink}
                disabled={!Object.values(autoLinkMap).some(m=>m.streamerId)}
                className="px-5 py-2 rounded-lg bg-blue-500 text-white text-xs font-bold hover:bg-blue-600 disabled:opacity-40 shadow-sm">
                ✓ ยืนยันเชื่อม {Object.values(autoLinkMap).filter(m=>m.streamerId).length} ชื่อ
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Print View — hidden normally, shown only when printing */}
      <PrintView year={year} month={month} data={data}/>

      {/* ── Top loading bar ── */}
      {(loading||saving)&&(
        <div className="fixed top-0 left-0 right-0 z-[60] h-0.5 overflow-hidden">
          <div className={`h-full bg-accent animate-[loadbar_1.2s_ease-in-out_infinite] ${saving?'opacity-100':'opacity-70'}`}
            style={{width:'100%',transformOrigin:'left'}}/>
        </div>
      )}

      {/* ── Saving chip ── */}
      {saving&&(
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-xs rounded-full shadow-xl font-medium pointer-events-none">
          <svg className="animate-spin w-3.5 h-3.5 text-accent flex-shrink-0" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
          </svg>
          กำลังบันทึก...
        </div>
      )}

      {/* ── Bulk action bar ── */}
      {selectMode&&(
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-3 bg-gray-900 text-white rounded-2xl shadow-2xl border border-white/10">
          {/* count */}
          <span className="text-sm font-bold text-white mr-1">
            {selected.size > 0 ? `☑ ${selected.size} slot` : 'กดเลือก slot ที่ต้องการ'}
          </span>
          {selected.size > 0 && <>
            <div className="w-px h-5 bg-white/20 mx-1"/>
            {/* select all visible */}
            <button onClick={()=>{
              const visibleIds = data.slots.filter(s=>fBrands.size===0||fBrands.has(s.brandId)).map(s=>s.id);
              setSelected(new Set(visibleIds));
            }} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">
              เลือกทั้งหมด
            </button>
            {/* change status */}
            <button onClick={()=>setBulkModal('status')}
              className="text-xs px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 transition-colors font-semibold">
              🔄 เปลี่ยนสถานะ
            </button>
            {/* assign streamer */}
            <button onClick={()=>setBulkModal('streamer')}
              className="text-xs px-3 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 transition-colors font-semibold">
              🎤 จัดนักไลฟ์
            </button>
            {/* assign studio */}
            <button onClick={()=>setBulkModal('location')}
              className="text-xs px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 transition-colors font-semibold">
              🎬 ลง Studio
            </button>
            {/* delete */}
            <button onClick={bulkDelete}
              className="text-xs px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-400 transition-colors font-semibold">
              🗑 ลบ
            </button>
          </>}
          <div className="w-px h-5 bg-white/20 mx-1"/>
          <button onClick={exitSelect} className="text-xs px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors">✕ ยกเลิก</button>
        </div>
      )}

      {/* ── Bulk modal: change status ── */}
      {bulkModal==='status'&&(
        <Modal title={`เปลี่ยนสถานะ ${selected.size} slot`} onClose={()=>setBulkModal(null)}>
          <div className="flex flex-col gap-2">
            {[['pending','รอยืนยัน','#f59e0b'],['confirmed','ยืนยันแล้ว','#3b82f6'],['approved','อนุมัติ','#22c55e']].map(([v,l,c])=>(
              <button key={v} onClick={()=>bulkSetStatus(v)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:border-accent hover:bg-gray-50 transition-all text-left">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:c}}/>
                <span className="text-sm font-semibold text-gray-700">{l}</span>
                <svg className="ml-auto w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ── Bulk modal: assign location ── */}
      {bulkModal==='location'&&(
        <Modal title={`กำหนดห้อง ${selected.size} slot`} onClose={()=>setBulkModal(null)}>
          <div className="flex flex-col gap-2">
            {[
              {id:'studio1', label:'🎬 S Room (Studio 1)', color:'#7c3aed'},
              {id:'studio2', label:'🎥 M Room (Studio 2)', color:'#1d4ed8'},
              {id:null,      label:'— ไม่ระบุห้อง',        color:'#9ca3af'},
            ].map(opt=>(
              <button key={String(opt.id)} onClick={()=>bulkSetLocation(opt.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:border-accent hover:bg-gray-50 transition-all text-left">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:opt.color}}/>
                <span className="text-sm font-semibold text-gray-700">{opt.label}</span>
                <svg className="ml-auto w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* ── Bulk modal: assign streamer ── */}
      {bulkModal==='streamer'&&(
        <Modal title={`จัดนักไลฟ์ให้ ${selected.size} slot`} onClose={()=>setBulkModal(null)}>
          <div className="flex flex-col gap-2 max-h-72 overflow-y-auto">
            <button onClick={()=>bulkSetStreamer(null)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:border-amber-300 hover:bg-amber-50 transition-all text-left">
              <span className="w-3 h-3 rounded-full bg-gray-300 flex-shrink-0"/>
              <span className="text-sm font-semibold text-amber-600">⚠ ยังไม่ระบุ (unassign)</span>
            </button>
            {sortByName(data.streamers).map(s=>(
              <button key={s.id} onClick={()=>bulkSetStreamer(s.id)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border hover:border-accent hover:bg-gray-50 transition-all text-left">
                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{backgroundColor:s.color}}/>
                <span className="text-sm font-semibold text-gray-700">{s.name}</span>
                <span className="text-xs text-gray-400 ml-auto">{s.type==='employee'?'ประจำ':s.type==='freelance-office'?'FL/ออฟ':s.type==='freelance-agency'?'Agency':'FL'}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* Toast */}
      {toast&&(
        <div className={`fixed bottom-5 right-5 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm shadow-xl font-medium transition-all ${toast.type==='err'?'bg-red-500 text-white':'bg-gray-900 text-white'}`}>
          {toast.type!=='err'&&<span className="text-green-400 text-base leading-none">✓</span>}
          {toast.type==='err'&&<span className="text-base leading-none">⚠</span>}
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── PrintView — monthly schedule for PDF ─────────────────────
function PrintView({ year, month, data }) {
  const days = getDaysInMonth(year, month);
  const DAY_SHORT = ['อา','จ','อ','พ','พฤ','ศ','ส'];
  const bById = Object.fromEntries((data.brands||[]).map(b=>[b.id,b]));
  const sById = Object.fromEntries((data.streamers||[]).map(s=>[s.id,s]));

  // group slots by date
  const byDate = {};
  for (const d of days) byDate[d] = [];
  for (const s of (data.slots||[])) {
    if (byDate[s.date]) byDate[s.date].push(s);
  }
  for (const d of days) {
    byDate[d].sort((a,b) => a.startTime.localeCompare(b.startTime));
  }

  return (
    <div id="print-view" style={{display:'none',fontFamily:'Noto Sans Thai,sans-serif'}}>
      <div style={{padding:'12px 16px 8px',borderBottom:'2px solid #ff6b35',marginBottom:8,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <div style={{width:28,height:28,borderRadius:'50%',background:'#ff6b35',color:'#fff',fontWeight:'bold',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14}}>P</div>
          <div>
            <div style={{fontWeight:'bold',fontSize:13,color:'#1a1a1a'}}>ตารางไลฟ์ — Peepz Team</div>
            <div style={{fontSize:10,color:'#888'}}>{MONTH_TH[month]} {year}</div>
          </div>
        </div>
        <div style={{fontSize:9,color:'#aaa'}}>พิมพ์: {new Date().toLocaleDateString('th-TH')}</div>
      </div>

      <table style={{width:'100%',borderCollapse:'collapse',fontSize:8,tableLayout:'fixed'}}>
        <thead>
          <tr>
            {days.map(d=>{
              const dt = new Date(d+'T00:00:00');
              const dd = dt.getDate();
              const dow = DAY_SHORT[dt.getDay()];
              const isWeekend = dt.getDay()===0||dt.getDay()===6;
              return (
                <th key={d} style={{
                  border:'1px solid #e2dcd5',
                  padding:'3px 1px',
                  textAlign:'center',
                  background: isWeekend ? '#fff3ee' : '#f8f7f5',
                  color: isWeekend ? '#ff6b35' : '#555',
                  fontWeight:'bold',
                  width: `${100/days.length}%`,
                }}>
                  <div style={{fontSize:9}}>{dow}</div>
                  <div style={{fontSize:11}}>{dd}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          <tr style={{verticalAlign:'top'}}>
            {days.map(d=>(
              <td key={d} style={{border:'1px solid #e2dcd5',padding:'2px 1px',verticalAlign:'top',minHeight:60}}>
                {byDate[d].map(s=>{
                  const brand = bById[s.brandId];
                  const streamer = sById[s.streamerId];
                  const color = brand?.color || '#9ca3af';
                  return (
                    <div key={s.id} style={{
                      borderLeft:`2px solid ${color}`,
                      background: color+'20',
                      borderRadius:2,
                      padding:'1px 2px',
                      marginBottom:2,
                    }}>
                      <div style={{fontWeight:'bold',color,fontSize:7,lineHeight:1.2,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{brand?.name||'-'}</div>
                      <div style={{color:'#555',fontSize:7,lineHeight:1.2}}>{s.startTime}–{s.endTime}</div>
                      {streamer&&<div style={{color:'#888',fontSize:6.5,lineHeight:1.2,overflow:'hidden',whiteSpace:'nowrap',textOverflow:'ellipsis'}}>{streamer.name}</div>}
                    </div>
                  );
                })}
              </td>
            ))}
          </tr>
        </tbody>
      </table>

      {/* Legend */}
      <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:6}}>
        {(data.brands||[]).map(b=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:3,fontSize:8}}>
            <div style={{width:8,height:8,borderRadius:2,background:b.color}}/>
            <span style={{color:'#555'}}>{b.name}</span>
          </div>
        ))}
      </div>
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

function Modal({title,onClose,children,wide,xl}){
  return(
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl mx-4 p-6 ${xl?'w-full max-w-5xl':wide?'w-full max-w-3xl':'w-full max-w-md'}`} onClick={e=>e.stopPropagation()}>
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

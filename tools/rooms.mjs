// Builds data.json for index.html: every Shnaton meeting held in a Givat Ram room, by room and
// date. Runs nightly from .github/workflows/data.yml (and by hand: node tools/rooms.mjs).
// The Shnaton API has no CORS, so the page can't ask it directly — it reads this file.
//
//   1. POST /courses/search-advanced (one call per period) → every course of the year
//   2. GET  /courses/groups-with-sessions?courseIds=… (≤200 characters ≈ 28 ids a call) →
//      groups → sessions (weekly slot + room) → studySessionSchedules (the actual dates,
//      with per-date time / room changes)
//
// Output (compact; times are minutes from midnight, days are days since 1970-01-01 UTC):
//   { v, builtAt, year, campus, types: [name], buildings: { code: name }, courses: { code: name },
//     rooms: { id: [name, buildingCode] },
//     s: { roomId: [[courseCode, group, typeIndex, start, end, firstDay, Δday, Δday, …]] } }
// No teacher names or emails are kept.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const SHNATON_API = 'https://shnaton.huji.ac.il/api';
// Givat Ram is listed in the Shnaton as campus 1, "אדמונד י' ספרא"
export const CAMPUS = { code: '1', name: 'גבעת רם' };
// Shnaton periods: 1 = A, 2 = B, 3 = A or B, 4 = summer, 5 = year-long
const PERIODS = [1, 2, 3, 4, 5];
const MAX_IDS_CHARS = 200; // the API rejects a longer courseIds

export const dayNum = (iso) => Math.round(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000);
const mins = (ms) => (ms == null ? null : Math.round(ms / 60000));

// Course ids → chunks whose comma-joined text fits the API's limit.
export function chunkIds(ids, max = MAX_IDS_CHARS) {
  const out = [];
  let cur = [];
  for (const id of ids) {
    const s = String(id);
    if (cur.length && [...cur, s].join(',').length > max) { out.push(cur); cur = []; }
    cur.push(s);
  }
  if (cur.length) out.push(cur);
  return out;
}

// courses: [{ id, code, name }] · groupsByCourse: { courseId: [group with studySessions] }
// → the data file object (without builtAt). Pure, so it can be tested on a fixture.
export function buildRooms(courses, groupsByCourse, { year, campus = CAMPUS } = {}) {
  const types = [];
  const typeIdx = (name) => { let i = types.indexOf(name); if (i < 0) { i = types.length; types.push(name); } return i; };
  const buildings = {};
  const rooms = {};
  const names = {};
  const entries = new Map(); // key → { room, row: [...], days: Set }
  const stats = { sessions: 0, noDates: 0, online: 0, otherCampus: 0, noRoom: 0 };

  const useRoom = (room) => {
    if (!room?.id) { stats.noRoom++; return null; }
    if (String(room.building?.campus?.code) !== campus.code) { stats.otherCampus++; return null; }
    const b = room.building;
    buildings[b.code] = b.name?.he?.trim() || b.code;
    rooms[room.id] = [room.name?.he?.trim() || String(room.id), b.code];
    return room.id;
  };
  const add = (roomId, course, group, type, start, end, day) => {
    if (start == null || end == null || end <= start) return;
    const key = `${roomId}|${course}|${group}|${type}|${start}|${end}`;
    let e = entries.get(key);
    if (!e) { e = { room: roomId, row: [course, group, type, start, end], days: new Set() }; entries.set(key, e); }
    e.days.add(day);
  };

  for (const c of courses) {
    const groups = groupsByCourse[c.id];
    if (!groups?.length) continue;
    let used = false;
    for (const g of groups) {
      const type = typeIdx(g.studySessionTypeName?.he?.trim() || '');
      for (const s of g.studySessions || []) {
        stats.sessions++;
        const dated = s.studySessionSchedules || [];
        if (!dated.length) { if (String(s.room?.building?.campus?.code) === campus.code) { stats.noDates++; } continue; }
        for (const d of dated) {
          if (!d.date) continue;
          if (d.isOnline) { stats.online++; continue; }
          const roomId = useRoom(d.room || s.room);
          if (roomId == null) continue;
          add(roomId, c.code, g.code, type, mins(d.startTime ?? s.startTime), mins(d.endTime ?? s.endTime), dayNum(d.date));
          used = true;
        }
      }
    }
    if (used) names[c.code] = (c.name?.he || '').trim().replace(/\s+/g, ' ');
  }

  const s = {};
  for (const e of entries.values()) {
    const days = [...e.days].sort((a, b) => a - b);
    (s[e.room] ||= []).push([...e.row, days[0], ...days.slice(1).map((d, i) => d - days[i])]);
  }
  for (const list of Object.values(s)) list.sort((a, b) => a[5] - b[5] || a[3] - b[3]);
  return { data: { v: 1, year, campus: campus.name, types, buildings, courses: names, rooms, s }, stats };
}

async function getJson(url, opts = {}, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(90_000) });
      if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 120)}`);
      return await r.json();
    } catch (err) {
      if (i >= tries) throw err;
      await new Promise((res) => setTimeout(res, 1500 * i));
    }
  }
}

async function main() {
  const root = new URL('../', import.meta.url);
  const years = await getJson(`${SHNATON_API}/reference-data/active-years`);
  const year = Number(process.env.SHNATON_YEAR) || years.find((y) => y.current)?.year;
  if (!year) throw new Error('no current Shnaton year');

  const courses = new Map();
  for (const p of PERIODS) {
    const list = await getJson(`${SHNATON_API}/courses/search-advanced?include=1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ year, semesters: [p] }),
    });
    if (!Array.isArray(list)) throw new Error(`search period ${p}: ${JSON.stringify(list).slice(0, 120)}`);
    for (const c of list) courses.set(c.id, { id: c.id, code: c.code, name: c.name });
    console.log(`period ${p}: ${list.length} courses`);
  }

  const chunks = chunkIds([...courses.keys()]);
  const groupsByCourse = {};
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const ids = chunks[next++];
      try {
        Object.assign(groupsByCourse, await getJson(`${SHNATON_API}/courses/groups-with-sessions?year=${year}&courseIds=${ids.join(',')}`));
      } catch (err) {
        failed++;
        console.log(`chunk failed: ${err.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`${courses.size} courses in ${chunks.length} requests, ${failed} failed`);
  if (failed > chunks.length * 0.05) throw new Error('too many failed requests — keeping the old data');

  const { data, stats } = buildRooms([...courses.values()], groupsByCourse, { year });
  const count = (d) => Object.values(d.s).reduce((n, l) => n + l.length, 0);
  console.log(`sessions ${stats.sessions} (Givat Ram without dates ${stats.noDates}, online ${stats.online}, other campus ${stats.otherCampus}, no room ${stats.noRoom})`);
  console.log(`${CAMPUS.name}: ${Object.keys(data.buildings).length} buildings, ${Object.keys(data.rooms).length} rooms, ${count(data)} entries`);
  if (!Object.keys(data.rooms).length) throw new Error(`no rooms on campus ${CAMPUS.code} (${CAMPUS.name}) — did the API change?`);

  const out = new URL('data.json', root);
  if (existsSync(out)) {
    const prev = JSON.parse(readFileSync(out, 'utf8'));
    // a sudden collapse is an API glitch, not a change
    if (prev.year === year && count(data) < count(prev) / 2 && process.env.FORCE !== 'true') {
      throw new Error(`only ${count(data)} entries (was ${count(prev)}) — keeping the old data (FORCE=true to override)`);
    }
    const { builtAt: _a, ...prevRest } = prev;
    if (JSON.stringify(prevRest) === JSON.stringify(data)) { console.log('no change'); return; }
  }
  const text = JSON.stringify({ ...data, builtAt: new Date().toISOString() });
  writeFileSync(out, text);
  console.log(`wrote data.json (${Math.round(text.length / 1024)} KB)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ''))) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}

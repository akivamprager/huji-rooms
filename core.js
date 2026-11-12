// Pure logic over data.json (format: see tools/rooms.mjs). No DOM, so it runs in tests too.
// Days are "day numbers" (days since 1970-01-01, by calendar date), times are minutes from midnight.

export const GAP = 15; // a break this short between two meetings doesn't make a room usable

export const dayOf = (date) => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
export const dateOf = (day) => { const d = new Date(day * 86400000); return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
export const weekday = (day) => (day + 4) % 7; // 0 = Sunday (1970-01-01 was a Thursday)
export const hm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export function decode(data) {
  const buildings = Object.entries(data.buildings).map(([code, name]) => ({ code, name }));
  const rooms = new Map();
  for (const [id, [name, b]] of Object.entries(data.rooms)) {
    rooms.set(id, { id, name, building: b, buildingName: data.buildings[b] || b });
  }
  // roomId → day → meetings that day, sorted by start
  const byRoom = new Map();
  for (const [id, list] of Object.entries(data.s)) {
    const days = new Map();
    for (const [course, group, type, start, end, first, ...deltas] of list) {
      const ev = { course, name: data.courses[course] || course, group, type: data.types[type] || '', start, end };
      let d = first;
      for (let i = -1; i < deltas.length; i++) {
        if (i >= 0) d += deltas[i];
        let arr = days.get(d);
        if (!arr) days.set(d, (arr = []));
        arr.push(ev);
      }
    }
    for (const arr of days.values()) arr.sort((a, b) => a.start - b.start || a.end - b.end);
    byRoom.set(id, days);
  }
  const allDays = [...byRoom.values()].flatMap((m) => [...m.keys()]);
  return {
    year: data.year, campus: data.campus, builtAt: data.builtAt, buildings, rooms, byRoom,
    firstDay: Math.min(...allDays), lastDay: Math.max(...allDays),
  };
}

export const eventsOn = (db, roomId, day) => db.byRoom.get(roomId)?.get(day) || [];

// Is the room in use at `minute` of `day`?
//   busy: { now: [meetings], until }  (until = end of the run of meetings, short breaks bridged)
//   free: { now: [], until, next }    (until = start of the next meeting that day, or null)
export function statusAt(db, roomId, day, minute) {
  const evs = eventsOn(db, roomId, day);
  const now = evs.filter((e) => e.start <= minute && minute < e.end);
  if (now.length) {
    let until = Math.max(...now.map((e) => e.end));
    for (const e of evs) if (e.start > minute && e.start <= until + GAP) until = Math.max(until, e.end);
    return { busy: true, now, until };
  }
  const next = evs.find((e) => e.start > minute) || null;
  return { busy: false, now: [], until: next ? next.start : null, next };
}

// Rooms of a building (or all, building = null) at that moment.
//   free: [{ room, until }] — longest free first (null = free for the rest of the day)
//   busy: [{ room, now, until }] — soonest free first
export function freeRooms(db, { building = null, day, minute }) {
  const free = [];
  const busy = [];
  for (const room of db.rooms.values()) {
    if (building && room.building !== building) continue;
    const st = statusAt(db, room.id, day, minute);
    if (st.busy) busy.push({ room, now: st.now, until: st.until });
    else free.push({ room, until: st.until });
  }
  const byName = (a, b) => a.room.name.localeCompare(b.room.name, 'he', { numeric: true });
  free.sort((a, b) => (b.until ?? 1e9) - (a.until ?? 1e9) || byName(a, b));
  busy.sort((a, b) => a.until - b.until || byName(a, b));
  return { free, busy };
}

// Free-text room search: every word must appear in the room's or building's name.
export function searchRooms(db, query) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const list = [...db.rooms.values()].filter((r) => {
    const hay = `${r.name} ${r.buildingName}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  return list.sort((a, b) => a.buildingName.localeCompare(b.buildingName, 'he') || a.name.localeCompare(b.name, 'he', { numeric: true }));
}

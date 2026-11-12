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

// ---- nearest free room ----
// Straight-line distance in metres between two [lat, lon] points.
export function distance([lat1, lon1], [lat2, lon2]) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * rad) / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
// Walking minutes for a walking distance, at ~80 m a minute (about 5 km/h, like maps apps).
export const walkMinutes = (m) => Math.max(1, Math.round(m / 80));
// Without a route, a straight line stands in for the path: paths are ~30% longer.
const STRAIGHT_TO_PATH = 1.3;

// Free rooms at that moment, closest first; dist = walking metres. walk: { buildingCode: metres }
// from walkingDistances (real paths); buildings it doesn't cover fall back to locs ({ code: [lat, lon] })
// and a straight line. Rooms the same number of walking minutes away count as equally close:
// among them, the one that stays free longer comes first.
// perBuilding caps how many rooms one building contributes, so the next buildings show up too.
export function nearestFree(db, locs, here, { day, minute, limit = 8, perBuilding = 3, walk = null }) {
  const { free } = freeRooms(db, { day, minute });
  const taken = {};
  const dist = (code) => walk?.[code] ?? (locs[code] ? distance(here, locs[code]) * STRAIGHT_TO_PATH : null);
  return free
    .map((x) => ({ ...x, dist: dist(x.room.building) }))
    .filter((x) => x.dist != null)
    .sort((a, b) => walkMinutes(a.dist) - walkMinutes(b.dist) || (b.until ?? 1e9) - (a.until ?? 1e9) || a.dist - b.dist)
    .filter(({ room }) => (taken[room.building] = (taken[room.building] || 0) + 1) <= perBuilding)
    .slice(0, limit);
}

// ---- walking routes on the campus's pedestrian paths (paths/<campus>.json, see tools/paths.mjs) ----
export function decodePaths(p) {
  const count = p.n.length / 2;
  const lat = new Float64Array(count);
  const lon = new Float64Array(count);
  for (let i = 0; i < count; i++) { lat[i] = p.origin[0] + p.n[2 * i] / 1e5; lon[i] = p.origin[1] + p.n[2 * i + 1] / 1e5; }
  const adj = Array.from({ length: count }, () => []);
  for (let k = 0; k < p.w.length; k++) {
    const a = p.e[2 * k];
    const b = p.e[2 * k + 1];
    adj[a].push(b, p.w[k]);
    adj[b].push(a, p.w[k]);
  }
  return { lat, lon, adj, edges: p.e, w: p.w, b: p.b, o: p.o || {} };
}

// Metres from `p` to the outline of a building made of `rings` ([[lat, lon], ...]); 0 if inside.
export function toOutline(p, rings) {
  const ky = 110540;
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const ay = (ring[j][0] - p[0]) * ky; const ax = (ring[j][1] - p[1]) * kx;
      const by = (ring[k][0] - p[0]) * ky; const bx = (ring[k][1] - p[1]) * kx;
      if ((ay > 0) !== (by > 0) && ax + ((0 - ay) * (bx - ax)) / (by - ay) > 0) inside = !inside;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return inside ? 0 : best;
}

// Walking metres from `here` to every building (shortest path, like a maps app), or null if `here`
// is too far from any campus path to route from.
export function walkingDistances(g, here, opts = {}) {
  const tree = walkingTree(g, here, opts);
  return tree && tree.toBuildings;
}

// Routes use ONLY the pedestrian paths: from `here` straight to the nearest point of a path, along
// the paths, and into a building from a path point next to its outline. The one exception: if you're
// in a building or within NEXT_TO metres of its outline, you just walk in.
// Returns { dist, prev (previous node, -1 = start), toBuildings,
//           entry: { buildingCode: node the route enters the building from, -1 = walk straight in } }.
// locs ({ code: [lat, lon] }) stands in for outlines a building doesn't have.
const NEXT_TO = 20;
export function walkingTree(g, here, { maxSnap = 400, locs = null } = {}) {
  const ky = 110540;
  const kx = 111320 * Math.cos((here[0] * Math.PI) / 180);
  const X = (i) => (g.lon[i] - here[1]) * kx;
  const Y = (i) => (g.lat[i] - here[0]) * ky;
  // the closest point on any path segment
  let best = null;
  for (let k = 0; k < g.w.length; k++) {
    const a = g.edges[2 * k];
    const b = g.edges[2 * k + 1];
    const ax = X(a); const ay = Y(a); const bx = X(b); const by = Y(b);
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || d < best.d) best = { d, a, b, t, k };
  }
  if (!best || best.d > maxSnap) return null;
  // Dijkstra from both ends of that segment
  const dist = new Float64Array(g.lat.length).fill(Infinity);
  const prev = new Int32Array(g.lat.length).fill(-1);
  const heap = [];
  const push = (node, d, from = -1) => {
    if (d >= dist[node]) return;
    dist[node] = d;
    prev[node] = from;
    heap.push([d, node]);
    for (let i = heap.length - 1; i > 0;) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1; const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const segLen = g.w[best.k];
  push(best.a, best.d + segLen * best.t);
  push(best.b, best.d + segLen * (1 - best.t));
  while (heap.length) {
    const [d, node] = pop();
    if (d > dist[node]) continue;
    const nb = g.adj[node];
    for (let i = 0; i < nb.length; i += 2) push(nb[i], d + nb[i + 1], node);
  }
  const toBuildings = {};
  const entry = {};
  const codes = new Set([...Object.keys(g.b), ...Object.keys(locs || {})]);
  for (const code of codes) {
    let m = Infinity;
    const list = g.b[code] || [];
    for (let i = 0; i < list.length; i += 2) {
      const v = dist[list[i]] + list[i + 1];
      if (v < m) { m = v; entry[code] = list[i]; }
    }
    const next = g.o[code] ? toOutline(here, g.o[code]) : locs?.[code] ? Math.max(0, distance(here, locs[code]) - 10) : Infinity;
    if (next <= NEXT_TO && next < m) { m = next; entry[code] = -1; }
    if (m < Infinity) toBuildings[code] = m;
  }
  return { dist, prev, toBuildings, entry };
}

// The route to a building as [lat, lon] points, from `here` to where it enters the building.
export function routeTo(g, tree, here, code) {
  const pts = [];
  for (let n = tree.entry[code] ?? -1; n >= 0; n = tree.prev[n]) pts.push([g.lat[n], g.lon[n]]);
  pts.push(here);
  return pts.reverse();
}

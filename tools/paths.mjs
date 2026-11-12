// Builds paths/<campus>.json: the campus's walkable network (pedestrian paths and roads), taken ONLY
// from the university's own campus map (ArcGIS layers in campuses.js → mapPaths), so routes never cut
// across lawns or hedges. The app finds the shortest walk on this network on the device itself; no one's
// location is sent anywhere. Run by hand when the campus map changes:
//   node tools/paths.mjs <campus id, default gr>
// Map data © the Hebrew University GIS center.
//
// Output: { v, origin: [lat, lon], n: [dLat, dLon, ...] (1e-5° steps from origin),
//           e: [a, b, ...] (node index pairs), w: [metres, ...] (one per edge),
//           b: { buildingCode: [node, metres, ...] } — path points within ENTRY metres of the
//              building's outline (and how far), where a walk can enter it,
//           o: { buildingCode: [[[lat, lon], ...], ...] } — the building's outlines (so the app
//              knows when you're standing in it) }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { distance } from '../core.js';
import { campusById } from '../campuses.js';

const campus = campusById(process.argv[2] || 'gr');
const root = new URL('../', import.meta.url);
const SNAP = 1.5; // points of different map lines closer than this are the same point
const TIE = 3; // a loose path end this close to another path joins it (drawing gaps)
const ENTRY = 15; // a path point this close to a building's outline is a way in

async function features(layer, { geometry = 'paths' } = {}) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const q = new URLSearchParams({
      where: layer.where || '1=1', outFields: layer.fields || '*', outSR: '4326', f: 'json', returnGeometry: 'true',
      geometryPrecision: '6', resultOffset: offset, resultRecordCount: 1000,
    });
    const j = await (await fetch(`${layer.url}/query?${q}`)).json();
    if (j.error) throw new Error(`${layer.url}: ${j.error.message}`);
    for (const f of j.features || []) out.push({ attributes: f.attributes, parts: (f.geometry?.[geometry] || []).map((p) => p.map(([lon, lat]) => [lat, lon])) });
    if (!j.exceededTransferLimit) break;
  }
  return out;
}

const origin = [campus.bbox[0], campus.bbox[1]];
const n = [];
const e = [];
const w = [];
const point = (i) => [origin[0] + n[2 * i] / 1e5, origin[1] + n[2 * i + 1] / 1e5];
const cell = 0.0002; // ~20 m grid for finding nearby points
const grid = new Map();
const key = (lat, lon) => `${Math.floor(lat / cell)},${Math.floor(lon / cell)}`;
const nearest = (p, maxD, skip = new Set()) => {
  let best = -1;
  let bestD = maxD;
  const [ci, cj] = key(p[0], p[1]).split(',').map(Number);
  for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
    for (const i of grid.get(`${ci + di},${cj + dj}`) || []) {
      if (skip.has(i)) continue;
      const d = distance(p, point(i));
      if (d < bestD) { bestD = d; best = i; }
    }
  }
  return best;
};
const addNode = (p) => {
  n.push(Math.round((p[0] - origin[0]) * 1e5), Math.round((p[1] - origin[1]) * 1e5));
  const i = n.length / 2 - 1;
  const k = key(...point(i));
  if (!grid.has(k)) grid.set(k, []);
  grid.get(k).push(i);
  return i;
};
const addEdge = (a, b, metres) => { if (a !== b) { e.push(a, b); w.push(Math.round(metres * 10) / 10); } };

// ---- the pedestrian paths ----
let lines = 0;
const ends = [];
for (const layer of campus.mapPaths) {
  for (const f of await features(layer)) {
    for (const line of f.parts) {
      lines++;
      let prev = -1;
      let prevPt = null;
      line.forEach((p, k) => {
        let i = nearest(p, SNAP);
        if (i < 0) i = addNode(p);
        if (prev >= 0) addEdge(prev, i, distance(prevPt, p));
        if (k === 0 || k === line.length - 1) ends.push(i);
        prev = i;
        prevPt = p;
      });
    }
  }
}
const degree = new Map();
for (const x of e) degree.set(x, (degree.get(x) || 0) + 1);
let tied = 0;
for (const i of ends) {
  if (degree.get(i) !== 1) continue;
  const nb = new Set([i]);
  for (let k = 0; k < e.length; k += 2) { if (e[k] === i) nb.add(e[k + 1]); if (e[k + 1] === i) nb.add(e[k]); }
  const j = nearest(point(i), TIE, nb);
  if (j >= 0) { addEdge(i, j, distance(point(i), point(j))); tied++; }
}

// ---- buildings: outlines from the campus map, matched by building number (buildings/<id>.json → map) ----
// distance in metres from p to a polygon's outline (0 inside)
const ky = 110540;
function toOutline(p, rings) {
  const kx = 111320 * Math.cos((p[0] * Math.PI) / 180);
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let k = 0, j = ring.length - 1; k < ring.length; j = k++) {
      const [ay, ax] = [(ring[j][0] - p[0]) * ky, (ring[j][1] - p[1]) * kx];
      const [by, bx] = [(ring[k][0] - p[0]) * ky, (ring[k][1] - p[1]) * kx];
      if ((ay > 0) !== (by > 0) && 0 < ax + ((0 - ay) * (bx - ax)) / (by - ay)) inside = !inside;
      const dx = bx - ax; const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return inside ? 0 : best;
}
const outlines = {};
for (const f of await features(campus.mapBuildings, { geometry: 'rings' })) {
  const num = String(f.attributes[campus.mapBuildings.numberField] ?? '').trim();
  if (num) (outlines[num] ||= []).push(...f.parts);
}
const buildings = JSON.parse(readFileSync(new URL(`buildings/${campus.id}.json`, root), 'utf8'));
const b = {};
const o = {};
for (const [code, info] of Object.entries(buildings)) {
  const rings = (info.map || []).flatMap((num) => outlines[num] || []);
  if (!rings.length) continue;
  o[code] = rings.map((ring) => ring.map(([la, lo]) => [Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6]));
  const near = [];
  let closest = [-1, Infinity];
  for (let i = 0; i < n.length / 2; i++) {
    const d = toOutline(point(i), rings);
    if (d <= ENTRY) near.push(i, Math.round(d));
    if (d < closest[1]) closest = [i, d];
  }
  b[code] = near.length ? near : [closest[0], Math.round(closest[1])];
  if (!near.length) console.log(`  note: ${info.name}: no path within ${ENTRY} m of the outline (closest ${Math.round(closest[1])} m)`);
}

const text = JSON.stringify({ v: 2, origin, n, e, w, b, o });
mkdirSync(new URL('paths/', root), { recursive: true });
writeFileSync(new URL(`paths/${campus.id}.json`, root), text);
console.log(`${campus.name}: ${lines} path lines → ${n.length / 2} points, ${w.length} segments (${tied} gaps joined), ${Object.keys(b).length} buildings, ${Math.round(text.length / 1024)} KB`);

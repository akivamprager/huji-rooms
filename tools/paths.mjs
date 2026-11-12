// Builds paths.json: the walking network of the Givat Ram campus (footways, stairs, plazas, campus
// roads) from OpenStreetMap, so the app can find real walking routes on the device itself, the way
// a maps app does, without sending anyone's location anywhere. Paths rarely change: run by hand
// (node tools/paths.mjs) when OpenStreetMap is updated. Data © OpenStreetMap contributors (ODbL).
//
// Output: { v, bbox, origin: [lat, lon], n: [dLat, dLon, ...] (1e-5° steps from origin),
//           e: [a, b, ...] (node index pairs), w: [metres, ...] (one per edge),
//           b: { buildingCode: [node, metres, node, metres, ...] } — path points within LINK metres of
//              the building (its location is its centre), so it can be entered from any side }
// --relink: only recompute b from the existing paths.json (after buildings.json changes), no download.
import { readFileSync, writeFileSync } from 'node:fs';
import { distance } from '../core.js';

const BBOX = [31.7680, 35.1915, 31.7810, 35.2030]; // south, west, north, east
const WALKABLE = 'footway|path|pedestrian|steps|service|residential|living_street|cycleway|unclassified|tertiary|tertiary_link|secondary|corridor|track';
const STEPS_FACTOR = 1.3; // stairs take longer than their length

const query = `[out:json][timeout:100];
way["highway"~"^(${WALKABLE})$"]["access"!~"^(no)$"]["foot"!~"^(no)$"](${BBOX.join(',')});
out body; >; out skel qt;`;

async function overpass() {
  for (let i = 0, wait = 5000; i < 6; i++, wait *= 2) {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'huji-rooms-builder/1.0' },
    });
    const text = await r.text();
    if (r.ok && text.trimStart().startsWith('{')) return JSON.parse(text);
    console.log(`Overpass busy (${r.status}), retrying in ${wait / 1000}s`);
    await new Promise((res) => setTimeout(res, wait));
  }
  throw new Error('Overpass unavailable');
}

const LINK = 70;
const root = new URL('../', import.meta.url);
const relink = process.argv.includes('--relink');
let n = [];
let e = [];
let w = [];
const origin = [BBOX[0], BBOX[1]];
let ways = [];
if (relink) ({ n, e, w } = JSON.parse(readFileSync(new URL('paths.json', root), 'utf8')));
else {
const osm = await overpass();
const coords = new Map(osm.elements.filter((e) => e.type === 'node').map((e) => [e.id, [e.lat, e.lon]]));
ways = osm.elements.filter((x) => x.type === 'way');
const index = new Map(); // OSM node id → our index
const idx = (id) => {
  if (!index.has(id)) {
    const [lat, lon] = coords.get(id);
    index.set(id, index.size);
    n.push(Math.round((lat - origin[0]) * 1e5), Math.round((lon - origin[1]) * 1e5));
  }
  return index.get(id);
};
for (const way of ways) {
  const factor = way.tags?.highway === 'steps' ? STEPS_FACTOR : 1;
  for (let i = 1; i < way.nodes.length; i++) {
    const [a, b] = [way.nodes[i - 1], way.nodes[i]];
    if (!coords.has(a) || !coords.has(b)) continue;
    e.push(idx(a), idx(b));
    w.push(Math.round(distance(coords.get(a), coords.get(b)) * factor * 10) / 10);
  }
}
}

// each building → the closest point of the network (its location is the building's centre)
const pt = (i) => [origin[0] + n[2 * i] / 1e5, origin[1] + n[2 * i + 1] / 1e5];
const buildings = JSON.parse(readFileSync(new URL('buildings.json', root), 'utf8'));
const b = {};
for (const [code, info] of Object.entries(buildings)) {
  if (!info.loc) continue;
  const near = [];
  let closest = [-1, Infinity];
  for (let i = 0; i < n.length / 2; i++) {
    const d = distance(info.loc, pt(i));
    if (d <= LINK) near.push(i, Math.round(d));
    if (d < closest[1]) closest = [i, d];
  }
  b[code] = near.length ? near : [closest[0], Math.round(closest[1])];
}

const out = { v: 1, bbox: BBOX, origin, n, e, w, b };
const text = JSON.stringify(out);
writeFileSync(new URL('paths.json', root), text);
console.log(`${relink ? 'relinked' : `${ways.length} ways`} → ${n.length / 2} nodes, ${w.length} edges, ${Object.keys(b).length} buildings, ${Math.round(text.length / 1024)} KB`);
for (const [code, [, d]] of Object.entries(b)) if (d > LINK) console.log(`  note: building ${buildings[code].name} is ${d} m from the nearest path`);

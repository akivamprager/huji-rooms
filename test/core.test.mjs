import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, statusAt, freeRooms, searchRooms, dayOf, weekday, eventsOn, distance, walkMinutes, nearestFree, decodePaths, walkingDistances } from '../core.js';
import { buildRooms, chunkIds, dayNum, fixUndefinedBuildings } from '../tools/rooms.mjs';

const room = (id, name, campus = '1', b = '10') => ({ id, name: { he: name }, building: { code: b, name: { he: 'פלדמן' }, campus: { code: campus } } });
const A = room(1, 'פלדמן א');
const B = room(2, 'פלדמן ב');
const far = room(3, 'הר הצופים 1', '0', '90');
const dates = (...ds) => ds.map((date) => ({ date: `${date}T00:00:00` }));

const courses = [{ id: 11, code: '80430', name: { he: ' הסתברות ' } }, { id: 12, code: '67101', name: { he: 'מבוא' } }];
const groups = {
  11: [{ code: '1-01', studySessionTypeName: { he: 'שעור' }, studySessions: [{
    room: A, startTime: 600 * 60000, endTime: 705 * 60000,
    studySessionSchedules: [
      ...dates('2026-10-11', '2026-10-18'),
      { date: '2026-10-25T00:00:00', room: B }, // moved for one date
      { date: '2026-11-01T00:00:00', startTime: 720 * 60000, endTime: 825 * 60000 }, // other time
      { date: '2026-11-08T00:00:00', isOnline: true },
    ],
  }] }],
  12: [{ code: '2-01', studySessionTypeName: { he: 'תרגיל' }, studySessions: [
    { room: A, startTime: 720 * 60000, endTime: 765 * 60000, studySessionSchedules: dates('2026-10-11') },
    { room: far, startTime: 0, endTime: 60 * 60000, studySessionSchedules: dates('2026-10-11') },
  ] }],
};

const { data } = buildRooms(courses, groups, { year: 2027 });
const db = decode(data);
const d11 = dayNum('2026-10-11');

test('only Givat Ram rooms, names trimmed', () => {
  assert.deepEqual(Object.keys(data.rooms).sort(), ['1', '2']);
  assert.equal(data.courses['80430'], 'הסתברות');
});

test('per-date room / time changes and online dates', () => {
  assert.equal(eventsOn(db, '1', d11).length, 2);
  assert.equal(eventsOn(db, '1', dayNum('2026-10-25')).length, 0);
  assert.equal(eventsOn(db, '2', dayNum('2026-10-25'))[0].course, '80430');
  assert.equal(eventsOn(db, '1', dayNum('2026-11-01'))[0].start, 720);
  assert.equal(eventsOn(db, '1', dayNum('2026-11-08')).length, 0);
});

test('statusAt bridges short breaks', () => {
  const busy = statusAt(db, '1', d11, 610);
  assert.equal(busy.busy, true);
  assert.equal(busy.until, 765); // 10:00–11:45, then 12:00–12:45
  const free = statusAt(db, '1', d11, 540);
  assert.deepEqual([free.busy, free.until], [false, 600]);
  assert.equal(statusAt(db, '1', d11, 800).until, null);
});

test('freeRooms: free longest first, busy soonest free first', () => {
  const r = freeRooms(db, { building: '10', day: d11, minute: 610 });
  assert.deepEqual(r.free.map((x) => x.room.id), ['2']);
  assert.deepEqual(r.busy.map((x) => [x.room.id, x.until]), [['1', 765]]);
});

test('search, days, chunking', () => {
  assert.deepEqual(searchRooms(db, 'פלדמן ב').map((r) => r.id), ['2']);
  assert.equal(weekday(d11), 0); // 11.10.2026 is a Sunday
  assert.equal(dayOf(new Date(2026, 9, 11, 23, 30)), d11);
  for (const c of chunkIds(Array.from({ length: 100 }, (_, i) => 500000 + i))) assert.ok(c.join(',').length <= 200);
});

test('rooms under "לא מוגדר" move to the building in their name, else to "אחר"', () => {
  const d = fixUndefinedBuildings({
    buildings: { 5: 'ברגמן', 9: 'דנציגר א', 99: 'לא מוגדר' },
    rooms: { 1: ['בנין ברגמן', '99'], 2: ['דנציגר א 10', '99'], 3: ['חדר 7', '99'], 4: ['ברגמן 2', '5'] },
  });
  assert.deepEqual(Object.fromEntries(Object.entries(d.rooms).map(([k, v]) => [k, v[1]])), { 1: '5', 2: '9', 3: 'other', 4: '5' });
  assert.equal(d.buildings[99], undefined);
  assert.equal(d.buildings.other, 'אחר');
});

test('nearestFree: closest building first, skips buildings without a location', () => {
  // room 1 is busy 10:00–12:45 on 11.10, room 2 is free; both in building 10
  const near = nearestFree(db, { 10: [31.7766, 35.1979] }, [31.7770, 35.1979], { day: d11, minute: 610 });
  assert.deepEqual(near.map((x) => x.room.id), ['2']);
  assert.ok(near[0].dist > 52 && near[0].dist < 64); // 0.0004° of latitude ≈ 44 m, × 1.3 without a route
  assert.deepEqual(nearestFree(db, {}, [31.77, 35.19], { day: d11, minute: 610 }), []);
  assert.equal(Math.round(distance([31.7766, 35.1979], [31.7766, 35.1979])), 0);
  assert.equal(walkMinutes(10), 1);
  assert.equal(walkMinutes(400), 5);
});

test('nearestFree: among equally close rooms, the one free for longer comes first', () => {
  // at 11:50 on 11.10: room 1 (building 10) is free until 12:00, room 2 (building 20, ~30 m further) all day
  const d = decode(buildRooms(courses, groups, { year: 2027 }).data);
  d.rooms.get('2').building = '20';
  const here = [31.7770, 35.1979];
  const near = nearestFree(d, { 10: here, 20: [31.77727, 35.1979] }, here, { day: d11, minute: 710 });
  assert.deepEqual(near.map((x) => [x.room.id, x.until]), [['2', null], ['1', 720]]);
  // a much further room does not jump ahead
  const far = nearestFree(d, { 10: here, 20: [31.7800, 35.1979] }, here, { day: d11, minute: 710 });
  assert.deepEqual(far.map((x) => x.room.id), ['1', '2']);
});

test('walkingDistances follows the paths, not a straight line', () => {
  // an L-shaped path: here (0,0) → corner (0, +100 m east) → building (100 m north of the corner)
  const o = [31.77, 35.19];
  const east = 100 / (111320 * Math.cos((o[0] * Math.PI) / 180)) * 1e5;
  const north = 100 / 110540 * 1e5;
  const g = decodePaths({ origin: o, n: [0, 0, 0, Math.round(east), Math.round(north), Math.round(east)], e: [0, 1, 1, 2], w: [100, 100], b: { 7: [2, 5] } });
  const d = walkingDistances(g, o);
  assert.ok(Math.abs(d[7] - 205) < 3, String(d[7])); // 100 + 100 + 5, not the 141 m diagonal
  assert.equal(walkingDistances(g, [31.80, 35.19]), null); // kilometres away: no route
  // used by nearestFree instead of the straight line
  const near = nearestFree(db, { 10: [31.7766, 35.1979] }, [31.7770, 35.1979], { day: d11, minute: 610, walk: { 10: 300 } });
  assert.equal(near[0].dist, 300);
});

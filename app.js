import { decode, statusAt, freeRooms, searchRooms, eventsOn, dayOf, dateOf, weekday, hm } from './core.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const FROM = 8 * 60;
const TO = 21 * 60;
const LS = 'huji-rooms.last';
const LS_FAV = 'huji-rooms.favorites';

// favorites: { rooms: [id], buildings: [code] }, kept in this browser
const fav = (() => {
  let v;
  try { v = JSON.parse(localStorage.getItem(LS_FAV)) || {}; } catch { v = {}; }
  v.rooms ||= []; v.buildings ||= [];
  return v;
})();
const isFav = (kind, id) => fav[kind].includes(id);
function toggleFav(kind, id) {
  fav[kind] = isFav(kind, id) ? fav[kind].filter((x) => x !== id) : [...fav[kind], id];
  localStorage.setItem(LS_FAV, JSON.stringify(fav));
}
const star = (kind, id, label) => `<button class="star" data-fav="${kind}" data-id="${esc(id)}" aria-pressed="${isFav(kind, id)}"
  title="${isFav(kind, id) ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}" aria-label="${isFav(kind, id) ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}: ${esc(label)}">${isFav(kind, id) ? '★' : '☆'}</button>`;

let db;
const state = { tab: 'room', room: null, week: null, building: '', day: null, minute: null };

const nowDay = () => dayOf(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const weekStart = (day) => day - weekday(day);
const dm = (day) => { const d = dateOf(day); return `${d.getDate()}.${d.getMonth() + 1}`; };
const isoOf = (day) => { const d = dateOf(day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const evText = (e) => `${e.name} · ${e.type} \u2066${e.group}\u2069`;

// ---- state ↔ URL hash (so a room or a search can be shared) ----
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('free')) {
    state.tab = 'free';
    state.building = p.get('free') || '';
    state.day = p.has('d') ? Number(p.get('d')) : null;
    state.minute = p.has('t') ? Number(p.get('t')) : null;
  } else {
    state.tab = 'room';
    state.room = p.get('room') || (p.toString() ? null : localStorage.getItem(LS));
    if (state.room && !db.rooms.has(state.room)) state.room = null;
    state.week = p.has('w') ? Number(p.get('w')) : null;
  }
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.tab === 'free') {
    p.set('free', state.building);
    if (state.day != null) p.set('d', state.day);
    if (state.minute != null) p.set('t', state.minute);
  } else if (state.room) {
    p.set('room', state.room);
    if (state.week != null) p.set('w', state.week);
  }
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}

function render() {
  writeHash();
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  $('tab-room').hidden = state.tab !== 'room';
  $('tab-free').hidden = state.tab !== 'free';
  if (state.tab === 'room') renderRoom(); else renderFree();
}

// ---- room tab ----
const roomChip = (r, withBuilding = false) => {
  const st = statusAt(db, r.id, nowDay(), nowMin());
  const until = st.busy ? ` · עד ${hm(st.until)}` : st.until != null ? ` · עד ${hm(st.until)}` : '';
  return `<button class="chip ${st.busy ? 'busy' : 'free'}" data-room="${esc(r.id)}" title="${st.busy ? 'תפוס' : 'פנוי'} עכשיו${until}">${
    withBuilding ? `<span class="muted">${esc(r.buildingName)}</span> ` : ''}${esc(r.name)}${withBuilding ? `<span class="muted small">${until}</span>` : ''}</button>`;
};

function renderRoomList() {
  const list = searchRooms(db, $('room-q').value);
  let html = '';
  const favRooms = list.filter((r) => isFav('rooms', r.id));
  if (favRooms.length) html += `<h3>★ חדרים מועדפים</h3><div class="chips">${favRooms.map((r) => roomChip(r, true)).join('')}</div>`;
  // favorite buildings first
  const groups = new Map();
  for (const r of list) {
    if (!groups.has(r.building)) groups.set(r.building, []);
    groups.get(r.building).push(r);
  }
  const order = [...groups.keys()].sort((a, b) => isFav('buildings', b) - isFav('buildings', a));
  for (const b of order) {
    const rooms = groups.get(b);
    html += `<h3 class="bhead">${star('buildings', b, rooms[0].buildingName)}${esc(rooms[0].buildingName)}</h3><div class="chips">${rooms.map((r) => roomChip(r)).join('')}</div>`;
  }
  $('room-list').innerHTML = html || '<p class="muted">לא נמצא חדר כזה.</p>';
}

function statusText(st, day, minute) {
  if (day < db.firstDay || day > db.lastDay) return { cls: '', html: 'אין מפגשים בשנתון בתאריך הזה.' };
  if (st.busy) {
    return { cls: 'busy', html: `<b>תפוס</b> עד ${hm(st.until)} — ${st.now.map((e) => esc(evText(e))).join(', ')}` };
  }
  if (st.until == null) return { cls: 'free', html: `<b>פנוי</b> עד סוף היום${minute < FROM ? '' : ''}` };
  return { cls: 'free', html: `<b>פנוי</b> עד ${hm(st.until)} (אז: ${esc(evText(st.next))})` };
}

function renderRoom() {
  const room = state.room && db.rooms.get(state.room);
  $('room-pick').hidden = !!room;
  $('room-view').hidden = !room;
  if (!room) { renderRoomList(); return; }
  localStorage.setItem(LS, room.id);
  $('room-name').innerHTML = `${esc(room.name)} ${star('rooms', room.id, room.name)}`;
  $('room-building').textContent = `בניין ${room.buildingName}`;
  const today = nowDay();
  const st = statusText(statusAt(db, room.id, today, nowMin()), today, nowMin());
  $('room-status').className = `status ${st.cls}`;
  $('room-status').innerHTML = `עכשיו: ${st.html}`;

  const start = state.week ?? weekStart(today);
  $('week-label').textContent = `\u2066${dm(start)}–${dm(start + 5)}\u2069`;
  const hours = [];
  for (let m = FROM; m < TO; m += 60) hours.push(`<div class="hour" data-top="${(m - FROM) / (TO - FROM)}">${hm(m)}</div>`);
  let cols = '';
  for (let i = 0; i < 6; i++) {
    const day = start + i;
    const evs = eventsOn(db, room.id, day);
    const blocks = evs.map((e) => {
      const top = (Math.max(e.start, FROM) - FROM) / (TO - FROM);
      const h = (Math.min(e.end, TO) - Math.max(e.start, FROM)) / (TO - FROM);
      const lecture = /שעור|שיעור/.test(e.type);
      return `<div class="ev ${lecture ? 'lec' : 'rec'}" data-top="${top}" data-h="${h}" title="${esc(`${evText(e)}\n${hm(e.start)}–${hm(e.end)}\nקורס ${e.course}`)}">
        <b>${esc(e.name)}</b><span>${esc(e.type)} <bdi>${esc(e.group)}</bdi> · <bdi>${hm(e.start)}–${hm(e.end)}</bdi></span></div>`;
    }).join('');
    const line = day === today && nowMin() >= FROM && nowMin() < TO ? `<div class="now" data-top="${(nowMin() - FROM) / (TO - FROM)}"></div>` : '';
    cols += `<div class="col${day === today ? ' today' : ''}"><div class="col-head">${DAYS[i]} <span class="muted">${dm(day)}</span></div>
      <div class="col-body">${blocks}${line}</div></div>`;
  }
  $('week').innerHTML = `<div class="hours"><div class="col-head"></div><div class="col-body">${hours.join('')}</div></div>${cols}`;
  // positions go through CSSOM: the CSP (style-src 'self') blocks inline style attributes
  for (const el of $('week').querySelectorAll('[data-top]')) {
    el.style.setProperty('--top', el.dataset.top);
    if (el.dataset.h) el.style.setProperty('--h', el.dataset.h);
  }
}

// ---- free rooms tab ----
function renderFree() {
  const day = state.day ?? nowDay();
  const minute = state.minute ?? nowMin();
  $('free-building').value = state.building;
  $('free-favs').innerHTML = (state.building ? star('buildings', state.building, db.buildings.find((b) => b.code === state.building)?.name || '') : '')
    + fav.buildings.filter((b) => db.buildings.some((x) => x.code === b)).map((b) => `<button class="chip${b === state.building ? ' on' : ''}" data-building="${esc(b)}">★ ${esc(db.buildings.find((x) => x.code === b).name)}</button>`).join('');
  $('free-date').value = isoOf(day);
  $('free-time').value = hm(minute);
  if (day < db.firstDay || day > db.lastDay || weekday(day) === 6) {
    $('free-result').innerHTML = '<p class="muted">אין מפגשים בשנתון בתאריך הזה — כנראה הכול פנוי.</p>';
    return;
  }
  const { free, busy } = freeRooms(db, { building: state.building || null, day, minute });
  const where = (r) => (state.building ? '' : `<span class="muted">${esc(r.buildingName)}</span> `);
  const freeHtml = free.map(({ room, until }) => `<li><button class="link" data-goto="${esc(room.id)}">${where(room)}${esc(room.name)}</button>
    <span class="tag free">${until == null ? 'עד סוף היום' : `עד ${hm(until)}`}</span></li>`).join('');
  const busyHtml = busy.map(({ room, now, until }) => `<li><button class="link" data-goto="${esc(room.id)}">${where(room)}${esc(room.name)}</button>
    <span class="tag busy">מתפנה ב-${hm(until)}</span> <span class="muted small">${esc(now.map((e) => e.name).join(', '))}</span></li>`).join('');
  $('free-result').innerHTML = `
    <h2>פנויים (${free.length})</h2><ul class="results">${freeHtml || '<li class="muted">אין</li>'}</ul>
    <h2>תפוסים (${busy.length})</h2><ul class="results">${busyHtml || '<li class="muted">אין</li>'}</ul>`;
}

// ---- events ----
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); }
  else if (t.dataset.fav) { toggleFav(t.dataset.fav, t.dataset.id); render(); }
  else if (t.dataset.building) { state.building = t.dataset.building === state.building ? '' : t.dataset.building; render(); }
  else if (t.dataset.room) { state.room = t.dataset.room; state.week = null; render(); scrollTo(0, 0); }
  else if (t.dataset.goto) {
    const day = state.day ?? nowDay();
    state.tab = 'room'; state.room = t.dataset.goto; state.week = weekStart(day) === weekStart(nowDay()) ? null : weekStart(day);
    render(); scrollTo(0, 0);
  } else if (t.id === 'room-change') { state.room = null; localStorage.removeItem(LS); render(); $('room-q').focus(); }
  else if (t.dataset.week) {
    const cur = state.week ?? weekStart(nowDay());
    const step = Number(t.dataset.week);
    state.week = step === 0 ? null : cur + 7 * step;
    render();
  } else if (t.id === 'free-now') { state.day = null; state.minute = null; render(); }
});
$('room-q').addEventListener('input', renderRoomList);
$('free-building').addEventListener('change', (e) => { state.building = e.target.value; render(); });
$('free-date').addEventListener('change', (e) => {
  const [y, m, d] = e.target.value.split('-').map(Number);
  if (y) { state.day = dayOf(new Date(y, m - 1, d)); render(); }
});
$('free-time').addEventListener('change', (e) => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.minute = h * 60 + (m || 0); render(); }
});
addEventListener('hashchange', () => { readHash(); render(); });
// keep "now" current when the page stays open
setInterval(() => { if (!document.hidden) render(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && db) render(); });

// ---- start ----
try {
  const res = await fetch('data.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(res.status);
  db = decode(await res.json());
  $('free-building').insertAdjacentHTML('beforeend', db.buildings
    .sort((a, b) => a.name.localeCompare(b.name, 'he'))
    .map((b) => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join(''));
  if (db.builtAt) $('built').textContent = `עודכן: ${new Date(db.builtAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}.`;
  $('loading').remove();
  readHash();
  render();
} catch (err) {
  $('loading').textContent = `לא הצלחתי לטעון את הנתונים (${err.message}).`;
}

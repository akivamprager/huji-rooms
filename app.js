import { decode, statusAt, freeRooms, eventsOn, dayOf, dateOf, weekday, hm, GAP } from './core.js';
import { combo } from './combo.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
const DAYS_SHORT = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳'];
const FROM = 8 * 60;
const TO = 21 * 60;
const LS = 'huji-rooms.last';
const LS_FAV = 'huji-rooms.favorites';
const BOOKING = 'https://www.huji.ac.il/rooms/';
const LTR = (s) => `⁦${s}⁩`;

let db;
let extras = {}; // building code → { aliases: [...] } (buildings.json, optional)
const state = { tab: 'room', building: null, room: null, week: null, dayIdx: null, freeBuilding: null, day: null, minute: null };

const nowDay = () => dayOf(new Date());
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const weekStart = (day) => day - weekday(day);
const dm = (day) => { const d = dateOf(day); return `${d.getDate()}.${d.getMonth() + 1}`; };
const isoOf = (day) => { const d = dateOf(day); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const dur = (m) => (m < 60 ? `${m} דק׳` : m % 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')} שע׳` : `${m / 60} שע׳`);
const inData = (day) => day >= db.firstDay && day <= db.lastDay && weekday(day) !== 6;
const isLecture = (e) => /שעור|שיעור|הרצאה/.test(e.type);
const bName = (code) => db.buildings.find((b) => b.code === code)?.name || '';

// ---- favorites: { rooms: [id], buildings: [code] }, kept in this browser ----
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
const star = (kind, id, label) => {
  const on = isFav(kind, id);
  const t = `${on ? 'הסרה מהמועדפים' : 'הוספה למועדפים'}: ${label}`;
  return `<button class="star" data-fav="${kind}" data-id="${esc(id)}" aria-pressed="${on}" title="${esc(t)}" aria-label="${esc(t)}">${on ? '★' : '☆'}</button>`;
};

// ---- dropdowns ----
// Search ignores quote marks ("מדמח" finds מדמ״ח) and Hebrew typed on an English keyboard
// ("nsnj" → "מדמח", standard Israeli layout).
const norm = (s) => String(s).toLowerCase().replace(/["'״׳`]/g, '');
const KEYS = { q: '/', w: "'", e: 'ק', r: 'ר', t: 'א', y: 'ט', u: 'ו', i: 'ן', o: 'ם', p: 'פ', a: 'ש', s: 'ד', d: 'ג', f: 'כ', g: 'ע',
  h: 'י', j: 'ח', k: 'ל', l: 'ך', ';': 'ף', ',': 'ת', '.': 'ץ', z: 'ז', x: 'ס', c: 'ב', v: 'ה', b: 'נ', n: 'מ', m: 'צ' };
const toHebrew = (q) => q.toLowerCase().replace(/[a-z;,.]/g, (c) => KEYS[c] || c);
const aliases = (code) => extras[code]?.aliases || [];
const matches = (q, ...texts) => {
  const hay = norm(texts.join(' '));
  const test = (query) => norm(query).trim().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  return test(q) || (/[a-z]/i.test(q) && test(toHebrew(q)));
};
const buildingOptions = (withAll) => (q) => {
  const list = db.buildings.filter((b) => matches(q, b.name, ...aliases(b.code)))
    .sort((a, b) => isFav('buildings', b.code) - isFav('buildings', a.code) || a.name.localeCompare(b.name, 'he'));
  const count = (code) => [...db.rooms.values()].filter((r) => r.building === code).length;
  const opts = list.map((b) => ({
    value: b.code, label: b.name, sub: [aliases(b.code)[0], `${count(b.code)} חדרים`].filter(Boolean).join(' · '), group: isFav('buildings', b.code) ? '★ מועדפים' : 'כל הבניינים',
  }));
  return withAll && !q.trim() ? [{ value: '', label: 'כל גבעת רם', sub: `${db.rooms.size} חדרים` }, ...opts] : opts;
};
const roomOptions = (q) => {
  const day = nowDay();
  const min = nowMin();
  return [...db.rooms.values()]
    .filter((r) => (!state.building || r.building === state.building) && matches(q, r.name, ...(state.building ? [] : [r.buildingName, ...aliases(r.building)])))
    .sort((a, b) => isFav('rooms', b.id) - isFav('rooms', a.id)
      || a.buildingName.localeCompare(b.buildingName, 'he') || a.name.localeCompare(b.name, 'he', { numeric: true }))
    .map((r) => {
      const st = statusAt(db, r.id, day, min);
      return {
        value: r.id, label: r.name, dot: st.busy ? 'busy' : 'free',
        sub: st.busy ? `תפוס עד ${hm(st.until)}` : st.until != null ? `פנוי עד ${hm(st.until)}` : 'פנוי',
        group: isFav('rooms', r.id) ? '★ מועדפים' : state.building ? null : r.buildingName,
      };
    });
};

let roomBuildingBox;
let roomBox;
let freeBuildingBox;

// ---- state ↔ URL hash (so a room or a search can be shared) ----
function readHash({ start = false } = {}) {
  const p = new URLSearchParams(location.hash.slice(1));
  // Opening the app plainly (no link to a room or search) with a favorite building:
  // go straight to the rooms free right now in that building (the first one, if several).
  const favB = fav.buildings.find((c) => bName(c));
  if (start && !p.toString() && favB) {
    Object.assign(state, { tab: 'free', freeBuilding: favB, day: null, minute: null });
  } else if (p.has('free')) {
    state.tab = 'free';
    state.freeBuilding = bName(p.get('free')) ? p.get('free') : null;
    state.day = p.has('d') ? Number(p.get('d')) : null;
    state.minute = p.has('t') ? Number(p.get('t')) : null;
  } else {
    state.tab = 'room';
    state.room = p.get('room') || (p.toString() ? null : localStorage.getItem(LS));
    if (state.room && !db.rooms.has(state.room)) state.room = null;
    state.building = state.room ? db.rooms.get(state.room).building : bName(p.get('b')) ? p.get('b') : null;
    state.week = p.has('w') ? Number(p.get('w')) : null;
  }
}
function writeHash() {
  const p = new URLSearchParams();
  if (state.tab === 'free') {
    p.set('free', state.freeBuilding || '');
    if (state.day != null) p.set('d', state.day);
    if (state.minute != null) p.set('t', state.minute);
  } else if (state.room) {
    p.set('room', state.room);
    if (state.week != null) p.set('w', state.week);
  } else if (state.building) p.set('b', state.building);
  const h = p.toString();
  history.replaceState(null, '', h ? `#${h}` : location.pathname + location.search);
}

// ---- header subtitle ----
function renderHero() {
  const code = state.tab === 'room' ? state.building : state.freeBuilding;
  const room = state.tab === 'room' && state.room && db.rooms.get(state.room);
  const aka = code && aliases(code)[0] ? ` (${aliases(code)[0]})` : '';
  $('hero-sub').textContent = room ? `${room.name === room.buildingName ? room.name : `${room.name} · ${room.buildingName}`}${aka}` : code ? `${bName(code)}${aka}` : 'מה תפוס, מה פנוי ומתי — לפי השנתון';
}

function render() {
  writeHash();
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === state.tab));
  $('tab-room').hidden = state.tab !== 'room';
  $('tab-free').hidden = state.tab !== 'free';
  renderHero();
  if (state.tab === 'room') renderRoom(); else renderFree();
}

// ---- favorites row ----
function favChips(forFree) {
  const rooms = forFree ? [] : fav.rooms.filter((id) => db.rooms.has(id)).map((id) => {
    const r = db.rooms.get(id);
    const st = statusAt(db, id, nowDay(), nowMin());
    return `<button class="chip${id === state.room ? ' on' : ''}" data-room="${esc(id)}"><span class="dot ${st.busy ? 'busy' : 'free'}"></span>${esc(r.name)}<span class="chip-sub">${esc(r.buildingName)}</span></button>`;
  });
  const cur = forFree ? state.freeBuilding : state.building;
  const bs = fav.buildings.filter((c) => bName(c)).map((c) =>
    `<button class="chip${c === cur ? ' on' : ''}" data-building="${esc(c)}" data-for="${forFree ? 'free' : 'room'}">🏢 ${esc(bName(c))}</button>`);
  const all = [...rooms, ...bs];
  return all.length ? `<span class="favs-label">★ מועדפים</span>${all.join('')}` : '';
}

// ---- room tab ----
function statusCard(room) {
  const day = nowDay();
  const min = nowMin();
  const head = `<div class="status-head"><span class="status-room">${esc(room.name)}</span>${star('rooms', room.id, room.name)}</div>`;
  if (!inData(day)) {
    return { cls: 'idle', html: `${head}<div class="status-big">אין מפגשים היום</div><div class="status-sub">לפי השנתון אין היום הרצאות או תרגולים בחדר.</div>` };
  }
  const st = statusAt(db, room.id, day, min);
  if (st.busy) {
    const e = st.now[0];
    return {
      cls: 'busy',
      html: `${head}<div class="status-kicker"><span class="dot busy"></span>תפוס עכשיו</div>
        <div class="status-big">עד ${LTR(hm(st.until))} <span class="status-in">(עוד ${dur(st.until - min)})</span></div>
        <div class="status-sub">${esc(e.name)} · ${esc(e.type)} ${LTR(esc(e.group))}</div>`,
    };
  }
  return {
    cls: 'free',
    html: `${head}<div class="status-kicker"><span class="dot free"></span>פנוי עכשיו</div>
      <div class="status-big">${st.until == null ? 'עד סוף היום' : `עד ${LTR(hm(st.until))} <span class="status-in">(עוד ${dur(st.until - min)})</span>`}</div>
      <div class="status-sub">${st.next ? `אחר כך: ${esc(st.next.name)} · ${esc(st.next.type)}` : 'אין יותר מפגשים היום'}</div>`,
  };
}

// The day as a list: meetings and the free gaps between them (08:00–21:00).
function dayAgenda(roomId, day) {
  if (!inData(day)) return '<p class="muted agenda-empty">אין מפגשים בשנתון ביום הזה.</p>';
  const evs = eventsOn(db, roomId, day);
  const rows = [];
  let cur = FROM;
  for (const e of evs) {
    if (e.start - cur > GAP) rows.push({ gap: true, start: cur, end: e.start });
    rows.push(e);
    cur = Math.max(cur, e.end);
  }
  if (TO - cur > GAP) rows.push({ gap: true, start: cur, end: TO });
  const live = day === nowDay() ? nowMin() : -1;
  return `<ol class="agenda-list">${rows.map((r) => {
    const nowCls = live >= r.start && live < r.end ? ' now' : '';
    return r.gap
      ? `<li class="ag gap${nowCls}"><span class="ag-time">${LTR(`${hm(r.start)}–${hm(r.end)}`)}</span><span class="ag-what">פנוי · ${dur(r.end - r.start)}</span></li>`
      : `<li class="ag ${isLecture(r) ? 'lec' : 'rec'}${nowCls}"><span class="ag-time">${LTR(`${hm(r.start)}–${hm(r.end)}`)}</span>
          <span class="ag-what"><b>${esc(r.name)}</b><small>${esc(r.type)} ${LTR(esc(r.group))} · קורס ${esc(r.course)}</small></span></li>`;
  }).join('')}</ol>`;
}

function renderRoom() {
  roomBuildingBox.set(state.building, state.building ? bName(state.building) : '');
  $('room-building-star').innerHTML = state.building ? star('buildings', state.building, bName(state.building)) : '';
  const room = state.room && db.rooms.get(state.room);
  roomBox.set(room ? room.id : null, room ? room.name : '');
  $('favs').innerHTML = favChips(false);
  $('room-empty').hidden = !!room || !!state.building;
  $('room-view').hidden = !room;
  $('room-overview').hidden = !!room || !state.building;
  if (!room) {
    if (state.building) availability($('room-overview'), state.building, nowDay(), nowMin(), { when: ' עכשיו' });
    return;
  }
  localStorage.setItem(LS, room.id);

  const st = statusCard(room);
  $('status').className = `card status ${st.cls}`;
  $('status').innerHTML = st.html;

  const today = nowDay();
  const start = state.week ?? weekStart(today);
  $('week-label').textContent = start === weekStart(today) ? `השבוע · ${LTR(`${dm(start)}–${dm(start + 5)}`)}` : LTR(`${dm(start)}–${dm(start + 5)}`);

  // desktop: week grid
  const span = TO - FROM;
  const hours = [];
  for (let m = FROM; m < TO; m += 60) hours.push(`<div class="hour" data-top="${(m - FROM) / span}">${hm(m)}</div>`);
  let cols = '';
  for (let i = 0; i < 6; i++) {
    const day = start + i;
    const blocks = eventsOn(db, room.id, day).map((e) => {
      const top = (Math.max(e.start, FROM) - FROM) / span;
      const h = (Math.min(e.end, TO) - Math.max(e.start, FROM)) / span;
      return `<div class="ev ${isLecture(e) ? 'lec' : 'rec'}" tabindex="0" data-top="${top}" data-h="${h}" title="${esc(`${e.name}\n${e.type} ${e.group} · ${hm(e.start)}–${hm(e.end)}\nקורס ${e.course}`)}">
        <b>${esc(e.name)}</b><span><bdi>${hm(e.start)}–${hm(e.end)}</bdi> · ${esc(e.type)}</span></div>`;
    }).join('');
    const line = day === today && nowMin() >= FROM && nowMin() < TO ? `<div class="now-line" data-top="${(nowMin() - FROM) / span}"></div>` : '';
    cols += `<div class="col${day === today ? ' today' : ''}"><div class="col-head">${DAYS[i]}<small>${dm(day)}</small></div><div class="col-body">${blocks}${line}</div></div>`;
  }
  $('week').innerHTML = `<div class="hours"><div class="col-head"></div><div class="col-body">${hours.join('')}</div></div>${cols}`;
  // positions go through CSSOM: the CSP (style-src 'self') blocks inline style attributes
  for (const el of $('week').querySelectorAll('[data-top]')) {
    el.style.setProperty('--top', el.dataset.top);
    if (el.dataset.h) el.style.setProperty('--h', el.dataset.h);
  }

  // phone: one day at a time
  const idx = state.dayIdx ?? (start === weekStart(today) ? Math.min(weekday(today), 5) : 0);
  const pills = DAYS_SHORT.map((d, i) => {
    const day = start + i;
    const n = eventsOn(db, room.id, day).length;
    return `<button class="day-pill${i === idx ? ' on' : ''}${day === today ? ' today' : ''}" data-day="${i}"><span>${d}</span><small>${dm(day)}</small><i>${n ? '•'.repeat(Math.min(n, 4)) : ''}</i></button>`;
  }).join('');
  $('agenda').innerHTML = `<div class="day-pills">${pills}</div>${dayAgenda(room.id, start + idx)}`;
}

// ---- free rooms tab ----
function renderFree() {
  const day = state.day ?? nowDay();
  const minute = state.minute ?? nowMin();
  freeBuildingBox.set(state.freeBuilding ?? '', state.freeBuilding ? bName(state.freeBuilding) : 'כל גבעת רם');
  $('free-date').value = isoOf(day);
  $('free-time').value = hm(minute);
  $('free-favs').innerHTML = favChips(true);
  availability($('free-result'), state.freeBuilding, day, minute);
}

// Free rooms (longest free first, "until when") and busy ones (when they free up) → el.
function availability(el, building, day, minute, { when = '' } = {}) {
  if (!inData(day)) {
    el.innerHTML = '<div class="empty"><div class="empty-icon" aria-hidden="true">🌴</div><p>אין מפגשים בשנתון בתאריך הזה — כנראה הכול פנוי.</p></div>';
    return;
  }
  const { free, busy } = freeRooms(db, { building: building || null, day, minute });
  const showB = !building;
  const freeCards = free.map(({ room, until }) => {
    const left = until == null ? TO - minute : until - minute;
    const pct = Math.max(4, Math.min(100, Math.round((left / 240) * 100)));
    return `<button class="room-card" data-goto="${esc(room.id)}" data-pct="${pct}">
      <span class="rc-name">${esc(room.name)}</span>${showB ? `<span class="rc-b">${esc(room.buildingName)}</span>` : ''}
      <span class="rc-until free">${until == null ? 'פנוי עד סוף היום' : `פנוי עד ${LTR(hm(until))} · ${dur(left)}`}</span>
      <span class="rc-bar"><span></span></span></button>`;
  }).join('');
  const busyRows = busy.map(({ room, now, until }) => `<li><button class="link" data-goto="${esc(room.id)}">${esc(room.name)}${showB ? ` <small class="muted">${esc(room.buildingName)}</small>` : ''}</button>
    <span class="muted small">${esc(now.map((e) => e.name).join(', '))}</span><span class="tag busy">מתפנה ב-${LTR(hm(until))}</span></li>`).join('');
  el.innerHTML = `
    <h2 class="section-title">פנויים${when} <span class="count">${free.length}</span></h2>
    <div class="room-grid">${freeCards || '<p class="muted">אין חדר פנוי בזמן הזה.</p>'}</div>
    <p class="book-note">צריכים חדר שמור לעבודה בקבוצה? <a href="${BOOKING}" target="_blank" rel="noopener">הזמנת חדר לימוד באתר האוניברסיטה ↗</a></p>
    ${busy.length ? `<details class="card busy-list"><summary>תפוסים <span class="count">${busy.length}</span></summary><ul>${busyRows}</ul></details>` : ''}`;
  for (const c of el.querySelectorAll('[data-pct]')) c.style.setProperty('--pct', `${c.dataset.pct}%`);
}

// ---- events ----
document.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.closest('.combo')) return;
  if (t.dataset.tab) { state.tab = t.dataset.tab; render(); }
  else if (t.dataset.fav) { toggleFav(t.dataset.fav, t.dataset.id); render(); }
  else if (t.dataset.building) {
    if (t.dataset.for === 'free') state.freeBuilding = t.dataset.building === state.freeBuilding ? null : t.dataset.building;
    else { state.building = t.dataset.building; if (state.room && db.rooms.get(state.room).building !== state.building) state.room = null; }
    render();
  } else if (t.dataset.room) { state.room = t.dataset.room; state.building = db.rooms.get(t.dataset.room).building; state.week = null; state.dayIdx = null; render(); }
  else if (t.dataset.goto) {
    const day = state.tab === 'free' ? state.day ?? nowDay() : nowDay();
    state.tab = 'room'; state.room = t.dataset.goto; state.building = db.rooms.get(t.dataset.goto).building;
    state.week = weekStart(day) === weekStart(nowDay()) ? null : weekStart(day);
    state.dayIdx = Math.min(weekday(day), 5);
    render(); scrollTo({ top: 0, behavior: 'smooth' });
  } else if (t.dataset.week) {
    const step = Number(t.dataset.week);
    state.week = step === 0 ? null : (state.week ?? weekStart(nowDay())) + 7 * step;
    if (step === 0) state.dayIdx = null;
    render();
  } else if (t.dataset.day) { state.dayIdx = Number(t.dataset.day); render(); }
  else if (t.id === 'free-now') { state.day = null; state.minute = null; render(); }
});
$('free-date').addEventListener('change', (e) => {
  const [y, m, d] = e.target.value.split('-').map(Number);
  if (y) { state.day = dayOf(new Date(y, m - 1, d)); render(); }
});
$('free-time').addEventListener('change', (e) => {
  const [h, m] = e.target.value.split(':').map(Number);
  if (!Number.isNaN(h)) { state.minute = h * 60 + (m || 0); render(); }
});
addEventListener('hashchange', () => { readHash(); render(); });
// keep "now" current while the page stays open (not while a dropdown is in use)
setInterval(() => { if (!document.hidden && !document.activeElement?.closest('.combo')) render(); }, 60_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && db) render(); });

// ---- installable app (PWA) ----
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
let installPrompt = null;
// already running as the installed app (Chrome/Edge standalone or window-controls-overlay, iOS home screen)
const isInstalled = () => matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches
  || navigator.standalone === true;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (isInstalled()) return;
  installPrompt = e;
  $('install-btn').hidden = false;
});
addEventListener('appinstalled', () => { installPrompt = null; $('install-btn').hidden = true; });
$('install-btn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $('install-btn').hidden = true;
});

// ---- start ----
try {
  const [res, ph] = await Promise.all([
    fetch('data.json', { cache: 'no-cache' }),
    fetch('buildings.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);
  if (!res.ok) throw new Error(res.status);
  db = decode(await res.json());
  extras = ph;
  roomBuildingBox = combo($('room-building'), {
    placeholder: 'כל הבניינים — הקלידו לחיפוש',
    options: buildingOptions(false),
    onSelect: (v) => {
      state.building = v;
      if (state.room && db.rooms.get(state.room).building !== v) state.room = null;
      render();
    },
  });
  roomBox = combo($('room-room'), {
    placeholder: 'הקלידו מספר או שם חדר',
    options: roomOptions,
    onSelect: (v) => {
      state.room = v; state.week = null; state.dayIdx = null;
      if (v) state.building = db.rooms.get(v).building;
      else localStorage.removeItem(LS);
      render();
    },
  });
  freeBuildingBox = combo($('free-building'), {
    placeholder: 'כל גבעת רם',
    options: buildingOptions(true),
    onSelect: (v) => { state.freeBuilding = v || null; render(); },
  });
  if (db.builtAt) $('built').textContent = `עודכן ${new Date(db.builtAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}`;
  $('loading').remove();
  readHash({ start: true });
  render();
} catch (err) {
  $('loading').textContent = `לא הצלחתי לטעון את הנתונים (${err.message}).`;
}

// A small searchable dropdown (ARIA combobox): type to filter, arrows + Enter, Esc to close.
// options(query) → [{ value, label, sub?, dot?: 'free'|'busy', group? }]

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let uid = 0;

export function combo(root, { placeholder, options, onSelect, emptyText = 'אין תוצאות' }) {
  const id = `combo-${++uid}`;
  root.classList.add('combo');
  root.innerHTML = `
    <div class="combo-field">
      <input type="text" role="combobox" aria-expanded="false" aria-controls="${id}" aria-autocomplete="list"
        autocomplete="off" spellcheck="false" placeholder="${esc(placeholder)}">
      <button type="button" class="combo-clear" aria-label="ניקוי" hidden>×</button>
      <span class="combo-chev" aria-hidden="true"></span>
    </div>
    <ul class="combo-list" role="listbox" id="${id}" hidden></ul>`;
  const input = root.querySelector('input');
  const list = root.querySelector('ul');
  const clear = root.querySelector('.combo-clear');
  let value = null;
  let label = '';
  let items = [];
  let active = -1;

  const open = (query = '') => {
    items = options(query);
    active = items.length ? 0 : -1;
    let html = '';
    let group = null;
    items.forEach((o, i) => {
      if (o.group != null && o.group !== group) { group = o.group; html += `<li class="combo-group" role="presentation">${esc(group)}</li>`; }
      html += `<li role="option" id="${id}-${i}" data-i="${i}" aria-selected="${o.value === value}" class="${i === active ? 'active' : ''}">
        ${o.dot ? `<span class="dot ${o.dot}"></span>` : ''}<span class="combo-label">${esc(o.label)}</span>${o.sub ? `<span class="combo-sub">${esc(o.sub)}</span>` : ''}</li>`;
    });
    list.innerHTML = html || `<li class="combo-empty" role="presentation">${esc(emptyText)}</li>`;
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    markActive();
  };
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.value = label;
  };
  const markActive = () => {
    list.querySelectorAll('[role=option]').forEach((li) => li.classList.toggle('active', Number(li.dataset.i) === active));
    const li = list.querySelector(`[data-i="${active}"]`);
    if (li) { input.setAttribute('aria-activedescendant', li.id); li.scrollIntoView({ block: 'nearest' }); }
  };
  const pick = (i) => {
    const o = items[i];
    if (!o) return;
    set(o.value, o.label);
    close();
    input.blur();
    onSelect(o.value);
  };
  function set(v, l = '') {
    value = v;
    label = v == null ? '' : l;
    input.value = label;
    clear.hidden = v == null;
  }

  input.addEventListener('focus', () => { input.select(); open(''); });
  input.addEventListener('input', () => open(input.value));
  input.addEventListener('keydown', (e) => {
    if (list.hidden && (e.key === 'ArrowDown' || e.key === 'Enter')) { open(''); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { active = Math.min(items.length - 1, active + 1); markActive(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); markActive(); e.preventDefault(); }
    else if (e.key === 'Enter') { pick(active); e.preventDefault(); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  // pointerdown (not click) so the choice lands before the input's blur closes the list
  list.addEventListener('pointerdown', (e) => {
    const li = e.target.closest('[role=option]');
    if (li) { e.preventDefault(); pick(Number(li.dataset.i)); }
  });
  input.addEventListener('blur', () => setTimeout(close, 120));
  clear.addEventListener('click', () => { set(null); onSelect(null); input.focus(); });

  return { set, get value() { return value; }, focus: () => input.focus() };
}

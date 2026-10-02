// Utilidades de interfaz: plantillas con escape, íconos, formato, avisos,
// ventanas, selector de fechas y de huéspedes. Sin dependencias.

import { names, parse, fmt, addDays, diffDays, human } from '../core/dates.js';
import { clp } from '../core/money.js';

export { clp };

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Plantilla: interpola con escape salvo valores marcados como raw().
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    out += flat(v) + strings[i + 1];
  });
  return raw(out);
}
function flat(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(flat).join('');
  return esc(v);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const plural = (n, one, many) => `${n.toLocaleString('es-CL')} ${n === 1 ? one : many}`;
export const pctFmt = (x, d = 2) => `${(x * 100).toLocaleString('es-CL', { minimumFractionDigits: 0, maximumFractionDigits: d })} %`;

// ---------- Íconos (trazo, 24×24) ----------
const P = {
  wifi: '<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.2" r=".9" fill="currentColor"/>',
  car: '<path d="M4 16v-4l2-5h12l2 5v4"/><path d="M3 16h18v3h-3v-1.5H6V19H3z"/><circle cx="7.5" cy="13.5" r="1"/><circle cx="16.5" cy="13.5" r="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14 0 9-5 14-13 14"/><path d="M5 19l8-8"/>',
  coffee: '<path d="M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5z"/><path d="M17 11h1.5a2.5 2.5 0 0 1 0 5H17"/><path d="M8 3.5c0 1.5 1 1.5 1 3M12 3.5c0 1.5 1 1.5 1 3"/>',
  van: '<path d="M2 16V7h11l3 4h4a2 2 0 0 1 2 2v3"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6M2 16h3"/>',
  flame: '<path d="M12 21a6 6 0 0 0 6-6c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-3-2 2-3 4.5-3 7a6 6 0 0 0 6 6z"/>',
  pot: '<path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/><path d="M2 10h20M9 6.5h6M12 6.5V10"/>',
  shower: '<path d="M4 20V7a3 3 0 0 1 6 0"/><path d="M7 7h6"/><path d="M14 11v.01M17 11v.01M14 14v.01M17 14v.01M20 11v.01M20 14v.01"/>',
  bed: '<path d="M3 18V7M3 13h18v5M21 18v-5a3 3 0 0 0-3-3h-7v3"/><circle cx="7" cy="10.5" r="1.8"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3 19a6 6 0 0 1 12 0"/><path d="M16 5.5a3 3 0 0 1 0 5.5M18 19a6 6 0 0 0-2.5-4.9"/>',
  ruler: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="1.5"/><path d="M8 21h8"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  left: '<path d="M15 5l-7 7 7 7"/>',
  right: '<path d="M9 5l7 7-7 7"/>',
  down: '<path d="M5 9l7 7 7-7"/>',
  arrow: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  lock: '<rect x="4" y="10.5" width="16" height="10" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.7" r=".8" fill="currentColor"/>',
  card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2z"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" stroke="none"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4.5"/><circle cx="12" cy="17.3" r=".8" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l5 5"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>',
  home: '<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8" r="1.3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M4.2 5.6l2.1 2.1M17.7 16.3l2.1 2.1M2.5 12h3M18.5 12h3M4.2 18.4l2.1-2.1M17.7 7.7l2.1-2.1"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  door: '<path d="M5 21V4h11v17M3 21h18"/><circle cx="13" cy="12.5" r=".9" fill="currentColor"/>',
  house: '<path d="M3 12 12 4l9 8"/><path d="M5 10.5V20h14v-9.5"/><path d="M9.5 20v-5h5v5"/>',
  chart: '<path d="M4 20V4M4 20h16"/><path d="M8 16v-5M12 16V8M16 16v-3"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.7-4.4L3 9"/><path d="M3 4v5h5"/><path d="M4 13a8 8 0 0 0 14.7 4.4L21 15"/><path d="M21 20v-5h-5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  chat: '<path d="M4 20l1.3-3.9A8 8 0 1 1 8.4 19z"/><path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z" fill="currentColor" stroke="none"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
};
export function icon(name, cls = '') {
  return raw(`<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`);
}

export const AMENITY_ICON = (a) => {
  const s = a.toLowerCase();
  if (s.includes('wifi')) return 'wifi';
  if (s.includes('baño')) return 'shower';
  if (s.includes('tv')) return 'tv';
  if (s.includes('calef')) return 'flame';
  if (s.includes('cocina') || s.includes('microondas')) return 'pot';
  if (s.includes('hervidor') || s.includes('cafetera')) return 'coffee';
  if (s.includes('jardín') || s.includes('comedor exterior')) return 'leaf';
  if (s.includes('entrada')) return 'door';
  if (s.includes('estacion')) return 'car';
  if (s.includes('cama') || s.includes('ropa')) return 'bed';
  return 'check';
};

// ---------- Avisos y ventanas ----------
export function toast(msg, kind = 'ok') {
  let host = $('#toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('role', 'status'); host.setAttribute('aria-live', 'polite'); document.body.append(host); }
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  host.append(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, 4200);
}

let lastFocus = null;
export function openSheet(content, { label = 'Detalle', wide = false, onClose } = {}) {
  closeSheet();
  lastFocus = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet-scrim" data-close></div><div class="sheet ${wide ? 'sheet-wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(label)}" tabindex="-1"><button class="sheet-x icon-btn" data-close aria-label="Cerrar">${icon('x')}</button><div class="sheet-body">${content}</div></div>`;
  document.body.append(wrap);
  document.body.classList.add('no-scroll');
  const sheet = $('.sheet', wrap);
  requestAnimationFrame(() => { wrap.classList.add('open'); sheet.focus(); });
  wrap.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeSheet(); });
  wrap._onClose = onClose;
  return sheet;
}
export function closeSheet() {
  const w = $('.sheet-wrap');
  if (!w) return;
  w._onClose?.();
  w.remove();
  document.body.classList.remove('no-scroll');
  lastFocus?.focus?.();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if ($('.pop.open')) closePops(); else closeSheet(); }
  if (e.key === 'Tab') {
    const sheet = $('.sheet-wrap .sheet');
    if (!sheet) return;
    const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', sheet).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  }
});

// Confirmación dentro de la página (el visor de artefactos no muestra confirm()).
export function confirmSheet({ title, body, confirm = 'Confirmar', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const sheet = openSheet(`<div class="confirm"><h2 class="h3">${esc(title)}</h2><div class="confirm-body">${body}</div><div class="row-end"><button class="btn btn-ghost" data-close>Volver</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-ok>${esc(confirm)}</button></div></div>`, { label: title, onClose: () => { if (!done) resolve(false); } });
    $('[data-ok]', sheet).addEventListener('click', () => { done = true; closeSheet(); resolve(true); });
  });
}

// ---------- Popovers ----------
export function closePops() { $$('.pop.open').forEach((p) => { p.classList.remove('open'); p.previousElementSibling?.setAttribute('aria-expanded', 'false'); }); }
document.addEventListener('click', (e) => {
  if (!e.target.closest('.pop, [data-pop]')) closePops();
});

// ---------- Selector de rango de fechas ----------
// Muestra dos meses (uno en celular), marca días sin disponibilidad y
// respeta que la salida sea posterior a la llegada.
export function rangePicker(host, { checkin, checkout, today, onChange, availability = null, months = 2, minDate = today, loadAvailability = null }) {
  let start = checkin || null;
  let end = checkout || null;
  let hover = null;
  let view = (checkin || today).slice(0, 7) + '-01';
  let avail = availability;

  function monthGrid(first) {
    const t = parse(first);
    const d0 = new Date(t);
    const y = d0.getUTCFullYear(); const m = d0.getUTCMonth();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const lead = (d0.getUTCDay() + 6) % 7; // semana parte el lunes
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<span></span>';
    for (let i = 1; i <= days; i++) {
      const d = fmt(Date.UTC(y, m, i));
      const past = d < minDate;
      const full = avail && avail[d] === 0;
      const inR = start && (end || hover) && d > start && d < (end || hover);
      const cls = ['day', past && 'past', full && 'full', d === start && 'sel start', d === end && 'sel end', inR && 'inrange', d === today && 'today'].filter(Boolean).join(' ');
      const disabled = past || (full && !(start && !end && d > start));
      cells += `<button type="button" class="${cls}" data-d="${d}" ${disabled ? 'disabled' : ''} aria-pressed="${d === start || d === end}" aria-label="${human(d, { weekday: true, year: true })}${full ? ', sin disponibilidad' : ''}">${i}</button>`;
    }
    return `<div class="month"><div class="month-name">${names.MESES[m]} ${y}</div><div class="dow">${['lu', 'ma', 'mi', 'ju', 'vi', 'sá', 'do'].map((x) => `<span>${x}</span>`).join('')}</div><div class="days">${cells}</div></div>`;
  }

  function render() {
    const mm = [];
    let f = view;
    for (let i = 0; i < months; i++) {
      mm.push(monthGrid(f));
      const d = new Date(parse(f));
      f = fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    const n = start && end ? diffDays(start, end) : 0;
    host.innerHTML = `<div class="rp">
      <div class="rp-nav"><button type="button" class="icon-btn" data-nav="-1" aria-label="Mes anterior" ${view <= minDate.slice(0, 7) + '-01' ? 'disabled' : ''}>${icon('left')}</button>
      <p class="rp-hint" aria-live="polite">${!start ? 'Elige el día de llegada' : !end ? 'Ahora elige el día de salida' : `${plural(n, 'noche', 'noches')} · ${human(start)} → ${human(end)}`}</p>
      <button type="button" class="icon-btn" data-nav="1" aria-label="Mes siguiente">${icon('right')}</button></div>
      <div class="rp-months">${mm.join('')}</div>
      ${avail ? '<p class="rp-legend"><span class="lg lg-full"></span> Sin habitaciones libres esa noche</p>' : ''}
    </div>`;
  }

  async function refreshAvail() {
    if (!loadAvailability) return;
    const d = new Date(parse(view));
    const to = fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 0));
    try { avail = { ...(avail || {}), ...(await loadAvailability(view, to)) }; render(); } catch { /* sin calendario de disponibilidad */ }
  }

  host.addEventListener('click', (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const d = new Date(parse(view));
      view = fmt(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + +nav.dataset.nav, 1));
      render(); refreshAvail();
      return;
    }
    const b = e.target.closest('[data-d]');
    if (!b) return;
    const d = b.dataset.d;
    if (!start || end || d <= start) { start = d; end = null; }
    else {
      // No permitir cruzar una noche sin disponibilidad.
      if (avail) {
        for (let x = start; x < d; x = addDays(x, 1)) if (avail[x] === 0) { start = d; end = null; render(); return; }
      }
      end = d;
    }
    render();
    onChange?.({ checkin: start, checkout: end });
  });
  host.addEventListener('mouseover', (e) => {
    const b = e.target.closest('[data-d]');
    if (!b || !start || end) return;
    if (hover !== b.dataset.d) { hover = b.dataset.d; $$('.day', host).forEach((x) => x.classList.toggle('inrange', x.dataset.d > start && x.dataset.d < hover)); }
  });
  render();
  refreshAvail();
  return { set(ci, co) { start = ci; end = co; render(); } };
}

// ---------- Selector de huéspedes ----------
export function guestStepper({ id, label, sub, value, min = 0, max = 12 }) {
  return html`<div class="stepper" data-stepper="${id}">
    <div><div class="stepper-label" id="${id}-l">${label}</div>${sub ? html`<div class="stepper-sub">${sub}</div>` : ''}</div>
    <div class="stepper-ctl" role="group" aria-labelledby="${id}-l">
      <button type="button" class="icon-btn sm" data-step="-1" aria-label="Menos" ${value <= min ? 'disabled' : ''}>${icon('minus')}</button>
      <output id="${id}" data-min="${min}" data-max="${max}">${value}</output>
      <button type="button" class="icon-btn sm" data-step="1" aria-label="Más" ${value >= max ? 'disabled' : ''}>${icon('plus')}</button>
    </div></div>`;
}
export function bindSteppers(root, onChange) {
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const wrap = b.closest('[data-stepper]');
    const out = $('output', wrap);
    const v = Math.min(+out.dataset.max, Math.max(+out.dataset.min, +out.value + +b.dataset.step));
    out.value = v; out.textContent = v;
    $$('[data-step]', wrap).forEach((x) => { x.disabled = (+x.dataset.step < 0 && v <= +out.dataset.min) || (+x.dataset.step > 0 && v >= +out.dataset.max); });
    onChange?.(wrap.dataset.stepper, v);
  });
}

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); toast('Copiado'); }
  catch {
    const r = document.createRange();
    const n = btn?.previousElementSibling;
    if (n) { r.selectNodeContents(n); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
    toast('Selecciona y copia el texto', 'info');
  }
}

// Aparición suave al entrar en pantalla. Un solo observador para todo el sitio;
// los hermanos entran escalonados. Sin IntersectionObserver, todo queda visible.
let revealer = null;
export function revealOnScroll(root, selector) {
  if (!('IntersectionObserver' in window)) return;
  revealer ||= new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); revealer.unobserve(e.target); }
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
  const order = new Map();
  for (const el of root.querySelectorAll(selector)) {
    const i = order.get(el.parentElement) || 0;
    order.set(el.parentElement, i + 1);
    el.style.setProperty('--d', `${Math.min(i, 5) * 80}ms`);
    el.setAttribute('data-reveal', '');
    revealer.observe(el);
  }
}

export function countdown(el, until, onEnd) {
  const tick = () => {
    const ms = new Date(until) - Date.now();
    if (ms <= 0) { el.textContent = '0:00'; clearInterval(t); onEnd?.(); return; }
    const m = Math.floor(ms / 60000); const s = Math.floor((ms % 60000) / 1000);
    el.textContent = `${m}:${String(s).padStart(2, '0')}`;
  };
  const t = setInterval(tick, 1000);
  tick();
  return () => clearInterval(t);
}

export const STATUS = {
  pendiente_pago: ['Esperando pago', 'warn'],
  confirmada: ['Confirmada', 'ok'],
  en_estadia: ['En estadía', 'info'],
  completada: ['Completada', 'muted'],
  cancelada: ['Cancelada', 'bad'],
  expirada: ['Expirada', 'muted'],
  no_show: ['No llegó', 'bad'],
  requiere_revision: ['Revisar', 'bad'],
};
export const PAY_STATUS = {
  sin_pago: 'Paga en el hostal',
  pendiente: 'Pago pendiente',
  anticipo_pagado: 'Anticipo pagado',
  pagado: 'Pagado',
  reembolsado: 'Reembolsado',
  reembolso_parcial: 'Reembolso parcial',
};
export const pill = (status) => { const [t, k] = STATUS[status] || [status, 'muted']; return html`<span class="pill pill-${k}">${t}</span>`; };

export { human, addDays, diffDays };

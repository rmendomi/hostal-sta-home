// Sitio público: portada, búsqueda, reserva, pago y gestión de la reserva.

import { createApi } from './api.js';
import { html, raw, esc, $, $$, icon, clp, human, plural, addDays, diffDays, toast, openSheet, closeSheet, confirmSheet, rangePicker, guestStepper, bindSteppers, closePops, countdown, copyText, revealOnScroll, AMENITY_ICON, PAY_STATUS } from './ui.js';
import { floorPlan, logoMark } from './art.js';
import { ledger } from './ledger.js';
import { UNIT_LABEL, stayDays } from '../core/pricing.js';
import { humanLong } from '../core/dates.js';

const app = $('#app');
const S = {
  api: null,
  info: null,
  search: null, // { checkin, checkout, adults, children }
  results: null,
  selection: [], // [{ roomId, adults, children }]
  extras: new Set(),
  extraDays: {}, // { [idCargo]: { days: Set, people } } para cargos por día elegido (almuerzo, cena)
  guest: {},
  quote: null,
  cleanup: [],
};

const ss = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// ---------- Enrutador por hash ----------
let route = '';
function currentHash() { try { return location.hash.replace(/^#\/?/, ''); } catch { return route; } }
export function go(r, { replace = false } = {}) {
  route = r.replace(/^#\/?/, '');
  try {
    if (replace) history.replaceState(null, '', `#/${route}`); else location.hash = `/${route}`;
  } catch { /* marco sin historial */ }
  render();
}
window.addEventListener('hashchange', () => { const h = currentHash(); if (h !== route) { route = h; if (S.info) render(); } });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  const target = a.getAttribute('href').slice(2);
  const [path, anchor] = target.split('#');
  if (anchor && (path === route || (path === 'inicio' && (route === '' || route === 'inicio')))) {
    document.getElementById(anchor)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    return;
  }
  go(path);
  if (anchor) requestAnimationFrame(() => document.getElementById(anchor)?.scrollIntoView({ block: 'start' }));
});

function cleanup() { S.cleanup.forEach((f) => f()); S.cleanup = []; closeSheet(); closePops(); }

async function render() {
  if (!S.info) return; // aún cargando: boot() llama a render() cuando llegan los datos
  cleanup();
  const [head, ...rest] = route.split('/');
  document.body.dataset.view = head || 'inicio';
  if (head === 'panel') {
    const { renderAdmin } = await import('./admin.js');
    return renderAdmin({ api: S.api, info: S.info, root: app, go, rest });
  }
  app.innerHTML = `${siteHeader()}<main id="main" tabindex="-1"></main>${siteFooter()}`;
  const main = $('#main');
  try {
    if (!head || head === 'inicio') viewHome(main);
    else if (head === 'buscar') await viewResults(main);
    else if (head === 'reservar') await viewCheckout(main);
    else if (head === 'reserva') await viewBooking(main, rest);
    else if (head === 'mi-reserva') viewLookup(main);
    else if (head === 'pago-simulado') viewGateway(main, rest[0]);
    else if (head === 'error-pago') viewMessage(main, 'No pudimos confirmar el pago', 'Si se hizo un cargo en tu tarjeta, escríbenos con tu código de reserva y lo revisamos de inmediato.');
    else viewMessage(main, 'Página no encontrada', 'Vuelve a la portada para buscar disponibilidad.');
  } catch (e) {
    console.error(e);
    viewMessage(main, 'Algo no funcionó', e.message || 'Intenta de nuevo en un momento.');
  }
  if (head && head !== 'inicio') window.scrollTo(0, 0);
  revealOnScroll(main, '.section-head, .room, .services, .loc > *, .policies > div, .rcard, .co-step, .bk-grid > *');
  onScroll();
}

// Cabecera con sombra cuando la página ya bajó (un cálculo por cuadro, como máximo).
let scrollTick = false;
function onScroll() {
  if (scrollTick) return;
  scrollTick = true;
  requestAnimationFrame(() => { scrollTick = false; $('.site-head')?.classList.toggle('is-scrolled', window.scrollY > 8); });
}
window.addEventListener('scroll', onScroll, { passive: true });

// ---------- Estructura ----------
function siteHeader() {
  const demo = S.api.mode === 'demo';
  return html`${demo ? html`<div class="demo-bar" role="note">${icon('info')}<span><b>Versión de demostración.</b> Pagos simulados, tarifas estimadas y reservas de ejemplo. Nada se cobra.</span><a href="#/panel">Ver panel</a></div>` : ''}
  <header class="site-head">
    <div class="wrap head-row">
      <a class="brand" href="#/inicio" aria-label="${S.info?.business?.name || 'Santa Elena de Maipo Home'}, inicio">${logoMark()}<span class="brand-name">Santa Elena de Maipo<small>Home</small></span></a>
      <nav class="site-nav" aria-label="Principal">
        <a href="#/inicio#habitaciones">Habitaciones</a>
        <a href="#/inicio#ubicacion">Ubicación</a>
        <a href="#/mi-reserva">Mi reserva</a>
      </nav>
      <a class="head-mine" href="#/mi-reserva">Mi reserva</a>
      <a class="btn btn-primary btn-sm head-cta" href="#/inicio#buscar">Reservar</a>
    </div>
  </header>`.toString();
}

function siteFooter() {
  const b = S.info.business;
  return html`<footer class="site-foot">
    <div class="wrap foot-grid">
      <div class="foot-brand">${logoMark()}<p class="brand-name">Santa Elena de Maipo<small>Home</small></p><p>${b.address}</p></div>
      <div><h2 class="foot-h">Contacto</h2><p>Teléfono y WhatsApp<br><a class="mono" href="${telHref(b.phone)}">${b.phone}</a></p><p><a href="${waHref(b)}" target="_blank" rel="noopener">Escribir por WhatsApp</a></p>${socialLinks(b)}${b.email ? html`<p>${b.email}</p>` : ''}<p>Recepción abierta las 24 horas</p></div>
      <div><h2 class="foot-h">Tu reserva</h2><p><a href="#/mi-reserva">Ver, cambiar o cancelar</a></p><p><a href="#/inicio#condiciones">Condiciones y políticas</a></p></div>
      <div><h2 class="foot-h">Administración</h2><p><a href="#/panel">Panel del hostal</a></p></div>
    </div>
    <p class="wrap foot-small">Pagos procesados por ${S.info.payment?.providerName || 'Webpay'}: este sitio nunca ve ni guarda los datos de tu tarjeta. Tus datos se usan solo para gestionar tu reserva.</p>
  </footer>
  ${b.whatsapp ? html`<a class="wa-float" href="${waHref(b)}" target="_blank" rel="noopener" aria-label="Escribir por WhatsApp">${icon('chat')}<span>WhatsApp</span></a>` : ''}`.toString();
}

// Contacto pulsable: tel: con el número en formato internacional y WhatsApp con un saludo listo.
function telHref(phone) { return `tel:+${String(phone || '').replace(/\D/g, '')}`; }
function waHref(b, text = `Hola, quiero consultar disponibilidad en ${b.name || 'el hostal'}.`) {
  return `https://wa.me/${String(b.whatsapp || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
function directionsHref(b) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(b.address || '')}`;
}
function socialLinks(b) {
  const links = [['Instagram', b.instagram], ['Facebook', b.facebook]].filter(([, u]) => /^https:\/\//.test(u || ''));
  return links.length ? html`<p>${links.map(([n, u], i) => html`${i ? ' · ' : ''}<a href="${u}" target="_blank" rel="noopener">${n}</a>`)}</p>` : '';
}

// Foto con versión liviana para listas (thumb) y grande para el detalle.
function photoImg(p, alt, { sizes = '(max-width: 760px) 100vw, 50vw', eager = false } = {}) {
  const srcset = p.thumb ? `${p.thumb} 800w, ${p.url} 1600w` : '';
  return html`<img src="${p.thumb || p.url}" ${srcset ? raw(`srcset="${esc(srcset)}" sizes="${esc(sizes)}"`) : ''} alt="${p.alt || alt}" ${eager ? raw('fetchpriority="high"') : raw('loading="lazy"')} decoding="async">`;
}

function viewMessage(main, title, body) {
  main.innerHTML = html`<section class="wrap msg"><h1 class="h2">${title}</h1><p>${body}</p><a class="btn btn-primary" href="#/inicio">Ir a la portada</a></section>`;
}

// ---------- Búsqueda (barra y selectores) ----------
function defaultSearch() {
  const t = S.info.today;
  return S.search || ss.get('se-search') || { checkin: addDays(t, 7), checkout: addDays(t, 9), adults: 2, children: 0 };
}

function searchBar(s, { compact = false } = {}) {
  const n = s.checkin && s.checkout ? diffDays(s.checkin, s.checkout) : 0;
  return html`<form class="searchbar ${compact ? 'searchbar-compact' : ''}" id="searchbar" novalidate>
    <button type="button" class="sb-field" data-pop="dates" aria-haspopup="dialog" aria-expanded="false">
      <span class="sb-label">${icon('cal')} Llegada</span><span class="sb-value" id="sb-in">${s.checkin ? human(s.checkin, { weekday: true }) : 'Elegir'}</span>
    </button>
    <button type="button" class="sb-field" data-pop="dates" aria-haspopup="dialog" aria-expanded="false">
      <span class="sb-label">Salida${n ? html` <em>${plural(n, 'noche', 'noches')}</em>` : ''}</span><span class="sb-value" id="sb-out">${s.checkout ? human(s.checkout, { weekday: true }) : 'Elegir'}</span>
    </button>
    <div class="sb-guests">
      <button type="button" class="sb-field" data-pop="guests" aria-haspopup="dialog" aria-expanded="false">
        <span class="sb-label">${icon('users')} Huéspedes</span><span class="sb-value" id="sb-g">${guestText(s)}</span>
      </button>
      <div class="pop pop-guests" role="dialog" aria-label="Huéspedes">
        ${guestStepper({ id: 'g-adults', label: 'Adultos', sub: 'Desde 12 años', value: s.adults, min: 1, max: 12 })}
        ${guestStepper({ id: 'g-children', label: 'Niños', sub: 'Menores de 12: no pagan', value: s.children, min: 0, max: 8 })}
        <button type="button" class="btn btn-ghost btn-sm pop-done">Listo</button>
      </div>
    </div>
    <button class="btn btn-primary sb-go" type="submit">${icon('search')}<span>Ver disponibilidad</span></button>
  </form>`;
}
const guestText = (s) => `${plural(s.adults, 'adulto', 'adultos')}${s.children ? `, ${plural(s.children, 'niño', 'niños')}` : ''}`;

// auto: en los resultados, cambiar fechas o huéspedes vuelve a buscar sin apretar el botón.
function bindSearchBar(root, s, onSubmit, { auto = false } = {}) {
  const form = $('#searchbar', root);
  const state = { ...s };
  let timer = null;
  const autoSearch = () => {
    clearTimeout(timer);
    const changed = ['checkin', 'checkout', 'adults', 'children'].some((k) => state[k] !== s[k]);
    if (auto && changed && state.checkin && state.checkout) onSubmit({ ...state });
  };
  const upd = () => {
    $('#sb-in', form).textContent = state.checkin ? human(state.checkin, { weekday: true }) : 'Elegir';
    $('#sb-out', form).textContent = state.checkout ? human(state.checkout, { weekday: true }) : 'Elegir';
    $('#sb-g', form).textContent = guestText(state);
    const lbl = $$('.sb-label', form)[1];
    const n = state.checkin && state.checkout ? diffDays(state.checkin, state.checkout) : 0;
    lbl.innerHTML = `Salida${n ? ` <em>${plural(n, 'noche', 'noches')}</em>` : ''}`;
  };
  form.addEventListener('click', (e) => {
    const f = e.target.closest('[data-pop]');
    if (!f) return;
    if (f.dataset.pop === 'dates') { openDates(state, upd, autoSearch); return; }
    const pop = f.nextElementSibling;
    const open = !pop.classList.contains('open');
    closePops();
    if (open) { pop.classList.add('open'); f.setAttribute('aria-expanded', 'true'); $('button:not([disabled])', pop)?.focus(); }
  });
  bindSteppers(form, (id, v) => {
    if (id === 'g-adults') state.adults = v; else state.children = v;
    upd();
    // Espera a que termine de ajustar la cantidad antes de buscar.
    if (auto) { clearTimeout(timer); timer = setTimeout(autoSearch, 900); }
  });
  $('.pop-done', form)?.addEventListener('click', () => { closePops(); autoSearch(); });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!state.checkin || !state.checkout) { openDates(state, upd); return; }
    onSubmit({ ...state });
  });
}

function openDates(state, after, onDone = null) {
  // onDone corre una sola vez al cerrar (Listo, X, Escape o fuera), cuando la hoja ya no está.
  let done = false;
  const onClose = onDone ? () => { if (!done) { done = true; setTimeout(onDone, 0); } } : undefined;
  const sheet = openSheet(`<h2 class="h3">¿Cuándo vienes?</h2><div id="rp"></div><div class="row-end rp-actions"><button class="btn btn-ghost" data-clear>Borrar</button><button class="btn btn-primary" data-ok>Listo</button></div>`, { label: 'Elegir fechas', wide: true, onClose });
  const months = matchMedia('(min-width: 760px)').matches ? 2 : 1;
  const picker = rangePicker($('#rp', sheet), {
    checkin: state.checkin, checkout: state.checkout, today: S.info.today, months,
    loadAvailability: async (from, to) => (await S.api.pub('calendar', { from: from < S.info.today ? S.info.today : from, to })).days,
    onChange: ({ checkin, checkout }) => { state.checkin = checkin; state.checkout = checkout; after(); },
  });
  $('[data-clear]', sheet).addEventListener('click', () => { state.checkin = null; state.checkout = null; picker.set(null, null); after(); });
  $('[data-ok]', sheet).addEventListener('click', () => {
    if (state.checkin && !state.checkout) { state.checkout = addDays(state.checkin, 1); after(); }
    closeSheet();
  });
}

function startSearch(s) {
  S.search = s;
  ss.set('se-search', s);
  S.selection = [];
  go('buscar');
}

// ---------- Portada ----------
function roomVisual(room, { big = false } = {}) {
  if (room.photos?.length) {
    return photoImg(room.photos[0], room.name, { sizes: big ? '(max-width: 760px) 100vw, 600px' : '(max-width: 760px) 100vw, 400px' });
  }
  return html`<div class="plan-bg">${floorPlan(room, { compact: !big })}</div>`;
}

function roomFacts(r) {
  return html`<ul class="facts">
    ${r.sizeM2 ? html`<li>${icon('ruler')}${r.sizeM2} m²</li>` : ''}
    <li>${icon('bed')}${r.beds}</li>
    <li>${icon('users')}Hasta ${plural(r.maxGuests, 'persona', 'personas')}</li>
    <li>${icon('shower')}Baño ${r.bathroom === 'compartido' ? 'compartido' : 'privado'}</li>
    ${r.kitchen ? html`<li>${icon('pot')}Cocina propia</li>` : ''}
  </ul>`;
}

function viewHome(main) {
  const s = defaultSearch();
  const b = S.info.business;
  const rooms = S.info.rooms;
  const house = S.info.housePhotos || [];
  const minRate = Math.min(...rooms.map((r) => r.baseRate));
  main.innerHTML = html`
  <section class="hero" aria-labelledby="hero-h">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <h1 id="hero-h"><span class="eyebrow">Hostal en Temuco · Región de la Araucanía</span><span class="display">Una casa abrigada para conocer <em>el sur.</em></span></h1>
        <p class="lede">Un hostal familiar de madera en Villa Santa Elena de Maipo, al poniente de Temuco: cuatro habitaciones y una cabaña. Reservas directo con nosotros y ves cada peso antes de pagar.</p>
        <div class="hero-links">
          <a class="rating" href="${b.mapsUrl}" target="_blank" rel="noopener">${icon('star')}<strong>${String(b.googleRating).replace('.', ',')}</strong> · ${b.googleReviews} opiniones en Google</a>
          ${b.whatsapp ? html`<a class="rating" href="${waHref(b)}" target="_blank" rel="noopener">${icon('chat')}Consultar por WhatsApp</a>` : ''}
        </div>
      </div>
      <figure class="hero-logo"><img src="/img/logo.jpg" width="960" height="720" alt="Santa Elena de Maipo Home: la casa de madera con su arco de entrada, rodeada de araucarias y con la cordillera detrás" fetchpriority="high"></figure>
    </div>
  </section>
  <section class="wrap search-dock" id="buscar" aria-label="Buscar disponibilidad">${searchBar(s)}
    <ul class="trust">
      <li>${icon('house')}Reservas directo con el hostal</li>
      <li>${icon('receipt')}Precio final con IVA incluido</li>
      <li>${icon('lock')}Pago seguro con ${S.info.payment?.providerName || 'Webpay'}</li>
    </ul>
  </section>

  <section class="wrap section" id="la-casa" aria-labelledby="serv-h">
    <div class="section-head"><h2 class="h2" id="serv-h">La casa</h2><p>Lo que viene con tu estadía y lo que puedes pedir.</p></div>
    <ul class="services">
      ${[['clock', 'Recepción 24 horas', 'Llega a la hora que necesites.'], ['coffee', 'Desayuno incluido', 'En las cuatro habitaciones de la casa.'], ['car', 'Estacionamiento', 'Dentro de la propiedad.'], ['wifi', 'Wifi', 'En habitaciones y áreas comunes.'], ['flame', 'Calefacción y TV', 'Para las noches frías del sur.'], ['pot', 'Almuerzo y cena', 'Comida casera a pedido, se paga en el hostal.'], ['leaf', 'Lavandería', 'A pedido durante tu estadía.'], ['house', 'Cabaña con cocina', 'Independiente, con baño y cocina propios.']]
        .map(([i, t, d]) => html`<li>${icon(i)}<div><strong>${t}</strong><span>${d}</span></div></li>`)}
    </ul>
    ${house.length ? html`<div class="house-photos n${Math.min(house.length, 5)}">${house.slice(0, 5).map((p, i) => html`<button type="button" class="hp" data-house="${i}" aria-label="Ampliar foto: ${p.alt || 'la casa'}">${photoImg(p, 'La casa', { sizes: i === 0 ? '(max-width: 760px) 100vw, 560px' : '(max-width: 760px) 50vw, 280px' })}${i === 4 && house.length > 5 ? html`<span class="hp-more">+${house.length - 5} fotos</span>` : ''}</button>`)}</div>` : ''}
  </section>

  <section class="wrap section" id="habitaciones" aria-labelledby="hab-h">
    <div class="section-head">
      <h2 class="h2" id="hab-h">Habitaciones</h2>
      <p>Las habitaciones incluyen desayuno y la cabaña tiene cocina propia. Todas con calefacción, TV y wifi. Precio por noche para dos personas, desde ${clp(minRate)} con IVA incluido.</p>
    </div>
    <div class="rooms">
      ${rooms.map((r) => html`<article class="room">
        <button class="room-visual" data-room="${r.id}" aria-label="Ver ${r.name}">${roomVisual(r)}</button>
        <div class="room-body">
          <h3 class="h3">${r.name}</h3>
          ${roomFacts(r)}
          <p class="room-desc">${r.description}</p>
          <div class="room-foot">
            <p class="price"><span>desde</span> <strong>${clp(r.baseRate)}</strong> <span>/ noche</span></p>
            <div class="room-actions"><button class="btn btn-ghost btn-sm" data-room="${r.id}">Ver detalle</button><a class="btn btn-soft btn-sm" href="#/inicio#buscar">Elegir fechas</a></div>
          </div>
        </div>
      </article>`)}
    </div>
  </section>

  <section class="wrap section loc" id="ubicacion" aria-labelledby="ubi-h">
    <div class="loc-card">
      <p class="eyebrow">Ubicación</p>
      <h2 class="h2" id="ubi-h">San Lucas 02125, Temuco</h2>
      <p>Villa Santa Elena de Maipo, sector poniente, cerca del camino Temuco–Labranza. A 3,6 km del Estadio Germán Becker y a 9,3 km del Cerro Ñielol.</p>
      <div class="row"><a class="btn btn-soft" href="${directionsHref(b)}" target="_blank" rel="noopener">${icon('pin')} Cómo llegar</a>${b.phone ? html`<a class="btn btn-ghost" href="${telHref(b.phone)}">${icon('phone')} Llamar</a>` : ''}</div>
      <p class="muted small">Distancias según la ficha pública del hostal.</p>
    </div>
    <div class="reviews">
      <div class="big-rating"><strong>${String(b.googleRating).replace('.', ',')}</strong><span class="stars" aria-hidden="true">${icon('star')}${icon('star')}${icon('star')}${icon('star')}${icon('star', 'half')}</span></div>
      <p>${b.googleReviews} opiniones en Google. Hotel de 3 estrellas.</p>
      <a href="${b.mapsUrl}" target="_blank" rel="noopener">Leer opiniones en Google ${icon('arrow')}</a>
    </div>
  </section>

  <section class="wrap section" id="condiciones" aria-labelledby="cond-h">
    <div class="section-head"><h2 class="h2" id="cond-h">Antes de reservar</h2></div>
    <dl class="policies">
      <div><dt>Llegada y salida</dt><dd>Llegada desde las ${b.checkinFrom}. Salida hasta las ${b.checkoutUntil}. Recepción abierta las 24 horas.</dd></div>
      <div><dt>Pago</dt><dd>${payText()}</dd></div>
      <div><dt>Cancelación</dt><dd>Gratis hasta ${plural(S.info.cancellation.freeUntilDays, 'día', 'días')} antes de la llegada: te devolvemos todo lo pagado. Después, se retiene el anticipo.</dd></div>
      <div><dt>Cambios de fecha</dt><dd>En línea hasta ${plural(S.info.modification?.freeUntilDays ?? 0, 'día', 'días')} antes, si hay disponibilidad. Si el nuevo total es distinto, la diferencia se ajusta en el saldo.</dd></div>
      <div class="pol-wide"><dt>Reglas de la casa</dt><dd><ul class="rules">${S.info.houseRules.slice(1).map((r) => html`<li>${r}</li>`)}</ul></dd></div>
    </dl>
  </section>

  <section class="wrap section faq-wrap" id="preguntas" aria-labelledby="faq-h">
    <div class="section-head faq-intro">
      <h2 class="h2" id="faq-h">Preguntas frecuentes</h2>
      <p>Lo que más nos preguntan antes de reservar. Si te queda alguna duda, escríbenos y te respondemos.</p>
      ${b.whatsapp ? html`<a class="btn btn-ghost btn-sm" href="${waHref(b)}" target="_blank" rel="noopener">${icon('chat')}Preguntar por WhatsApp</a>` : ''}
    </div>
    <div class="faq">${faq(b).map(([q, a]) => html`<details><summary><span>${q}</span><span class="faq-ic" aria-hidden="true"></span></summary><p>${a}</p></details>`)}</div>
  </section>`;

  bindSearchBar(main, s, startSearch);
  main.addEventListener('click', (e) => {
    const r = e.target.closest('[data-room]');
    if (r) return openRoom(r.dataset.room);
    const h = e.target.closest('[data-house]');
    if (h) lightbox(house, +h.dataset.house, 'La casa');
  });

}

function payText() {
  const d = S.info.deposit;
  return `${d.mode === 'percent' ? `Al reservar pagas un anticipo del ${d.percent} % con ${S.info.payment?.providerName || 'Webpay'}. El saldo se paga al llegar.` : 'Según se indica al reservar.'}${d.fullIfWithinDays != null ? ` Si la llegada es en ${plural(d.fullIfWithinDays, 'día', 'días')} o menos, se paga el total.` : ''}`;
}

// Preguntas frecuentes armadas con los datos del panel, para que no queden desactualizadas.
function faq(b) {
  const pets = (S.info.houseRules || []).find((r) => /mascota/i.test(r));
  return [
    ['¿Cómo llego?', `Estamos en ${b.address}, en el sector poniente de Temuco, cerca del camino Temuco–Labranza. El botón "Cómo llegar" abre Google Maps con la ruta hasta la puerta.`],
    ['¿A qué hora puedo llegar y hasta qué hora me puedo quedar?', `La llegada es desde las ${b.checkinFrom} y la salida hasta las ${b.checkoutUntil}. La recepción está abierta las 24 horas, así que puedes llegar tarde sin problema.`],
    ['¿Tienen estacionamiento?', 'Sí, dentro de la propiedad.'],
    ['¿El desayuno está incluido?', 'Sí, en las cuatro habitaciones de la casa. La cabaña no incluye desayuno: tiene cocina propia para que prepares lo tuyo. También preparamos almuerzo y cena caseros a pedido, que se pagan en el hostal.'],
    ['¿Cómo se paga la reserva?', `${payText()} Tu tarjeta la ingresas en la página de ${S.info.payment?.providerName || 'Webpay'}: nosotros nunca vemos sus datos.`],
    ['¿Puedo cancelar o cambiar las fechas?', `Puedes cancelar gratis hasta ${plural(S.info.cancellation.freeUntilDays, 'día', 'días')} antes de la llegada y te devolvemos todo lo pagado. Las fechas se cambian en línea, desde "Mi reserva", hasta ${plural(S.info.modification?.freeUntilDays ?? 0, 'día', 'días')} antes.`],
    ['¿Aceptan mascotas?', pets || 'Escríbenos por WhatsApp antes de reservar y lo conversamos.'],
  ];
}

// Visor de fotos a pantalla completa: flechas del teclado, deslizar en el celular y Escape para cerrar.
function lightbox(photos, start, label) {
  let i = start;
  const onKey = (e) => { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); };
  const sheet = openSheet(html`<div class="lb"><figure class="lb-fig"></figure>
    ${photos.length > 1 ? html`<div class="lb-nav"><button type="button" class="icon-btn" data-lb="-1" aria-label="Foto anterior">${icon('left')}</button><span class="lb-count" aria-live="polite"></span><button type="button" class="icon-btn" data-lb="1" aria-label="Foto siguiente">${icon('right')}</button></div>` : ''}</div>`.toString(), { label, wide: true, onClose: () => document.removeEventListener('keydown', onKey) });
  const draw = () => {
    const p = photos[i];
    $('.lb-fig', sheet).innerHTML = html`<img src="${p.url}" alt="${p.alt || `${label}, foto ${i + 1}`}">${p.alt ? html`<figcaption>${p.alt}</figcaption>` : ''}`;
    const c = $('.lb-count', sheet); if (c) c.textContent = `${i + 1} de ${photos.length}`;
  };
  const step = (d) => { i = (i + d + photos.length) % photos.length; draw(); };
  sheet.addEventListener('click', (e) => { const b = e.target.closest('[data-lb]'); if (b) step(+b.dataset.lb); });
  document.addEventListener('keydown', onKey);
  let x0 = null;
  sheet.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  sheet.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); x0 = null; });
  draw();
  return sheet;
}

// ---------- Detalle de habitación ----------
function openRoom(id, { fromResults = null } = {}) {
  const r = S.info.rooms.find((x) => x.id === id);
  if (!r) return;
  const photos = r.photos || [];
  // Fotos de la casa descritas como baño: se muestran en las habitaciones que lo comparten.
  const bath = r.bathroom === 'compartido' ? (S.info.housePhotos || []).filter((p) => /ba[ñn]o/i.test(p.alt || '')) : [];
  const sheet = openSheet(html`<article class="room-detail">
    <div class="gallery">${photos.length ? html`<div class="gallery-track" tabindex="0" aria-label="Fotos de ${r.name}">${photos.map((p, i) => photoImg(p, `${r.name}, foto ${i + 1}`, { sizes: '(max-width: 760px) 100vw, 900px', eager: i === 0 }))}</div>${photos.length > 1 ? html`<button type="button" class="icon-btn g-prev" data-gal="-1" aria-label="Foto anterior">${icon('left')}</button><button type="button" class="icon-btn g-next" data-gal="1" aria-label="Foto siguiente">${icon('right')}</button>` : ''}` : html`<div class="plan-bg plan-big">${floorPlan(r)}</div>`}</div>
    <div class="rd-body">
      <h2 class="h2">${r.name}</h2>
      ${roomFacts(r)}
      <p>${r.description}</p>
      ${!photos.length ? html`<p class="note">${icon('image')} Pronto subiremos fotos de esta habitación. Mientras, te mostramos un plano referencial con sus camas.</p>` : html`<details class="plan-more"><summary>Ver plano referencial</summary><div class="plan-bg">${floorPlan(r)}</div></details>`}
      ${bath.length ? html`<h3 class="h4">Baño compartido</h3><div class="bath-photos">${bath.map((p) => html`<figure>${photoImg(p, 'Baño compartido', { sizes: '(max-width: 760px) 50vw, 300px' })}<figcaption>${p.alt}</figcaption></figure>`)}</div>` : ''}
      <h3 class="h4">Qué incluye</h3>
      <ul class="amenities">${r.amenities.map((a) => html`<li>${icon(AMENITY_ICON(a))}${a}</li>`)}</ul>
      <h3 class="h4">Condiciones</h3>
      <ul class="conds">
        <li>Tarifa por noche para ${plural(r.baseOccupancy, 'persona', 'personas')}: desde ${clp(r.baseRate)}.${r.extraGuestFee ? ` Persona adicional desde 12 años: ${clp(r.extraGuestFee)} por noche.` : ''} Menores de 12 no pagan.</li>
        ${r.minNights > 1 ? html`<li>Mínimo ${r.minNights} noches.</li>` : ''}
        <li>Cancelación gratis hasta ${plural(S.info.cancellation.freeUntilDays, 'día', 'días')} antes de la llegada.</li>
        <li>Llegada desde las ${S.info.business.checkinFrom}, salida hasta las ${S.info.business.checkoutUntil}.</li>
      </ul>
      <div class="rd-cta">${fromResults ? html`<button class="btn btn-primary" data-pick="${r.id}">${fromResults}</button>` : html`<button class="btn btn-primary" data-go-search>Ver disponibilidad</button>`}</div>
    </div>
  </article>`.toString(), { label: r.name, wide: true });
  sheet.addEventListener('click', (e) => {
    const g = e.target.closest('[data-gal]');
    if (!g) return;
    const t = $('.gallery-track', sheet);
    t.scrollBy({ left: +g.dataset.gal * t.clientWidth, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  });
  $('[data-go-search]', sheet)?.addEventListener('click', () => { closeSheet(); go('inicio'); requestAnimationFrame(() => $('#buscar')?.scrollIntoView({ block: 'center' })); });
  return sheet;
}

// ---------- Resultados ----------
async function viewResults(main) {
  const s = S.search || ss.get('se-search');
  if (!s) return go('inicio', { replace: true });
  S.search = s;
  main.innerHTML = html`<section class="results-top"><div class="wrap">${searchBar(s, { compact: true })}</div></section><section class="wrap section-tight" id="res"><p class="loading">Buscando habitaciones libres…</p></section>`;
  bindSearchBar(main, s, startSearch, { auto: true });
  let res;
  try { res = await S.api.pub('search', s); } catch (e) {
    $('#res', main).innerHTML = html`<div class="alert alert-bad">${icon('alert')}<p>${e.message}</p></div>`;
    return;
  }
  S.results = res;
  const sel = S.selection;
  const drawSel = async () => {
    const bar = $('#selbar', main);
    if (!sel.length) { bar.hidden = true; return; }
    bar.hidden = false;
    const guests = sel.reduce((a, x) => a + x.adults + x.children, 0);
    const party = s.adults + s.children;
    $('.selbar-text', bar).innerHTML = html`<strong>${plural(sel.length, 'habitación', 'habitaciones')}</strong> · ${plural(guests, 'persona', 'personas')}${guests < party ? html` <em class="warn-text">faltan ${party - guests} por ubicar</em>` : ''}`;
    try {
      const q = await S.api.pub('quote', { checkin: s.checkin, checkout: s.checkout, items: sel });
      S.quote = q;
      $('.selbar-total', bar).innerHTML = html`<span>Total ${plural(q.nights, 'noche', 'noches')}</span><strong>${clp(q.total)}</strong>`;
      $('[data-continue]', bar).disabled = false;
    } catch (e) {
      $('.selbar-total', bar).innerHTML = html`<span class="warn-text">${e.message}</span>`;
      $('[data-continue]', bar).disabled = true;
    }
  };
  // Invitación a quedarse más: el siguiente descuento por estadía que mejora el actual.
  const stayPromo = () => {
    const now = Math.max(0, ...res.results.map((r) => r.price?.discount?.pct || 0));
    const next = (S.info.stayDiscounts || []).filter((d) => d.minNights > res.nights && d.pct > now).sort((a, b) => a.minNights - b.minNights)[0];
    if (!next) return '';
    const more = next.minNights - res.nights;
    const until = addDays(s.checkin, next.minNights);
    return html`<div class="alert alert-promo">${icon('tag')}<p><strong>Quédate ${plural(more, 'noche', 'noches')} más y te descontamos el ${next.pct} % del alojamiento.</strong> Con ${plural(next.minNights, 'noche', 'noches')} o más se aplica solo, sin códigos.</p><button type="button" class="btn btn-soft btn-sm" data-extend="${until}">Ver hasta el ${human(until, { weekday: true })}</button></div>`;
  };
  const draw = () => {
    const avail = res.results.filter((r) => r.available);
    $('#res', main).innerHTML = html`
      <div class="res-head">
        <h1 class="h2">${avail.length ? `${plural(avail.length, 'habitación libre', 'habitaciones libres')}` : 'Sin habitaciones libres'}</h1>
        <p>${humanLong(s.checkin)} → ${humanLong(s.checkout)} · ${plural(res.nights, 'noche', 'noches')} · ${guestText(s)}</p>
      </div>
      ${res.needsMultipleRooms ? html`<div class="alert">${icon('users')}<p>Son ${s.adults + s.children} personas y cada habitación recibe hasta 3. Elige dos o más habitaciones y reparte a tu grupo.</p></div>` : ''}
      ${!avail.length ? html`<div class="alert">${icon('cal')}<p>Esas noches están tomadas. Prueba otras fechas: en el calendario verás qué días tienen habitaciones libres.</p></div>` : ''}
      ${avail.length ? stayPromo() : ''}
      <div class="res-list">${res.results.map((r) => resultCard(r, s))}</div>`;
  };
  function resultCard(r, s) {
    const picked = sel.find((x) => x.roomId === r.room.id);
    const price = r.price;
    return html`<article class="rcard ${r.available ? '' : 'rcard-off'} ${picked ? 'rcard-on' : ''}">
      <button class="rcard-visual" data-room="${r.room.id}" aria-label="Ver ${r.room.name}">${roomVisual(r.room)}</button>
      <div class="rcard-body">
        <h2 class="h3">${r.room.name}</h2>
        ${roomFacts(r.room)}
        ${r.available ? '' : html`<p class="rcard-reason">${icon('info')} ${r.reason}</p>`}
        ${r.available && !r.fits && !picked ? html`<p class="rcard-reason">${icon('users')} Recibe hasta ${r.room.maxGuests}: úsala junto a otra habitación.</p>` : ''}
        ${picked ? html`<div class="rcard-guests">
          ${guestStepper({ id: `a-${r.room.id}`, label: 'Adultos', value: picked.adults, min: 1, max: r.room.maxGuests - picked.children })}
          ${guestStepper({ id: `c-${r.room.id}`, label: 'Niños', value: picked.children, min: 0, max: r.room.maxGuests - picked.adults })}
        </div>` : ''}
      </div>
      <div class="rcard-price">
        ${price ? html`<p class="price-stay"><strong>${clp(price.total)}</strong><span>${plural(price.nights, 'noche', 'noches')}, ${plural(r.quoteFor.adults + r.quoteFor.children, 'persona', 'personas')}</span></p>
        <p class="price-night">${clp(price.perNightAvg)} por noche en promedio${price.discount ? html`<br><em class="tag tag-ok">${price.discount.name} −${price.discount.pct} %</em>` : ''}</p>` : ''}
        ${r.available ? html`<button class="btn ${picked ? 'btn-ghost' : 'btn-primary'}" data-toggle="${r.room.id}" aria-pressed="${!!picked}">${picked ? 'Quitar' : 'Elegir'}</button>` : html`<button class="btn btn-ghost" data-other-dates>Cambiar fechas</button>`}
      </div>
    </article>`;
  }
  main.insertAdjacentHTML('beforeend', html`<div class="selbar" id="selbar" hidden><div class="wrap selbar-row"><div class="selbar-text"></div><div class="selbar-total"></div><button class="btn btn-primary" data-continue>Continuar ${icon('arrow')}</button></div></div>`.toString());
  draw(); drawSel();

  const toggle = (id) => {
    const i = sel.findIndex((x) => x.roomId === id);
    if (i >= 0) sel.splice(i, 1);
    else {
      const r = res.results.find((x) => x.room.id === id).room;
      const placed = sel.reduce((a, x) => ({ a: a.a + x.adults, c: a.c + x.children }), { a: 0, c: 0 });
      const adults = Math.max(1, Math.min(r.maxGuests, s.adults - placed.a));
      const children = Math.max(0, Math.min(r.maxGuests - adults, s.children - placed.c));
      sel.push({ roomId: id, adults, children });
    }
    draw(); drawSel();
  };
  main.addEventListener('click', (e) => {
    const t = e.target.closest('[data-toggle]');
    if (t) return toggle(t.dataset.toggle);
    const x = e.target.closest('[data-extend]');
    if (x) return startSearch({ ...s, checkout: x.dataset.extend });
    const v = e.target.closest('[data-room]');
    if (v) {
      const r = res.results.find((x) => x.room.id === v.dataset.room);
      const picked = sel.some((x) => x.roomId === v.dataset.room);
      const sheet = openRoom(v.dataset.room, { fromResults: r.available && !picked ? `Elegir · ${clp(r.price.total)}` : null });
      $('[data-pick]', sheet)?.addEventListener('click', () => { closeSheet(); toggle(v.dataset.room); });
      return;
    }
    if (e.target.closest('[data-other-dates]')) { $('.sb-field', main).click(); return; }
    if (e.target.closest('[data-continue]')) {
      ss.set('se-selection', { search: s, selection: sel });
      go('reservar');
    }
  });
  bindSteppers($('#res', main), (id, v) => {
    const roomId = id.slice(2);
    const it = sel.find((x) => x.roomId === roomId);
    if (!it) return;
    if (id.startsWith('a-')) it.adults = v; else it.children = v;
    draw(); drawSel();
  });
}

// ---------- Reserva: extras, datos, condiciones ----------
async function viewCheckout(main) {
  const saved = ss.get('se-selection');
  const s = S.search || saved?.search;
  const sel = S.selection.length ? S.selection : saved?.selection || [];
  if (!s || !sel.length) return go('inicio', { replace: true });
  S.search = s; S.selection = sel;
  const g = { country: 'Chile', ...ss.get('se-guest'), ...S.guest };
  const extras = S.info.extras.filter((x) => !x.mandatory);
  const deposit = S.info.deposit;
  const days = stayDays(s.checkin, s.checkout);
  const guests = sel.reduce((a, x) => a + (+x.adults || 0) + (+x.children || 0), 0);
  // Los días elegidos antes se conservan solo si siguen dentro de la estadía.
  for (const x of extras.filter((e) => e.unit === 'persona_dia')) {
    const prev = S.extraDays[x.id];
    S.extraDays[x.id] = { days: new Set([...(prev?.days || [])].filter((d) => days.includes(d))), people: Math.min(guests, prev?.people || guests) };
  }
  const extrasPayload = () => [...S.extras, ...Object.entries(S.extraDays).filter(([, v]) => v.days.size).map(([id, v]) => ({ id, days: [...v.days], people: v.people }))];
  const extraCard = (x) => {
    if (x.unit !== 'persona_dia') return html`<label class="extra"><input type="checkbox" value="${x.id}" ${S.extras.has(x.id) ? 'checked' : ''}><span class="extra-box"><strong>${x.name}</strong><span>${x.description}</span><span class="extra-price">${clp(x.amount)} ${UNIT_LABEL[x.unit]}</span></span></label>`;
    const st = S.extraDays[x.id];
    return html`<div class="extra extra-days ${st.days.size ? 'is-on' : ''}" data-xdays="${x.id}">
      <div class="extra-box"><strong>${x.name}</strong><span>${x.description}</span><span class="extra-price">${clp(x.amount)} ${UNIT_LABEL[x.unit]}</span></div>
      <p class="xd-q" id="xd-${x.id}">¿Qué días?</p>
      <div class="day-chips" role="group" aria-labelledby="xd-${x.id}">${days.map((d) => html`<button type="button" class="day-chip" data-day="${d}" aria-pressed="${st.days.has(d)}">${human(d, { weekday: true })}</button>`)}</div>
      ${guests > 1 ? html`<div class="xd-people" ${st.days.size ? '' : 'hidden'}>${guestStepper({ id: `xp-${x.id}`, label: 'Personas', sub: 'Cuántos comen cada día marcado', value: st.people, min: 1, max: guests })}</div>` : ''}
    </div>`;
  };

  main.innerHTML = html`<div class="wrap checkout">
    <div class="co-main">
      <a class="back" href="#/buscar">${icon('left')} Volver a las habitaciones</a>
      <h1 class="h2">Confirma tu reserva</h1>
      <section class="co-step" aria-labelledby="st1">
        <h2 class="h4" id="st1"><span class="stepn">1</span>Tu estadía</h2>
        <div class="stay-sum">
          <div><span class="muted">Llegada</span><strong>${humanLong(s.checkin)}</strong><span class="muted">desde las ${S.info.business.checkinFrom}</span></div>
          <div><span class="muted">Salida</span><strong>${humanLong(s.checkout)}</strong><span class="muted">hasta las ${S.info.business.checkoutUntil}</span></div>
        </div>
        <ul class="stay-rooms">${sel.map((x) => { const r = S.info.rooms.find((y) => y.id === x.roomId); return html`<li>${icon('bed')}<span><strong>${r.name}</strong> · ${plural(x.adults, 'adulto', 'adultos')}${x.children ? `, ${plural(x.children, 'niño', 'niños')}` : ''}</span></li>`; })}</ul>
        ${extras.length ? html`<h3 class="h5">Agrega a tu estadía</h3><div class="extras">${extras.map(extraCard)}</div>` : ''}
      </section>

      <form class="co-step" id="guest-form" novalidate aria-labelledby="st2">
        <h2 class="h4" id="st2"><span class="stepn">2</span>Tus datos</h2>
        <div class="fields">
          ${field('firstName', 'Nombre', g.firstName, { autocomplete: 'given-name', required: true })}
          ${field('lastName', 'Apellido', g.lastName, { autocomplete: 'family-name', required: true })}
          ${field('email', 'Correo', g.email, { type: 'email', autocomplete: 'email', required: true, hint: 'Aquí te llega la confirmación.' })}
          ${field('phone', 'Teléfono o WhatsApp', g.phone, { type: 'tel', autocomplete: 'tel', required: true, placeholder: '+56 9 1234 5678' })}
          ${field('country', 'País', g.country, { autocomplete: 'country-name' })}
          ${field('docId', 'RUT o pasaporte', g.docId, { hint: 'Agiliza el registro al llegar.' })}
          <div class="field"><label for="f-arrivalTime">Hora estimada de llegada</label><select id="f-arrivalTime" name="arrivalTime">${['', 'Antes de las 15:00', '15:00 – 18:00', '18:00 – 21:00', '21:00 – 00:00', 'Después de medianoche'].map((o) => html`<option value="${o}" ${g.arrivalTime === o ? 'selected' : ''}>${o || 'No lo sé aún'}</option>`)}</select></div>
          <div class="field field-wide"><label for="f-notes">Comentarios para el hostal</label><textarea id="f-notes" name="notes" rows="3" maxlength="600" placeholder="Por ejemplo: viajo con un bebé, necesito boleta, llego en bus.">${g.notes || ''}</textarea></div>
        </div>
      </form>

      <section class="co-step" aria-labelledby="st3">
        <h2 class="h4" id="st3"><span class="stepn">3</span>Condiciones</h2>
        <ul class="conds" id="conds"></ul>
        <label class="check"><input type="checkbox" id="accept"><span>Acepto las condiciones de pago, cambio y cancelación, y que mis datos se usen solo para gestionar esta reserva.</span></label>
        <p class="field-err" id="accept-err" hidden>Marca la casilla para continuar.</p>
        <div class="co-pay">
          <button class="btn btn-primary btn-lg" id="pay-btn" type="button">…</button>
          <p class="secure">${icon('lock')} Pagas en el sitio seguro de Webpay (Transbank). Tu reserva queda apartada ${S.info.holdMinutes} minutos mientras pagas.</p>
        </div>
      </section>
    </div>
    <aside class="co-aside" aria-label="Resumen del precio"><div class="co-sticky" id="co-ledger"></div></aside>
  </div>`;

  const redraw = async () => {
    try {
      const q = await S.api.pub('quote', { checkin: s.checkin, checkout: s.checkout, items: sel, extras: extrasPayload() });
      S.quote = q;
      $('#co-ledger', main).innerHTML = ledger(q, { info: S.info });
      const p = q.payment;
      $('#pay-btn', main).innerHTML = p.dueNow > 0 ? html`${icon('lock')} Pagar ${p.mode === 'percent' ? 'anticipo de ' : ''}${clp(p.dueNow)} con Webpay` : 'Confirmar reserva';
      $('#conds', main).innerHTML = html`
        <li><strong>Hoy pagas ${clp(p.dueNow)}</strong>${p.dueAtProperty ? html` y <strong>${clp(p.dueAtProperty)} al llegar</strong>` : ''}. ${p.reason}</li>
        <li>Cancelación gratis hasta el <strong>${humanLong(q.policy.freeCancelUntil)}</strong>: te devolvemos todo lo pagado. Después se retiene el anticipo.</li>
        <li>Puedes cambiar las fechas en línea hasta el ${humanLong(q.policy.freeChangeUntil)}, si hay disponibilidad.</li>
        <li>${S.info.houseRules.slice(1, 3).join(' ')}</li>`;
    } catch (e) {
      $('#co-ledger', main).innerHTML = html`<div class="alert alert-bad">${icon('alert')}<p>${e.message}</p></div>`;
    }
  };
  await redraw();

  $$('.extra input', main).forEach((c) => c.addEventListener('change', () => { if (c.checked) S.extras.add(c.value); else S.extras.delete(c.value); redraw(); }));
  $$('[data-xdays]', main).forEach((box) => {
    const st = S.extraDays[box.dataset.xdays];
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-day]');
      if (!b) return;
      if (st.days.has(b.dataset.day)) st.days.delete(b.dataset.day); else st.days.add(b.dataset.day);
      b.setAttribute('aria-pressed', st.days.has(b.dataset.day));
      box.classList.toggle('is-on', st.days.size > 0);
      const p = $('.xd-people', box); if (p) p.hidden = !st.days.size;
      redraw();
    });
    bindSteppers(box, (_, v) => { st.people = v; redraw(); });
  });
  const form = $('#guest-form', main);
  form.addEventListener('input', () => { S.guest = Object.fromEntries(new FormData(form)); ss.set('se-guest', S.guest); });

  $('#pay-btn', main).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const guest = Object.fromEntries(new FormData(form));
    $$('.field-err', form).forEach((x) => x.remove());
    $$('[aria-invalid]', form).forEach((x) => x.removeAttribute('aria-invalid'));
    const accept = $('#accept', main).checked;
    $('#accept-err', main).hidden = accept;
    if (!form.checkValidity() || !accept) {
      markInvalid(form, clientErrors(guest));
      (form.querySelector('[aria-invalid]') || $('#accept', main)).focus();
      return;
    }
    btn.disabled = true; btn.classList.add('busy');
    try {
      const { booking, token } = await S.api.pub('createBooking', { checkin: s.checkin, checkout: s.checkout, items: sel, extras: extrasPayload(), guest, acceptTerms: true });
      ss.set(`se-t-${booking.code}`, token);
      if (booking.status === 'pendiente_pago') {
        const pay = await S.api.pub('startPayment', { code: booking.code, token });
        S.api.goToPayment(pay);
      } else go(`reserva/${booking.code}/${token}/confirmada`);
    } catch (err) {
      btn.disabled = false; btn.classList.remove('busy');
      if (err.fields) { markInvalid(form, err.fields); form.querySelector('[aria-invalid]')?.focus(); }
      toast(err.message, 'bad');
      if (err.status === 409) setTimeout(() => go('buscar'), 1800);
    }
  });
}

function field(name, label, value, { type = 'text', autocomplete = 'off', required = false, hint = '', placeholder = '' } = {}) {
  return html`<div class="field"><label for="f-${name}">${label}${required ? '' : html` <span class="opt">opcional</span>`}</label>
    <input id="f-${name}" name="${name}" type="${type}" value="${value || ''}" autocomplete="${autocomplete}" ${required ? 'required' : ''} placeholder="${placeholder}" aria-describedby="${hint ? `h-${name}` : ''}">
    ${hint ? html`<p class="hint" id="h-${name}">${hint}</p>` : ''}</div>`;
}
function clientErrors(g) {
  const e = {};
  if (!g.firstName?.trim()) e.firstName = 'Escribe el nombre.';
  if (!g.lastName?.trim()) e.lastName = 'Escribe el apellido.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(g.email || '')) e.email = 'Revisa el correo: lo usamos para enviarte la confirmación.';
  if (((g.phone || '').match(/\d/g) || []).length < 8) e.phone = 'Escribe un teléfono con al menos 8 dígitos.';
  return e;
}
function markInvalid(form, errors) {
  for (const [k, msg] of Object.entries(errors || {})) {
    const input = form.querySelector(`[name="${k}"]`);
    if (!input) continue;
    input.setAttribute('aria-invalid', 'true');
    const p = document.createElement('p');
    p.className = 'field-err'; p.id = `e-${k}`; p.textContent = msg;
    input.setAttribute('aria-describedby', `e-${k}`);
    input.after(p);
  }
}

// ---------- Pasarela simulada (solo demo) ----------
function viewGateway(main, token) {
  const t = S.api.gateway?.info(token);
  if (!t) return viewMessage(main, 'Pago no encontrado', 'Esta sesión de pago simulado ya no existe. Vuelve a buscar tu reserva en "Mi reserva".');
  main.innerHTML = html`<section class="wrap gateway">
    <div class="gw-card">
      <p class="gw-demo">${icon('info')} Pasarela <strong>simulada</strong>. En el sitio publicado aquí se abre el formulario oficial de Webpay.</p>
      <p class="eyebrow">Pago a ${S.info.business.name}</p>
      <h1 class="h2">${clp(t.amount)} <span class="muted">CLP</span></h1>
      <p class="muted">Orden ${t.buyOrder}</p>
      <div class="gw-actions">
        <button class="btn btn-primary" data-d="debit">${icon('card')} Aprobar con débito</button>
        <button class="btn btn-primary" data-d="credit">${icon('card')} Aprobar con crédito</button>
        <button class="btn btn-ghost" data-d="reject">Simular rechazo</button>
        <button class="btn btn-ghost" data-d="abort">Anular y volver</button>
      </div>
    </div>
  </section>`;
  main.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-d]');
    if (!b) return;
    $$('[data-d]', main).forEach((x) => { x.disabled = true; });
    try {
      const r = await S.api.gateway.finish(token, b.dataset.d);
      go(`reserva/${r.code}/${r.token}/${r.result}`, { replace: true });
    } catch (err) { toast(err.message, 'bad'); }
  });
}

// ---------- Ver reserva ----------
async function viewBooking(main, [code, token, result]) {
  main.innerHTML = html`<section class="wrap section-tight"><p class="loading">Cargando tu reserva…</p></section>`;
  let b;
  try { ({ booking: b } = await S.api.pub('getBooking', { code, token })); } catch (e) {
    return viewMessage(main, 'No encontramos la reserva', e.message);
  }
  const biz = S.info.business;
  const banner = {
    confirmada: ['ok', 'check', result === 'autorizado' || result === 'confirmada' ? '¡Listo! Tu reserva está confirmada.' : 'Reserva confirmada', `Te enviamos el detalle a ${b.guest.email}. Guarda tu código: lo necesitas para cambiar o cancelar.`],
    pendiente_pago: ['warn', 'clock', result === 'rechazado' ? 'El pago no se aprobó' : result === 'anulado' ? 'El pago no se completó' : 'Falta pagar el anticipo', result === 'rechazado' ? 'Tu banco rechazó el pago. Puedes intentar con otra tarjeta: tus noches siguen apartadas un momento más.' : 'Tus noches siguen apartadas mientras corre el tiempo. Completa el pago para confirmar.'],
    expirada: ['bad', 'alert', 'La reserva expiró', 'No se completó el pago a tiempo y las noches se liberaron. No se hizo ningún cargo. Puedes buscar de nuevo.'],
    cancelada: ['muted', 'x', 'Reserva cancelada', b.amountRefunded ? `Devolvemos ${clp(b.amountRefunded)} al mismo medio de pago. Según tu banco, puede tardar algunos días hábiles en verse.` : 'No hubo devolución según la política de cancelación.'],
    requiere_revision: ['warn', 'alert', 'Recibimos tu pago; estamos revisando', 'El pago llegó justo después de que se liberaran tus noches. Te contactaremos hoy para reubicarte o devolverte el dinero.'],
    en_estadia: ['ok', 'house', 'Estás alojando con nosotros', 'Si necesitas algo, la recepción está abierta las 24 horas.'],
    completada: ['muted', 'check', 'Estadía completada', 'Gracias por quedarte con nosotros.'],
    no_show: ['muted', 'x', 'Reserva no utilizada', 'Registramos que no llegaste.'],
  }[b.status] || ['muted', 'info', b.status, ''];
  main.innerHTML = html`<div class="wrap booking">
    <div class="bk-banner bk-${banner[0]}">${icon(banner[1])}<div><h1 class="h2">${banner[2]}</h1><p>${banner[3]}</p>
      ${b.status === 'pendiente_pago' ? html`<div class="bk-pay"><button class="btn btn-primary" id="retry">${icon('lock')} Pagar ${clp(b.depositAmount)} con Webpay</button><span class="timer">Quedan <strong id="left">–</strong></span></div>` : ''}
      ${b.status === 'expirada' ? html`<a class="btn btn-primary" href="#/buscar">Buscar de nuevo</a>` : ''}
    </div></div>
    <div class="bk-grid">
      <div class="bk-main">
        <div class="bk-code"><span class="muted">Código de reserva</span><span class="mono code sel">${b.code}</span><button class="icon-btn" data-copy aria-label="Copiar código">${icon('copy')}</button></div>
        <dl class="bk-facts">
          <div><dt>Llegada</dt><dd>${humanLong(b.checkin)}<span>desde las ${biz.checkinFrom}</span></dd></div>
          <div><dt>Salida</dt><dd>${humanLong(b.checkout)}<span>hasta las ${biz.checkoutUntil}</span></dd></div>
          <div><dt>Habitaciones</dt><dd>${b.items.map((i) => html`${i.roomName} · ${plural(i.adults + i.children, 'persona', 'personas')}<br>`)}</dd></div>
          <div><dt>A nombre de</dt><dd>${b.guest.firstName} ${b.guest.lastName}<span>${b.guest.email}</span></dd></div>
          <div><dt>Pago</dt><dd>${PAY_STATUS[b.paymentStatus] || b.paymentStatus}${b.payments.map((p) => html`<span>${p.kind === 'reembolso' ? 'Devolución' : 'Pago'} ${clp(p.amount)} · ${p.method === 'webpay' ? `Webpay ${p.cardType === 'credit' ? 'crédito' : p.cardType === 'debit' ? 'débito' : 'prepago'}${p.cardLast4 ? ` ****${p.cardLast4}` : ''}` : p.method}</span>`)}</dd></div>
          <div><dt>Dirección</dt><dd>${biz.address}<span><a href="${biz.mapsUrl}" target="_blank" rel="noopener">Cómo llegar</a> · ${biz.phone}</span></dd></div>
        </dl>
        ${['confirmada'].includes(b.status) ? html`<div class="bk-actions">
          ${b.canChange ? html`<button class="btn btn-soft" id="change">${icon('cal')} Cambiar fechas</button>` : html`<p class="muted small">El plazo para cambiar fechas en línea terminó el ${humanLong(b.freeChangeUntil)}. Escríbenos y lo vemos contigo.</p>`}
          <button class="btn btn-ghost" id="cancel">Cancelar reserva</button>
        </div>
        <p class="muted small">${b.cancellation?.free ? `Cancelación gratis hasta el ${humanLong(b.freeCancelUntil)}.` : `La cancelación gratis terminó el ${humanLong(b.freeCancelUntil)}; si cancelas, se retiene el anticipo.`}</p>` : ''}
      </div>
      <aside>${ledger(b.quote, { info: S.info, booking: b })}</aside>
    </div>
  </div>`;
  if (b.status === 'pendiente_pago' && b.expiresAt) {
    S.cleanup.push(countdown($('#left', main), b.expiresAt, () => render()));
    $('#retry', main).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      try { S.api.goToPayment(await S.api.pub('startPayment', { code: b.code, token })); } catch (err) { toast(err.message, 'bad'); e.currentTarget.disabled = false; }
    });
  }
  $('[data-copy]', main)?.addEventListener('click', (e) => copyText(b.code, e.currentTarget));
  $('#cancel', main)?.addEventListener('click', async () => {
    const c = b.cancellation;
    const ok = await confirmSheet({
      title: '¿Cancelar la reserva?',
      body: html`<p>${c.free ? html`Estás dentro del plazo de cancelación gratis: te devolvemos <strong>${clp(c.refund)}</strong>.` : html`El plazo de cancelación gratis terminó el ${humanLong(c.deadline)}. Se retiene el anticipo de <strong>${clp(c.retained)}</strong>${c.refund ? html` y te devolvemos ${clp(c.refund)}` : ''}.`}</p><p class="muted">Las noches quedan libres para otros huéspedes. Esta acción no se puede deshacer.</p>`.toString(),
      confirm: c.refund ? `Cancelar y recibir ${clp(c.refund)}` : 'Cancelar reserva',
      danger: true,
    });
    if (!ok) return;
    try { await S.api.pub('cancelBooking', { code: b.code, token }); toast('Reserva cancelada'); render(); } catch (err) { toast(err.message, 'bad'); }
  });
  $('#change', main)?.addEventListener('click', () => changeDatesSheet(b, token));
}

function changeDatesSheet(b, token) {
  const state = { checkin: b.checkin, checkout: b.checkout };
  const sheet = openSheet(`<h2 class="h3">Cambiar fechas</h2><p class="muted">Tu reserva actual: ${esc(human(b.checkin))} → ${esc(human(b.checkout))}. Las noches de tu propia reserva se muestran como disponibles.</p><div id="rp2"></div><div id="chg" aria-live="polite"></div>`, { label: 'Cambiar fechas', wide: true });
  const out = $('#chg', sheet);
  const check = async () => {
    if (!state.checkin || !state.checkout) { out.innerHTML = ''; return; }
    out.innerHTML = '<p class="loading">Revisando…</p>';
    try {
      const r = await S.api.pub('previewChange', { code: b.code, token, ...state });
      out.innerHTML = html`<div class="chg-box ${r.available ? '' : 'chg-bad'}">
        ${r.available ? html`<p>Nuevo total <strong>${clp(r.quote.total)}</strong> (${r.difference === 0 ? 'mismo precio' : r.difference > 0 ? `${clp(r.difference)} más` : `${clp(-r.difference)} menos`}). Saldo a pagar al llegar: <strong>${clp(r.newBalance)}</strong>.</p>
        <button class="btn btn-primary" data-apply>Confirmar nuevas fechas</button>` : html`<p>${icon('alert')} Tu habitación no está libre en esas fechas.</p>`}
      </div>`;
      $('[data-apply]', out)?.addEventListener('click', async () => {
        try { await S.api.pub('changeBooking', { code: b.code, token, ...state }); closeSheet(); toast('Fechas cambiadas'); render(); } catch (err) { toast(err.message, 'bad'); }
      });
    } catch (e) { out.innerHTML = html`<p class="warn-text">${e.message}</p>`; }
  };
  rangePicker($('#rp2', sheet), { checkin: b.checkin, checkout: b.checkout, today: S.info.today, months: matchMedia('(min-width: 760px)').matches ? 2 : 1, onChange: (v) => { Object.assign(state, v); check(); } });
}

function viewLookup(main) {
  main.innerHTML = html`<section class="wrap lookup">
    <h1 class="h2">Mi reserva</h1>
    <p>Escribe tu código (empieza con SE-) y el correo con que reservaste para ver, cambiar o cancelar tu reserva.</p>
    <form id="lk" class="lk-form" novalidate>
      <div class="field"><label for="lk-code">Código de reserva</label><input id="lk-code" name="code" autocomplete="off" placeholder="SE-XXXXXX" required style="text-transform:uppercase"></div>
      <div class="field"><label for="lk-email">Correo</label><input id="lk-email" name="email" type="email" autocomplete="email" required></div>
      <button class="btn btn-primary">Buscar mi reserva</button>
      <p class="field-err" id="lk-err" hidden></p>
    </form>
  </section>`;
  $('#lk', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $('#lk-err', main);
    try {
      const { booking, token } = await S.api.pub('getBooking', f);
      go(`reserva/${booking.code}/${token}`);
    } catch (x) { err.hidden = false; err.textContent = x.message; }
  });
}

// ---------- Arranque ----------
(async function boot() {
  try {
    S.api = await createApi();
    S.info = await S.api.pub('info');
  } catch (e) {
    app.innerHTML = html`<section class="wrap msg"><h1 class="h2">No pudimos cargar el sitio</h1><p>${e.message}</p></section>`.toString();
    return;
  }
  document.documentElement.classList.toggle('is-demo', S.api.mode === 'demo');
  route = currentHash();
  render();
})();

export { S };
export const _internal = { raw };

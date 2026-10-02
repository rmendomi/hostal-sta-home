// Panel privado del hostal: día a día, reservas, calendario, habitaciones,
// tarifas, cobros y ajustes.

import { html, raw, esc, $, $$, icon, clp, human, plural, addDays, diffDays, toast, openSheet, closeSheet, confirmSheet, rangePicker, pill, copyText, pctFmt, PAY_STATUS, STATUS } from './ui.js';
import { ledger } from './ledger.js';
import { logoMark, floorPlan } from './art.js';
import { UNIT_LABEL } from '../core/pricing.js';
import { humanLong, names } from '../core/dates.js';

let ctx = null; // { api, info, root, go }
const A = async (m, a) => {
  try { return await ctx.api.admin(m, a); }
  catch (e) {
    if (e.status === 401 && m !== 'login') { renderLogin(); throw e; }
    throw e;
  }
};

const NAV = [
  ['', 'home', 'Hoy'],
  ['reservas', 'list', 'Reservas'],
  ['calendario', 'cal', 'Calendario'],
  ['habitaciones', 'bed', 'Habitaciones'],
  ['tarifas', 'tag', 'Tarifas'],
  ['cobros', 'chart', 'Cobros'],
  ['ajustes', 'gear', 'Ajustes'],
];

export async function renderAdmin({ api, info, root, go, rest }) {
  ctx = { api, info, root, go, rest };
  document.title = 'Panel · Santa Elena de Maipo Home';
  let me;
  try { me = await api.admin('me'); } catch (e) {
    if (e.status === 401) return renderLogin();
    root.innerHTML = html`<p class="wrap msg">${e.message}</p>`;
    return;
  }
  ctx.me = me;
  const section = rest[0] || '';
  root.innerHTML = html`<div class="adm">
    <aside class="adm-side">
      <a class="brand" href="#/inicio" aria-label="Ver el sitio público">${logoMark()}<span class="brand-name">Santa Elena<small>Panel</small></span></a>
      <nav class="adm-nav" aria-label="Panel">${NAV.map(([k, i, t]) => html`<a href="#/panel${k ? `/${k}` : ''}" class="${section === k ? 'on' : ''}" ${section === k ? raw('aria-current="page"') : ''}>${icon(i)}<span>${t}</span></a>`)}</nav>
      <div class="adm-side-foot">
        ${api.mode === 'demo' ? html`<p class="adm-env adm-env-demo">Demostración · pagos simulados</p>` : html`<p class="adm-env ${me.environment === 'produccion' ? 'adm-env-live' : 'adm-env-demo'}">Webpay: ${me.environment === 'produccion' ? 'producción' : me.environment === 'simulado' ? 'simulado' : 'pruebas (integración)'}</p>`}
        <a href="#/inicio" class="adm-link">${icon('house')} Ver sitio</a>
        <button class="adm-link" id="logout">${icon('logout')} Salir</button>
      </div>
    </aside>
    <main class="adm-main" id="main" tabindex="-1"><p class="loading">Cargando…</p></main>
  </div>`;
  $('#logout', root).addEventListener('click', async () => { await A('logout'); go('inicio'); });
  const main = $('#main', root);
  try {
    const views = { '': viewToday, reservas: viewBookings, calendario: viewCalendar, habitaciones: viewRooms, tarifas: viewRates, cobros: viewMoney, ajustes: viewSettings };
    await (views[section] || viewToday)(main, rest.slice(1));
  } catch (e) {
    if (e.status !== 401) { console.error(e); main.innerHTML = html`<div class="alert alert-bad">${icon('alert')}<p>${e.message}</p></div>`; }
  }
}

function renderLogin() {
  const demo = ctx.api.mode === 'demo';
  ctx.root.innerHTML = html`<div class="login">
    <form class="login-card" id="login" novalidate>
      <a class="brand" href="#/inicio">${logoMark()}<span class="brand-name">Santa Elena<small>Panel del hostal</small></span></a>
      <h1 class="h3">Entrar al panel</h1>
      ${demo ? html`<p class="note">${icon('info')} Demostración: escribe cualquier correo y contraseña. En la versión publicada, el acceso usa la cuenta que crees al instalar.</p>` : ''}
      <div class="field"><label for="l-email">Correo</label><input id="l-email" name="email" type="email" autocomplete="username" required value="${demo ? 'rene@santaelena.cl' : ''}"></div>
      <div class="field"><label for="l-pass">Contraseña</label><input id="l-pass" name="password" type="password" autocomplete="current-password" required value="${demo ? 'demostracion' : ''}"></div>
      <button class="btn btn-primary">Entrar</button>
      <p class="field-err" id="l-err" hidden></p>
    </form>
  </div>`;
  $('#login').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await A('login', Object.fromEntries(new FormData(e.target))); renderAdmin({ ...ctx, rest: ctx.rest || [] }); }
    catch (x) { const el = $('#l-err'); el.hidden = false; el.textContent = x.message; }
  });
}

const head = (title, sub = '', actions = '') => html`<header class="adm-head"><div><h1 class="h2">${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div><div class="row">${actions}</div></header>`;
const monthRange = (t, delta = 0) => {
  const [y, m] = t.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1 + delta, 1));
  const last = new Date(Date.UTC(y, m + delta, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10), label: `${names.MESES[first.getUTCMonth()]} ${first.getUTCFullYear()}` };
};

// ---------- Hoy ----------
async function viewToday(main) {
  const [t, rooms, bookings, outbox] = await Promise.all([A('today'), A('list', { kind: 'rooms' }), A('bookings', {}), A('list', { kind: 'outbox' })]);
  const month = monthRange(t.today);
  const sum = await A('summary', month);
  const unconfirmed = rooms.filter((r) => r.dataStatus === 'por_confirmar' || r.rateStatus === 'estimada').length;
  const queued = outbox.filter((m) => m.status === 'en_cola').length;
  const upcoming = bookings.filter((b) => ['confirmada'].includes(b.status) && b.checkin > t.today && b.checkin <= addDays(t.today, 7)).sort((a, b) => a.checkin.localeCompare(b.checkin));
  const list = (items, empty, extra = (b) => '') => items.length ? html`<ul class="mini">${items.map((b) => html`<li><button class="mini-row" data-open="${b.id}"><span><strong>${b.guest}</strong><span class="muted">${b.rooms}</span></span><span class="mini-r">${extra(b)}</span></button></li>`)}</ul>` : html`<p class="muted small">${empty}</p>`;
  main.innerHTML = html`
    ${head(`Hoy, ${humanLong(t.today)}`, '', html`<button class="btn btn-primary" id="new-bk">${icon('plus')} Nueva reserva</button>`)}
    ${t.review.length || unconfirmed || queued || t.pendingPayment ? html`<div class="adm-alerts">
      ${t.review.length ? html`<div class="alert alert-bad">${icon('alert')}<p><strong>${plural(t.review.length, 'reserva requiere', 'reservas requieren')} revisión:</strong> pagaron después de que se liberaran sus noches. Reubica o devuelve el dinero. ${t.review.map((b) => html`<button class="linklike" data-open="${b.id}">${b.code}</button> `)}</p></div>` : ''}
      ${unconfirmed ? html`<div class="alert">${icon('info')}<p><strong>${plural(unconfirmed, 'habitación tiene', 'habitaciones tienen')} la tarifa estimada</strong>. Pon el precio real y guarda. <a href="#/panel/tarifas">Ir a Tarifas</a></p></div>` : ''}
      ${queued ? html`<div class="alert">${icon('mail')}<p><strong>${plural(queued, 'correo', 'correos')} en cola sin enviar.</strong> Falta conectar el servicio de correo (ver Ajustes).</p></div>` : ''}
      ${t.pendingPayment ? html`<div class="alert">${icon('clock')}<p>${plural(t.pendingPayment, 'reserva está', 'reservas están')} esperando que el huésped termine de pagar. Si no paga en ${ctx.info.holdMinutes} minutos, las noches se liberan solas.</p></div>` : ''}
    </div>` : ''}
    <section class="kpis" aria-label="Resumen de ${month.label}">
      <div class="kpi"><span>Cobrado a huéspedes · ${month.label}</span><strong>${clp(sum.gross)}</strong><em>${clp(sum.online)} en línea · ${clp(sum.atProperty)} en el hostal</em></div>
      <div class="kpi"><span>Comisiones Webpay (con IVA)</span><strong>${clp(sum.fees + sum.feesVat)}</strong><em>${sum.online ? `${sum.effectiveFeePct.toLocaleString('es-CL', { maximumFractionDigits: 2 })} % de lo cobrado en línea` : 'Sin cobros en línea'}</em></div>
      <div class="kpi kpi-main"><span>Recibe el hostal</span><strong>${clp(sum.net)}</strong><em>Cobrado − comisiones − devoluciones</em></div>
      <div class="kpi"><span>Saldos por cobrar al llegar</span><strong>${clp(sum.pendingBalances)}</strong><em>Reservas confirmadas</em></div>
      <div class="kpi"><span>Ocupación del mes</span><strong>${Math.round(sum.occupancyPct)} %</strong><em>${plural(sum.nightsSold, 'noche vendida', 'noches vendidas')} de ${sum.capacity}</em></div>
    </section>
    <section class="adm-cols">
      <div class="panel"><h2 class="h4">Llegan hoy</h2>${list(t.arrivals, 'Nadie llega hoy.', (b) => html`${b.arrivalTime ? html`<span class="muted small">${b.arrivalTime}</span>` : ''}${b.balanceDue ? html`<span class="due">Cobrar ${clp(b.balanceDue)}</span>` : html`<span class="pill pill-ok">Pagado</span>`}`)}</div>
      <div class="panel"><h2 class="h4">Salen hoy</h2>${list(t.departures, 'Nadie sale hoy.', (b) => b.balanceDue ? html`<span class="due">Saldo ${clp(b.balanceDue)}</span>` : '')}</div>
      <div class="panel"><h2 class="h4">Alojados</h2>${list(t.inHouse, 'No hay huéspedes alojados.')}</div>
      <div class="panel"><h2 class="h4">Próximos 7 días</h2>${upcoming.length ? html`<ul class="mini">${upcoming.map((b) => html`<li><button class="mini-row" data-open="${b.id}"><span><strong>${b.guest}</strong><span class="muted">${human(b.checkin, { weekday: true })} · ${b.rooms}</span></span><span class="mini-r">${b.balanceDue ? html`<span class="muted small">Saldo ${clp(b.balanceDue)}</span>` : ''}</span></button></li>`)}</ul>` : html`<p class="muted small">Sin llegadas esta semana.</p>`}</div>
    </section>`;
  main.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) openBooking(o.dataset.open, () => viewToday(main)); });
  $('#new-bk', main).addEventListener('click', () => newBookingSheet(() => viewToday(main)));
}

// ---------- Reservas ----------
async function viewBookings(main, [openId]) {
  const state = { q: '', status: '' };
  main.innerHTML = html`${head('Reservas', 'Todas las reservas del sitio, del teléfono y de mostrador.', html`<button class="btn btn-primary" id="new-bk">${icon('plus')} Nueva reserva</button>`)}
    <div class="toolbar">
      <label class="search-in">${icon('search')}<span class="sr">Buscar</span><input id="bq" placeholder="Buscar por nombre, código, correo o teléfono" autocomplete="off"></label>
      <label class="sel-wrap"><span class="sr">Estado</span><select id="bs"><option value="">Todos los estados</option>${Object.entries(STATUS).map(([k, [t]]) => html`<option value="${k}">${t}</option>`)}</select></label>
    </div>
    <div class="table-wrap"><table class="tbl" id="bt"><thead><tr><th>Código</th><th>Huésped</th><th>Estadía</th><th>Habitación</th><th class="r">Total</th><th class="r">Pagado</th><th class="r">Saldo</th><th>Estado</th><th>Origen</th></tr></thead><tbody></tbody></table></div>`;
  const draw = async () => {
    const rows = await A('bookings', { q: state.q, status: state.status });
    $('#bt tbody', main).innerHTML = rows.length ? html`${rows.map((b) => html`<tr tabindex="0" data-open="${b.id}">
      <td class="mono">${b.code}</td><td>${b.guest}</td><td class="nowrap">${human(b.checkin)} → ${human(b.checkout)} <span class="muted">(${diffDays(b.checkin, b.checkout)} n)</span></td>
      <td>${b.rooms}</td><td class="r">${clp(b.total)}</td><td class="r">${clp(b.amountPaid - (b.amountRefunded || 0))}</td><td class="r ${b.balanceDue ? 'due' : ''}">${b.balanceDue ? clp(b.balanceDue) : '—'}</td>
      <td>${pill(b.status)}</td><td class="muted">${{ web: 'Sitio web', admin: 'Panel' }[b.source] || b.source}</td></tr>`)}` : html`<tr><td colspan="9" class="muted empty">No hay reservas con ese filtro.</td></tr>`;
  };
  await draw();
  let t;
  $('#bq', main).addEventListener('input', (e) => { clearTimeout(t); t = setTimeout(() => { state.q = e.target.value; draw(); }, 200); });
  $('#bs', main).addEventListener('change', (e) => { state.status = e.target.value; draw(); });
  const open = (id) => openBooking(id, draw);
  main.addEventListener('click', (e) => { const r = e.target.closest('[data-open]'); if (r) open(r.dataset.open); });
  main.addEventListener('keydown', (e) => { const r = e.target.closest('tr[data-open]'); if (r && e.key === 'Enter') open(r.dataset.open); });
  $('#new-bk', main).addEventListener('click', () => newBookingSheet(draw));
  if (openId) open(openId);
}

async function openBooking(id, refresh) {
  const b = await A('booking', { id });
  const v = b.view;
  const g = b.guest;
  const online = b.payments.filter((p) => p.method === 'webpay');
  const actions = [];
  if (['confirmada', 'en_estadia', 'pendiente_pago'].includes(b.status) && v.balanceDue > 0) actions.push(html`<button class="btn btn-primary btn-sm" data-act="pay">${icon('cash')} Registrar pago</button>`);
  if (b.status === 'confirmada') actions.push(html`<button class="btn btn-soft btn-sm" data-act="in">Marcar llegada</button>`);
  if (b.status === 'en_estadia') actions.push(html`<button class="btn btn-soft btn-sm" data-act="out">Marcar salida</button>`);
  if (b.status === 'requiere_revision') actions.push(html`<button class="btn btn-soft btn-sm" data-act="relocate">Confirmar (si hay cupo)</button>`);
  if (b.status === 'confirmada') actions.push(html`<button class="btn btn-ghost btn-sm" data-act="dates">Cambiar fechas</button>`, html`<button class="btn btn-ghost btn-sm" data-act="noshow">No llegó</button>`);
  if (['confirmada', 'pendiente_pago', 'requiere_revision'].includes(b.status)) actions.push(html`<button class="btn btn-ghost btn-sm danger-text" data-act="cancel">Cancelar</button>`);

  const sheet = openSheet(html`<div class="bk-detail">
    <header class="bd-head"><div><p class="eyebrow">${{ web: 'Reserva del sitio web', admin: 'Reserva del panel' }[b.source] || b.source} · creada ${human(b.createdAt.slice(0, 10), { year: true })}</p><h2 class="h2 mono">${b.code}</h2></div>${pill(b.status)}</header>
    ${actions.length ? html`<div class="row bd-actions">${actions}</div>` : ''}
    <div class="bd-grid">
      <section>
        <h3 class="h5">Huésped</h3>
        <dl class="kv">
          <div><dt>Nombre</dt><dd>${g.firstName} ${g.lastName}</dd></div>
          <div><dt>Correo</dt><dd class="sel">${g.email}</dd></div>
          <div><dt>Teléfono</dt><dd class="sel">${g.phone}</dd></div>
          <div><dt>País</dt><dd>${g.country || '—'}</dd></div>
          <div><dt>Documento</dt><dd>${g.docId || '—'}</dd></div>
          <div><dt>Llegada estimada</dt><dd>${g.arrivalTime || '—'}</dd></div>
          ${g.notes ? html`<div class="kv-wide"><dt>Comentarios</dt><dd>${g.notes}</dd></div>` : ''}
          ${b.notesInternal ? html`<div class="kv-wide"><dt>Nota interna</dt><dd>${b.notesInternal}</dd></div>` : ''}
        </dl>
        <h3 class="h5">Estadía</h3>
        <dl class="kv">
          <div><dt>Llegada</dt><dd>${humanLong(b.checkin)}</dd></div>
          <div><dt>Salida</dt><dd>${humanLong(b.checkout)}</dd></div>
          <div class="kv-wide"><dt>Habitaciones</dt><dd>${b.items.map((i) => html`${i.roomName}: ${plural(i.adults, 'adulto', 'adultos')}${i.children ? `, ${plural(i.children, 'niño', 'niños')}` : ''}<br>`)}</dd></div>
        </dl>
        <h3 class="h5">Pagos y comisiones</h3>
        ${b.payments.length ? html`<div class="table-wrap"><table class="tbl tbl-sm"><thead><tr><th>Fecha</th><th>Movimiento</th><th class="r">Monto</th><th class="r">Comisión + IVA</th><th class="r">Recibe el hostal</th></tr></thead><tbody>
          ${b.payments.map((p) => html`<tr><td class="nowrap">${human(p.createdAt.slice(0, 10))}</td><td>${p.kind === 'reembolso' ? 'Devolución' : 'Pago'} · ${p.method === 'webpay' ? `Webpay ${p.cardType ? { credit: 'crédito', debit: 'débito', prepaid: 'prepago' }[p.cardType] : ''}${p.cardLast4 ? ` ****${p.cardLast4}` : ''}` : p.method}<br><span class="muted small">${{ autorizado: 'Aprobado', iniciado: 'Iniciado, sin terminar', rechazado: 'Rechazado', anulado: 'Anulado por el huésped', pendiente_manual: 'Devolver manualmente' }[p.status] || p.status}</span></td>
            <td class="r">${p.kind === 'reembolso' ? '−' : ''}${clp(p.amount)}</td><td class="r">${p.fee ? clp(p.fee + p.feeVat) : '—'}</td><td class="r">${p.status === 'autorizado' ? (p.kind === 'reembolso' ? `−${clp(p.amount)}` : clp(p.net ?? p.amount)) : '—'}</td></tr>`)}
        </tbody></table></div>` : html`<p class="muted small">Sin pagos todavía.</p>`}
        ${online.length ? html`<p class="muted small">Webpay abona débito en 24 horas hábiles y crédito en 48 horas hábiles, ya descontada la comisión.</p>` : ''}
        <h3 class="h5">Historial</h3>
        <ol class="timeline">${(b.history || []).slice().reverse().map((h) => html`<li><time>${new Date(h.at).toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' })}</time><span>${h.what}</span></li>`)}</ol>
        ${b.emails?.length ? html`<h3 class="h5">Correos al huésped</h3><ul class="plain">${b.emails.map((m) => html`<li>${m.subject} · <span class="muted">${{ en_cola: 'en cola (sin enviar)', enviado: 'enviado', error: 'error' }[m.status] || m.status}</span></li>`)}</ul>` : ''}
      </section>
      <aside>${ledger(b.quote, { info: ctx.info, booking: v, fees: true })}</aside>
    </div>
  </div>`.toString(), { label: `Reserva ${b.code}`, wide: true });

  const done = async (msg) => { toast(msg); closeSheet(); await refresh?.(); openBooking(id, refresh); };
  sheet.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    try {
      if (act === 'pay') return paySheet(b, v, () => done('Pago registrado'));
      if (act === 'in') { await A('setStatus', { id, status: 'en_estadia' }); return done('Llegada registrada'); }
      if (act === 'out') { await A('setStatus', { id, status: 'completada' }); return done('Salida registrada'); }
      if (act === 'relocate') { await A('setStatus', { id, status: 'confirmada' }); return done('Reserva confirmada'); }
      if (act === 'noshow') {
        if (await confirmSheet({ title: 'Marcar como no llegó', body: '<p>Las noches se liberan. El anticipo pagado se mantiene según la política.</p>', confirm: 'Marcar no llegó', danger: true })) { await A('setStatus', { id, status: 'no_show' }); toast('Registrado'); await refresh?.(); }
        return;
      }
      if (act === 'cancel') return cancelSheet(b, v, async () => { toast('Reserva cancelada'); await refresh?.(); openBooking(id, refresh); });
      if (act === 'dates') return datesSheet(b, async () => { toast('Fechas cambiadas'); await refresh?.(); openBooking(id, refresh); });
    } catch (err) { toast(err.message, 'bad'); }
  });
}

function paySheet(b, v, after) {
  const sheet = openSheet(html`<h2 class="h3">Registrar pago en el hostal</h2><p class="muted">Saldo pendiente: ${clp(v.balanceDue)}.</p>
    <form id="pf" class="stack">
      <div class="field"><label for="p-amt">Monto (CLP)</label><input id="p-amt" name="amount" inputmode="numeric" value="${v.balanceDue}"></div>
      <div class="field"><label for="p-m">Medio</label><select id="p-m" name="method"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="pos">Tarjeta en el hostal (POS)</option><option value="otro">Otro</option></select></div>
      <div class="field"><label for="p-n">Nota <span class="opt">opcional</span></label><input id="p-n" name="note"></div>
      <div class="row-end"><button type="button" class="btn btn-ghost" data-close>Volver</button><button class="btn btn-primary">Registrar</button></div>
    </form>`.toString(), { label: 'Registrar pago' });
  $('#pf', sheet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await A('recordPayment', { id: b.id, amount: +String(f.amount).replace(/\D/g, ''), method: f.method, note: f.note }); after(); } catch (x) { toast(x.message, 'bad'); }
  });
}

function cancelSheet(b, v, after) {
  const c = v.cancellation || { refund: 0, retained: 0, free: false };
  const maxRefund = b.amountPaid - (b.amountRefunded || 0);
  const sheet = openSheet(html`<h2 class="h3">Cancelar ${b.code}</h2>
    <p>${c.free ? html`Está dentro del plazo de cancelación gratis: según la política corresponde devolver <strong>${clp(c.refund)}</strong>.` : html`El plazo de cancelación gratis terminó el ${humanLong(v.freeCancelUntil)}: según la política se retiene ${clp(c.retained)} y se devuelve ${clp(c.refund)}.`}</p>
    <form id="cf" class="stack">
      <div class="field"><label for="c-r">Monto a devolver (CLP)</label><input id="c-r" name="refund" inputmode="numeric" value="${c.refund}"><p class="hint">Puedes devolver más como gesto comercial, hasta ${clp(maxRefund)}. Las devoluciones de Webpay se piden automáticamente; si no se puede, queda marcada para devolver a mano.</p></div>
      <div class="field"><label for="c-why">Motivo <span class="opt">opcional</span></label><input id="c-why" name="reason"></div>
      <div class="row-end"><button type="button" class="btn btn-ghost" data-close>Volver</button><button class="btn btn-danger">Cancelar reserva</button></div>
    </form>`.toString(), { label: 'Cancelar reserva' });
  $('#cf', sheet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await A('cancel', { id: b.id, refund: String(f.refund).replace(/\D/g, ''), reason: f.reason }); closeSheet(); after(); } catch (x) { toast(x.message, 'bad'); }
  });
}

function datesSheet(b, after) {
  const st = { checkin: b.checkin, checkout: b.checkout };
  const sheet = openSheet(html`<h2 class="h3">Cambiar fechas de ${b.code}</h2><div id="rpa"></div><div id="chk" aria-live="polite"></div>`.toString(), { label: 'Cambiar fechas', wide: true });
  const out = $('#chk', sheet);
  const check = async () => {
    if (!st.checkin || !st.checkout) return;
    try {
      const r = await A('changeDates', { id: b.id, ...st, dryRun: true });
      out.innerHTML = html`<div class="chg-box ${r.available ? '' : 'chg-bad'}">${r.available ? html`<p>Nuevo total ${clp(r.quote.total)} (antes ${clp(r.previousTotal)}). Nuevo saldo: ${clp(r.newBalance)}.</p><button class="btn btn-primary" data-apply>Guardar nuevas fechas</button>` : html`<p>La habitación no está libre en esas fechas.</p>`}</div>`;
      $('[data-apply]', out)?.addEventListener('click', async () => { try { await A('changeDates', { id: b.id, ...st }); closeSheet(); after(); } catch (x) { toast(x.message, 'bad'); } });
    } catch (x) { out.innerHTML = html`<p class="warn-text">${x.message}</p>`; }
  };
  rangePicker($('#rpa', sheet), { checkin: b.checkin, checkout: b.checkout, today: ctx.info.today, months: matchMedia('(min-width: 760px)').matches ? 2 : 1, onChange: (x) => { Object.assign(st, x); check(); } });
}

// Reserva hecha por teléfono o en mostrador.
async function newBookingSheet(after, preset = {}) {
  const rooms = (await A('list', { kind: 'rooms' })).filter((r) => r.active !== false);
  const charges = (await A('list', { kind: 'charges' })).filter((c) => c.active !== false && !c.mandatory);
  const st = { checkin: preset.checkin || null, checkout: preset.checkout || null, roomId: preset.roomId || rooms[0].id, adults: 2, children: 0, extras: new Set() };
  const sheet = openSheet(html`<h2 class="h3">Nueva reserva</h2><p class="muted">Para reservas por teléfono, WhatsApp o en recepción. Queda confirmada sin cobro en línea; registra los pagos cuando lleguen.</p>
    <div id="nb-rp"></div>
    <form id="nb" class="stack" novalidate>
      <div class="fields">
        <div class="field"><label for="nb-room">Habitación</label><select id="nb-room" name="roomId">${rooms.map((r) => html`<option value="${r.id}" ${r.id === st.roomId ? 'selected' : ''}>${r.name} (hasta ${r.maxGuests})</option>`)}</select></div>
        <div class="field"><label for="nb-a">Adultos</label><input id="nb-a" name="adults" type="number" min="1" max="12" value="2"></div>
        <div class="field"><label for="nb-c">Niños menores de 12</label><input id="nb-c" name="children" type="number" min="0" max="8" value="0"></div>
        ${charges.length ? html`<fieldset class="field field-wide plain-fs"><legend>Extras</legend>${charges.map((c) => html`<label class="check"><input type="checkbox" name="extra" value="${c.id}"><span>${c.name} · ${clp(c.amount)} ${UNIT_LABEL[c.unit]}</span></label>`)}</fieldset>` : ''}
        <div class="field"><label for="nb-fn">Nombre</label><input id="nb-fn" name="firstName" required></div>
        <div class="field"><label for="nb-ln">Apellido</label><input id="nb-ln" name="lastName" required></div>
        <div class="field"><label for="nb-em">Correo</label><input id="nb-em" name="email" type="email" required></div>
        <div class="field"><label for="nb-ph">Teléfono</label><input id="nb-ph" name="phone" type="tel" required></div>
        <div class="field field-wide"><label for="nb-note">Nota interna <span class="opt">opcional</span></label><input id="nb-note" name="notesInternal"></div>
      </div>
      <div id="nb-q"></div>
      <div class="row-end"><button type="button" class="btn btn-ghost" data-close>Volver</button><button class="btn btn-primary">Crear reserva</button></div>
    </form>`.toString(), { label: 'Nueva reserva', wide: true });
  const form = $('#nb', sheet);
  const read = () => {
    const f = new FormData(form);
    st.roomId = f.get('roomId'); st.adults = +f.get('adults') || 1; st.children = +f.get('children') || 0; st.extras = new Set(f.getAll('extra'));
  };
  const quote = async () => {
    read();
    const box = $('#nb-q', sheet);
    if (!st.checkin || !st.checkout) { box.innerHTML = html`<p class="muted small">Elige las fechas arriba.</p>`; return; }
    try {
      const q = await A('quote', { checkin: st.checkin, checkout: st.checkout, items: [{ roomId: st.roomId, adults: st.adults, children: st.children }], extras: [...st.extras] });
      const s = await A('search', { checkin: st.checkin, checkout: st.checkout, adults: 1 });
      const free = s.results.find((r) => r.room.id === st.roomId)?.available;
      box.innerHTML = html`${free ? '' : html`<div class="alert alert-bad">${icon('alert')}<p>Esa habitación no está libre en esas fechas.</p></div>`}<p class="nb-total">Total ${clp(q.total)} · ${plural(q.nights, 'noche', 'noches')}${q.discount ? ` · incluye ${q.discount.name}` : ''}</p>`;
    } catch (e) { box.innerHTML = html`<p class="warn-text">${e.message}</p>`; }
  };
  rangePicker($('#nb-rp', sheet), { checkin: st.checkin, checkout: st.checkout, today: ctx.info.today, months: matchMedia('(min-width: 760px)').matches ? 2 : 1, onChange: (x) => { Object.assign(st, x); quote(); } });
  form.addEventListener('change', quote);
  quote();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    read();
    const f = Object.fromEntries(new FormData(form));
    try {
      const bk = await A('createBooking', { checkin: st.checkin, checkout: st.checkout, items: [{ roomId: st.roomId, adults: st.adults, children: st.children }], extras: [...st.extras], guest: { firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone }, notesInternal: f.notesInternal });
      closeSheet(); toast(`Reserva ${bk.code} creada`); await after?.();
    } catch (x) {
      toast(x.fields ? Object.values(x.fields)[0] : x.message, 'bad');
    }
  });
}

// ---------- Calendario ----------
async function viewCalendar(main) {
  let start = addDays(ctx.info.today, -2);
  const DAYS = 28;
  main.innerHTML = html`${head('Calendario', 'Cada fila es una habitación. Toca una noche libre para bloquearla o crear una reserva.', html`<div class="row"><button class="icon-btn" id="cp" aria-label="Semanas anteriores">${icon('left')}</button><button class="btn btn-ghost btn-sm" id="ct">Hoy</button><button class="icon-btn" id="cn" aria-label="Semanas siguientes">${icon('right')}</button></div>`)}
    <div class="cal-legend"><span><i class="lg-b lg-conf"></i>Confirmada</span><span><i class="lg-b lg-pend"></i>Esperando pago</span><span><i class="lg-b lg-stay"></i>En estadía</span><span><i class="lg-b lg-block"></i>Bloqueo</span></div>
    <div class="cal-wrap" id="cal"></div>`;
  const draw = async () => {
    const to = addDays(start, DAYS - 1);
    const c = await A('calendar', { from: start, to });
    const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i));
    const col = (d) => diffDays(start, d) + 2;
    const bars = [];
    c.rooms.forEach((r, ri) => {
      const row = ri + 2;
      const mine = c.locks.filter((l) => l.roomId === r.id);
      const groups = [];
      for (const l of mine) {
        const key = l.bookingId || l.blockId;
        const g = groups[groups.length - 1];
        if (g && g.key === key && addDays(g.last, 1) === l.night) g.last = l.night; else groups.push({ key, first: l.night, last: l.night, booking: !!l.bookingId });
      }
      for (const g of groups) {
        const bk = g.booking ? c.bookings.find((x) => x.id === g.key) : null;
        const bl = !g.booking ? c.blocks.find((x) => x.id === g.key) : null;
        const cls = bk ? { confirmada: 'conf', pendiente_pago: 'pend', en_estadia: 'stay', requiere_revision: 'pend' }[bk.status] || 'conf' : 'block';
        const label = bk ? `${bk.guest}${bk.paymentStatus === 'pagado' ? '' : ''}` : bl?.reason || 'Bloqueo';
        bars.push(html`<button class="bar bar-${cls}" style="grid-row:${row};grid-column:${col(g.first)} / span ${diffDays(g.first, g.last) + 1}" ${bk ? raw(`data-bk="${bk.id}"`) : raw(`data-bl="${g.key}"`)} title="${label}"><span>${label}</span></button>`);
      }
    });
    $('#cal', main).innerHTML = html`<div class="cal" style="grid-template-columns: minmax(120px, 160px) repeat(${DAYS}, minmax(38px, 1fr))">
      <div class="cal-corner"></div>
      ${days.map((d, i) => { const dt = new Date(d + 'T12:00:00Z'); const wd = dt.getUTCDay(); const newMonth = dt.getUTCDate() === 1 || i === 0; return html`<div class="cal-day ${d === ctx.info.today ? 'is-today' : ''} ${wd === 0 || wd === 6 ? 'is-we' : ''} ${newMonth ? 'is-m' : ''}" style="grid-column:${i + 2}">${newMonth ? html`<em>${names.MESES_CORTOS[dt.getUTCMonth()]}</em>` : html`<span>${names.DIAS_CORTOS[wd]}</span>`}<strong>${dt.getUTCDate()}</strong></div>`; })}
      ${c.rooms.map((r, ri) => html`<div class="cal-room" style="grid-row:${ri + 2}">${r.shortName || r.name}</div>${days.map((d, i) => html`<button class="cal-cell ${d === ctx.info.today ? 'is-today' : ''}" style="grid-row:${ri + 2};grid-column:${i + 2}" data-room="${r.id}" data-d="${d}" aria-label="${r.name}, noche del ${human(d)}"></button>`)}`)}
      ${bars}
    </div>`;
  };
  await draw();
  $('#cp', main).addEventListener('click', () => { start = addDays(start, -14); draw(); });
  $('#cn', main).addEventListener('click', () => { start = addDays(start, 14); draw(); });
  $('#ct', main).addEventListener('click', () => { start = addDays(ctx.info.today, -2); draw(); });
  $('#cal', main).addEventListener('click', async (e) => {
    const bk = e.target.closest('[data-bk]');
    if (bk) return openBooking(bk.dataset.bk, draw);
    const bl = e.target.closest('[data-bl]');
    if (bl) {
      const cal = await A('calendar', { from: start, to: addDays(start, DAYS) });
      const block = cal.blocks.find((x) => x.id === bl.dataset.bl);
      if (await confirmSheet({ title: 'Quitar bloqueo', body: html`<p>${block?.reason || ''} · ${human(block.from)} a ${human(block.to)} (última noche).</p>`.toString(), confirm: 'Quitar bloqueo', danger: true })) {
        await A('removeBlock', { id: bl.dataset.bl }); toast('Bloqueo quitado'); draw();
      }
      return;
    }
    const cell = e.target.closest('.cal-cell');
    if (!cell) return;
    const room = cell.dataset.room; const d = cell.dataset.d;
    const sheet = openSheet(html`<h2 class="h3">Noche del ${humanLong(d)}</h2>
      <div class="row"><button class="btn btn-primary" data-new>${icon('plus')} Crear reserva desde esta noche</button></div>
      <hr class="sep">
      <form id="blk" class="stack"><h3 class="h5">O bloquear noches</h3>
        <div class="fields"><div class="field"><label for="b-from">Primera noche</label><input id="b-from" name="from" type="date" value="${d}"></div><div class="field"><label for="b-to">Última noche</label><input id="b-to" name="to" type="date" value="${d}"></div>
        <div class="field field-wide"><label for="b-r">Motivo</label><input id="b-r" name="reason" value="Mantención" maxlength="200"></div></div>
        <div class="row-end"><button class="btn btn-soft">Bloquear</button></div></form>`.toString(), { label: 'Noche' });
    $('[data-new]', sheet).addEventListener('click', () => { closeSheet(); newBookingSheet(draw, { checkin: d, checkout: addDays(d, 1), roomId: room }); });
    $('#blk', sheet).addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = Object.fromEntries(new FormData(ev.target));
      try { await A('createBlock', { roomId: room, from: f.from, to: f.to, reason: f.reason }); closeSheet(); toast('Noches bloqueadas'); draw(); } catch (x) { toast(x.message, 'bad'); }
    });
  });
}

// ---------- Habitaciones ----------
async function viewRooms(main) {
  const rooms = await A('list', { kind: 'rooms' });
  main.innerHTML = html`${head('Habitaciones', 'Nombre, fotos, capacidad y lo que incluye cada una. Lo que cambies aquí se ve al instante en el sitio.', html`<button class="btn btn-primary" id="add-room">${icon('plus')} Agregar habitación</button>`)}
    <div class="adm-rooms">${rooms.map((r) => html`<article class="adm-room ${r.active === false ? 'is-off' : ''}">
      <div class="adm-room-img">${r.photos?.length ? html`<img src="${r.photos[0].url}" alt="">` : html`<div class="plan-bg">${floorPlan(r, { compact: true })}</div>`}</div>
      <div class="adm-room-body">
        <h2 class="h4">${r.name} ${r.active === false ? html`<span class="pill pill-muted">Oculta</span>` : ''} ${r.dataStatus === 'por_confirmar' ? html`<span class="pill pill-warn">Por confirmar</span>` : ''}</h2>
        <p class="muted small">${r.sizeM2 ? `${r.sizeM2} m² · ` : ''}${r.beds} · hasta ${r.maxGuests} · ${plural(r.photos?.length || 0, 'foto', 'fotos')}</p>
        <p><strong>${clp(r.baseRate)}</strong> <span class="muted">por noche${r.extraGuestFee ? ` · persona extra ${clp(r.extraGuestFee)}` : ''}${r.minNights > 1 ? ` · mínimo ${r.minNights} noches` : ''}</span></p>
        <button class="btn btn-ghost btn-sm" data-edit="${r.id}">${icon('edit')} Editar</button>
      </div></article>`)}</div>`;
  main.addEventListener('click', (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) roomSheet(rooms.find((r) => r.id === b.dataset.edit), () => viewRooms(main));
  });
  $('#add-room', main).addEventListener('click', () => roomSheet({ name: '', beds: '1 cama doble', bathroom: 'privado', maxGuests: 2, baseOccupancy: 2, baseRate: 40000, extraGuestFee: 0, minNights: 1, amenities: ['Wifi gratis', 'Baño privado'], photos: [], active: true, sort: rooms.length + 1 }, () => viewRooms(main)));
}

// Achica la foto en el navegador antes de subirla. Al redibujarla en un canvas
// se pierden los metadatos (ubicación GPS incluida) y queda bien girada.
async function resizeImage(file, max = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const webp = c.toDataURL('image/webp', 0.78);
    return webp.startsWith('data:image/webp') ? webp : c.toDataURL('image/jpeg', 0.8); // navegadores sin WebP
  } finally { URL.revokeObjectURL(url); }
}

// Sube una foto en dos tamaños: 1600 px para verla en grande y 800 px para las listas.
async function uploadPhoto(f) {
  const [big, small] = [await resizeImage(f, 1600), await resizeImage(f, 800)];
  const up = await A('upload', { dataUrl: big, name: f.name });
  const th = await A('upload', { dataUrl: small, name: f.name });
  return { url: up.url, thumb: th.url, alt: '' };
}

// Editor de fotos reutilizable: ordenar, describir, quitar y subir.
function photoEditor(root, photos, { empty }) {
  const box = $('[data-photos]', root);
  const draw = () => {
    box.innerHTML = photos.length ? html`${photos.map((p, i) => html`<figure class="ph"><img src="${p.thumb || p.url}" alt=""><input aria-label="Descripción de la foto ${i + 1}" data-alt="${i}" value="${p.alt || ''}" placeholder="Describe la foto"><div class="ph-ctl"><button type="button" class="icon-btn sm" data-mv="${i}" data-dir="-1" aria-label="Mover antes" ${i === 0 ? 'disabled' : ''}>${icon('left')}</button><button type="button" class="icon-btn sm" data-mv="${i}" data-dir="1" aria-label="Mover después" ${i === photos.length - 1 ? 'disabled' : ''}>${icon('right')}</button><button type="button" class="icon-btn sm" data-rm="${i}" aria-label="Quitar foto">${icon('trash')}</button></div></figure>`)}` : html`<p class="muted small">${empty}</p>`;
  };
  draw();
  box.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-mv]');
    if (mv) { const i = +mv.dataset.mv; const j = i + +mv.dataset.dir; [photos[i], photos[j]] = [photos[j], photos[i]]; draw(); }
    const rm = e.target.closest('[data-rm]');
    if (rm) { photos.splice(+rm.dataset.rm, 1); draw(); }
  });
  box.addEventListener('input', (e) => { if (e.target.dataset.alt != null) photos[+e.target.dataset.alt].alt = e.target.value; });
  $('[data-upload]', root).addEventListener('change', async (e) => {
    const label = e.target.closest('label');
    label?.classList.add('is-busy');
    for (const f of e.target.files) {
      try { photos.push(await uploadPhoto(f)); draw(); }
      catch (x) { toast(x.message || 'No se pudo subir la foto', 'bad'); }
    }
    label?.classList.remove('is-busy');
    e.target.value = '';
  });
}

function roomSheet(r, after) {
  const photos = [...(r.photos || [])];
  const sheet = openSheet(html`<h2 class="h3">${r.id ? `Editar ${r.name}` : 'Nueva habitación'}</h2>
    <form id="rf" class="stack" novalidate>
      <div class="fields">
        <div class="field"><label for="r-name">Nombre</label><input id="r-name" name="name" value="${r.name}" required></div>
        <div class="field"><label for="r-short">Nombre corto (calendario)</label><input id="r-short" name="shortName" value="${r.shortName || ''}"></div>
        <div class="field field-wide"><label for="r-desc">Descripción</label><textarea id="r-desc" name="description" rows="3">${r.description || ''}</textarea></div>
        <div class="field"><label for="r-beds">Camas</label><input id="r-beds" name="beds" value="${r.beds || ''}" placeholder="1 cama doble y 1 cama de una plaza"><p class="hint">El plano referencial dibuja las camas desde este texto.</p></div>
        <div class="field"><label for="r-bath">Baño</label><select id="r-bath" name="bathroom"><option value="privado" ${r.bathroom !== 'compartido' ? 'selected' : ''}>Privado</option><option value="compartido" ${r.bathroom === 'compartido' ? 'selected' : ''}>Compartido</option></select></div>
        <div class="field"><label for="r-size">Superficie (m²)</label><input id="r-size" name="sizeM2" inputmode="numeric" value="${r.sizeM2 ?? ''}"></div>
        <div class="field"><label for="r-max">Capacidad máxima</label><input id="r-max" name="maxGuests" type="number" min="1" max="20" value="${r.maxGuests}"></div>
        <div class="field"><label for="r-base">Personas incluidas en la tarifa</label><input id="r-base" name="baseOccupancy" type="number" min="1" max="20" value="${r.baseOccupancy ?? r.maxGuests}"></div>
        <div class="field"><label for="r-rate">Tarifa base por noche (CLP, IVA incl.)</label><input id="r-rate" name="baseRate" inputmode="numeric" value="${r.baseRate}"></div>
        <div class="field"><label for="r-extra">Persona adicional por noche</label><input id="r-extra" name="extraGuestFee" inputmode="numeric" value="${r.extraGuestFee || 0}"><p class="hint">Se cobra por cada adulto sobre las personas incluidas. Menores de 12 no pagan.</p></div>
        <div class="field"><label for="r-min">Mínimo de noches</label><input id="r-min" name="minNights" type="number" min="1" max="30" value="${r.minNights || 1}"></div>
        <div class="field"><label for="r-view">Vista</label><input id="r-view" name="view" value="${r.view || ''}"></div>
        <div class="field field-wide"><label for="r-am">Qué incluye (separado por comas)</label><textarea id="r-am" name="amenities" rows="2">${(r.amenities || []).join(', ')}</textarea></div>
        <label class="check"><input type="checkbox" name="kitchen" ${r.kitchen ? 'checked' : ''}><span>Tiene cocina</span></label>
        <label class="check"><input type="checkbox" name="active" ${r.active !== false ? 'checked' : ''}><span>Visible y reservable en el sitio</span></label>
        <label class="check field-wide"><input type="checkbox" name="confirmed" ${r.dataStatus !== 'por_confirmar' ? 'checked' : ''}><span>Revisé estos datos y son correctos</span></label>
      </div>
      <h3 class="h5">Fotos</h3>
      <div class="photos" data-photos></div>
      <label class="btn btn-soft btn-sm upload">${icon('image')} Subir fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload></label>
      <p class="hint">Se achican automáticamente antes de subir. La primera foto es la portada. Describe cada foto para lectores de pantalla.</p>
      <div class="row-end">${r.id ? html`<button type="button" class="btn btn-ghost danger-text" id="r-del">Eliminar</button>` : ''}<button type="button" class="btn btn-ghost" data-close>Volver</button><button class="btn btn-primary">Guardar</button></div>
    </form>`.toString(), { label: 'Habitación', wide: true });
  photoEditor(sheet, photos, { empty: 'Sin fotos: el sitio muestra el plano referencial.' });
  $('#r-del', sheet)?.addEventListener('click', async () => {
    try { await A('remove', { kind: 'rooms', id: r.id }); closeSheet(); toast('Habitación eliminada'); after(); } catch (x) { toast(x.message, 'bad'); }
  });
  $('#rf', sheet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const num = (k) => String(f.get(k) ?? '').replace(/\D/g, '');
    const item = {
      ...r, name: f.get('name'), shortName: f.get('shortName'), description: f.get('description'), beds: f.get('beds'), bathroom: f.get('bathroom'),
      sizeM2: num('sizeM2') || null, maxGuests: +f.get('maxGuests'), baseOccupancy: +f.get('baseOccupancy'),
      baseRate: +num('baseRate'), rateStatus: +num('baseRate') !== r.baseRate ? 'confirmada' : r.rateStatus, extraGuestFee: +num('extraGuestFee') || 0, minNights: +f.get('minNights') || 1,
      view: f.get('view'), amenities: String(f.get('amenities')).split(','), kitchen: f.get('kitchen') === 'on', active: f.get('active') === 'on',
      dataStatus: f.get('confirmed') === 'on' ? 'confirmado' : 'por_confirmar', photos,
    };
    try { await A('save', { kind: 'rooms', item }); closeSheet(); toast('Habitación guardada'); ctx.info = await ctx.api.pub('info'); after(); } catch (x) { toast(x.message, 'bad'); }
  });
}

// ---------- Tarifas ----------
async function viewRates(main) {
  const [rooms, seasons, discounts, charges] = await Promise.all(['rooms', 'seasons', 'discounts', 'charges'].map((kind) => A('list', { kind })));
  const roomName = (id) => rooms.find((r) => r.id === id)?.shortName || id;
  main.innerHTML = html`${head('Tarifas', 'Precio base de cada habitación, temporadas, descuentos y cargos extra. Todos los montos en CLP con IVA incluido.')}
    <section class="panel">
      <div class="panel-head"><h2 class="h4">Tarifa base por noche</h2></div>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Habitación</th><th class="r">Tarifa base</th><th class="r">Persona extra</th><th class="r">Mín. noches</th><th></th></tr></thead><tbody>
        ${rooms.map((r) => html`<tr data-r="${r.id}"><td>${r.name}${r.rateStatus === 'estimada' ? html` <span class="pill pill-warn">Estimada</span>` : ''}</td>
          <td class="r"><input class="in-num" aria-label="Tarifa base de ${r.name}" name="baseRate" inputmode="numeric" value="${r.baseRate}"></td>
          <td class="r"><input class="in-num" aria-label="Persona extra en ${r.name}" name="extraGuestFee" inputmode="numeric" value="${r.extraGuestFee || 0}"></td>
          <td class="r"><input class="in-num in-xs" aria-label="Mínimo de noches en ${r.name}" name="minNights" type="number" min="1" value="${r.minNights || 1}"></td>
          <td class="r"><button class="btn btn-soft btn-sm" data-save-rate="${r.id}">Guardar</button></td></tr>`)}
      </tbody></table></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2 class="h4">Temporadas</h2><button class="btn btn-ghost btn-sm" data-new="seasons">${icon('plus')} Agregar</button></div>
      <p class="muted small">Suben o bajan la tarifa base un porcentaje en un rango de fechas. Si dos temporadas se cruzan, gana la de mayor prioridad.</p>
      <div class="table-wrap"><table class="tbl"><thead><tr><th>Nombre</th><th>Fechas (noches)</th><th class="r">Ajuste</th><th class="r">Mín. noches</th><th>Habitaciones</th><th></th></tr></thead><tbody>
        ${seasons.map((s) => html`<tr class="${s.active === false ? 'is-off' : ''}"><td>${s.name}</td><td class="nowrap">${human(s.start, { year: true })} → ${human(s.end, { year: true })}</td><td class="r">${s.adjustPct > 0 ? '+' : ''}${s.adjustPct} %</td><td class="r">${s.minNights || '—'}</td><td>${s.roomIds?.length ? s.roomIds.map(roomName).join(', ') : 'Todas'}</td><td class="r"><button class="btn btn-ghost btn-sm" data-edit="seasons" data-id="${s.id}">Editar</button></td></tr>`)}
      </tbody></table></div>
    </section>

    <div class="adm-cols">
      <section class="panel">
        <div class="panel-head"><h2 class="h4">Descuentos</h2><button class="btn btn-ghost btn-sm" data-new="discounts">${icon('plus')} Agregar</button></div>
        <p class="muted small">Se aplica solo el mejor descuento que califique, sobre el alojamiento (no sobre los extras).</p>
        <ul class="plain-list">${discounts.map((d) => html`<li class="${d.active === false ? 'is-off' : ''}"><span><strong>${d.name}</strong><br><span class="muted small">−${d.pct} % · ${d.type === 'estadia' ? `desde ${d.minNights} noches` : `reservando con ${d.minDaysAhead} días de anticipación`}</span></span><button class="btn btn-ghost btn-sm" data-edit="discounts" data-id="${d.id}">Editar</button></li>`)}</ul>
      </section>
      <section class="panel">
        <div class="panel-head"><h2 class="h4">Cargos extra</h2><button class="btn btn-ghost btn-sm" data-new="charges">${icon('plus')} Agregar</button></div>
        <p class="muted small">Opcionales los elige el huésped al reservar; los obligatorios se suman a todas las reservas y se muestran desde la búsqueda.</p>
        <ul class="plain-list">${charges.map((c) => html`<li class="${c.active === false ? 'is-off' : ''}"><span><strong>${c.name}</strong>${c.status === 'por_confirmar' ? html` <span class="pill pill-warn">Por confirmar</span>` : ''}<br><span class="muted small">${clp(c.amount)} ${UNIT_LABEL[c.unit]} · ${c.mandatory ? 'obligatorio' : 'opcional'}</span></span><button class="btn btn-ghost btn-sm" data-edit="charges" data-id="${c.id}">Editar</button></li>`)}</ul>
      </section>
    </div>

    <section class="panel">
      <div class="panel-head"><h2 class="h4">Simulador de precio</h2></div>
      <p class="muted small">Revisa exactamente lo que verá y pagará un huésped con las tarifas actuales.</p>
      <form id="sim" class="sim"><label class="field"><span>Habitación</span><select name="roomId">${rooms.filter((r) => r.active !== false).map((r) => html`<option value="${r.id}">${r.name}</option>`)}</select></label>
        <label class="field"><span>Llegada</span><input type="date" name="checkin" value="${addDays(ctx.info.today, 30)}"></label>
        <label class="field"><span>Salida</span><input type="date" name="checkout" value="${addDays(ctx.info.today, 33)}"></label>
        <label class="field"><span>Adultos</span><input type="number" name="adults" min="1" value="2"></label>
        <label class="field"><span>Niños</span><input type="number" name="children" min="0" value="0"></label></form>
      <div id="sim-out" class="sim-out"></div>
    </section>`;

  main.addEventListener('click', async (e) => {
    const sr = e.target.closest('[data-save-rate]');
    if (sr) {
      const tr = sr.closest('tr');
      const r = rooms.find((x) => x.id === sr.dataset.saveRate);
      const v = (n) => +String($(`[name="${n}"]`, tr).value).replace(/\D/g, '');
      try { await A('save', { kind: 'rooms', item: { ...r, baseRate: v('baseRate'), extraGuestFee: v('extraGuestFee'), minNights: v('minNights') || 1, rateStatus: 'confirmada' } }); r.rateStatus = 'confirmada'; $('.pill', tr)?.remove(); toast('Tarifa guardada'); sim(); } catch (x) { toast(x.message, 'bad'); }
      return;
    }
    const nw = e.target.closest('[data-new]');
    const ed = e.target.closest('[data-edit]');
    if (nw || ed) {
      const kind = (nw || ed).dataset.new || ed.dataset.edit;
      const list = { seasons, discounts, charges }[kind];
      const item = ed ? list.find((x) => x.id === ed.dataset.id) : null;
      rateItemSheet(kind, item, rooms, () => viewRates(main));
    }
  });
  const sim = async () => {
    const f = Object.fromEntries(new FormData($('#sim', main)));
    try {
      const q = await A('quote', { checkin: f.checkin, checkout: f.checkout, items: [{ roomId: f.roomId, adults: +f.adults, children: +f.children }] });
      $('#sim-out', main).innerHTML = ledger(q, { info: ctx.info, fees: true });
    } catch (x) { $('#sim-out', main).innerHTML = html`<p class="warn-text">${x.message}</p>`; }
  };
  $('#sim', main).addEventListener('change', sim);
  sim();
}

function rateItemSheet(kind, item, rooms, after) {
  const it = item || { seasons: { name: '', start: addDays(ctx.info.today, 30), end: addDays(ctx.info.today, 40), adjustPct: 10, minNights: '', priority: 1, roomIds: [], active: true }, discounts: { name: '', type: 'estadia', pct: 10, minNights: 7, minDaysAhead: 30, active: true }, charges: { name: '', description: '', unit: 'reserva', amount: 0, mandatory: false, active: true } }[kind];
  const titles = { seasons: 'Temporada', discounts: 'Descuento', charges: 'Cargo extra' };
  const body = {
    seasons: html`
      <div class="field field-wide"><label for="i-name">Nombre</label><input id="i-name" name="name" value="${it.name}" required></div>
      <div class="field"><label for="i-s">Primera noche</label><input id="i-s" name="start" type="date" value="${it.start}"></div>
      <div class="field"><label for="i-e">Última noche</label><input id="i-e" name="end" type="date" value="${it.end}"></div>
      <div class="field"><label for="i-a">Ajuste (%)</label><input id="i-a" name="adjustPct" type="number" min="-90" max="300" value="${it.adjustPct}"><p class="hint">Positivo sube, negativo baja. Ej.: 15 = +15 %.</p></div>
      <div class="field"><label for="i-m">Mínimo de noches <span class="opt">opcional</span></label><input id="i-m" name="minNights" type="number" min="1" value="${it.minNights || ''}"></div>
      <div class="field"><label for="i-p">Prioridad</label><input id="i-p" name="priority" type="number" min="0" max="100" value="${it.priority || 0}"></div>
      <fieldset class="field field-wide plain-fs"><legend>Aplica a</legend><p class="hint">Sin marcar ninguna, aplica a todas.</p>${rooms.map((r) => html`<label class="check"><input type="checkbox" name="roomIds" value="${r.id}" ${it.roomIds?.includes(r.id) ? 'checked' : ''}><span>${r.name}</span></label>`)}</fieldset>`,
    discounts: html`
      <div class="field field-wide"><label for="i-name">Nombre visible para el huésped</label><input id="i-name" name="name" value="${it.name}" required></div>
      <div class="field"><label for="i-t">Tipo</label><select id="i-t" name="type"><option value="estadia" ${it.type === 'estadia' ? 'selected' : ''}>Por largo de estadía</option><option value="anticipacion" ${it.type === 'anticipacion' ? 'selected' : ''}>Por reservar con anticipación</option></select></div>
      <div class="field"><label for="i-pct">Descuento (%)</label><input id="i-pct" name="pct" type="number" min="1" max="80" value="${it.pct}"></div>
      <div class="field"><label for="i-mn">Desde cuántas noches</label><input id="i-mn" name="minNights" type="number" min="2" value="${it.minNights || 7}"></div>
      <div class="field"><label for="i-md">Días de anticipación</label><input id="i-md" name="minDaysAhead" type="number" min="1" value="${it.minDaysAhead || 30}"></div>`,
    charges: html`
      <div class="field field-wide"><label for="i-name">Nombre</label><input id="i-name" name="name" value="${it.name}" required></div>
      <div class="field field-wide"><label for="i-d">Descripción</label><input id="i-d" name="description" value="${it.description || ''}"></div>
      <div class="field"><label for="i-am">Monto (CLP, IVA incl.)</label><input id="i-am" name="amount" inputmode="numeric" value="${it.amount}"></div>
      <div class="field"><label for="i-u">Se cobra</label><select id="i-u" name="unit">${Object.entries(UNIT_LABEL).map(([k, t]) => html`<option value="${k}" ${it.unit === k ? 'selected' : ''}>${t}</option>`)}</select></div>
      <label class="check field-wide"><input type="checkbox" name="mandatory" ${it.mandatory ? 'checked' : ''}><span>Obligatorio para todas las reservas (se muestra en el precio desde la búsqueda)</span></label>
      <label class="check field-wide"><input type="checkbox" name="confirmed" ${it.status !== 'por_confirmar' ? 'checked' : ''}><span>Monto confirmado</span></label>`,
  }[kind];
  const sheet = openSheet(html`<h2 class="h3">${item ? `Editar ${titles[kind].toLowerCase()}` : `Nuevo: ${titles[kind].toLowerCase()}`}</h2>
    <form id="rif" class="stack" novalidate><div class="fields">${body}
      <label class="check field-wide"><input type="checkbox" name="active" ${it.active !== false ? 'checked' : ''}><span>Activo</span></label></div>
      <div class="row-end">${item ? html`<button type="button" class="btn btn-ghost danger-text" id="i-del">Eliminar</button>` : ''}<button type="button" class="btn btn-ghost" data-close>Volver</button><button class="btn btn-primary">Guardar</button></div></form>`.toString(), { label: titles[kind] });
  $('#i-del', sheet)?.addEventListener('click', async () => { await A('remove', { kind, id: item.id }); closeSheet(); toast('Eliminado'); after(); });
  $('#rif', sheet).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const o = Object.fromEntries(f);
    const out = { ...(item || {}), ...o, active: f.get('active') === 'on' };
    if (kind === 'seasons') { out.roomIds = f.getAll('roomIds'); out.minNights = o.minNights ? +o.minNights : null; out.adjustPct = +o.adjustPct; out.priority = +o.priority; }
    if (kind === 'discounts') { out.pct = +o.pct; out.minNights = +o.minNights; out.minDaysAhead = +o.minDaysAhead; }
    if (kind === 'charges') { out.amount = +String(o.amount).replace(/\D/g, ''); out.mandatory = f.get('mandatory') === 'on'; out.status = f.get('confirmed') === 'on' ? 'confirmado' : 'por_confirmar'; delete out.confirmed; }
    try { await A('save', { kind, item: out }); closeSheet(); toast('Guardado'); ctx.info = await ctx.api.pub('info'); after(); } catch (x) { toast(x.message, 'bad'); }
  });
}

// ---------- Cobros ----------
async function viewMoney(main) {
  const s = await A('settings');
  const t = ctx.info.today;
  const periods = { mes: monthRange(t), anterior: monthRange(t, -1), anio: { from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31`, label: `año ${t.slice(0, 4)}` } };
  const pay = s.payment;
  main.innerHTML = html`${head('Cobros', 'Lo que pagan los huéspedes, lo que se lleva el proveedor de pago y lo que recibe el hostal.', html`<label class="sel-wrap"><span class="sr">Periodo</span><select id="per"><option value="mes">Este mes</option><option value="anterior">Mes anterior</option><option value="anio">Este año</option></select></label>`)}
    <section id="sum"></section>
    <div class="adm-cols">
      <section class="panel">
        <div class="panel-head"><h2 class="h4">Cómo se cobra</h2></div>
        <form id="pol" class="stack">
          <fieldset class="plain-fs"><legend class="h5">Al reservar en el sitio</legend>
            <label class="check"><input type="radio" name="mode" value="percent" ${s.deposit.mode === 'percent' ? 'checked' : ''}><span>Anticipo en línea y saldo al llegar</span></label>
            <label class="check"><input type="radio" name="mode" value="full" ${s.deposit.mode === 'full' ? 'checked' : ''}><span>Pago total en línea</span></label>
            <label class="check"><input type="radio" name="mode" value="none" ${s.deposit.mode === 'none' ? 'checked' : ''}><span>Sin pago en línea (se paga todo en el hostal)</span></label>
          </fieldset>
          <div class="fields">
            <div class="field"><label for="d-pct">Anticipo (%)</label><input id="d-pct" name="percent" type="number" min="1" max="100" value="${s.deposit.percent}"></div>
            <div class="field"><label for="d-full">Cobrar el total si faltan (días) o menos</label><input id="d-full" name="fullIfWithinDays" type="number" min="0" max="60" value="${s.deposit.fullIfWithinDays ?? ''}"></div>
            <div class="field"><label for="c-days">Cancelación gratis hasta (días antes)</label><input id="c-days" name="freeUntilDays" type="number" min="0" max="90" value="${s.cancellation.freeUntilDays}"><p class="hint">Después se retiene el anticipo.</p></div>
            <div class="field"><label for="m-days">Cambios en línea hasta (días antes)</label><input id="m-days" name="modDays" type="number" min="0" max="90" value="${s.modification?.freeUntilDays ?? 0}"></div>
            <div class="field"><label for="h-min">Minutos para pagar antes de liberar</label><input id="h-min" name="holdMinutes" type="number" min="5" max="60" value="${s.holdMinutes}"></div>
          </div>
          <div class="row-end"><button class="btn btn-primary">Guardar condiciones</button></div>
        </form>
      </section>
      <section class="panel">
        <div class="panel-head"><h2 class="h4">Proveedor de pago</h2></div>
        <dl class="kv">
          <div class="kv-wide"><dt>Proveedor</dt><dd>${pay.providerName} · ${{ integracion: 'ambiente de pruebas', produccion: 'producción', simulado: 'simulado' }[pay.environment] || pay.environment}</dd></div>
          <div><dt>Débito y prepago</dt><dd>${pctFmt(pay.rates.debit)} + IVA</dd></div>
          <div><dt>Crédito</dt><dd>${pctFmt(pay.rates.credit)} + IVA</dd></div>
          <div><dt>Comisión mínima</dt><dd>${pay.minFeeUF.debit} UF débito · ${pay.minFeeUF.credit} UF crédito</dd></div>
          <div><dt>Mensualidad</dt><dd>${pay.monthlyFee ? clp(pay.monthlyFee) : 'Sin mensualidad'}</dd></div>
          <div><dt>Abono</dt><dd>Débito ${pay.payoutDays.debit}; crédito ${pay.payoutDays.credit}</dd></div>
          <div><dt>Fuente</dt><dd><a href="${pay.source}" target="_blank" rel="noopener">Transbank</a>, revisado el ${human(pay.verifiedAt, { year: true })}</dd></div>
        </dl>
        <form id="prov" class="stack">
          <div class="fields">
            <div class="field"><label for="p-deb">Comisión débito (%)</label><input id="p-deb" name="debit" inputmode="decimal" value="${(pay.rates.debit * 100).toFixed(2).replace('.', ',')}"></div>
            <div class="field"><label for="p-cre">Comisión crédito (%)</label><input id="p-cre" name="credit" inputmode="decimal" value="${(pay.rates.credit * 100).toFixed(2).replace('.', ',')}"></div>
            <div class="field"><label for="p-uf">Valor UF (CLP)</label><input id="p-uf" name="ufValue" inputmode="numeric" value="${pay.ufValue}"><p class="hint">Solo afecta la comisión mínima de pagos muy pequeños.</p></div>
          </div>
          <p class="hint">Cambia las comisiones solo si Transbank te confirma otra tarifa. Afectan las estimaciones; lo real se calcula con el tipo de tarjeta de cada pago.</p>
          <div class="row-end"><button class="btn btn-soft">Guardar</button></div>
        </form>
      </section>
    </div>
    <section class="panel costs">
      <h2 class="h4">Costos de operación</h2>
      <table class="tbl"><tbody>
        <tr><td>Webpay Plus (Transbank)</td><td>Sin mensualidad. Solo comisión por venta: ${pctFmt(pay.rates.debit)} débito, ${pctFmt(pay.rates.credit)} crédito, más IVA.</td></tr>
        <tr><td>Hosting</td><td>NinjaHosting plan Wako, $59.900 + IVA al año.</td></tr>
        <tr><td>Dominio .cl</td><td>$9.990 al año en NIC Chile.</td></tr>
        <tr><td>Correo de confirmaciones</td><td>Resend, plan gratuito hasta 3.000 correos al mes.</td></tr>
      </tbody></table>
    </section>`;

  const drawSum = async (key) => {
    const p = periods[key];
    const x = await A('summary', { from: p.from, to: p.to });
    $('#sum', main).innerHTML = html`<div class="money">
      <div class="money-flow">
        <div class="mf-row"><span>Cobrado a huéspedes</span><strong>${clp(x.gross)}</strong></div>
        <div class="mf-row mf-sub"><span>En línea con Webpay</span><span>${clp(x.online)}</span></div>
        ${x.byMethod.filter((m) => m.method !== 'webpay').map((m) => html`<div class="mf-row mf-sub"><span>En el hostal · ${{ efectivo: 'efectivo', transferencia: 'transferencia', pos: 'tarjeta POS', otro: 'otro' }[m.method]}</span><span>${clp(m.amount)}</span></div>`)}
        <div class="mf-row mf-neg"><span>Comisión Webpay</span><span>−${clp(x.fees)}</span></div>
        <div class="mf-row mf-neg"><span>IVA de la comisión</span><span>−${clp(x.feesVat)}</span></div>
        <div class="mf-row mf-neg"><span>Devoluciones a huéspedes</span><span>−${clp(x.refunded)}</span></div>
        <div class="mf-row mf-total"><span>Recibe el hostal · ${p.label}</span><strong>${clp(x.net)}</strong></div>
      </div>
      <div class="money-side">
        <div class="kpi"><span>Costo efectivo de cobrar en línea</span><strong>${x.online ? `${x.effectiveFeePct.toLocaleString('es-CL', { maximumFractionDigits: 2 })} %` : '—'}</strong><em>Comisión + IVA sobre lo cobrado con Webpay</em></div>
        <div class="kpi"><span>Saldos por cobrar al llegar</span><strong>${clp(x.pendingBalances)}</strong><em>De reservas confirmadas</em></div>
        <div class="kpi"><span>Reservas creadas · canceladas</span><strong>${x.bookingsCreated} · ${x.bookingsCancelled}</strong><em>Ocupación ${Math.round(x.occupancyPct)} %</em></div>
      </div>
    </div>`;
  };
  await drawSum('mes');
  $('#per', main).addEventListener('change', (e) => drawSum(e.target.value));
  $('#pol', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await A('saveSettings', { patch: { deposit: { mode: f.mode, percent: +f.percent, fullIfWithinDays: f.fullIfWithinDays === '' ? null : +f.fullIfWithinDays }, cancellation: { freeUntilDays: +f.freeUntilDays }, modification: { freeUntilDays: +f.modDays }, holdMinutes: +f.holdMinutes } });
      ctx.info = await ctx.api.pub('info'); toast('Condiciones guardadas');
    } catch (x) { toast(x.message, 'bad'); }
  });
  $('#prov', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const dec = (v) => +String(v).replace(',', '.');
    try {
      await A('saveSettings', { patch: { payment: { rates: { debit: dec(f.debit) / 100, prepaid: dec(f.debit) / 100, credit: dec(f.credit) / 100 }, ufValue: +String(f.ufValue).replace(/\D/g, '') } } });
      ctx.info = await ctx.api.pub('info'); toast('Guardado'); drawSum($('#per', main).value);
    } catch (x) { toast(x.message, 'bad'); }
  });
}

// ---------- Ajustes ----------
async function viewSettings(main) {
  const demo = ctx.api.mode === 'demo';
  const [s, outbox, me, bk, tr] = await Promise.all([A('settings'), A('list', { kind: 'outbox' }), A('me'), demo ? null : A('backups'), demo ? null : A('tareas')]);
  const b = s.business;
  const kb = (n) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1).replace('.', ',')} MB`);
  main.innerHTML = html`${head('Ajustes')}
    <section class="panel">
      <div class="panel-head"><h2 class="h4">Datos del hostal</h2></div>
      <form id="biz" class="stack"><div class="fields">
        <div class="field"><label for="b-name">Nombre</label><input id="b-name" name="name" value="${b.name}"></div>
        <div class="field"><label for="b-legal">Razón social</label><input id="b-legal" name="legalName" value="${b.legalName}"></div>
        <div class="field"><label for="b-rut">RUT</label><input id="b-rut" name="rut" value="${b.rut}"></div>
        <div class="field"><label for="b-phone">Teléfono</label><input id="b-phone" name="phone" value="${b.phone}"></div>
        <div class="field"><label for="b-mail">Correo de contacto</label><input id="b-mail" name="email" type="email" value="${b.email}"></div>
        <div class="field"><label for="b-wa">WhatsApp (solo números)</label><input id="b-wa" name="whatsapp" value="${b.whatsapp}"></div>
        <div class="field field-wide"><label for="b-addr">Dirección</label><input id="b-addr" name="address" value="${b.address}"></div>
        <div class="field"><label for="b-in">Llegada desde</label><input id="b-in" name="checkinFrom" type="time" value="${b.checkinFrom}"></div>
        <div class="field"><label for="b-out">Salida hasta</label><input id="b-out" name="checkoutUntil" type="time" value="${b.checkoutUntil}"></div>
        <div class="field field-wide"><label for="b-maps">Enlace a la ficha del hostal en Google</label><input id="b-maps" name="mapsUrl" type="url" value="${b.mapsUrl || ''}" placeholder="https://maps.app.goo.gl/..."><p class="hint">En Google Maps, abre la ficha del hostal, toca "Compartir" y pega aquí el enlace. Lo usan "Leer opiniones" y la nota en Google.</p></div>
        <div class="field"><label for="b-rate">Nota en Google</label><input id="b-rate" name="googleRating" inputmode="decimal" value="${String(b.googleRating ?? '').replace('.', ',')}"></div>
        <div class="field"><label for="b-revs">Cantidad de opiniones</label><input id="b-revs" name="googleReviews" inputmode="numeric" value="${b.googleReviews ?? ''}"></div>
        <div class="field"><label for="b-ig">Instagram (opcional)</label><input id="b-ig" name="instagram" type="url" value="${b.instagram || ''}" placeholder="https://www.instagram.com/..."></div>
        <div class="field"><label for="b-fb">Facebook (opcional)</label><input id="b-fb" name="facebook" type="url" value="${b.facebook || ''}" placeholder="https://www.facebook.com/..."></div>
        <div class="field field-wide"><label for="b-rules">Reglas de la casa (una por línea)</label><textarea id="b-rules" name="rules" rows="5">${(s.houseRules || []).join('\n')}</textarea></div>
      </div><div class="row-end"><button class="btn btn-primary">Guardar</button></div></form>
    </section>

    <section class="panel" id="house">
      <div class="panel-head"><h2 class="h4">Fotos de la casa</h2></div>
      <p class="muted small">Fachada, living, comedor, desayuno, jardín. La primera es la foto grande de la portada (mejor si es horizontal); las siguientes, hasta 6, se muestran en la sección "La casa". Si en la descripción de una foto escribes "baño" (por ejemplo "Baño compartido"), también aparece en las habitaciones con baño compartido.</p>
      <div class="photos" data-photos></div>
      <div class="row-end"><label class="btn btn-soft btn-sm upload">${icon('image')} Subir fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple data-upload></label><button class="btn btn-primary btn-sm" id="house-save" type="button">Guardar fotos</button></div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2 class="h4">Correos a huéspedes</h2>${demo ? '' : html`<button class="btn btn-soft btn-sm" id="mail-test">Enviar correo de prueba</button>`}</div>
      <p class="muted small">Confirmación, cambio y cancelación se envían solos cuando alguien reserva, cambia o cancela. ${demo ? '' : me.mail?.connected ? `Servicio de correo conectado${me.mail.from ? `, se envía como ${me.mail.from}` : ''}.` : 'El servicio de correo no está conectado: falta RESEND_API_KEY en el servidor. Mientras tanto quedan en cola.'}</p>
      ${outbox.length ? html`<ul class="plain">${outbox.slice(-8).reverse().map((m) => html`<li>${m.subject} → ${m.to} · <span class="muted">${{ en_cola: 'en cola', enviado: 'enviado', error: 'no se pudo enviar', descartado: 'descartado' }[m.status] || m.status}</span>${m.status === 'error' && m.error ? html`<br><span class="muted small">${m.error}</span>` : ''}</li>`)}</ul>` : html`<p class="note">${icon('info')} Todavía no hay correos: se crean cuando alguien reserva.</p>`}
      ${!demo && outbox.some((m) => m.status === 'en_cola') ? html`<div class="row-end"><button class="btn btn-ghost btn-sm" id="mail-discard">Descartar pendientes</button><button class="btn btn-soft btn-sm" id="mail-now">Enviar pendientes ahora</button></div>` : ''}
      ${!demo && outbox.some((m) => m.status === 'error') ? html`<div class="row-end"><button class="btn btn-ghost btn-sm" id="mail-retry">Reintentar los que fallaron</button></div>` : ''}
      ${tr ? html`<h3 class="h5">Tareas programadas (Cron Jobs)</h3><ul class="plain">${['correos', 'vencer', 'respaldo'].map((k) => { const r = tr.runs[k]; return html`<li>${{ correos: 'Enviar correos', vencer: 'Liberar reservas no pagadas', respaldo: 'Respaldo diario' }[k]} · <span class="muted">${!tr.enabled ? 'falta TAREAS_SECRET en el servidor' : !r ? 'todavía no ha llegado ninguna llamada' : `última llamada ${new Date(r.at).toLocaleString('es-CL')}${r.result === 'ok' ? '' : r.result === 'clave' ? ': la frase del cron no coincide con TAREAS_SECRET' : ': falló'}`}</span></li>`; })}</ul>` : ''}
    </section>

    ${demo ? html`<section class="panel"><div class="panel-head"><h2 class="h4">Demostración</h2></div><p class="muted small">Vuelve a los datos iniciales: borra tus pruebas y recrea las reservas de ejemplo.</p><button class="btn btn-ghost" id="reset">Reiniciar demostración</button></section>` : html`
    <section class="panel"><div class="panel-head"><h2 class="h4">Respaldos</h2><button class="btn btn-soft btn-sm" id="bk-now">${icon('copy')} Respaldar ahora</button></div>
      <p class="muted small">Copia de la base de datos (reservas, huéspedes, pagos, tarifas). Se hace una al día automáticamente y se guardan las últimas 14. Descarga una de vez en cuando y guárdala en tu computador. Las fotos no van aquí: están en la carpeta de datos del hosting.</p>
      ${bk.backups.length ? html`<ul class="plain-list">${bk.backups.map((x) => html`<li><span><strong>${x.name}</strong><br><span class="muted small">${new Date(x.at).toLocaleString('es-CL')} · ${kb(x.size)}</span></span><a class="btn btn-ghost btn-sm" href="/panel/respaldos/${x.name}" download>Descargar</a></li>`)}</ul>` : html`<p class="note">${icon('info')} Todavía no hay respaldos.</p>`}
    </section>
    <section class="panel"><div class="panel-head"><h2 class="h4">Seguridad</h2></div>
      <form id="em" class="stack"><div class="fields"><div class="field"><label for="em1">Correo para entrar al panel</label><input id="em1" name="email" type="email" autocomplete="username" value="${me.admin?.email || ''}"></div><div class="field"><label for="em2">Tu contraseña actual</label><input id="em2" name="password" type="password" autocomplete="current-password"></div></div><div class="row-end"><button class="btn btn-soft">Cambiar correo</button></div></form>
      <form id="pw" class="stack"><div class="fields"><div class="field"><label for="pw1">Nueva contraseña</label><input id="pw1" name="password" type="password" minlength="10" autocomplete="new-password"><p class="hint">Mínimo 10 caracteres.</p></div></div><div class="row-end"><button class="btn btn-soft">Cambiar contraseña</button></div></form>
    </section>`}`;

  $('#biz', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const rules = String(f.rules).split('\n').map((x) => x.trim()).filter(Boolean);
    delete f.rules;
    try { await A('saveSettings', { patch: { business: f, houseRules: rules } }); ctx.info = await ctx.api.pub('info'); toast('Datos guardados'); } catch (x) { toast(x.message, 'bad'); }
  });
  const housePhotos = [...(s.housePhotos || [])];
  photoEditor($('#house', main), housePhotos, { empty: 'Todavía no hay fotos: la portada muestra el logo.' });
  $('#house-save', main).addEventListener('click', async () => {
    try { await A('saveSettings', { patch: { housePhotos } }); ctx.info = await ctx.api.pub('info'); toast('Fotos de la casa guardadas'); } catch (x) { toast(x.message, 'bad'); }
  });
  main.addEventListener('click', (e) => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.dataset.copy, c); });
  $('#reset', main)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: 'Reiniciar demostración', body: '<p>Se borran las reservas y cambios que hiciste en esta demo.</p>', confirm: 'Reiniciar', danger: true }))) return;
    await A('resetDemo'); ctx.info = await ctx.api.pub('info'); toast('Demostración reiniciada'); ctx.go('panel');
  });
  $('#mail-test', main)?.addEventListener('click', async () => { try { const r = await A('mailTest'); toast(`Correo de prueba enviado a ${r.to}`); } catch (x) { toast(x.message, 'bad'); } });
  $('#mail-now', main)?.addEventListener('click', async () => { try { const r = await A('mailSendNow'); toast(r.pending ? `Quedan ${r.pending} en cola` : 'Correos enviados'); viewSettings(main); } catch (x) { toast(x.message, 'bad'); } });
  $('#mail-discard', main)?.addEventListener('click', async () => {
    if (!(await confirmSheet({ title: 'Descartar correos pendientes', body: '<p>No se enviarán. Úsalo para no mandar confirmaciones de reservas de prueba.</p>', confirm: 'Descartar', danger: true }))) return;
    try { const r = await A('mailDiscard'); toast(`${r.discarded} correo(s) descartados`); viewSettings(main); } catch (x) { toast(x.message, 'bad'); }
  });
  $('#mail-retry', main)?.addEventListener('click', async () => { try { const r = await A('mailRetry'); toast(`${r.retried} correo(s) enviados de nuevo`); viewSettings(main); } catch (x) { toast(x.message, 'bad'); } });
  $('#bk-now', main)?.addEventListener('click', async () => { try { await A('backupNow'); toast('Respaldo creado'); viewSettings(main); } catch (x) { toast(x.message, 'bad'); } });
  $('#em', main)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { await A('changeEmail', f); toast('Correo cambiado. Úsalo la próxima vez que entres.'); e.target.password.value = ''; } catch (x) { toast(x.message, 'bad'); }
  });
  $('#pw', main)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = new FormData(e.target).get('password');
    if (String(p).length < 10) { toast('La contraseña debe tener al menos 10 caracteres', 'bad'); return; }
    try { await A('changePassword', { password: p }); toast('Contraseña cambiada'); e.target.reset(); } catch (x) { toast(x.message, 'bad'); }
  });
}

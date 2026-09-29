// "Boleta clara": el detalle del precio que ve el huésped y el panel.
// Muestra cada noche, cargos, descuento, total, qué se paga hoy y al llegar,
// y, solo en el panel (fees: true), cuánto se queda Webpay y cuánto recibe el hostal.

import { html, clp, human, plural, pctFmt, icon } from './ui.js';
import { UNIT_LABEL } from '../core/pricing.js';

export function ledger(q, { info, booking = null, compact = false, fees = false } = {}) {
  if (!q) return '';
  const lines = q.items.map((it) => {
    const many = it.nights.length > 4;
    const seasons = [...new Set(it.nights.filter((n) => n.season).map((n) => `${n.season.name} (${n.season.adjustPct > 0 ? '+' : ''}${n.season.adjustPct} %)`))];
    const same = it.nights.every((n) => n.rate === it.nights[0].rate);
    return html`<div class="lg-group">
      <div class="lg-title">${it.roomName}<span>${plural(it.adults, 'adulto', 'adultos')}${it.children ? ` · ${plural(it.children, 'niño', 'niños')}` : ''}</span></div>
      ${many || compact ? html`
        <div class="lg-line"><span>${same ? `${plural(it.nights.length, 'noche', 'noches')} × ${clp(it.nights[0].rate)}` : `${plural(it.nights.length, 'noche', 'noches')} (tarifa variable)`}</span><span>${clp(it.roomNights)}</span></div>
        ${!same ? html`<details class="lg-nights"><summary>Ver precio de cada noche</summary>${it.nights.map((n) => html`<div class="lg-line lg-night"><span>${human(n.date, { weekday: true })}${n.season ? html` <em class="tag">${n.season.name}</em>` : ''}</span><span>${clp(n.rate)}</span></div>`)}</details>` : ''}
      ` : it.nights.map((n) => html`<div class="lg-line lg-night"><span>Noche del ${human(n.date, { weekday: true })}${n.season ? html` <em class="tag">${n.season.name}</em>` : ''}</span><span>${clp(n.rate)}</span></div>`)}
      ${it.extraGuests.count ? html`<div class="lg-line"><span>Persona adicional · ${clp(it.extraGuests.unit)} × ${plural(it.nights.length, 'noche', 'noches')}${it.extraGuests.count > 1 ? ` × ${it.extraGuests.count}` : ''}</span><span>${clp(it.extraGuests.total)}</span></div>` : ''}
      ${seasons.length && (many || compact) ? html`<p class="lg-note">Incluye ${seasons.join(', ')}.</p>` : ''}
    </div>`;
  });
  const p = q.payment;
  const prov = q.provider;
  const pay = info?.payment;
  const paidOnline = booking ? (booking.payments || []).filter((x) => x.kind === 'cargo' && x.method === 'webpay') : [];
  return html`<div class="ledger" aria-label="Detalle del precio">
    <div class="ledger-head"><span>Detalle del precio</span><span class="mono">${q.currency} · ${plural(q.nights, 'noche', 'noches')}</span></div>
    ${lines}
    ${q.discount ? html`<div class="lg-line lg-disc"><span>${q.discount.name} (−${q.discount.pct} %)</span><span>−${clp(q.discount.amount)}</span></div>` : ''}
    ${q.extras.map((e) => html`<div class="lg-line"><span>${e.name} · ${clp(e.unitAmount)} ${UNIT_LABEL[e.unit]}${e.unit === 'persona_noche' ? ` × ${plural(q.guests, 'persona', 'personas')} × ${plural(q.nights, 'noche', 'noches')}` : e.qty > 1 ? ` × ${e.qty}` : ''}${e.mandatory ? ' (obligatorio)' : ''}</span><span>${clp(e.amount)}</span></div>`)}
    <div class="lg-total"><span>Total de la estadía</span><strong>${clp(q.total)}</strong></div>
    <p class="lg-vat">${q.vat.included ? `IVA incluido (${clp(q.vat.amount)}). Sin cargos por servicio ni por reservar.` : 'Precios sin IVA.'}</p>
    ${booking ? bookingSplit(booking) : html`
      <div class="lg-split">
        <div><span>Pagas hoy${p.mode === 'percent' ? ` · anticipo ${p.percent} %` : ''}</span><strong>${clp(p.dueNow)}</strong></div>
        <div><span>Pagas al llegar</span><strong>${clp(p.dueAtProperty)}</strong></div>
      </div>
      <p class="lg-note">${p.reason}</p>`}
    ${fees && prov && (booking ? paidOnline.length : p.dueNow > 0) ? moneyFlow({ prov, pay, booking, paidOnline }) : ''}
    ${q.policy && !booking ? html`<p class="lg-policy">${icon('check')} Cancelación gratis hasta el ${human(q.policy.freeCancelUntil, { weekday: true, year: true })}.</p>` : ''}
  </div>`;
}

function bookingSplit(b) {
  return html`<div class="lg-split">
    <div><span>Pagado</span><strong>${clp(b.amountPaid)}</strong></div>
    <div><span>${b.status === 'cancelada' ? 'Devuelto' : 'Saldo al llegar'}</span><strong>${clp(b.status === 'cancelada' ? b.amountRefunded : b.balanceDue)}</strong></div>
  </div>`;
}

function moneyFlow({ prov, pay, booking, paidOnline }) {
  let body;
  if (booking) {
    const p = paidOnline[0];
    const rate = pay?.rates?.[p.cardType] ?? 0;
    body = html`<p>Pagaste ${clp(p.amount)} con tarjeta de ${p.cardType === 'credit' ? 'crédito' : 'débito'}. Webpay cobra al hostal ${pctFmt(rate)} + IVA por esa venta; tú no pagas esa comisión.</p>`;
  } else {
    const deb = prov.debit; const cre = prov.credit;
    const share = Math.max(2, (cre.total / (cre.net + cre.total)) * 100);
    body = html`
      <div class="flow-bar" role="img" aria-label="De tu pago de hoy, el hostal recibe entre ${clp(cre.net)} y ${clp(deb.net)}; el resto es la comisión de Webpay"><span class="flow-net" style="width:${100 - share}%"></span><span class="flow-fee" style="width:${share}%"></span></div>
      <div class="flow-rows">
        <div><span class="dot dot-net"></span>Recibe el hostal</div><div class="num">${clp(cre.net)} – ${clp(deb.net)}</div>
        <div><span class="dot dot-fee"></span>Comisión Webpay con débito (${pctFmt(pay?.rates?.debit ?? 0)} + IVA)</div><div class="num">${clp(deb.total)}</div>
        <div><span class="dot dot-fee"></span>Comisión Webpay con crédito (${pctFmt(pay?.rates?.credit ?? 0)} + IVA)</div><div class="num">${clp(cre.total)}</div>
      </div>
      <p>La comisión la paga el hostal: tu total no cambia según la tarjeta.${pay?.verifiedAt ? ` Tarifas publicadas por Transbank, revisadas el ${human(pay.verifiedAt, { year: true })}.` : ''}</p>`;
  }
  return html`<details class="lg-flow"><summary>${icon('info')} ¿Cuánto recibe el hostal de tu pago?</summary><div class="lg-flow-body">${body}</div></details>`;
}

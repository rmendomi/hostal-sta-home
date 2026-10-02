// Motor de precios. Es la única fuente de verdad para montos: lo usan el
// servidor, el panel y la demo del navegador, así que el huésped ve
// exactamente lo que después se cobra.

import { nightsBetween, addDays, diffDays } from './dates.js';
import { pct, vatIncluded } from './money.js';

export class QuoteError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

function roundTo(n, step) {
  return step > 1 ? Math.round(n / step) * step : Math.round(n);
}

export function seasonFor(date, roomId, seasons) {
  let best = null;
  for (const s of seasons || []) {
    if (s.active === false) continue;
    if (date < s.start || date > s.end) continue;
    if (s.roomIds && s.roomIds.length && !s.roomIds.includes(roomId)) continue;
    if (!best || (s.priority || 0) > (best.priority || 0)) best = s;
  }
  return best;
}

export function nightlyRate(room, date, seasons, settings) {
  const season = seasonFor(date, room.id, seasons);
  const adj = season ? Number(season.adjustPct) || 0 : 0;
  // Aritmética entera para evitar errores de punto flotante (45000 × 1,15 = 51749,99…).
  const rate = roundTo((room.baseRate * (100 + adj)) / 100, settings.rateRounding ?? 100);
  return { date, rate, season: season ? { id: season.id, name: season.name, adjustPct: adj } : null };
}

// Mínimo de noches: el mayor entre el de la habitación y el de cualquier temporada que toque la estadía.
export function minNightsFor(room, checkin, checkout, seasons) {
  let min = room.minNights || 1;
  for (const d of nightsBetween(checkin, checkout)) {
    const s = seasonFor(d, room.id, seasons);
    if (s && s.minNights) min = Math.max(min, s.minNights);
  }
  return min;
}

export function quoteItem({ room, checkin, checkout, adults, children = 0, seasons, settings }) {
  const nights = nightsBetween(checkin, checkout);
  if (!nights.length) throw new QuoteError('fechas', 'La salida debe ser después de la llegada.');
  if (adults < 1) throw new QuoteError('huespedes', 'Debe haber al menos un adulto por habitación.');
  if (adults + children > room.maxGuests) {
    throw new QuoteError('capacidad', `${room.name} admite hasta ${room.maxGuests} personas.`);
  }
  const min = minNightsFor(room, checkin, checkout, seasons);
  if (nights.length < min) {
    throw new QuoteError('minimo', `${room.name} requiere un mínimo de ${min} noches en estas fechas.`);
  }
  const lines = nights.map((d) => nightlyRate(room, d, seasons, settings));
  const roomNights = lines.reduce((a, l) => a + l.rate, 0);
  const extraCount = Math.max(0, adults - (room.baseOccupancy || room.maxGuests));
  const extraPerNight = extraCount * (room.extraGuestFee || 0);
  const extraTotal = extraPerNight * nights.length;
  return {
    roomId: room.id,
    roomName: room.name,
    adults,
    children,
    nights: lines,
    roomNights,
    extraGuests: { count: extraCount, perNight: extraPerNight, total: extraTotal, unit: room.extraGuestFee || 0 },
    subtotal: roomNights + extraTotal,
  };
}

// Descuentos: se aplica solo el mejor de los que correspondan (no se suman).
export function bestDiscount({ nights, checkin, today, discounts }) {
  const lead = diffDays(today, checkin);
  let best = null;
  for (const d of discounts || []) {
    if (d.active === false) continue;
    if (d.type === 'estadia' && nights < d.minNights) continue;
    if (d.type === 'anticipacion' && lead < d.minDaysAhead) continue;
    if (!best || d.pct > best.pct) best = d;
  }
  return best;
}

export function extraAmount(charge, { nights, guests }) {
  switch (charge.unit) {
    case 'reserva': return { qty: 1, amount: charge.amount };
    case 'noche': return { qty: nights, amount: charge.amount * nights };
    case 'persona': return { qty: guests, amount: charge.amount * guests };
    case 'persona_noche': return { qty: guests * nights, amount: charge.amount * guests * nights };
    // Sin días elegidos (panel o cargo obligatorio): todos los días de la estadía, para todos.
    case 'persona_dia': return { qty: guests * (nights + 1), amount: charge.amount * guests * (nights + 1) };
    default: throw new Error(`Unidad de cargo desconocida: ${charge.unit}`);
  }
}

export const UNIT_LABEL = {
  reserva: 'por reserva',
  noche: 'por noche',
  persona: 'por persona',
  persona_noche: 'por persona y noche',
  persona_dia: 'por persona y día',
};

// Días en que se puede pedir un cargo por día: desde la llegada hasta la salida, ambos incluidos.
export function stayDays(checkin, checkout) {
  const days = [];
  for (let d = checkin; d <= checkout; d = addDays(d, 1)) days.push(d);
  return days;
}

// Comisión del proveedor de pago sobre un monto cobrado en línea.
// Devuelve la comisión, su IVA, el total descontado y lo que recibe el negocio.
export function providerFee(amount, cardType, pay) {
  if (!amount || !pay) return { rate: 0, fee: 0, vat: 0, total: 0, net: amount || 0 };
  const rate = pay.rates?.[cardType] ?? 0;
  const minUF = pay.minFeeUF?.[cardType] ?? 0;
  const minClp = Math.round(minUF * (pay.ufValue || 0));
  const fee = Math.max(Math.round(amount * rate), minClp);
  const vat = Math.round(fee * (pay.feeVatRate ?? 0.19));
  return { rate, fee, vat, total: fee + vat, net: amount - fee - vat, minApplied: fee === minClp && minClp > 0 };
}

export function cancellationDeadline(checkin, settings) {
  const days = settings.cancellation?.freeUntilDays ?? 0;
  return addDays(checkin, -days);
}

export function modificationDeadline(checkin, settings) {
  const days = settings.modification?.freeUntilDays ?? settings.cancellation?.freeUntilDays ?? 0;
  return addDays(checkin, -days);
}

// Cuánto se paga ahora y cuánto al llegar.
export function paymentPlan(total, checkin, today, settings) {
  const dep = settings.deposit || { mode: 'percent', percent: 30 };
  if (dep.mode === 'none') {
    return { mode: 'none', percent: 0, dueNow: 0, dueAtProperty: total, reason: 'Se paga completo en el hostal.' };
  }
  const lead = diffDays(today, checkin);
  if (dep.mode === 'full' || (dep.fullIfWithinDays != null && lead <= dep.fullIfWithinDays)) {
    const reason = dep.mode === 'full'
      ? 'Se paga el total al reservar.'
      : `Como faltan ${lead} días o menos para la llegada, se paga el total al reservar.`;
    return { mode: 'full', percent: 100, dueNow: total, dueAtProperty: 0, reason };
  }
  const dueNow = Math.min(total, Math.ceil((total * dep.percent) / 100));
  return {
    mode: 'percent',
    percent: dep.percent,
    dueNow,
    dueAtProperty: total - dueNow,
    reason: `Anticipo del ${dep.percent} % para asegurar la reserva; el saldo se paga al llegar.`,
  };
}

// Reembolso según la política, calculado para una fecha dada.
export function refundFor({ booking, today, settings }) {
  const deadline = cancellationDeadline(booking.checkin, settings);
  const paid = booking.amountPaid || 0;
  if (today <= deadline) {
    return { free: true, deadline, refund: paid, retained: 0 };
  }
  const retainedMax = booking.depositAmount || 0;
  const retained = Math.min(paid, retainedMax);
  return { free: false, deadline, refund: paid - retained, retained };
}

// Cotización completa de una reserva (una o varias habitaciones).
export function quote({ rooms, items, checkin, checkout, extras = [], seasons, discounts, charges, settings, today }) {
  if (!checkin || !checkout || checkout <= checkin) throw new QuoteError('fechas', 'Elige una fecha de salida posterior a la llegada.');
  if (checkin < today) throw new QuoteError('fechas', 'La llegada no puede ser en el pasado.');
  const maxAhead = settings.maxDaysAhead ?? 540;
  if (diffDays(today, checkin) > maxAhead) throw new QuoteError('fechas', 'Aún no abrimos reservas para esas fechas.');
  if (!items?.length) throw new QuoteError('habitaciones', 'Elige al menos una habitación.');
  const seen = new Set();
  const lineItems = items.map((it) => {
    if (seen.has(it.roomId)) throw new QuoteError('habitaciones', 'Una habitación aparece dos veces.');
    seen.add(it.roomId);
    const room = rooms.find((r) => r.id === it.roomId && r.active !== false);
    if (!room) throw new QuoteError('habitaciones', 'Esa habitación no está disponible para reservar.');
    return quoteItem({ room, checkin, checkout, adults: +it.adults || 0, children: +it.children || 0, seasons, settings });
  });

  const nights = diffDays(checkin, checkout);
  const guests = lineItems.reduce((a, i) => a + i.adults + i.children, 0);
  const lodging = lineItems.reduce((a, i) => a + i.subtotal, 0);

  const disc = bestDiscount({ nights, checkin, today, discounts });
  const discount = disc ? { id: disc.id, name: disc.name, pct: disc.pct, amount: pct(lodging, disc.pct) } : null;

  // Cada extra elegido es su id, o { id, days, people } para los que se cobran por día elegido.
  const chosen = new Map((extras || []).map((e) => (typeof e === 'string' ? [e, null] : [e?.id, e])));
  const validDays = new Set(stayDays(checkin, checkout));
  const extraLines = [];
  for (const c of charges || []) {
    if (c.active === false) continue;
    if (!c.mandatory && !chosen.has(c.id)) continue;
    const pick = chosen.get(c.id);
    if (c.unit === 'persona_dia' && pick?.days) {
      // Los días fuera de la estadía se descartan (por ejemplo, tras un cambio de fechas).
      const days = [...new Set(pick.days)].filter((d) => validDays.has(d)).sort();
      if (!days.length) continue;
      const people = Math.min(guests, Math.max(1, Math.floor(+pick.people) || guests));
      const qty = days.length * people;
      extraLines.push({ id: c.id, name: c.name, unit: c.unit, unitAmount: c.amount, qty, amount: c.amount * qty, mandatory: !!c.mandatory, days, people });
      continue;
    }
    const { qty, amount } = extraAmount(c, { nights, guests });
    extraLines.push({ id: c.id, name: c.name, unit: c.unit, unitAmount: c.amount, qty, amount, mandatory: !!c.mandatory });
  }
  const extrasTotal = extraLines.reduce((a, e) => a + e.amount, 0);
  const total = lodging - (discount?.amount || 0) + extrasTotal;

  const plan = paymentPlan(total, checkin, today, settings);
  const pay = settings.payment;
  const vatRate = settings.vatRate ?? 0.19;

  return {
    currency: settings.currency || 'CLP',
    checkin,
    checkout,
    nights,
    guests,
    items: lineItems,
    lodging,
    discount,
    extras: extraLines,
    extrasTotal,
    total,
    vat: settings.pricesIncludeVat === false
      ? { included: false, rate: vatRate, amount: 0 }
      : { included: true, rate: vatRate, amount: vatIncluded(total, vatRate) },
    payment: plan,
    provider: pay ? {
      name: pay.providerName,
      debit: providerFee(plan.dueNow, 'debit', pay),
      credit: providerFee(plan.dueNow, 'credit', pay),
    } : null,
    policy: {
      freeCancelUntil: cancellationDeadline(checkin, settings),
      freeChangeUntil: modificationDeadline(checkin, settings),
      freeUntilDays: settings.cancellation?.freeUntilDays ?? 0,
    },
  };
}

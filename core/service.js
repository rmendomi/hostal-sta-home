// Lógica de reservas. Funciona sobre cualquier "store" (SQLite en el servidor,
// almacenamiento local en la demo) con la misma interfaz, así ambas versiones
// se comportan igual. Toda operación que toma noches lo hace dentro de store.tx
// y la tabla de noches bloqueadas tiene clave única (habitación, noche): dos
// reservas simultáneas nunca pueden quedarse con la misma noche.

import { nightsBetween, addDays, diffDays, today as todayIn, isDate } from './dates.js';
import { quote as buildQuote, QuoteError, refundFor, providerFee, cancellationDeadline, modificationDeadline } from './pricing.js';

export class ServiceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}

export class ConflictError extends ServiceError {
  constructor(message = 'Otra persona acaba de reservar alguna de esas noches. Elige otras fechas u otra habitación.') {
    super('ocupado', message, 409);
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function cardTypeFromWebpay(code) {
  if (code === 'VD') return 'debit';
  if (code === 'VP') return 'prepaid';
  return 'credit';
}

export const CARD_LABEL = { debit: 'Débito', credit: 'Crédito', prepaid: 'Prepago' };

export function createService({ store, now = () => new Date(), random = Math.random, payments = null }) {
  const settings = () => store.getSettings();
  const today = () => todayIn(settings().business?.timezone || 'America/Santiago', now());
  const iso = () => now().toISOString();

  function newCode() {
    for (;;) {
      let s = '';
      for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
      const code = `SE-${s}`;
      if (!store.findBookingByCode(code)) return code;
    }
  }

  function catalog() {
    return {
      rooms: store.list('rooms').filter((r) => r.active !== false).sort((a, b) => (a.sort || 0) - (b.sort || 0)),
      seasons: store.list('seasons'),
      discounts: store.list('discounts'),
      charges: store.list('charges'),
    };
  }

  // Libera noches de reservas que no se pagaron a tiempo.
  function sweepExpired() {
    const t = iso();
    let n = 0;
    store.tx(() => {
      for (const b of store.list('bookings', { status: 'pendiente_pago' })) {
        if (b.expiresAt && b.expiresAt < t) {
          store.removeLocks({ bookingId: b.id });
          store.update('bookings', b.id, { status: 'expirada', history: [...(b.history || []), { at: t, what: 'Reserva expirada: no se completó el pago a tiempo.' }] });
          n++;
        }
      }
    });
    return n;
  }

  function checkDates(checkin, checkout) {
    if (!isDate(checkin) || !isDate(checkout)) throw new ServiceError('fechas', 'Elige las fechas de llegada y salida.');
    if (checkout <= checkin) throw new ServiceError('fechas', 'La salida debe ser posterior a la llegada.');
    if (checkin < today()) throw new ServiceError('fechas', 'La llegada no puede ser en el pasado.');
    if (diffDays(checkin, checkout) > 60) throw new ServiceError('fechas', 'Para estadías de más de 60 noches, escríbenos directamente.');
  }

  function busyNights(roomIds, checkin, checkout, { exceptBookingId } = {}) {
    const locks = store.locksFor(roomIds, checkin, addDays(checkout, -1));
    return locks.filter((l) => !exceptBookingId || l.bookingId !== exceptBookingId);
  }

  // ---------- Público ----------

  function publicInfo() {
    const s = settings();
    const { rooms, charges, discounts } = catalog();
    return {
      business: s.business,
      // Descuentos por estadía larga: el sitio los usa para invitar a quedarse más noches.
      stayDiscounts: discounts.filter((d) => d.active !== false && d.type === 'estadia').map(({ name, pct, minNights }) => ({ name, pct, minNights })),
      currency: s.currency,
      pricesIncludeVat: s.pricesIncludeVat,
      deposit: s.deposit,
      cancellation: s.cancellation,
      modification: s.modification,
      payment: { providerName: s.payment?.providerName, rates: s.payment?.rates, feeVatRate: s.payment?.feeVatRate, source: s.payment?.source, verifiedAt: s.payment?.verifiedAt, mode: s.payment?.mode },
      holdMinutes: s.holdMinutes,
      demo: !!s.demo,
      today: today(),
      rooms: rooms.map(publicRoom),
      extras: charges.filter((c) => c.active !== false).map(({ id, name, description, unit, amount, mandatory, status }) => ({ id, name, description, unit, amount, mandatory, status })),
      houseRules: s.houseRules || [],
      housePhotos: s.housePhotos || [],
    };
  }

  function publicRoom(r) {
    const { id, slug, name, description, sizeM2, beds, bathroom, baseOccupancy, maxGuests, amenities, photos, baseRate, extraGuestFee, minNights, kitchen, view, dataStatus, rateStatus } = r;
    return { id, slug, name, description, sizeM2, beds, bathroom, baseOccupancy, maxGuests, amenities, photos, baseRate, extraGuestFee, minNights, kitchen, view, dataStatus, rateStatus };
  }

  function search({ checkin, checkout, adults = 2, children = 0 }) {
    checkDates(checkin, checkout);
    adults = Math.max(1, +adults || 1);
    children = Math.max(0, +children || 0);
    sweepExpired();
    const s = settings();
    const { rooms, seasons, discounts, charges } = catalog();
    const busy = busyNights(rooms.map((r) => r.id), checkin, checkout);
    const party = adults + children;
    const results = rooms.map((room) => {
      const taken = busy.filter((l) => l.roomId === room.id).map((l) => l.night);
      const fits = party <= room.maxGuests;
      // Si el grupo no cabe, se cotiza con la capacidad máxima de la habitación para mostrar un precio de referencia.
      const a = fits ? adults : Math.min(adults, room.maxGuests);
      const c = fits ? children : Math.max(0, Math.min(children, room.maxGuests - a));
      let q = null; let reason = null;
      try {
        q = buildQuote({ rooms, items: [{ roomId: room.id, adults: a, children: c }], checkin, checkout, seasons, discounts, charges: charges.filter((x) => x.mandatory), settings: s, today: today() });
      } catch (e) {
        if (!(e instanceof QuoteError)) throw e;
        reason = e.message;
      }
      const available = taken.length === 0 && !reason;
      return {
        room: publicRoom(room),
        available,
        fits,
        takenNights: taken.sort(),
        reason: taken.length ? 'Ocupada en parte de esas fechas.' : reason,
        quoteFor: { adults: a, children: c },
        price: q ? { total: q.total, lodging: q.lodging, perNightAvg: Math.round(q.lodging / q.nights), discount: q.discount, nights: q.nights } : null,
      };
    });
    const maxRoom = Math.max(...rooms.map((r) => r.maxGuests));
    return {
      checkin, checkout, adults, children,
      nights: diffDays(checkin, checkout),
      needsMultipleRooms: party > maxRoom,
      results,
    };
  }

  // Cuántas habitaciones quedan libres cada día (para pintar el calendario).
  function availabilityCalendar({ from, to, roomId }) {
    if (!isDate(from) || !isDate(to) || to < from) throw new ServiceError('fechas', 'Rango de fechas inválido.');
    if (diffDays(from, to) > 400) throw new ServiceError('fechas', 'Rango demasiado largo.');
    sweepExpired();
    const rooms = catalog().rooms.filter((r) => !roomId || r.id === roomId);
    const locks = store.locksFor(rooms.map((r) => r.id), from, to);
    const byNight = new Map();
    for (const l of locks) byNight.set(l.night, (byNight.get(l.night) || 0) + 1);
    const days = {};
    for (let d = from; d <= to; d = addDays(d, 1)) days[d] = rooms.length - (byNight.get(d) || 0);
    return { total: rooms.length, days };
  }

  function quote(input) {
    checkDates(input.checkin, input.checkout);
    const { rooms, seasons, discounts, charges } = catalog();
    try {
      return buildQuote({ rooms, seasons, discounts, charges, settings: settings(), today: today(), ...input });
    } catch (e) {
      if (e instanceof QuoteError) throw new ServiceError(e.code, e.message);
      throw e;
    }
  }

  function validateGuest(g = {}) {
    const clean = (v, max = 120) => String(v ?? '').trim().slice(0, max);
    const guest = {
      firstName: clean(g.firstName, 60),
      lastName: clean(g.lastName, 60),
      email: clean(g.email, 120).toLowerCase(),
      phone: clean(g.phone, 30),
      country: clean(g.country, 60) || 'Chile',
      docId: clean(g.docId, 30),
      arrivalTime: clean(g.arrivalTime, 20),
      notes: clean(g.notes, 600),
    };
    const errors = {};
    if (!guest.firstName) errors.firstName = 'Escribe el nombre.';
    if (!guest.lastName) errors.lastName = 'Escribe el apellido.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(guest.email)) errors.email = 'Revisa el correo: lo usamos para enviarte la confirmación.';
    if ((guest.phone.match(/\d/g) || []).length < 8) errors.phone = 'Escribe un teléfono con al menos 8 dígitos.';
    if (Object.keys(errors).length) {
      const e = new ServiceError('datos', 'Revisa los datos marcados.');
      e.fields = errors;
      throw e;
    }
    return guest;
  }

  function event(booking, what, extra = {}) {
    return [...(booking.history || []), { at: iso(), what, ...extra }];
  }

  // Crea la reserva y toma las noches. Si hay que pagar en línea queda
  // pendiente unos minutos; si no hay cobro anticipado queda confirmada.
  function createBooking({ checkin, checkout, items, extras = [], guest, acceptTerms, source = 'web', actor = 'huesped', skipPayment = false, notesInternal = '' }) {
    if (source === 'web' && !acceptTerms) throw new ServiceError('condiciones', 'Debes aceptar las condiciones de reserva y cancelación.');
    const g = validateGuest(guest);
    sweepExpired();
    const q = quote({ checkin, checkout, items, extras });
    const s = settings();
    const nights = nightsBetween(checkin, checkout);
    const code = newCode();
    const online = !skipPayment && q.payment.dueNow > 0;
    const holdMs = (s.holdMinutes || 15) * 60000;
    let booking;
    store.tx(() => {
      const busy = busyNights(items.map((i) => i.roomId), checkin, checkout);
      if (busy.length) throw new ConflictError();
      booking = store.insert('bookings', {
        code,
        status: online ? 'pendiente_pago' : 'confirmada',
        createdAt: iso(),
        expiresAt: online ? new Date(now().getTime() + holdMs).toISOString() : null,
        checkin, checkout,
        items: q.items.map((i) => ({ roomId: i.roomId, roomName: i.roomName, adults: i.adults, children: i.children })),
        extras: q.extras.map((e) => (e.days ? { id: e.id, days: e.days, people: e.people } : e.id)),
        quote: q,
        total: q.total,
        depositAmount: skipPayment ? 0 : q.payment.dueNow,
        amountPaid: 0,
        amountRefunded: 0,
        guest: g,
        source,
        paymentStatus: online ? 'pendiente' : 'sin_pago',
        notesInternal,
        history: [{ at: iso(), what: online ? 'Reserva creada; esperando el pago del anticipo.' : 'Reserva confirmada sin pago en línea.', actor }],
      });
      // Clave única (habitación, noche): si otra reserva ganó la carrera, esto lanza ConflictError y se revierte todo.
      store.addLocks(items.flatMap((i) => nights.map((night) => ({ roomId: i.roomId, night, bookingId: booking.id }))));
    });
    if (!online) queueEmail(booking, 'confirmacion');
    return view(booking);
  }

  function requireBooking(code, email) {
    const b = store.findBookingByCode(String(code || '').trim().toUpperCase());
    if (!b || (email !== undefined && b.guest.email !== String(email || '').trim().toLowerCase())) {
      throw new ServiceError('no_encontrada', 'No encontramos una reserva con ese código y correo.', 404);
    }
    return b;
  }

  // Vista para el huésped: sin notas internas.
  function view(b) {
    const s = settings();
    const t = today();
    const cancel = ['confirmada', 'pendiente_pago'].includes(b.status) ? refundFor({ booking: b, today: t, settings: s }) : null;
    return {
      code: b.code,
      status: b.status,
      createdAt: b.createdAt,
      expiresAt: b.expiresAt,
      checkin: b.checkin,
      checkout: b.checkout,
      items: b.items,
      quote: b.quote,
      total: b.total,
      depositAmount: b.depositAmount,
      amountPaid: b.amountPaid,
      amountRefunded: b.amountRefunded,
      balanceDue: b.status === 'cancelada' ? 0 : Math.max(0, b.total - b.amountPaid + (b.amountRefunded || 0)),
      paymentStatus: b.paymentStatus,
      guest: { firstName: b.guest.firstName, lastName: b.guest.lastName, email: b.guest.email, phone: b.guest.phone },
      cancellation: cancel,
      canChange: b.status === 'confirmada' && t <= modificationDeadline(b.checkin, s),
      freeCancelUntil: cancellationDeadline(b.checkin, s),
      freeChangeUntil: modificationDeadline(b.checkin, s),
      payments: store.list('payments', { bookingId: b.id }).filter((p) => p.status === 'autorizado').map((p) => ({ kind: p.kind, method: p.method, amount: p.amount, cardType: p.cardType, cardLast4: p.cardLast4, at: p.createdAt })),
    };
  }

  function getBooking(code, email) {
    sweepExpired();
    return view(requireBooking(code, email));
  }

  // ---------- Pagos ----------

  async function startPayment(code, { returnUrl }) {
    sweepExpired();
    const b = requireBooking(code);
    if (b.status !== 'pendiente_pago') throw new ServiceError('estado', b.status === 'expirada' ? 'El tiempo para pagar terminó y las noches se liberaron. Vuelve a buscar disponibilidad.' : 'Esta reserva no tiene un pago pendiente.');
    if (!payments) throw new ServiceError('pagos', 'El pago en línea no está configurado.', 503);
    const s = settings();
    const buyOrder = `${b.code.replace('-', '')}${Date.now().toString(36).slice(-4).toUpperCase()}`.slice(0, 26);
    const res = await payments.create({ buyOrder, sessionId: b.id, amount: b.depositAmount, returnUrl });
    store.insert('payments', {
      bookingId: b.id, kind: 'cargo', provider: s.payment?.provider || 'webpay', method: 'webpay',
      amount: b.depositAmount, status: 'iniciado', providerRef: res.token, buyOrder, createdAt: iso(),
      environment: s.payment?.environment || 'integracion',
    });
    return { url: res.url, token: res.token };
  }

  // Webpay devuelve al huésped a returnUrl con token_ws (pago procesado),
  // o con TBK_TOKEN (el huésped anuló o se agotó el tiempo en el formulario).
  async function finishPayment({ token, aborted = false }) {
    const p = store.list('payments', { providerRef: token })[0];
    if (!p) throw new ServiceError('pago', 'No reconocemos este pago.', 404);
    const b = store.get('bookings', p.bookingId);
    if (p.status !== 'iniciado') return { booking: view(b), payment: p.status };
    const s = settings();
    if (aborted) {
      store.update('payments', p.id, { status: 'anulado', finishedAt: iso() });
      store.update('bookings', b.id, { history: event(b, 'El pago se anuló o no se completó en el formulario de pago.') });
      return { booking: view(store.get('bookings', b.id)), payment: 'anulado' };
    }
    const r = await payments.commit(token);
    const ok = r.status === 'AUTHORIZED' && r.responseCode === 0 && r.amount === p.amount;
    if (!ok) {
      store.update('payments', p.id, { status: 'rechazado', finishedAt: iso(), responseCode: r.responseCode, raw: r.raw });
      store.update('bookings', b.id, { history: event(b, 'El pago fue rechazado. La reserva sigue apartada hasta que venza el plazo.') });
      return { booking: view(store.get('bookings', b.id)), payment: 'rechazado' };
    }
    const cardType = cardTypeFromWebpay(r.paymentTypeCode);
    const fee = providerFee(p.amount, cardType === 'prepaid' ? 'prepaid' : cardType, s.payment);
    let payStatus = 'autorizado';
    store.tx(() => {
      store.update('payments', p.id, {
        status: 'autorizado', finishedAt: iso(), cardType, cardLast4: r.cardLast4, installments: r.installments,
        authorizationCode: r.authorizationCode, paymentTypeCode: r.paymentTypeCode,
        fee: fee.fee, feeVat: fee.vat, net: fee.net, raw: r.raw,
      });
      const fresh = store.get('bookings', b.id);
      if (fresh.status === 'expirada') {
        // Pagó después de que venció el plazo: intentamos recuperar las mismas noches.
        const nights = nightsBetween(fresh.checkin, fresh.checkout);
        try {
          store.addLocks(fresh.items.flatMap((i) => nights.map((night) => ({ roomId: i.roomId, night, bookingId: fresh.id }))));
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          payStatus = 'autorizado_sin_cupo';
        }
      }
      const paid = (fresh.amountPaid || 0) + p.amount;
      store.update('bookings', b.id, {
        status: payStatus === 'autorizado' ? 'confirmada' : 'requiere_revision',
        expiresAt: null,
        amountPaid: paid,
        paymentStatus: paid >= fresh.total ? 'pagado' : 'anticipo_pagado',
        history: event(fresh, payStatus === 'autorizado'
          ? `Pago aprobado (${CARD_LABEL[cardType]} terminada en ${r.cardLast4 || '—'}). Reserva confirmada.`
          : 'Pago aprobado pero las noches ya no estaban libres. Requiere revisión del hostal para reubicar o devolver.'),
      });
    });
    const done = store.get('bookings', b.id);
    if (payStatus === 'autorizado') queueEmail(done, 'confirmacion');
    else queueEmail(done, 'revision');
    return { booking: view(done), payment: payStatus };
  }

  // ---------- Cambios y cancelación ----------

  async function cancelBooking(code, email, { reason = '', actor = 'huesped' } = {}) {
    const b = requireBooking(code, email);
    return cancelInternal(b, { reason, actor });
  }

  async function cancelInternal(b, { reason, actor, refundOverride = null }) {
    if (!['confirmada', 'pendiente_pago', 'requiere_revision'].includes(b.status)) {
      throw new ServiceError('estado', 'Esta reserva ya no se puede cancelar.');
    }
    const s = settings();
    const r = refundFor({ booking: b, today: today(), settings: s });
    const refund = refundOverride ?? r.refund;
    let refundResult = null;
    if (refund > 0) {
      const charge = store.list('payments', { bookingId: b.id }).find((p) => p.kind === 'cargo' && p.status === 'autorizado' && p.method === 'webpay');
      let status = 'pendiente_manual';
      if (charge && payments?.refund) {
        try {
          const rr = await payments.refund(charge.providerRef, refund);
          status = rr.ok ? 'autorizado' : 'pendiente_manual';
          refundResult = rr;
        } catch (e) {
          refundResult = { ok: false, error: e.message };
        }
      }
      store.insert('payments', {
        bookingId: b.id, kind: 'reembolso', provider: charge?.provider || 'manual', method: charge ? 'webpay' : 'manual',
        amount: refund, status, createdAt: iso(), providerRef: charge?.providerRef || null, raw: refundResult,
      });
    }
    store.tx(() => {
      store.removeLocks({ bookingId: b.id });
      store.update('bookings', b.id, {
        status: 'cancelada',
        cancelledAt: iso(),
        cancelReason: String(reason).slice(0, 300),
        amountRefunded: (b.amountRefunded || 0) + refund,
        paymentStatus: refund > 0 ? (refund >= b.amountPaid ? 'reembolsado' : 'reembolso_parcial') : b.paymentStatus,
        history: event(b, `Reserva cancelada por ${actor === 'huesped' ? 'el huésped' : 'el hostal'}. Reembolso: $${refund.toLocaleString('es-CL')}.`, { actor }),
      });
    });
    const done = store.get('bookings', b.id);
    queueEmail(done, 'cancelacion');
    return { booking: view(done), refund, retained: r.retained, free: r.free };
  }

  function previewChange(code, email, { checkin, checkout }) {
    const b = requireBooking(code, email);
    return changeInternal(b, { checkin, checkout, dryRun: true });
  }

  function changeBooking(code, email, { checkin, checkout }) {
    const b = requireBooking(code, email);
    return changeInternal(b, { checkin, checkout, dryRun: false });
  }

  function changeInternal(b, { checkin, checkout, dryRun, actor = 'huesped', force = false }) {
    const s = settings();
    if (b.status !== 'confirmada') throw new ServiceError('estado', 'Solo se pueden cambiar reservas confirmadas.');
    if (!force && today() > modificationDeadline(b.checkin, s)) {
      throw new ServiceError('plazo', 'El plazo para cambiar fechas en línea terminó. Escríbenos y lo vemos contigo.');
    }
    checkDates(checkin, checkout);
    const q = quote({ checkin, checkout, items: b.items.map(({ roomId, adults, children }) => ({ roomId, adults, children })), extras: b.extras });
    const busy = busyNights(b.items.map((i) => i.roomId), checkin, checkout, { exceptBookingId: b.id });
    const result = {
      available: busy.length === 0,
      quote: q,
      previousTotal: b.total,
      difference: q.total - b.total,
      newBalance: Math.max(0, q.total - b.amountPaid + (b.amountRefunded || 0)),
    };
    if (dryRun || !result.available) {
      if (!dryRun) throw new ConflictError('Esas fechas ya no están libres para tu habitación.');
      return result;
    }
    store.tx(() => {
      store.removeLocks({ bookingId: b.id });
      const nights = nightsBetween(checkin, checkout);
      store.addLocks(b.items.flatMap((i) => nights.map((night) => ({ roomId: i.roomId, night, bookingId: b.id }))));
      store.update('bookings', b.id, {
        checkin, checkout, quote: q, total: q.total,
        extras: q.extras.map((e) => (e.days ? { id: e.id, days: e.days, people: e.people } : e.id)),
        history: event(b, `Fechas cambiadas de ${b.checkin}→${b.checkout} a ${checkin}→${checkout}. Nuevo total $${q.total.toLocaleString('es-CL')}; la diferencia se ajusta en el saldo.`, { actor }),
      });
    });
    const done = store.get('bookings', b.id);
    queueEmail(done, 'cambio');
    return { ...result, booking: view(done) };
  }

  // ---------- Correo (cola; se envía si hay proveedor configurado) ----------

  function queueEmail(b, kind) {
    const subjects = {
      confirmacion: `Reserva confirmada ${b.code}`,
      cancelacion: `Reserva cancelada ${b.code}`,
      cambio: `Cambio de fechas ${b.code}`,
      revision: `Tu pago llegó; estamos revisando tu reserva ${b.code}`,
    };
    store.insert('outbox', { to: b.guest.email, kind, subject: subjects[kind], bookingId: b.id, code: b.code, status: 'en_cola', createdAt: iso() });
  }

  // ---------- Administración ----------

  const admin = {
    settings: () => settings(),
    saveSettings(patch) {
      const cur = settings();
      if (patch.housePhotos !== undefined) patch = { ...patch, housePhotos: cleanPhotos(patch.housePhotos) };
      if (patch.business) {
        const b = { ...patch.business };
        for (const k of ['instagram', 'facebook']) if (k in b) b[k] = httpsUrl(b[k]);
        if ('mapsUrl' in b) { b.mapsUrl = httpsUrl(b.mapsUrl); if (!b.mapsUrl) delete b.mapsUrl; } // vacío o inválido: se mantiene el anterior
        if ('googleRating' in b) b.googleRating = Math.min(5, Math.max(0, Math.round(Number(String(b.googleRating).replace(',', '.')) * 10) / 10 || 0));
        if ('googleReviews' in b) b.googleReviews = int(b.googleReviews || 0, { min: 0, max: 100000, name: 'Opiniones en Google' });
        patch = { ...patch, business: b };
      }
      const next = deepMerge(cur, patch);
      store.saveSettings(next);
      return next;
    },

    list(kind) {
      if (!['rooms', 'seasons', 'discounts', 'charges', 'blocks', 'outbox'].includes(kind)) throw new ServiceError('tipo', 'Tipo desconocido.');
      return store.list(kind).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.start || a.createdAt || '').localeCompare(String(b.start || b.createdAt || '')));
    },
    save(kind, obj) {
      if (!['rooms', 'seasons', 'discounts', 'charges'].includes(kind)) throw new ServiceError('tipo', 'Tipo desconocido.');
      const clean = validators[kind](obj);
      if (obj.id && store.get(kind, obj.id)) return store.update(kind, obj.id, clean);
      return store.insert(kind, clean);
    },
    remove(kind, id) {
      if (kind === 'rooms') {
        const future = store.locksFor([id], today(), addDays(today(), 800)).filter((l) => l.bookingId);
        if (future.length) throw new ServiceError('en_uso', 'Esta habitación tiene reservas futuras. Desactívala en vez de borrarla.');
      }
      if (!['rooms', 'seasons', 'discounts', 'charges'].includes(kind)) throw new ServiceError('tipo', 'Tipo desconocido.');
      store.remove(kind, id);
      return { ok: true };
    },

    createBlock({ roomId, from, to, reason = 'Bloqueo manual', source = 'manual', externalId = null }) {
      if (!isDate(from) || !isDate(to) || to < from) throw new ServiceError('fechas', 'Rango inválido: la última noche debe ser igual o posterior a la primera.');
      if (!store.get('rooms', roomId)) throw new ServiceError('habitacion', 'Habitación desconocida.');
      let block;
      store.tx(() => {
        const nights = nightsBetween(from, addDays(to, 1));
        const busy = store.locksFor([roomId], from, to);
        if (busy.length) throw new ConflictError('Ya hay reservas o bloqueos en esas noches.');
        block = store.insert('blocks', { roomId, from, to, reason: String(reason).slice(0, 200), source, externalId, createdAt: iso() });
        store.addLocks(nights.map((night) => ({ roomId, night, blockId: block.id })));
      });
      return block;
    },
    removeBlock(id) {
      store.tx(() => {
        store.removeLocks({ blockId: id });
        store.remove('blocks', id);
      });
      return { ok: true };
    },

    bookings({ status, q, from, to } = {}) {
      sweepExpired();
      let list = store.list('bookings');
      if (status) list = list.filter((b) => b.status === status);
      if (from) list = list.filter((b) => b.checkout > from);
      if (to) list = list.filter((b) => b.checkin <= to);
      if (q) {
        const s = q.toLowerCase();
        list = list.filter((b) => [b.code, b.guest.firstName, b.guest.lastName, b.guest.email, b.guest.phone].join(' ').toLowerCase().includes(s));
      }
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((b) => ({
        id: b.id, code: b.code, status: b.status, checkin: b.checkin, checkout: b.checkout,
        guest: `${b.guest.firstName} ${b.guest.lastName}`, rooms: b.items.map((i) => i.roomName).join(', '),
        total: b.total, amountPaid: b.amountPaid, amountRefunded: b.amountRefunded, paymentStatus: b.paymentStatus, source: b.source, createdAt: b.createdAt,
        balanceDue: ['cancelada', 'expirada'].includes(b.status) ? 0 : Math.max(0, b.total - b.amountPaid + (b.amountRefunded || 0)),
      }));
    },
    booking(id) {
      const b = store.get('bookings', id);
      if (!b) throw new ServiceError('no_encontrada', 'Reserva no encontrada.', 404);
      return { ...b, view: view(b), payments: store.list('payments', { bookingId: id }), emails: store.list('outbox', { bookingId: id }) };
    },
    createBooking(input) {
      return createBooking({ ...input, source: input.source || 'admin', actor: 'hostal', skipPayment: true, acceptTerms: true });
    },
    recordPayment(id, { amount, method = 'efectivo', note = '' }) {
      const b = store.get('bookings', id);
      if (!b) throw new ServiceError('no_encontrada', 'Reserva no encontrada.', 404);
      amount = Math.round(+amount);
      if (!(amount > 0)) throw new ServiceError('monto', 'Ingresa un monto mayor a cero.');
      if (!['efectivo', 'transferencia', 'pos', 'otro'].includes(method)) throw new ServiceError('metodo', 'Medio de pago inválido.');
      store.insert('payments', { bookingId: id, kind: 'cargo', provider: 'hostal', method, amount, fee: 0, feeVat: 0, net: amount, status: 'autorizado', note: String(note).slice(0, 200), createdAt: iso() });
      const paid = (b.amountPaid || 0) + amount;
      store.update('bookings', id, {
        amountPaid: paid,
        paymentStatus: paid - (b.amountRefunded || 0) >= b.total ? 'pagado' : 'anticipo_pagado',
        status: b.status === 'pendiente_pago' ? 'confirmada' : b.status,
        expiresAt: null,
        history: event(b, `Pago registrado en el hostal: $${amount.toLocaleString('es-CL')} (${method}).`, { actor: 'hostal' }),
      });
      if (b.status === 'pendiente_pago') {
        // Si pagó en el hostal una reserva pendiente, las noches ya están tomadas: solo se confirma.
      }
      return admin.booking(id);
    },
    setStatus(id, status) {
      const b = store.get('bookings', id);
      if (!b) throw new ServiceError('no_encontrada', 'Reserva no encontrada.', 404);
      const allowed = { confirmada: ['en_estadia', 'no_show'], en_estadia: ['completada'], requiere_revision: ['confirmada'] };
      if (!(allowed[b.status] || []).includes(status)) throw new ServiceError('estado', `No se puede pasar de "${b.status}" a "${status}".`);
      store.tx(() => {
        if (status === 'no_show') store.removeLocks({ bookingId: id });
        if (status === 'confirmada' && b.status === 'requiere_revision') {
          const nights = nightsBetween(b.checkin, b.checkout);
          store.addLocks(b.items.flatMap((i) => nights.map((night) => ({ roomId: i.roomId, night, bookingId: id }))));
        }
        store.update('bookings', id, { status, history: event(b, `Estado cambiado a ${status}.`, { actor: 'hostal' }) });
      });
      return admin.booking(id);
    },
    cancel(id, { reason = '', refund = null } = {}) {
      const b = store.get('bookings', id);
      if (!b) throw new ServiceError('no_encontrada', 'Reserva no encontrada.', 404);
      const override = refund === null || refund === undefined || refund === '' ? null : Math.max(0, Math.min(Math.round(+refund), b.amountPaid - (b.amountRefunded || 0)));
      return cancelInternal(b, { reason, actor: 'hostal', refundOverride: override });
    },
    changeDates(id, { checkin, checkout, dryRun = false }) {
      const b = store.get('bookings', id);
      if (!b) throw new ServiceError('no_encontrada', 'Reserva no encontrada.', 404);
      return changeInternal(b, { checkin, checkout, dryRun, actor: 'hostal', force: true });
    },

    calendar({ from, to }) {
      sweepExpired();
      const rooms = catalog().rooms;
      const locks = store.locksFor(rooms.map((r) => r.id), from, to);
      const bookings = new Map();
      const blocks = new Map();
      for (const l of locks) {
        if (l.bookingId && !bookings.has(l.bookingId)) {
          const b = store.get('bookings', l.bookingId);
          if (b) bookings.set(b.id, { id: b.id, code: b.code, status: b.status, checkin: b.checkin, checkout: b.checkout, guest: `${b.guest.firstName} ${b.guest.lastName}`, source: b.source, paymentStatus: b.paymentStatus });
        }
        if (l.blockId && !blocks.has(l.blockId)) blocks.set(l.blockId, store.get('blocks', l.blockId));
      }
      return { rooms: rooms.map((r) => ({ id: r.id, name: r.name, shortName: r.shortName })), locks, bookings: [...bookings.values()], blocks: [...blocks.values()].filter(Boolean) };
    },

    // Resumen de ingresos: lo cobrado a huéspedes, lo que se llevó el proveedor de pago y lo que queda.
    summary({ from, to }) {
      sweepExpired();
      const s = settings();
      const inRange = (d) => d >= from && d <= to;
      const pays = store.list('payments').filter((p) => p.status === 'autorizado' && inRange((p.createdAt || '').slice(0, 10)));
      const charged = pays.filter((p) => p.kind === 'cargo');
      const refunds = pays.filter((p) => p.kind === 'reembolso');
      const sum = (arr, k) => arr.reduce((a, p) => a + (p[k] || 0), 0);
      const online = charged.filter((p) => p.method === 'webpay');
      const atProperty = charged.filter((p) => p.method !== 'webpay');

      const bookings = store.list('bookings');
      const stays = bookings.filter((b) => ['confirmada', 'en_estadia', 'completada'].includes(b.status) && b.checkin <= to && b.checkout > from);
      const rooms = catalog().rooms;
      let nightsSold = 0;
      for (const b of stays) {
        for (const n of nightsBetween(b.checkin, b.checkout)) if (inRange(n)) nightsSold += b.items.length;
      }
      const capacity = rooms.length * (diffDays(from, to) + 1);
      const booked = bookings.filter((b) => inRange(b.createdAt.slice(0, 10)) && !['expirada'].includes(b.status));
      const pending = bookings.filter((b) => ['confirmada', 'en_estadia'].includes(b.status)).reduce((a, b) => a + Math.max(0, b.total - b.amountPaid + (b.amountRefunded || 0)), 0);
      const gross = sum(charged, 'amount');
      const fees = sum(online, 'fee');
      const feesVat = sum(online, 'feeVat');
      const refunded = sum(refunds, 'amount');
      const net = gross - fees - feesVat - refunded;
      return {
        from, to,
        gross, online: sum(online, 'amount'), atProperty: sum(atProperty, 'amount'),
        fees, feesVat, refunded, net,
        effectiveFeePct: sum(online, 'amount') ? ((fees + feesVat) / sum(online, 'amount')) * 100 : 0,
        pendingBalances: pending,
        bookingsCreated: booked.length,
        bookingsCancelled: booked.filter((b) => b.status === 'cancelada').length,
        nightsSold, capacity, occupancyPct: capacity ? (nightsSold / capacity) * 100 : 0,
        byMethod: ['webpay', 'efectivo', 'transferencia', 'pos', 'otro'].map((m) => ({ method: m, amount: sum(charged.filter((p) => p.method === m), 'amount') })).filter((x) => x.amount),
      };
    },

    today() {
      sweepExpired();
      const t = today();
      const list = store.list('bookings').filter((b) => ['confirmada', 'en_estadia', 'requiere_revision'].includes(b.status));
      const pick = (b) => ({ id: b.id, code: b.code, guest: `${b.guest.firstName} ${b.guest.lastName}`, rooms: b.items.map((i) => i.roomName).join(', '), balanceDue: Math.max(0, b.total - b.amountPaid + (b.amountRefunded || 0)), arrivalTime: b.guest.arrivalTime, status: b.status, phone: b.guest.phone });
      return {
        today: t,
        arrivals: list.filter((b) => b.checkin === t).map(pick),
        departures: list.filter((b) => b.checkout === t).map(pick),
        inHouse: list.filter((b) => b.checkin < t && b.checkout > t).map(pick),
        review: list.filter((b) => b.status === 'requiere_revision').map(pick),
        pendingPayment: store.list('bookings', { status: 'pendiente_pago' }).length,
      };
    },
  };

  return {
    today, publicInfo, search, availabilityCalendar, quote, createBooking, getBooking, startPayment, finishPayment,
    cancelBooking, previewChange, changeBooking, sweepExpired, admin,
  };
}

function deepMerge(a, b) {
  if (Array.isArray(b) || typeof b !== 'object' || b === null) return b;
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b)) out[k] = (typeof v === 'object' && v !== null && !Array.isArray(v)) ? deepMerge(out[k], v) : v;
  return out;
}

const int = (v, { min = 0, max = 1e9, name }) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min || n > max) throw new ServiceError('valor', `${name}: ingresa un número entre ${min} y ${max.toLocaleString('es-CL')}.`);
  return n;
};
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
// Fotos: url grande y, si existe, una versión liviana (thumb) para listas.
// Las url largas son fotos de la demo, guardadas como data: en el navegador.
const cleanPhotos = (list) => (Array.isArray(list) ? list : []).slice(0, 20).map((p) => ({ url: str(p?.url, 3_000_000), alt: str(p?.alt, 160), ...(p?.thumb ? { thumb: str(p.thumb, 3_000_000) } : {}) })).filter((p) => p.url);
const httpsUrl = (v) => (/^https:\/\/[^\s"'<>]+$/.test(str(v, 500)) ? str(v, 500) : '');

const validators = {
  rooms(r) {
    const name = str(r.name, 80);
    if (!name) throw new ServiceError('valor', 'La habitación necesita un nombre.');
    const maxGuests = int(r.maxGuests, { min: 1, max: 20, name: 'Capacidad' });
    return {
      name,
      shortName: str(r.shortName || name, 30),
      slug: str(r.slug || name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-'), 60),
      description: str(r.description, 1200),
      sizeM2: r.sizeM2 === '' || r.sizeM2 == null ? null : int(r.sizeM2, { min: 1, max: 500, name: 'Superficie' }),
      beds: str(r.beds, 120),
      bathroom: r.bathroom === 'compartido' ? 'compartido' : 'privado',
      kitchen: !!r.kitchen,
      view: str(r.view, 60),
      baseOccupancy: int(r.baseOccupancy ?? maxGuests, { min: 1, max: maxGuests, name: 'Personas incluidas en la tarifa' }),
      maxGuests,
      baseRate: int(r.baseRate, { min: 1000, max: 5000000, name: 'Tarifa base' }),
      extraGuestFee: int(r.extraGuestFee || 0, { min: 0, max: 1000000, name: 'Cargo por persona extra' }),
      minNights: int(r.minNights || 1, { min: 1, max: 30, name: 'Mínimo de noches' }),
      amenities: (Array.isArray(r.amenities) ? r.amenities : String(r.amenities || '').split(',')).map((a) => str(a, 60)).filter(Boolean).slice(0, 30),
      photos: cleanPhotos(r.photos),
      active: r.active !== false,
      sort: int(r.sort || 0, { min: 0, max: 999, name: 'Orden' }),
      dataStatus: str(r.dataStatus, 40),
      rateStatus: str(r.rateStatus, 20),
    };
  },
  seasons(s) {
    const name = str(s.name, 60);
    if (!name) throw new ServiceError('valor', 'La temporada necesita un nombre.');
    if (!isDate(s.start) || !isDate(s.end) || s.end < s.start) throw new ServiceError('valor', 'Revisa las fechas de la temporada: el fin debe ser igual o posterior al inicio.');
    return {
      name, start: s.start, end: s.end,
      adjustPct: int(s.adjustPct, { min: -90, max: 300, name: 'Ajuste %' }),
      minNights: s.minNights ? int(s.minNights, { min: 1, max: 30, name: 'Mínimo de noches' }) : null,
      priority: int(s.priority || 0, { min: 0, max: 100, name: 'Prioridad' }),
      roomIds: Array.isArray(s.roomIds) ? s.roomIds : [],
      active: s.active !== false,
    };
  },
  discounts(d) {
    const name = str(d.name, 60);
    if (!name) throw new ServiceError('valor', 'El descuento necesita un nombre.');
    if (!['estadia', 'anticipacion'].includes(d.type)) throw new ServiceError('valor', 'Tipo de descuento inválido.');
    return {
      name, type: d.type,
      pct: int(d.pct, { min: 1, max: 80, name: 'Descuento %' }),
      minNights: d.type === 'estadia' ? int(d.minNights, { min: 2, max: 60, name: 'Noches mínimas' }) : null,
      minDaysAhead: d.type === 'anticipacion' ? int(d.minDaysAhead, { min: 1, max: 365, name: 'Días de anticipación' }) : null,
      active: d.active !== false,
    };
  },
  charges(c) {
    const name = str(c.name, 60);
    if (!name) throw new ServiceError('valor', 'El cargo necesita un nombre.');
    if (!['reserva', 'noche', 'persona', 'persona_noche', 'persona_dia'].includes(c.unit)) throw new ServiceError('valor', 'Unidad de cobro inválida.');
    return {
      name, description: str(c.description, 300), unit: c.unit,
      amount: int(c.amount, { min: 0, max: 5000000, name: 'Monto' }),
      mandatory: !!c.mandatory, active: c.active !== false, status: str(c.status, 40),
    };
  },
};

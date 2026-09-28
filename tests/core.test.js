import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryStore } from '../core/memory-store.js';
import { createService, ConflictError, ServiceError } from '../core/service.js';
import { seedAll } from '../core/seed.js';
import { createSimulatedPayments } from '../core/simulated-payments.js';
import { providerFee, quote as rawQuote } from '../core/pricing.js';
import { nightsBetween } from '../core/dates.js';

// Reloj fijo: 1 de octubre de 2026, mediodía en Chile.
function setup(start = '2026-10-01T15:00:00Z') {
  let t = new Date(start);
  const store = createMemoryStore();
  seedAll(store);
  // Cargos de prueba con monto, independientes de los precios reales del hostal.
  store.insert('charges', { id: 'cargo-test', name: 'Desayuno de prueba', unit: 'persona_noche', amount: 6000, active: true });
  store.insert('charges', { id: 'cargo-test-reserva', name: 'Traslado de prueba', unit: 'reserva', amount: 20000, active: true });
  const payments = createSimulatedPayments();
  const svc = createService({ store, payments, now: () => t });
  return { store, svc, payments, advance: (ms) => { t = new Date(t.getTime() + ms); } };
}

const guest = { firstName: 'Ana', lastName: 'Rojas', email: 'Ana@Example.cl', phone: '+56 9 1234 5678' };

test('noches entre fechas', () => {
  assert.deepEqual(nightsBetween('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01']);
});

test('precio simple: tarifa × noches, anticipo 30 % y saldo', () => {
  const { svc } = setup();
  const q = svc.quote({ checkin: '2026-10-10', checkout: '2026-10-13', items: [{ roomId: 'hab-doble', adults: 2 }] });
  assert.equal(q.nights, 3);
  assert.equal(q.lodging, 114000);
  assert.equal(q.discount, null);
  assert.equal(q.total, 114000);
  assert.equal(q.payment.dueNow, 34200);
  assert.equal(q.payment.dueAtProperty, 79800);
  assert.equal(q.vat.amount, 18202); // 114000 - 114000/1.19
});

test('temporada: ajuste por noche y mínimo de noches', () => {
  const { svc } = setup();
  // 2026-12-24 y 25 fuera de temporada, 26 y 27 dentro (+15 %).
  const q = svc.quote({ checkin: '2026-12-24', checkout: '2026-12-28', items: [{ roomId: 'hab-doble', adults: 1 }] });
  assert.deepEqual(q.items[0].nights.map((n) => n.rate), [38000, 38000, 43700, 43700]);
  assert.throws(() => svc.quote({ checkin: '2027-01-05', checkout: '2027-01-06', items: [{ roomId: 'hab-doble', adults: 1 }] }), /mínimo de 2 noches/);
});

test('persona extra y niños', () => {
  const { svc } = setup();
  const q = svc.quote({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-triple', adults: 3 }] });
  assert.equal(q.items[0].extraGuests.total, 20000);
  assert.equal(q.total, 110000);
  const kids = svc.quote({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-triple', adults: 2, children: 1 }] });
  assert.equal(kids.total, 90000);
  assert.throws(() => svc.quote({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2, children: 1 }] }), /hasta 2 personas/);
});

test('descuentos: se aplica solo el mejor, y los extras no se descuentan', () => {
  const { svc } = setup();
  // 8 noches con 50 días de anticipación: califica a 10 % y 5 %; gana 10 %.
  const q = svc.quote({ checkin: '2026-11-20', checkout: '2026-11-28', items: [{ roomId: 'hab-twin', adults: 2 }], extras: ['cargo-test'] });
  assert.equal(q.lodging, 304000);
  assert.equal(q.discount.pct, 10);
  assert.equal(q.discount.amount, 30400);
  assert.equal(q.extras[0].amount, 6000 * 2 * 8);
  assert.equal(q.total, 304000 - 30400 + 96000);
});

test('anticipo total si la llegada es muy pronto', () => {
  const { svc } = setup();
  const q = svc.quote({ checkin: '2026-10-02', checkout: '2026-10-03', items: [{ roomId: 'hab-doble', adults: 2 }] });
  assert.equal(q.payment.mode, 'full');
  assert.equal(q.payment.dueNow, 38000);
});

test('comisión Webpay: porcentaje, mínimo en UF e IVA', () => {
  const pay = { rates: { credit: 0.0235, debit: 0.0175 }, minFeeUF: { credit: 0.003515, debit: 0.00226 }, ufValue: 41016, feeVatRate: 0.19 };
  assert.deepEqual(providerFee(40500, 'credit', pay), { rate: 0.0235, fee: 952, vat: 181, total: 1133, net: 39367, minApplied: false });
  assert.deepEqual(providerFee(40500, 'debit', pay), { rate: 0.0175, fee: 709, vat: 135, total: 844, net: 39656, minApplied: false });
  // Monto pequeño: aplica el mínimo (0,003515 UF ≈ $144).
  const small = providerFee(3000, 'credit', pay);
  assert.equal(small.fee, 144);
  assert.equal(small.minApplied, true);
});

test('los totales de la cotización cuadran siempre', () => {
  const { svc } = setup();
  for (const [ci, co, room, a, c] of [['2026-12-20', '2027-01-04', 'cabana', 3, 0], ['2027-09-14', '2027-09-22', 'hab-privado', 2, 1], ['2026-10-05', '2026-10-06', 'hab-doble', 1, 0]]) {
    const q = svc.quote({ checkin: ci, checkout: co, items: [{ roomId: room, adults: a, children: c }], extras: ['cargo-test-reserva'] });
    const lodging = q.items.reduce((s, i) => s + i.nights.reduce((x, n) => x + n.rate, 0) + i.extraGuests.total, 0);
    assert.equal(q.lodging, lodging);
    assert.equal(q.total, q.lodging - (q.discount?.amount || 0) + q.extrasTotal);
    assert.equal(q.payment.dueNow + q.payment.dueAtProperty, q.total);
    assert.ok(Number.isInteger(q.total) && Number.isInteger(q.payment.dueNow));
  }
});

test('recorrido completo: reservar, pagar con débito, confirmar', async () => {
  const { svc, payments } = setup();
  const b = svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }], guest, acceptTerms: true });
  assert.equal(b.status, 'pendiente_pago');
  assert.match(b.code, /^SE-[A-Z2-9]{6}$/);
  const s = svc.search({ checkin: '2026-10-11', checkout: '2026-10-12', adults: 2 });
  assert.equal(s.results.find((r) => r.room.id === 'hab-doble').available, false, 'la noche apartada no se ofrece');
  const { token } = await svc.startPayment(b.code, { returnUrl: 'x' });
  payments.decide(token, { approve: true, cardType: 'debit' });
  const r = await svc.finishPayment({ token });
  assert.equal(r.payment, 'autorizado');
  assert.equal(r.booking.status, 'confirmada');
  assert.equal(r.booking.amountPaid, 22800);
  assert.equal(r.booking.balanceDue, 53200);
  // Volver a la página de retorno no cobra dos veces.
  const again = await svc.finishPayment({ token });
  assert.equal(again.booking.amountPaid, 22800);
  const sum = svc.admin.summary({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(sum.gross, 22800);
  assert.equal(sum.fees, 399); // 1,75 % de 22.800
  assert.equal(sum.feesVat, 76);
  assert.equal(sum.net, 22800 - 399 - 76);
  // Buscar la reserva exige el correo correcto.
  assert.throws(() => svc.getBooking(b.code, 'otro@correo.cl'), /No encontramos/);
  assert.equal(svc.getBooking(b.code.toLowerCase(), 'ANA@example.cl').code, b.code);
});

test('no hay reservas duplicadas: la segunda sobre las mismas noches falla', () => {
  const { svc } = setup();
  svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-13', items: [{ roomId: 'hab-privado', adults: 2 }], guest, acceptTerms: true });
  assert.throws(
    () => svc.createBooking({ checkin: '2026-10-12', checkout: '2026-10-14', items: [{ roomId: 'hab-privado', adults: 2 }], guest, acceptTerms: true }),
    ConflictError,
  );
  // Salida el día 13 y llegada el 13 sí conviven.
  const ok = svc.createBooking({ checkin: '2026-10-13', checkout: '2026-10-14', items: [{ roomId: 'hab-privado', adults: 2 }], guest, acceptTerms: true });
  assert.equal(ok.status, 'pendiente_pago');
});

test('una reserva de varias habitaciones es todo o nada', () => {
  const { svc, store } = setup();
  svc.admin.createBlock({ roomId: 'hab-triple', from: '2026-10-11', to: '2026-10-11', reason: 'Mantención' });
  assert.throws(() => svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }, { roomId: 'hab-triple', adults: 2 }], guest, acceptTerms: true }), ConflictError);
  assert.equal(store.locksFor(['hab-doble'], '2026-10-01', '2026-10-30').length, 0, 'no quedan noches tomadas a medias');
  assert.equal(store.list('bookings').length, 0);
});

test('el apartado vence y libera las noches', async () => {
  const { svc, advance } = setup();
  svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }], guest, acceptTerms: true });
  advance(16 * 60000);
  const s = svc.search({ checkin: '2026-10-10', checkout: '2026-10-12', adults: 2 });
  assert.equal(s.results.find((r) => r.room.id === 'hab-doble').available, true);
});

test('pago rechazado deja la reserva pendiente sin cobrar', async () => {
  const { svc, payments } = setup();
  const b = svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }], guest, acceptTerms: true });
  const { token } = await svc.startPayment(b.code, { returnUrl: 'x' });
  payments.decide(token, { approve: false });
  const r = await svc.finishPayment({ token });
  assert.equal(r.payment, 'rechazado');
  assert.equal(r.booking.status, 'pendiente_pago');
  assert.equal(r.booking.amountPaid, 0);
});

test('cancelación gratis antes del plazo y con retención después', async () => {
  const { svc, payments, advance } = setup();
  const make = async (ci, co) => {
    const b = svc.createBooking({ checkin: ci, checkout: co, items: [{ roomId: 'hab-twin', adults: 2 }], guest, acceptTerms: true });
    const { token } = await svc.startPayment(b.code, { returnUrl: 'x' });
    payments.decide(token, { approve: true, cardType: 'credit' });
    await svc.finishPayment({ token });
    return b.code;
  };
  const early = await make('2026-10-20', '2026-10-22');
  const r1 = await svc.cancelBooking(early, guest.email);
  assert.equal(r1.free, true);
  assert.equal(r1.refund, 22800);
  const late = await make('2026-10-06', '2026-10-08'); // faltan 5 días (< 7)
  const r2 = await svc.cancelBooking(late, guest.email);
  assert.equal(r2.free, false);
  assert.equal(r2.refund, 0);
  assert.equal(r2.retained, 22800);
  // Tras cancelar, las noches vuelven a estar libres.
  const s = svc.search({ checkin: '2026-10-06', checkout: '2026-10-08', adults: 2 });
  assert.equal(s.results.find((r) => r.room.id === 'hab-twin').available, true);
  advance(0);
});

test('cambio de fechas: recalcula y respeta disponibilidad', async () => {
  const { svc } = setup();
  const other = svc.admin.createBooking({ checkin: '2026-10-20', checkout: '2026-10-22', items: [{ roomId: 'hab-doble', adults: 1 }], guest: { ...guest, email: 'b@b.cl' } });
  assert.equal(other.status, 'confirmada');
  const b = svc.admin.createBooking({ checkin: '2026-10-15', checkout: '2026-10-17', items: [{ roomId: 'hab-doble', adults: 2 }], guest });
  assert.throws(() => svc.changeBooking(b.code, guest.email, { checkin: '2026-10-19', checkout: '2026-10-21' }), ConflictError);
  const prev = svc.previewChange(b.code, guest.email, { checkin: '2026-10-15', checkout: '2026-10-18' });
  assert.equal(prev.difference, 38000);
  const done = svc.changeBooking(b.code, guest.email, { checkin: '2026-10-15', checkout: '2026-10-18' });
  assert.equal(done.booking.total, 114000);
  // Se puede extender sobre sus propias noches sin chocar consigo misma.
  const s = svc.search({ checkin: '2026-10-17', checkout: '2026-10-18', adults: 1 });
  assert.equal(s.results.find((r) => r.room.id === 'hab-doble').available, false);
});

test('datos del huésped se validan', () => {
  const { svc } = setup();
  try {
    svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }], guest: { firstName: 'A', email: 'malo' }, acceptTerms: true });
    assert.fail('debió fallar');
  } catch (e) {
    assert.ok(e instanceof ServiceError);
    assert.ok(e.fields.email && e.fields.lastName && e.fields.phone);
  }
  assert.throws(() => svc.createBooking({ checkin: '2026-10-10', checkout: '2026-10-12', items: [{ roomId: 'hab-doble', adults: 2 }], guest }), /condiciones/);
});

test('pago en el hostal y resumen por medio de pago', async () => {
  const { svc } = setup();
  const b = svc.admin.createBooking({ checkin: '2026-10-03', checkout: '2026-10-05', items: [{ roomId: 'hab-doble', adults: 2 }], guest });
  const list = svc.admin.bookings({});
  const id = list[0].id;
  svc.admin.recordPayment(id, { amount: 90000, method: 'efectivo' });
  const sum = svc.admin.summary({ from: '2026-10-01', to: '2026-10-31' });
  assert.equal(sum.atProperty, 90000);
  assert.equal(sum.fees, 0);
  assert.equal(svc.getBooking(b.code, guest.email).balanceDue, 0);
});

test('temporada solo para algunas habitaciones y cotización sin servicio', () => {
  const rooms = [{ id: 'a', name: 'A', baseRate: 10000, maxGuests: 2, baseOccupancy: 2 }, { id: 'b', name: 'B', baseRate: 10000, maxGuests: 2, baseOccupancy: 2 }];
  const seasons = [{ id: 's', name: 'S', start: '2026-10-01', end: '2026-10-31', adjustPct: 50, roomIds: ['a'] }];
  const settings = { rateRounding: 1, deposit: { mode: 'none' } };
  const qa = rawQuote({ rooms, items: [{ roomId: 'a', adults: 1 }], checkin: '2026-10-10', checkout: '2026-10-11', seasons, discounts: [], charges: [], settings, today: '2026-10-01' });
  const qb = rawQuote({ rooms, items: [{ roomId: 'b', adults: 1 }], checkin: '2026-10-10', checkout: '2026-10-11', seasons, discounts: [], charges: [], settings, today: '2026-10-01' });
  assert.equal(qa.total, 15000);
  assert.equal(qb.total, 10000);
  assert.equal(qa.payment.dueNow, 0);
});

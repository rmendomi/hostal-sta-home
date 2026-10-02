import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.js';
import { createWebpay } from '../server/payments/webpay.js';
import { addDays, today } from '../core/dates.js';

let app; let base; let dir;
const T = today();
const d = (n) => addDays(T, n);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'se-'));
  app = await createApp({ PORT: '0', DATA_DIR: dir, PAYMENTS: 'simulado', INICIAR_BASE: '1', ADMIN_EMAIL: 'rene@example.cl', ADMIN_PASSWORD: 'clave-muy-segura-1' });
  await new Promise((r) => app.server.listen(0, r));
  base = `http://127.0.0.1:${app.server.address().port}`;
  app.cfg.baseUrl = base;
});
after(() => { app.close(); rmSync(dir, { recursive: true, force: true }); });

const post = async (path, body, headers = {}) => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}), redirect: 'manual' });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const guest = { firstName: 'Pedro', lastName: 'Soto', email: 'pedro@example.cl', phone: '+56 9 8765 4321' };

test('sitio y cabeceras de seguridad', async () => {
  const r = await fetch(base + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal((await fetch(base + '/../server/index.js')).status, 404);
  assert.equal((await fetch(base + '/core/pricing.js')).status, 200);
});

test('reserva por HTTP con pago simulado y enlace firmado', async () => {
  const { body: info } = await post('/api/public/info');
  assert.equal(info.rooms.length, 5);
  const c = await post('/api/public/createBooking', { checkin: d(20), checkout: d(22), items: [{ roomId: 'hab-doble', adults: 2 }], guest, acceptTerms: true });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  const { booking, token } = c.body;
  const noToken = await post('/api/public/startPayment', { code: booking.code });
  assert.equal(noToken.status, 404);
  const p = await post('/api/public/startPayment', { code: booking.code, token });
  assert.equal(p.status, 200);
  // El huésped aprueba en la pasarela simulada y vuelve.
  const txToken = p.body.token;
  const g = await fetch(`${base}/pago-simulado/${txToken}`, { method: 'POST', body: new URLSearchParams({ r: 'credit' }), redirect: 'manual' });
  assert.equal(g.status, 303);
  const back = await fetch(base + g.headers.get('location'), { redirect: 'manual' });
  assert.equal(back.status, 303);
  assert.match(back.headers.get('location'), new RegExp(`#/reserva/${booking.code}/[\\w-]+/autorizado$`));
  const v = await post('/api/public/getBooking', { code: booking.code, token });
  assert.equal(v.body.booking.status, 'confirmada');
  assert.equal(v.body.booking.payments[0].cardType, 'credit');
  const bad = await post('/api/public/getBooking', { code: booking.code, token: 'x' + token.slice(1) });
  assert.equal(bad.status, 403);
});

test('carrera: 12 reservas simultáneas por la misma noche, solo una gana', async () => {
  const tries = await Promise.all(Array.from({ length: 12 }, (_, i) => post('/api/public/createBooking', {
    checkin: d(40), checkout: d(41), items: [{ roomId: 'hab-privado', adults: 2 }], guest: { ...guest, email: `g${i}@example.cl` }, acceptTerms: true,
  }, { 'X-Forwarded-For': `10.0.0.${i}` })));
  const ok = tries.filter((t) => t.status === 200);
  const conflict = tries.filter((t) => t.status === 409);
  assert.equal(ok.length, 1);
  assert.equal(conflict.length, 11);
  assert.match(conflict[0].body.error, /Otra persona acaba de reservar/);
});

test('panel: exige sesión y permite gestionar', async () => {
  assert.equal((await post('/api/admin/bookings')).status, 401);
  assert.equal((await post('/api/admin/login', { email: 'rene@example.cl', password: 'mala' })).status, 401);
  const l = await post('/api/admin/login', { email: 'rene@example.cl', password: 'clave-muy-segura-1' });
  assert.equal(l.status, 200);
  const cookie = l.headers.get('set-cookie').split(';')[0];
  assert.match(l.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const h = { Cookie: cookie };
  const list = await post('/api/admin/bookings', {}, h);
  assert.ok(list.body.length >= 2);
  const cross = await post('/api/admin/bookings', {}, { ...h, Origin: 'https://malicioso.example' });
  assert.equal(cross.status, 403);
  const block = await post('/api/admin/createBlock', { roomId: 'hab-twin', from: d(50), to: d(52), reason: 'Pintura' }, h);
  assert.equal(block.status, 200);
  const s = await post('/api/public/search', { checkin: d(51), checkout: d(52), adults: 1 });
  assert.equal(s.body.results.find((r) => r.room.id === 'hab-twin').available, false);
  const sum = await post('/api/admin/summary', { from: T, to: d(60) }, h);
  assert.equal(sum.status, 200);
  assert.ok(sum.body.gross > 0);
  const up = await post('/api/admin/upload', { dataUrl: 'data:image/png;base64,' + Buffer.from('no es imagen').toString('base64') }, h);
  assert.equal(up.status, 400);
  // Subida binaria (como la envía el panel): PNG mínimo con su firma.
  const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32)]);
  const bin = await fetch(base + '/api/admin/upload', { method: 'POST', headers: { ...h, 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('fachada ñ.png') }, body: png });
  const binBody = await bin.json();
  assert.equal(bin.status, 200);
  assert.match(binBody.url, /^\/uploads\/[\w-]+\.png$/);
  assert.equal(binBody.name, 'fachada ñ.png');
  const fake = await fetch(base + '/api/admin/upload', { method: 'POST', headers: { ...h, 'Content-Type': 'image/png' }, body: Buffer.from('no es imagen') });
  assert.equal(fake.status, 400);
});

test('Webpay: forma de las llamadas a la API', async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => {
    calls.push({ url, ...opts });
    if (opts.method === 'POST' && url.endsWith('/transactions')) return new Response(JSON.stringify({ token: 'tok123', url: 'https://webpay3gint.transbank.cl/webpayserver/initTransaction' }));
    if (opts.method === 'PUT') return new Response(JSON.stringify({ vci: 'TSY', amount: 27000, status: 'AUTHORIZED', buy_order: 'SEABC', card_detail: { card_number: '6623' }, authorization_code: '1213', payment_type_code: 'VD', response_code: 0, installments_number: 0 }));
    if (url.endsWith('/refunds')) return new Response(JSON.stringify({ type: 'REVERSED' }));
    return new Response('{}', { status: 404 });
  };
  const wp = createWebpay({ fetchImpl: fakeFetch });
  const c = await wp.create({ buyOrder: 'SEABC', sessionId: 's1', amount: 27000, returnUrl: 'https://x/pago/retorno' });
  assert.equal(c.token, 'tok123');
  assert.equal(calls[0].url, 'https://webpay3gint.transbank.cl/rswebpaytransaction/api/webpay/v1.2/transactions');
  assert.equal(calls[0].headers['Tbk-Api-Key-Id'], '597055555532');
  assert.deepEqual(JSON.parse(calls[0].body), { buy_order: 'SEABC', session_id: 's1', amount: 27000, return_url: 'https://x/pago/retorno' });
  const r = await wp.commit('tok123');
  assert.equal(r.paymentTypeCode, 'VD');
  assert.equal(r.cardLast4, '6623');
  assert.equal(calls[1].method, 'PUT');
  assert.equal((await wp.refund('tok123', 1000)).ok, true);
  assert.throws(() => createWebpay({ environment: 'produccion' }), /Faltan/);
});

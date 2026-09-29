// Demostración sin servidor: la misma lógica de reservas y precios corre en el
// navegador y guarda los datos solo en este navegador. Los pagos son simulados
// y las reservas de ejemplo tienen huéspedes ficticios.

import { createMemoryStore } from '../core/memory-store.js';
import { createService, ServiceError } from '../core/service.js';
import { createRpc } from '../core/rpc.js';
import { seedAll } from '../core/seed.js';
import { createSimulatedPayments } from '../core/simulated-payments.js';
import { addDays, today as todayIn } from '../core/dates.js';
import { ApiError } from './api.js';

const KEY = 'se-demo-v2';

function load() {
  try { const s = localStorage.getItem(KEY); return s ? JSON.parse(s) : null; } catch { return null; }
}
let warned = false;
function persist(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { if (!warned) { warned = true; console.warn('La demo no pudo guardar en este navegador; los cambios duran hasta recargar.'); } }
}

// Firma de demostración (en el servidor real es un HMAC con clave secreta).
function sign(code) {
  let h = 2166136261;
  for (const c of `demo:${code}`) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return `d${(h >>> 0).toString(36)}`;
}

async function seedExamples(svc, payments, store) {
  const t = todayIn();
  const d = (n) => addDays(t, n);
  const pay = async (b, cardType) => {
    const { token } = await svc.startPayment(b.code, { returnUrl: '' });
    payments.decide(token, { approve: true, cardType, last4: cardType === 'debit' ? '4051' : '8820' });
    await svc.finishPayment({ token });
  };
  const ex = (first, last, n) => ({ firstName: first, lastName: `${last} (ejemplo)`, email: `ejemplo${n}@correo-demo.cl`, phone: `+56 9 0000 00${String(n).padStart(2, '0')}`, country: 'Chile' });

  const b1 = svc.createBooking({ checkin: d(0), checkout: d(2), items: [{ roomId: 'hab-doble', adults: 2 }], guest: { ...ex('Camila', 'Fuentes', 1), arrivalTime: '17:00' }, acceptTerms: true });
  await pay(b1, 'debit');
  const b2 = svc.createBooking({ checkin: d(6), checkout: d(9), items: [{ roomId: 'cabana', adults: 2, children: 1 }], guest: ex('Matías', 'Henríquez', 2), acceptTerms: true });
  await pay(b2, 'credit');
  const b3 = svc.createBooking({ checkin: d(12), checkout: d(20), items: [{ roomId: 'hab-triple', adults: 2 }], guest: { ...ex('Laura', 'Schmidt', 3), country: 'Alemania' }, acceptTerms: true });
  await pay(b3, 'credit');
  const b4 = svc.admin.createBooking({ checkin: d(3), checkout: d(4), items: [{ roomId: 'hab-twin', adults: 1 }], guest: ex('Jorge', 'Painemal', 4), notesInternal: 'Reservó por teléfono. Paga en efectivo.' });
  const row = svc.admin.bookings({ q: b4.code })[0];
  svc.admin.recordPayment(row.id, { amount: 20000, method: 'transferencia', note: 'Abono por transferencia' });
  svc.admin.createBlock({ roomId: 'hab-privado', from: d(1), to: d(3), reason: 'Mantención' });
  const b5 = svc.createBooking({ checkin: d(25), checkout: d(27), items: [{ roomId: 'hab-privado', adults: 2 }], guest: ex('Valentina', 'Muñoz', 5), acceptTerms: true });
  await pay(b5, 'debit');
  await svc.cancelBooking(b5.code, ex('', '', 5).email, { reason: 'Cambio de planes (ejemplo)' });
}

export async function createDemoBackend() {
  let saved = load();
  const payments = createSimulatedPayments();
  let store = createMemoryStore(saved, { persist });
  let svc = createService({ store, payments });
  let rpc = createRpc({ svc, sign: async (c) => sign(c), returnUrl: () => '' });

  async function fresh() {
    try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
    store = createMemoryStore(null, { persist });
    seedAll(store, { demo: true });
    svc = createService({ store, payments });
    rpc = createRpc({ svc, sign: async (c) => sign(c), returnUrl: () => '' });
    await seedExamples(svc, payments, store);
  }
  if (!saved) await fresh();

  let loggedIn = false;
  try { loggedIn = sessionStorage.getItem('se-demo-admin') === '1'; } catch { /* nada */ }

  const wrap = async (fn) => {
    try { return structuredClone(await fn()); }
    catch (e) {
      if (e instanceof ServiceError) throw new ApiError(e.message, { status: e.status, code: e.code, fields: e.fields });
      console.error(e);
      throw new ApiError('Algo falló en la demo.');
    }
  };

  return {
    mode: 'demo',
    pub: (m, a = {}) => wrap(() => {
      if (!Object.hasOwn(rpc.publicApi, m)) throw new ServiceError('x', 'No encontrado', 404);
      return rpc.publicApi[m](a);
    }),
    admin: (m, a = {}) => wrap(async () => {
      if (m === 'login') {
        if (!a.email || !a.password) throw new ServiceError('login', 'Escribe correo y contraseña.', 401);
        loggedIn = true;
        try { sessionStorage.setItem('se-demo-admin', '1'); } catch { /* nada */ }
        return { admin: { email: a.email, name: 'Rene' } };
      }
      if (!loggedIn) throw new ServiceError('auth', 'Inicia sesión para continuar.', 401);
      if (m === 'logout') { loggedIn = false; try { sessionStorage.removeItem('se-demo-admin'); } catch { /* nada */ } return { ok: true }; }
      if (m === 'me') return { admin: { email: 'rene@demo', name: 'Rene' }, environment: 'simulado', server: false };
      if (m === 'upload') return { url: a.dataUrl, name: a.name };
      if (m === 'changePassword' || m === 'sendQueuedEmails') return { ok: true, demo: true };
      if (m === 'resetDemo') { await fresh(); return { ok: true }; }
      if (!Object.hasOwn(rpc.adminApi, m)) throw new ServiceError('x', 'No encontrado', 404);
      return rpc.adminApi[m](a);
    }),
    goToPayment({ url }) { location.hash = url.replace(/^#/, ''); },
    gateway: {
      info: (token) => payments.info(token),
      async finish(token, decision) {
        return wrap(async () => {
          if (decision === 'abort') {
            const r = await svc.finishPayment({ token, aborted: true });
            return { code: r.booking.code, token: sign(r.booking.code), result: r.payment };
          }
          payments.decide(token, decision === 'reject' ? { approve: false } : { approve: true, cardType: decision });
          const r = await svc.finishPayment({ token });
          return { code: r.booking.code, token: sign(r.booking.code), result: r.payment };
        });
      },
    },
  };
}

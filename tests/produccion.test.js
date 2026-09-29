import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createApp } from '../server/index.js';
import { addDays, today } from '../core/dates.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

async function start(env) {
  const dir = mkdtempSync(join(tmpdir(), 'se-prod-'));
  const app = await createApp({ PORT: '0', DATA_DIR: dir, PAYMENTS: 'simulado', ...env });
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  app.cfg.baseUrl = base;
  return { app, base, dir, done: () => { app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const post = (base, path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) });

test('base vacía: no siembra nada y muestra cómo iniciarla', async () => {
  const s = await start({});
  try {
    const r = await fetch(s.base + '/');
    assert.equal(r.status, 503);
    assert.match(await r.text(), /INICIAR_BASE/);
    assert.equal((await (await fetch(s.base + '/salud')).json()).base, 'vacia');
    assert.equal(s.app.store.list('bookings').length, 0);
  } finally { s.done(); }
});

test('INICIAR_BASE carga solo datos reales, sin ejemplos', async () => {
  const s = await start({ INICIAR_BASE: '1' });
  try {
    const st = s.app.store;
    assert.equal(st.list('rooms').length, 5);
    assert.equal(st.list('bookings').length, 0);
    assert.equal(st.list('payments').length, 0);
    assert.ok(st.list('seasons').every((x) => x.active === false), 'temporadas en borrador');
    assert.ok(st.list('discounts').every((x) => x.active === false), 'descuentos en borrador');
    assert.ok(st.list('charges').every((x) => x.active === false), 'cargos sin precio apagados');
    assert.equal(st.getSettings().demo, false);
    assert.equal((await fetch(s.base + '/')).status, 200);
  } finally { s.done(); }
});

test('tareas programadas: protegidas por clave', async () => {
  const s = await start({ INICIAR_BASE: '1', TAREAS_SECRET: 'una-frase-larga-de-prueba' });
  try {
    assert.equal((await post(s.base, '/tareas/vencer', {})).status, 403);
    assert.equal((await post(s.base, '/tareas/vencer', {}, { 'X-Tarea-Clave': 'otra' })).status, 403);
    assert.equal((await fetch(s.base + '/tareas/vencer', { headers: { 'X-Tarea-Clave': 'una-frase-larga-de-prueba' } })).status, 405);
    assert.equal((await post(s.base, '/tareas/nada', {}, { 'X-Tarea-Clave': 'una-frase-larga-de-prueba' })).status, 404);
    for (const t of ['vencer', 'correos', 'ical']) {
      const r = await post(s.base, `/tareas/${t}`, {}, { 'X-Tarea-Clave': 'una-frase-larga-de-prueba' });
      assert.equal(r.status, 200, t);
    }
    const r = await post(s.base, '/tareas/respaldo', {}, { 'X-Tarea-Clave': 'una-frase-larga-de-prueba' });
    const { name } = await r.json();
    assert.match(name, /^reservas-\d{4}-\d{2}-\d{2}\.db$/);
    assert.ok(existsSync(join(s.dir, 'respaldos', name)));
  } finally { s.done(); }
});

test('sin TAREAS_SECRET las rutas de tareas no existen', async () => {
  const s = await start({ INICIAR_BASE: '1' });
  try {
    assert.equal((await post(s.base, '/tareas/respaldo', {}, { 'X-Tarea-Clave': '' })).status, 404);
  } finally { s.done(); }
});

test('respaldos: guarda los últimos 14 y solo el panel los descarga', async () => {
  const s = await start({ INICIAR_BASE: '1', ADMIN_EMAIL: 'rene@example.cl', ADMIN_PASSWORD: 'clave-muy-segura-1' });
  try {
    await s.app.backupNow();
    for (let i = 0; i < 16; i++) writeFileSync(join(s.dir, 'respaldos', `reservas-2026-01-${String(i + 1).padStart(2, '0')}.db`), 'x');
    await s.app.backupNow();
    assert.equal((await s.app.listBackups()).length, 14);
    const name = (await s.app.listBackups())[0].name;
    assert.equal((await fetch(`${s.base}/panel/respaldos/${name}`, { redirect: 'manual' })).status, 302, 'sin sesión no descarga');
    const login = await post(s.base, '/api/admin/login', { email: 'rene@example.cl', password: 'clave-muy-segura-1' });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const ok = await fetch(`${s.base}/panel/respaldos/${name}`, { headers: { Cookie: cookie } });
    assert.equal(ok.status, 200);
    assert.equal((await fetch(`${s.base}/panel/respaldos/..%2Freservas.db`, { headers: { Cookie: cookie } })).status, 404);
    // Cambiar el correo exige la contraseña actual.
    const bad = await post(s.base, '/api/admin/changeEmail', { email: 'nuevo@example.cl', password: 'otra' }, { Cookie: cookie });
    assert.equal(bad.status, 400);
    const good = await post(s.base, '/api/admin/changeEmail', { email: 'nuevo@example.cl', password: 'clave-muy-segura-1' }, { Cookie: cookie });
    assert.equal((await good.json()).admin.email, 'nuevo@example.cl');
    assert.equal((await post(s.base, '/api/admin/login', { email: 'nuevo@example.cl', password: 'clave-muy-segura-1' })).status, 200);
  } finally { s.done(); }
});

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, opts);
    let out = ''; let err = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

test('dos procesos reservando la misma noche al mismo tiempo: gana uno', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'se-race-'));
  const db = join(dir, 'reservas.db');
  try {
    // Base iniciada una vez, como en el hosting.
    const s = await createApp({ PORT: '0', DATA_DIR: dir, PAYMENTS: 'simulado', INICIAR_BASE: '1' });
    s.close();
    const night = addDays(today(), 30);
    const startAt = Date.now() + 600;
    const script = `
      import { openStore } from ${JSON.stringify(join(ROOT, 'server/store-sqlite.js'))};
      import { createService } from ${JSON.stringify(join(ROOT, 'core/service.js'))};
      import { createSimulatedPayments } from ${JSON.stringify(join(ROOT, 'core/simulated-payments.js'))};
      const store = openStore(${JSON.stringify(db)});
      const svc = createService({ store, payments: createSimulatedPayments() });
      while (Date.now() < ${startAt}) {}
      try {
        svc.createBooking({ checkin: ${JSON.stringify(night)}, checkout: ${JSON.stringify(addDays(night, 2))}, items: [{ roomId: 'hab-doble', adults: 2 }], guest: { firstName: 'P', lastName: process.pid + '', email: 'p' + process.pid + '@example.cl', phone: '+56 9 1111 2222' }, acceptTerms: true });
        console.log('ok');
      } catch (e) { console.log(e.status === 409 ? 'conflicto' : 'error ' + e.message); }
    `;
    const args = ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', script];
    const results = await Promise.all([run(process.execPath, args), run(process.execPath, args)]);
    const outs = results.map((r) => r.out.trim()).sort();
    assert.deepEqual(outs, ['conflicto', 'ok'], JSON.stringify(results));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('app.cjs arranca como lo hace cPanel (require) y explica si falla la carpeta de datos', async () => {
  const port = String(43000 + Math.floor(Math.random() * 1000));
  // DATA_DIR bajo un archivo (no una carpeta): no se puede crear.
  const tmp = mkdtempSync(join(tmpdir(), 'se-bad-'));
  writeFileSync(join(tmp, 'archivo'), 'x');
  const bad = spawn(process.execPath, ['-e', `require(${JSON.stringify(join(ROOT, 'app.cjs'))})`], { env: { ...process.env, PORT: port, DATA_DIR: join(tmp, 'archivo', 'datos') } });
  try {
    let res;
    for (let i = 0; i < 40 && !res; i++) {
      await new Promise((r) => setTimeout(r, 100));
      res = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
    }
    assert.equal(res?.status, 503);
    assert.match(await res.text(), /carpeta de datos/);
  } finally { bad.kill(); rmSync(tmp, { recursive: true, force: true }); }
});

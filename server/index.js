// Servidor de Santa Elena de Maipo Home. Sin dependencias externas: Node 22+
// con su SQLite integrado. Arranque: `npm start` (ver README.md).

import http from 'node:http';
import { readFile, writeFile, mkdir, stat, readdir, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual, createHash } from 'node:crypto';

import { openStore } from './store-sqlite.js';
import { createService, ServiceError } from '../core/service.js';
import { createRpc } from '../core/rpc.js';
import { seedProduction } from '../core/seed.js';
import { createWebpay } from './payments/webpay.js';
import { createSimulatedPayments } from '../core/simulated-payments.js';
import { createAuth, signer } from './auth.js';
import { startMailer } from './mailer.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export async function createApp(env = process.env) {
  const cfg = {
    port: +(env.PORT || 3000),
    baseUrl: (env.BASE_URL || `http://localhost:${env.PORT || 3000}`).replace(/\/$/, ''),
    dataDir: env.DATA_DIR || join(ROOT, 'data'),
    payments: env.PAYMENTS || 'webpay', // 'webpay' | 'simulado'
    webpayEnv: env.WEBPAY_ENV || 'integracion',
  };
  await mkdir(join(cfg.dataDir, 'uploads'), { recursive: true });

  // Secreto para firmar enlaces de reserva: se crea una vez y se guarda.
  let secret = env.SECRET;
  const secretFile = join(cfg.dataDir, '.secret');
  if (!secret) {
    if (existsSync(secretFile)) secret = (await readFile(secretFile, 'utf8')).trim();
    else { secret = randomBytes(32).toString('hex'); await writeFile(secretFile, secret, { mode: 0o600 }); }
  }
  const sign = signer(secret);

  const store = openStore(env.DB_FILE || join(cfg.dataDir, 'reservas.db'));
  // La base parte vacía. Solo se cargan los datos reales del hostal si se pide
  // explícitamente (INICIAR_BASE=1), para no sembrar nada por accidente.
  if (!store.list('rooms').length && env.INICIAR_BASE === '1') seedProduction(store);
  const needsSetup = () => !store.list('rooms').length;

  const payments = cfg.payments === 'simulado'
    ? createSimulatedPayments({ urlFor: (token) => `${cfg.baseUrl}/pago-simulado/${token}` })
    : createWebpay({ environment: cfg.webpayEnv, commerceCode: env.WEBPAY_COMMERCE_CODE, apiKey: env.WEBPAY_API_KEY });
  const s0 = store.getSettings();
  if (s0.payment) store.saveSettings({ ...s0, payment: { ...s0.payment, environment: cfg.payments === 'simulado' ? 'simulado' : cfg.webpayEnv } });

  const svc = createService({ store, payments });
  const rpc = createRpc({ svc, sign, returnUrl: () => `${cfg.baseUrl}/pago/retorno` });
  const secure = cfg.baseUrl.startsWith('https://');
  const auth = createAuth({ store, secure });
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && !auth.hasAdmins()) auth.createAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: 'Administración' });

  // Con TAREAS_SECRET definido (hosting con cron, como cPanel) las tareas
  // repetidas las dispara el cron en /tareas/*; sin él, corren con relojes internos.
  const useTimers = !env.TAREAS_SECRET;
  const mailer = startMailer({ timers: useTimers, store, settingsFn: () => store.getSettings(), baseUrl: cfg.baseUrl, sign, apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM || 'Santa Elena de Maipo Home <reservas@example.cl>' });

  // ---------- Respaldos ----------
  const backupDir = join(cfg.dataDir, 'respaldos');
  const BACKUP_RE = /^reservas-\d{4}-\d{2}-\d{2}(?:-\d{6})?\.db$/;
  async function listBackups() {
    await mkdir(backupDir, { recursive: true });
    const names = (await readdir(backupDir)).filter((n) => BACKUP_RE.test(n)).sort().reverse();
    return Promise.all(names.map(async (name) => { const st = await stat(join(backupDir, name)); return { name, size: st.size, at: st.mtime.toISOString() }; }));
  }
  async function backupNow({ keep = 14, suffix = '' } = {}) {
    await mkdir(backupDir, { recursive: true });
    const name = `reservas-${new Date().toISOString().slice(0, 10)}${suffix}.db`;
    const file = join(backupDir, name);
    if (existsSync(file)) await unlink(file);
    // VACUUM INTO copia la base de forma consistente aunque esté en uso.
    store.db.prepare('VACUUM INTO ?').run(file);
    const all = await listBackups();
    for (const b of all.slice(keep)) await unlink(join(backupDir, b.name)).catch(() => {});
    return { name };
  }

  // ---------- Tareas programadas (cron) ----------
  const tareaKey = env.TAREAS_SECRET ? createHash('sha256').update(env.TAREAS_SECRET).digest() : null;
  function tareaAuthorized(req) {
    if (!tareaKey) return false;
    const got = createHash('sha256').update(String(req.headers['x-tarea-clave'] || '')).digest();
    return timingSafeEqual(got, tareaKey);
  }
  const TAREAS = {
    correos: async () => { await mailer.tick(); return { ok: true, configured: !!env.RESEND_API_KEY }; },
    vencer: async () => { svc.sweepExpired(); return { ok: true }; },
    respaldo: async () => backupNow(),
  };

  // ---------- Límite de peticiones por IP ----------
  const buckets = new Map();
  function limited(ip, group, max, perMs) {
    const key = `${group}|${ip}`;
    const now = Date.now();
    const b = buckets.get(key) || { n: 0, reset: now + perMs };
    if (now > b.reset) { b.n = 0; b.reset = now + perMs; }
    b.n++;
    buckets.set(key, b);
    if (buckets.size > 20000) buckets.clear();
    return b.n > max;
  }

  // ---------- Utilidades HTTP ----------
  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; form-action 'self' https://webpay3g.transbank.cl https://webpay3gint.transbank.cl; frame-ancestors 'none'; base-uri 'self'",
    ...(secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
  function send(res, status, body, headers = {}) {
    res.writeHead(status, { ...SEC_HEADERS, ...headers });
    res.end(body);
  }
  const json = (res, status, data, headers = {}) => send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });

  async function readBody(req, max = 200_000) {
    let size = 0;
    const chunks = [];
    for await (const c of req) {
      size += c.length;
      if (size > max) throw new ServiceError('tamano', 'La solicitud es demasiado grande.', 413);
      chunks.push(c);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  async function readJson(req, max) {
    const t = await readBody(req, max);
    try { return t ? JSON.parse(t) : {}; } catch { throw new ServiceError('json', 'Solicitud inválida.'); }
  }
  async function readForm(req) {
    return Object.fromEntries(new URLSearchParams(await readBody(req, 20_000)));
  }
  const ipOf = (req) => (env.TRUST_PROXY ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '') || req.socket.remoteAddress || '?';

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true; // navegadores siempre la envían en POST con fetch; SameSite=Strict cubre el resto
    return origin === cfg.baseUrl || origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  }

  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json' };
  async function serveFile(res, file, cache = 'public, max-age=300') {
    try {
      const st = await stat(file);
      if (!st.isFile()) return false;
      send(res, 200, await readFile(file), { 'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': cache });
      return true;
    } catch { return false; }
  }
  function safeJoin(base, p) {
    const full = normalize(join(base, decodeURIComponent(p)));
    return full.startsWith(base) ? full : null;
  }

  // Webpay devuelve al huésped aquí (GET o POST según el caso).
  async function paymentReturn(req, res, params) {
    const token = params.token_ws || params.TBK_TOKEN;
    let dest = `${cfg.baseUrl}/#/inicio`;
    try {
      if (!token) {
        // Tiempo agotado en el formulario de pago: Webpay no envía token.
        const p = params.TBK_ID_SESION ? store.get('bookings', params.TBK_ID_SESION) : null;
        if (p) dest = `${cfg.baseUrl}/#/reserva/${p.code}/${await sign(p.code)}/anulado`;
      } else {
        const r = await svc.finishPayment({ token, aborted: !params.token_ws });
        const code = r.booking.code;
        dest = `${cfg.baseUrl}/#/reserva/${code}/${await sign(code)}/${r.payment}`;
      }
    } catch (e) {
      console.error('retorno de pago', e);
      dest = `${cfg.baseUrl}/#/error-pago`;
    }
    send(res, 303, '', { Location: dest });
  }

  function simulatedGatewayPage(token) {
    const t = payments.info?.(token);
    if (!t) return null;
    return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pago simulado</title>
<style>body{font-family:system-ui,sans-serif;background:#f1f3f5;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px}main{background:#fff;max-width:420px;width:100%;padding:24px;border-radius:12px;box-shadow:0 4px 24px #0001}h1{font-size:20px}.b{display:block;width:100%;padding:12px;margin-top:10px;border-radius:8px;border:1px solid #ccc;font-size:16px;cursor:pointer;background:#fff}.ok{background:#1f6b3a;color:#fff;border:0}.w{background:#fff4d6;padding:10px;border-radius:8px;font-size:14px}</style>
<main><p class="w">Pasarela <b>simulada</b> para pruebas. No se cobra dinero real.</p><h1>Pagar $${t.amount.toLocaleString('es-CL')} CLP</h1><p>Orden ${t.buyOrder}</p>
<form method="post"><input type="hidden" name="token" value="${token}">
<button class="b ok" name="r" value="debit">Aprobar con débito</button>
<button class="b ok" name="r" value="credit">Aprobar con crédito</button>
<button class="b" name="r" value="reject">Rechazar pago</button>
<button class="b" name="r" value="abort">Anular y volver</button></form></main></html>`;
  }

  // ---------- Rutas ----------
  async function handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    const ip = ipOf(req);

    if (path === '/salud') return json(res, 200, { ok: true, base: needsSetup() ? 'vacia' : 'lista' });

    const tareaMatch = /^\/tareas\/([a-z]+)$/.exec(path);
    if (tareaMatch) {
      if (!tareaKey || !Object.hasOwn(TAREAS, tareaMatch[1])) return send(res, 404, 'No encontrado');
      if (req.method !== 'POST') return json(res, 405, { error: 'Usa POST.' });
      if (!tareaAuthorized(req)) return json(res, 403, { error: 'Clave inválida.' });
      try { return json(res, 200, await TAREAS[tareaMatch[1]]()); } catch (e) { console.error('tarea', tareaMatch[1], e); return json(res, 500, { error: e.message }); }
    }

    if (needsSetup() && !path.startsWith('/core/') && !/\.(js|css|svg|ico|png|woff2)$/.test(path)) {
      return send(res, 503, setupPage(), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    }

    if (path === '/pago/retorno') {
      const params = req.method === 'POST' ? await readForm(req) : Object.fromEntries(url.searchParams);
      return paymentReturn(req, res, params);
    }

    if (path.startsWith('/pago-simulado/') && cfg.payments === 'simulado') {
      const token = path.split('/')[2];
      if (req.method === 'POST') {
        const f = await readForm(req);
        // Llegada desde /pago/ir (POST con token_ws, como hace Webpay): mostrar el formulario.
        if (!f.r) {
          const page = simulatedGatewayPage(token);
          return page ? send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' }) : send(res, 404, 'No encontrado');
        }
        if (f.r === 'abort') return send(res, 303, '', { Location: `/pago/retorno?TBK_TOKEN=${encodeURIComponent(token)}` });
        payments.decide(token, { approve: f.r !== 'reject', cardType: f.r === 'credit' ? 'credit' : 'debit' });
        return send(res, 303, '', { Location: `/pago/retorno?token_ws=${encodeURIComponent(token)}` });
      }
      const page = simulatedGatewayPage(token);
      return page ? send(res, 200, page, { 'Content-Type': 'text/html; charset=utf-8' }) : send(res, 404, 'No encontrado');
    }

    // Redirección al formulario de Webpay (requiere POST con token_ws).
    if (path === '/pago/ir' && req.method === 'GET') {
      const to = url.searchParams.get('url') || '';
      const token = url.searchParams.get('token') || '';
      if (!/^https:\/\/webpay3g(int)?\.transbank\.cl\//.test(to) && !to.startsWith(`${cfg.baseUrl}/pago-simulado/`)) return send(res, 400, 'Destino inválido');
      const h = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
      return send(res, 200, `<!doctype html><meta charset="utf-8"><title>Redirigiendo a Webpay…</title><body style="font-family:sans-serif;padding:24px">
<form id="f" method="post" action="${h(to)}"><input type="hidden" name="token_ws" value="${h(token)}"><p>Te estamos llevando al pago seguro de Webpay…</p><button>Continuar al pago</button></form>
<script src="/pago-ir.js"></script>`, { 'Content-Type': 'text/html; charset=utf-8' });
    }

    if (path.startsWith('/api/')) {
      if (req.method !== 'POST') return json(res, 405, { error: 'Usa POST.' });
      if (!sameOrigin(req)) return json(res, 403, { error: 'Origen no permitido.' });
      try {
        const [, , area, method] = path.split('/');
        if (area === 'public') {
          const fn = Object.hasOwn(rpc.publicApi, method) ? rpc.publicApi[method] : null;
          if (!fn) return json(res, 404, { error: 'No encontrado.' });
          const heavy = ['createBooking', 'getBooking', 'cancelBooking', 'changeBooking', 'startPayment'].includes(method);
          if (limited(ip, heavy ? 'pub-heavy' : 'pub', heavy ? 30 : 240, 10 * 60000)) return json(res, 429, { error: 'Demasiadas solicitudes. Espera unos minutos.' });
          return json(res, 200, await fn(await readJson(req)));
        }
        if (area === 'admin') {
          if (method === 'login') {
            if (limited(ip, 'login', 10, 15 * 60000)) return json(res, 429, { error: 'Demasiados intentos. Espera 15 minutos.' });
            const b = await readJson(req);
            const r = auth.login(b.email, b.password);
            if (!r) return json(res, 401, { error: 'Correo o contraseña incorrectos.' });
            return json(res, 200, { admin: r.admin }, { 'Set-Cookie': auth.cookie(r.token) });
          }
          const who = auth.fromRequest(req);
          if (!who) return json(res, 401, { error: 'Inicia sesión para continuar.' });
          if (method === 'logout') { auth.logout(req); return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookie('', 0) }); }
          if (method === 'me') return json(res, 200, { admin: who.admin, environment: store.getSettings().payment?.environment, server: true, mail: { connected: !!env.RESEND_API_KEY, from: env.MAIL_FROM || '' } });
          if (method === 'mailTest') {
            const r = await mailer.test(who.admin.email);
            return r.ok ? json(res, 200, { ok: true, to: who.admin.email }) : json(res, 400, { error: `No se pudo enviar: ${r.error}` });
          }
          if (method === 'mailRetry') { const n = mailer.retry(); await mailer.tick(); return json(res, 200, { retried: n }); }
          if (method === 'upload') return json(res, 200, await upload(await readJson(req, 12_000_000)));
          if (method === 'changePassword') {
            const b = await readJson(req);
            auth.createAdmin({ email: who.admin.email, password: b.password });
            return json(res, 200, { ok: true });
          }
          if (method === 'changeEmail') {
            const b = await readJson(req);
            if (!auth.checkPassword(who.admin.id, b.password)) return json(res, 400, { error: 'La contraseña actual no es correcta.' });
            const admin = auth.changeEmail(who.admin.id, b.email);
            return json(res, 200, { admin });
          }
          if (method === 'backups') return json(res, 200, { backups: await listBackups(), dir: backupDir });
          if (method === 'backupNow') {
            const r = await backupNow({ suffix: `-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}` });
            store.insert('audit', { at: new Date().toISOString(), adminId: who.admin.id, method, ip });
            return json(res, 200, r);
          }
          if (method === 'sendQueuedEmails') { await mailer.tick(); return json(res, 200, { ok: true, configured: !!env.RESEND_API_KEY }); }
          const fn = Object.hasOwn(rpc.adminApi, method) ? rpc.adminApi[method] : null;
          if (!fn) return json(res, 404, { error: 'No encontrado.' });
          const out = await fn(await readJson(req, 2_000_000));
          store.insert('audit', { at: new Date().toISOString(), adminId: who.admin.id, method, ip });
          return json(res, 200, out);
        }
        return json(res, 404, { error: 'No encontrado.' });
      } catch (e) {
        if (e instanceof ServiceError) return json(res, e.status, { error: e.message, code: e.code, fields: e.fields });
        console.error(e);
        return json(res, 500, { error: 'Algo falló de nuestro lado. Intenta de nuevo o escríbenos.' });
      }
    }

    if (path.startsWith('/uploads/')) {
      const f = safeJoin(join(cfg.dataDir, 'uploads'), path.slice('/uploads/'.length));
      if (f && await serveFile(res, f, 'public, max-age=31536000, immutable')) return;
      return send(res, 404, 'No encontrado');
    }

    const dl = /^\/panel\/respaldos\/([\w.-]+)$/.exec(path);
    if (dl) {
      if (!auth.fromRequest(req)) return send(res, 302, '', { Location: '/#/panel' });
      if (!BACKUP_RE.test(dl[1])) return send(res, 404, 'No encontrado');
      try {
        const buf = await readFile(join(backupDir, dl[1]));
        return send(res, 200, buf, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="${dl[1]}"`, 'Cache-Control': 'no-store' });
      } catch { return send(res, 404, 'No encontrado'); }
    }

    if (path === '/admin' || path === '/admin/' || path === '/panel') return send(res, 302, '', { Location: '/#/panel' });
    const webRoot = join(ROOT, 'web');
    const file = path === '/' ? join(webRoot, 'index.html') : safeJoin(webRoot, path.slice(1));
    const coreFile = path.startsWith('/core/') ? safeJoin(join(ROOT, 'core'), path.slice('/core/'.length)) : null;
    if (coreFile && await serveFile(res, coreFile)) return;
    if (file && await serveFile(res, file)) return;
    return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  function setupPage() {
    return `<!doctype html><html lang="es-CL"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Falta iniciar la base</title>
<style>body{font-family:system-ui,sans-serif;background:#eef1ec;margin:0;display:grid;place-items:center;min-height:100vh;padding:16px;color:#1b2a22}main{background:#fff;max-width:560px;padding:28px;border-radius:14px;box-shadow:0 4px 24px #0001;line-height:1.5}code{background:#eef1ec;padding:2px 6px;border-radius:4px}</style>
<main><h1>El sitio está instalado, falta iniciar la base de datos</h1>
<p>La base está vacía. Para cargar las habitaciones y las políticas del hostal:</p>
<ol><li>En cPanel → <b>Setup Node.js App</b>, edita la aplicación.</li>
<li>Agrega la variable <code>INICIAR_BASE</code> con el valor <code>1</code> y guarda.</li>
<li>Aprieta <b>Restart</b> y recarga esta página.</li>
<li>Después borra la variable <code>INICIAR_BASE</code> (no hace falta dejarla).</li></ol>
<p>No se crean reservas ni datos de ejemplo.</p></main></html>`;
  }

  async function upload({ dataUrl, name = '' }) {
    const m = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
    if (!m) throw new ServiceError('imagen', 'Sube una foto JPG, PNG o WebP.');
    const buf = Buffer.from(m[3], 'base64');
    const magic = buf.subarray(0, 12).toString('hex');
    const okMagic = (m[2] === 'jpeg' && magic.startsWith('ffd8ff')) || (m[2] === 'png' && magic.startsWith('89504e47')) || (m[2] === 'webp' && buf.subarray(8, 12).toString() === 'WEBP');
    if (!okMagic) throw new ServiceError('imagen', 'El archivo no parece una imagen válida.');
    const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
    const file = `${Date.now().toString(36)}-${randomBytes(5).toString('hex')}.${ext}`;
    await writeFile(join(cfg.dataDir, 'uploads', file), buf);
    return { url: `/uploads/${file}`, name: String(name).slice(0, 100) };
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) send(res, 500, 'Error'); });
  });
  server.headersTimeout = 20000;
  server.requestTimeout = 60000;

  return { server, cfg, store, svc, auth, payments, backupNow, listBackups, close: () => { server.close(); store.close(); mailer.stop(); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.server.listen(app.cfg.port, () => {
    console.log(`Santa Elena de Maipo Home en ${app.cfg.baseUrl}`);
    console.log(`Pagos: ${app.cfg.payments === 'simulado' ? 'SIMULADOS (sin dinero real)' : `Webpay ${app.cfg.webpayEnv}`}`);
    if (!app.auth.hasAdmins()) console.log('Aún no hay usuario del panel. Crea uno con: npm run admin:crear -- correo@dominio.cl');
  });
}

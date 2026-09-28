// Servidor de Santa Elena de Maipo Home. Sin dependencias externas: Node 22+
// con su SQLite integrado. Arranque: `npm start` (ver README.md).

import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

import { openStore } from './store-sqlite.js';
import { createService, ServiceError } from '../core/service.js';
import { createRpc } from '../core/rpc.js';
import { seedAll } from '../core/seed.js';
import { createWebpay } from './payments/webpay.js';
import { createSimulatedPayments } from '../core/simulated-payments.js';
import { createAuth, signer } from './auth.js';
import { exportRoomCalendar, parseIcs, applyImport } from './ical.js';
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
  if (!store.list('rooms').length) seedAll(store);

  const payments = cfg.payments === 'simulado'
    ? createSimulatedPayments({ urlFor: (token) => `${cfg.baseUrl}/pago-simulado/${token}` })
    : createWebpay({ environment: cfg.webpayEnv, commerceCode: env.WEBPAY_COMMERCE_CODE, apiKey: env.WEBPAY_API_KEY });
  const s0 = store.getSettings();
  store.saveSettings({ ...s0, payment: { ...s0.payment, environment: cfg.payments === 'simulado' ? 'simulado' : cfg.webpayEnv } });

  const svc = createService({ store, payments });
  const rpc = createRpc({ svc, sign, returnUrl: () => `${cfg.baseUrl}/pago/retorno` });
  const secure = cfg.baseUrl.startsWith('https://');
  const auth = createAuth({ store, secure });
  if (env.ADMIN_EMAIL && env.ADMIN_PASSWORD && !auth.hasAdmins()) auth.createAdmin({ email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, name: 'Administración' });

  const mailer = startMailer({ store, settingsFn: () => store.getSettings(), baseUrl: cfg.baseUrl, sign, apiKey: env.RESEND_API_KEY, from: env.MAIL_FROM || 'Santa Elena de Maipo Home <reservas@example.cl>' });

  // ---------- iCal ----------
  async function syncIcal() {
    const s = store.getSettings();
    const report = [];
    for (const [roomId, url] of Object.entries(s.ical || {})) {
      if (!url) continue;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const r = applyImport({ store, svc, roomId, events: parseIcs(await res.text()), today: svc.today() });
        report.push({ roomId, ok: true, ...r });
      } catch (e) {
        report.push({ roomId, ok: false, error: e.message });
      }
    }
    store.saveSettings({ ...store.getSettings(), icalLastSync: { at: new Date().toISOString(), report } });
    return report;
  }
  const icalTimer = setInterval(() => syncIcal().catch(() => {}), 15 * 60000);
  icalTimer.unref();

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

    if (path === '/salud') return json(res, 200, { ok: true });

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

    const icalMatch = /^\/ical\/([\w-]+)\.ics$/.exec(path);
    if (icalMatch) {
      const roomId = icalMatch[1];
      if (url.searchParams.get('k') !== sign(`ical:${roomId}`)) return send(res, 403, 'Enlace inválido');
      const room = store.get('rooms', roomId);
      if (!room) return send(res, 404, 'No encontrado');
      return send(res, 200, exportRoomCalendar({ store, roomId, name: room.name }), { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' });
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
          if (method === 'me') return json(res, 200, { admin: who.admin, environment: store.getSettings().payment?.environment, server: true });
          if (method === 'upload') return json(res, 200, await upload(await readJson(req, 12_000_000)));
          if (method === 'icalSync') return json(res, 200, { report: await syncIcal() });
          if (method === 'icalLinks') {
            return json(res, 200, { links: store.list('rooms').map((r) => ({ roomId: r.id, name: r.name, url: `${cfg.baseUrl}/ical/${r.id}.ics?k=${sign(`ical:${r.id}`)}` })), lastSync: store.getSettings().icalLastSync || null });
          }
          if (method === 'changePassword') {
            const b = await readJson(req);
            auth.createAdmin({ email: who.admin.email, password: b.password });
            return json(res, 200, { ok: true });
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

    if (path === '/admin' || path === '/admin/' || path === '/panel') return send(res, 302, '', { Location: '/#/panel' });
    const webRoot = join(ROOT, 'web');
    const file = path === '/' ? join(webRoot, 'index.html') : safeJoin(webRoot, path.slice(1));
    const coreFile = path.startsWith('/core/') ? safeJoin(join(ROOT, 'core'), path.slice('/core/'.length)) : null;
    if (coreFile && await serveFile(res, coreFile)) return;
    if (file && await serveFile(res, file)) return;
    return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
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

  return { server, cfg, store, svc, auth, payments, syncIcal, close: () => { server.close(); store.close(); clearInterval(icalTimer); } };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await createApp();
  app.server.listen(app.cfg.port, () => {
    console.log(`Santa Elena de Maipo Home en ${app.cfg.baseUrl}`);
    console.log(`Pagos: ${app.cfg.payments === 'simulado' ? 'SIMULADOS (sin dinero real)' : `Webpay ${app.cfg.webpayEnv}`}`);
    if (!app.auth.hasAdmins()) console.log('Aún no hay usuario del panel. Crea uno con: npm run admin:crear -- correo@dominio.cl');
  });
}

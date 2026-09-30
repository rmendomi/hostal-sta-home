// Correos al huésped. Se guardan en una cola (tabla outbox) y se envían con
// Resend si hay RESEND_API_KEY (plan gratuito: 3.000 correos al mes). Sin
// llave, quedan en cola y el panel los muestra como "no enviados".

import { clp } from '../core/money.js';
import { humanLong } from '../core/dates.js';

const h = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderEmail({ booking, settings, kind, manageUrl }) {
  const b = booking;
  const q = b.quote;
  const biz = settings.business;
  const intro = {
    confirmacion: `Hola ${h(b.guest.firstName)}, tu reserva está confirmada. Te esperamos.`,
    cancelacion: `Hola ${h(b.guest.firstName)}, cancelamos tu reserva como pediste.${b.amountRefunded ? ` Devolveremos ${clp(b.amountRefunded)} al mismo medio de pago.` : ''}`,
    cambio: `Hola ${h(b.guest.firstName)}, cambiamos las fechas de tu reserva.`,
    revision: `Hola ${h(b.guest.firstName)}, recibimos tu pago pero las noches se liberaron antes de que terminara. Te contactaremos hoy para reubicarte o devolverte el dinero.`,
  }[kind];
  const rows = [
    ['Llegada', `${humanLong(b.checkin)}, desde las ${biz.checkinFrom}`],
    ['Salida', `${humanLong(b.checkout)}, hasta las ${biz.checkoutUntil}`],
    ['Habitación', b.items.map((i) => `${h(i.roomName)} (${i.adults + i.children} pers.)`).join('<br>')],
    ['Total estadía', clp(b.total)],
    ['Pagado', clp(b.amountPaid)],
    ['Saldo al llegar', clp(Math.max(0, b.total - b.amountPaid + (b.amountRefunded || 0)))],
  ];
  const html = `<!doctype html><html><body style="margin:0;background:#eef2ee;font-family:Arial,sans-serif;color:#14211c">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <p style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#4f6b52;margin:0 0 8px">${h(biz.name)} · Temuco</p>
    <h1 style="font-size:24px;margin:0 0 12px">Reserva ${h(b.code)}</h1>
    <p style="font-size:16px;line-height:1.5">${intro}</p>
    <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:8px">
      ${rows.map(([k, v]) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #e3e8e3;color:#56655d;font-size:14px">${k}</td><td style="padding:10px 14px;border-bottom:1px solid #e3e8e3;font-size:14px;text-align:right">${v}</td></tr>`).join('')}
    </table>
    ${q?.policy ? `<p style="font-size:14px;line-height:1.5">Cancelación gratis hasta el ${humanLong(q.policy.freeCancelUntil)}. Después se retiene el anticipo.</p>` : ''}
    <p><a href="${h(manageUrl)}" style="display:inline-block;background:#b8203a;color:#fff;padding:12px 18px;border-radius:6px;text-decoration:none">Ver o cambiar mi reserva</a></p>
    <p style="font-size:13px;color:#56655d">${h(biz.address)} · ${h(biz.phone)}</p>
  </div></body></html>`;
  return html;
}

export function startMailer({ store, settingsFn, baseUrl, sign, apiKey, from, intervalMs = 30000, log = console, timers = true }) {
  async function send({ to, subject, html }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, html }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : (await res.text()).slice(0, 300) };
  }
  async function tick() {
    const queue = store.list('outbox', { status: 'en_cola' });
    if (!queue.length) return;
    if (!apiKey) return; // Sin proveedor: quedan en cola, visibles en el panel.
    for (const m of queue) {
      const booking = store.get('bookings', m.bookingId);
      if (!booking) { store.update('outbox', m.id, { status: 'descartado' }); continue; }
      const manageUrl = `${baseUrl}/#/reserva/${booking.code}/${await sign(booking.code)}`;
      const html = renderEmail({ booking, settings: settingsFn(), kind: m.kind, manageUrl });
      try {
        const r = await send({ to: m.to, subject: m.subject, html });
        if (r.ok) store.update('outbox', m.id, { status: 'enviado', sentAt: new Date().toISOString(), error: null });
        else store.update('outbox', m.id, { status: r.status >= 500 ? 'en_cola' : 'error', error: r.error });
      } catch (e) {
        log.warn?.('correo', e.message);
      }
    }
  }
  const t = timers ? setInterval(() => tick().catch((e) => log.error('correo', e)), intervalMs) : null;
  t?.unref();
  // Correo de prueba al dueño, para comprobar la conexión con Resend sin hacer una reserva.
  async function test(to) {
    if (!apiKey) return { ok: false, error: 'Falta la variable RESEND_API_KEY en Setup Node.js App.' };
    const biz = settingsFn().business || {};
    try {
      return await send({ to, subject: `Correo de prueba · ${biz.name || 'Hostal'}`, html: `<p style="font-family:Arial,sans-serif;font-size:16px">Si lees esto, los correos de reservas funcionan.</p>` });
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }
  // Vuelve a poner en cola los correos que fallaron (por ejemplo, antes de verificar el dominio).
  function retry() {
    let n = 0;
    for (const m of store.list('outbox', { status: 'error' })) { store.update('outbox', m.id, { status: 'en_cola' }); n++; }
    return n;
  }
  return { tick, test, retry, stop: () => t && clearInterval(t) };
}

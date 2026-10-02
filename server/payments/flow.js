// Flow (flow.cl), API REST. El huésped paga en la página de Flow (Webpay,
// otras tarjetas y medios que Flow ofrezca); este sitio nunca ve los datos de
// la tarjeta. Aquí solo se guardan el token, el número de orden de Flow, el
// medio de pago y la comisión que informa Flow.
//
// Documentación: https://developers.flow.cl/api
// Cada llamada se firma: parámetros ordenados por nombre, concatenados como
// "nombrevalor" y firmados con HMAC-SHA256 usando la secretKey (parámetro "s").
// Credenciales en FLOW_API_KEY y FLOW_SECRET_KEY; ambiente en FLOW_ENV.

import { createHmac } from 'node:crypto';

const HOSTS = {
  sandbox: 'https://sandbox.flow.cl/api',
  produccion: 'https://www.flow.cl/api',
};

// Estado de la orden en Flow: 1 pendiente de pago, 2 pagada, 3 rechazada, 4 anulada.
const STATUS = { 1: 'PENDING', 2: 'AUTHORIZED', 3: 'FAILED', 4: 'ABORTED' };

export function flowSignature(params, secretKey) {
  const base = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
  return createHmac('sha256', secretKey).update(base).digest('hex');
}

export function createFlow({ environment = 'sandbox', apiKey, secretKey, fetchImpl = fetch } = {}) {
  if (!HOSTS[environment]) throw new Error(`FLOW_ENV debe ser "sandbox" o "produccion" (llegó "${environment}").`);
  if (!apiKey || !secretKey) throw new Error('Faltan FLOW_API_KEY y FLOW_SECRET_KEY.');
  const base = HOSTS[environment];

  async function call(method, path, params) {
    const all = { ...params, apiKey };
    const body = new URLSearchParams({ ...all, s: flowSignature(all, secretKey) });
    const url = method === 'GET' ? `${base}${path}?${body}` : `${base}${path}`;
    const res = await fetchImpl(url, {
      method,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: method === 'GET' ? undefined : body.toString(),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Flow ${method} ${path}: ${res.status} ${data?.message || text}`.slice(0, 300));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    environment,
    provider: 'flow',
    async create({ buyOrder, amount, returnUrl, confirmUrl, email, subject }) {
      const d = await call('POST', '/payment/create', {
        commerceOrder: buyOrder, subject, currency: 'CLP', amount, email,
        urlConfirmation: confirmUrl, urlReturn: returnUrl,
      });
      return { token: d.token, url: `${d.url}?token=${encodeURIComponent(d.token)}`, providerOrder: d.flowOrder };
    },
    async commit(token) {
      const d = await call('GET', '/payment/getStatus', { token });
      const pd = d.paymentData || {};
      return {
        status: STATUS[d.status] || 'FAILED',
        responseCode: d.status === 2 ? 0 : -1,
        amount: Math.round(Number(d.amount)),
        media: pd.media || null,
        // Flow informa su comisión en cada pago; se usa en vez de la estimada.
        fee: pd.fee != null ? Math.round(Number(pd.fee)) : null,
        raw: { flowOrder: d.flowOrder, commerceOrder: d.commerceOrder, status: d.status, media: pd.media, date: pd.date, fee: pd.fee, balance: pd.balance, transferDate: pd.transferDate },
      };
    },
    // Las devoluciones de Flow se hacen desde su panel: quedan como pendientes manuales.
    async refund() {
      return { ok: false, manual: true };
    },
  };
}

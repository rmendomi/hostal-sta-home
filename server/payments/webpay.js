// Webpay Plus (Transbank), API REST. El huésped escribe los datos de su
// tarjeta en el formulario de Transbank, nunca en este sitio: aquí solo se
// guardan el token de la transacción, el código de autorización, el tipo de
// tarjeta y sus últimos 4 dígitos.
//
// Documentación: https://www.transbankdevelopers.cl/referencia/webpay
// Las credenciales de integración son las públicas de prueba de Transbank.
// En producción se usan el código de comercio y la llave que entrega Transbank
// tras validar la integración (variables WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY).

const HOSTS = {
  integracion: 'https://webpay3gint.transbank.cl',
  produccion: 'https://webpay3g.transbank.cl',
};

export const INTEGRATION_CREDENTIALS = {
  commerceCode: '597055555532',
  apiKey: '579B532A7440BB0C9079DED94D31EA1615BACEB56610332264630D42D0A36B1C',
};

export function createWebpay({ environment = 'integracion', commerceCode, apiKey, apiVersion = 'v1.2', fetchImpl = fetch } = {}) {
  if (environment === 'integracion') {
    commerceCode ||= INTEGRATION_CREDENTIALS.commerceCode;
    apiKey ||= INTEGRATION_CREDENTIALS.apiKey;
  }
  if (!commerceCode || !apiKey) throw new Error('Faltan WEBPAY_COMMERCE_CODE y WEBPAY_API_KEY para producción.');
  const base = `${HOSTS[environment]}/rswebpaytransaction/api/webpay/${apiVersion}/transactions`;
  const headers = { 'Tbk-Api-Key-Id': commerceCode, 'Tbk-Api-Key-Secret': apiKey, 'Content-Type': 'application/json' };

  async function call(method, path, body) {
    const res = await fetchImpl(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    if (!res.ok) {
      const err = new Error(`Webpay ${method} ${path}: ${res.status} ${data?.error_message || text}`.slice(0, 300));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    environment,
    async create({ buyOrder, sessionId, amount, returnUrl }) {
      const d = await call('POST', '', { buy_order: buyOrder, session_id: sessionId, amount, return_url: returnUrl });
      return { token: d.token, url: d.url };
    },
    async commit(token) {
      const d = await call('PUT', `/${encodeURIComponent(token)}`);
      return {
        status: d.status,
        responseCode: d.response_code,
        amount: d.amount,
        authorizationCode: d.authorization_code,
        paymentTypeCode: d.payment_type_code,
        cardLast4: d.card_detail?.card_number || null,
        installments: d.installments_number || 0,
        raw: { vci: d.vci, status: d.status, buy_order: d.buy_order, accounting_date: d.accounting_date, transaction_date: d.transaction_date, response_code: d.response_code, payment_type_code: d.payment_type_code, installments_number: d.installments_number },
      };
    },
    async status(token) {
      return call('GET', `/${encodeURIComponent(token)}`);
    },
    // Reversa o anulación. Transbank decide el tipo según plazo y tipo de tarjeta.
    async refund(token, amount) {
      const d = await call('POST', `/${encodeURIComponent(token)}/refunds`, { amount });
      return { ok: ['REVERSED', 'NULLIFIED'].includes(d.type) && (d.response_code === undefined || d.response_code === 0), type: d.type, raw: d };
    },
  };
}

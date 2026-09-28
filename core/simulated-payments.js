// Pasarela SIMULADA con la misma forma que el adaptador de Webpay. Solo para la
// demo y las pruebas: no mueve dinero. El formulario simulado llama a decide()
// con el resultado que elige quien prueba (aprobar con débito/crédito o rechazar).

export function createSimulatedPayments({ urlFor = (token) => `#/pago-simulado/${token}` } = {}) {
  const tx = new Map();
  let n = 0;
  return {
    simulated: true,
    async create({ buyOrder, sessionId, amount, returnUrl }) {
      const token = `sim_${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      tx.set(token, { buyOrder, sessionId, amount, returnUrl, decision: null });
      return { token, url: urlFor(token) };
    },
    info(token) { return tx.get(token) || null; },
    decide(token, { approve = true, cardType = 'debit', last4 = '6623' } = {}) {
      const t = tx.get(token);
      if (!t) throw new Error('Transacción simulada desconocida');
      t.decision = { approve, cardType, last4 };
    },
    async commit(token) {
      const t = tx.get(token);
      if (!t || !t.decision) return { status: 'FAILED', responseCode: -1, amount: t?.amount || 0, raw: { simulated: true } };
      const code = { debit: 'VD', credit: 'VN', prepaid: 'VP' }[t.decision.cardType] || 'VN';
      return t.decision.approve
        ? { status: 'AUTHORIZED', responseCode: 0, amount: t.amount, authorizationCode: String(100000 + Math.floor(Math.random() * 899999)), paymentTypeCode: code, cardLast4: t.decision.last4, installments: 0, raw: { simulated: true } }
        : { status: 'FAILED', responseCode: -1, amount: t.amount, paymentTypeCode: code, raw: { simulated: true } };
    },
    async refund(token, amount) {
      return { ok: true, type: 'REVERSED', amount, simulated: true };
    },
  };
}

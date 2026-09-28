// Cliente de datos. En el servidor real habla con /api; en la demo usa la
// misma lógica corriendo en el navegador (ver demo.js).

export class ApiError extends Error {
  constructor(msg, { status, code, fields } = {}) { super(msg); this.status = status; this.code = code; this.fields = fields; }
}

export async function createApi() {
  if (globalThis.SE_DEMO) {
    const { createDemoBackend } = await import('./demo.js');
    return createDemoBackend();
  }
  const call = async (area, method, args) => {
    let r;
    try {
      r = await fetch(`/api/${area}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(args || {}), credentials: 'same-origin' });
    } catch {
      throw new ApiError('No pudimos conectarnos. Revisa tu conexión e intenta de nuevo.');
    }
    const d = await r.json().catch(() => ({ error: 'Respuesta inesperada del servidor.' }));
    if (!r.ok) throw new ApiError(d.error || 'Algo falló.', { status: r.status, code: d.code, fields: d.fields });
    return d;
  };
  return {
    mode: 'server',
    pub: (m, a) => call('public', m, a),
    admin: (m, a) => call('admin', m, a),
    goToPayment({ url, token }) {
      location.href = `/pago/ir?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
    },
  };
}

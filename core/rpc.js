// Lista blanca de operaciones que el navegador puede pedir. El servidor la
// expone en /api/public/<método> y /api/admin/<método>; la demo la llama
// directamente. Así las dos versiones tienen exactamente las mismas reglas.

import { ServiceError } from './service.js';

export function createRpc({ svc, sign, returnUrl, confirmUrl = () => '' }) {
  function emailFor(code) {
    code = String(code || '').trim().toUpperCase();
    const row = svc.admin.bookings({ q: code }).find((b) => b.code === code);
    if (!row) throw new ServiceError('no_encontrada', 'No encontramos una reserva con ese código y correo.', 404);
    return svc.admin.booking(row.id).guest.email;
  }

  // El huésped se identifica con su correo, o con el enlace firmado que recibe
  // al reservar (así no tiene que escribir el correo al volver del pago).
  async function identify({ code, email, token }) {
    code = String(code || '').trim().toUpperCase();
    if (token) {
      if (token !== (await sign(code))) throw new ServiceError('enlace', 'El enlace de la reserva no es válido.', 403);
      return { code, email: emailFor(code) };
    }
    if (!email) throw new ServiceError('no_encontrada', 'Escribe el código de reserva y el correo con que reservaste.', 404);
    return { code, email };
  }

  const publicApi = {
    info: () => svc.publicInfo(),
    search: (a) => svc.search(a),
    calendar: (a) => svc.availabilityCalendar(a),
    quote: (a) => svc.quote(a),
    async createBooking(a) {
      const booking = svc.createBooking({ ...a, source: 'web', actor: 'huesped', skipPayment: false });
      return { booking, token: await sign(booking.code) };
    },
    async getBooking(a) {
      const { code, email } = await identify(a);
      const booking = svc.getBooking(code, email);
      return { booking, token: await sign(booking.code) };
    },
    async startPayment(a) {
      const { code } = await identify({ ...a, email: undefined, token: a.token });
      return svc.startPayment(code, { returnUrl: returnUrl(code), confirmUrl: confirmUrl(code) });
    },
    async cancelBooking(a) {
      const { code, email } = await identify(a);
      return svc.cancelBooking(code, email, { reason: a.reason || '' });
    },
    async previewChange(a) {
      const { code, email } = await identify(a);
      return svc.previewChange(code, email, a);
    },
    async changeBooking(a) {
      const { code, email } = await identify(a);
      return svc.changeBooking(code, email, a);
    },
  };

  const A = svc.admin;
  const adminApi = {
    today: () => A.today(),
    summary: (a) => A.summary(a),
    bookings: (a) => A.bookings(a || {}),
    booking: (a) => A.booking(a.id),
    createBooking: (a) => A.createBooking(a),
    recordPayment: (a) => A.recordPayment(a.id, a),
    setStatus: (a) => A.setStatus(a.id, a.status),
    cancel: (a) => A.cancel(a.id, a),
    changeDates: (a) => A.changeDates(a.id, a),
    list: (a) => A.list(a.kind),
    save: (a) => A.save(a.kind, a.item),
    remove: (a) => A.remove(a.kind, a.id),
    createBlock: (a) => A.createBlock(a),
    removeBlock: (a) => A.removeBlock(a.id),
    settings: () => A.settings(),
    saveSettings: (a) => A.saveSettings(a.patch),
    calendar: (a) => A.calendar(a),
    quote: (a) => svc.quote(a),
    search: (a) => svc.search(a),
  };

  return { publicApi, adminApi };
}

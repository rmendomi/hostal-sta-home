// Sincronización de calendarios con Booking (u otro portal) por iCal.
// - Exportar: cada habitación publica un .ics con sus noches ocupadas; se pega
//   en la extranet de Booking ("Sincronizar calendarios") para que Booking
//   cierre esas noches.
// - Importar: se pega aquí el enlace .ics que entrega Booking; cada 15 minutos
//   las reservas de Booking se vuelven bloqueos en este sistema.
// iCal no es instantáneo: entre sincronizaciones puede haber una ventana de
// minutos en que ambos canales venden la misma noche. Se informa en el panel.

import { addDays, nightsBetween } from '../core/dates.js';
import { ConflictError } from '../core/service.js';

const esc = (s) => String(s).replace(/[\\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
const d8 = (d) => d.replaceAll('-', '');

export function exportRoomCalendar({ store, roomId, name }) {
  const locks = store.locksFor([roomId], '0000-01-01', '9999-12-31');
  // Agrupa noches consecutivas del mismo origen en un evento.
  const events = [];
  for (const l of locks) {
    const key = l.bookingId || l.blockId;
    const last = events[events.length - 1];
    if (last && last.key === key && addDays(last.lastNight, 1) === l.night) last.lastNight = l.night;
    else events.push({ key, firstNight: l.night, lastNight: l.night, isBlock: !!l.blockId });
  }
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Santa Elena de Maipo Home//Reservas//ES', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`,
  ];
  for (const e of events) {
    // No reexportamos a Booking lo que vino de Booking.
    if (e.isBlock) {
      const b = store.get('blocks', e.key);
      if (b?.source === 'ical') continue;
    }
    lines.push('BEGIN:VEVENT', `UID:${e.key}-${d8(e.firstNight)}@santaelena`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${d8(e.firstNight)}`, `DTEND;VALUE=DATE:${d8(addDays(e.lastNight, 1))}`,
      `SUMMARY:${e.isBlock ? 'Cerrado' : 'Reservado'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export function parseIcs(text) {
  const unfolded = String(text).replace(/\r?\n[ \t]/g, '');
  const events = [];
  let cur = null;
  for (const line of unfolded.split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') cur = {};
    else if (line === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) {
      const i = line.indexOf(':');
      if (i < 0) continue;
      const key = line.slice(0, i).split(';')[0].toUpperCase();
      const val = line.slice(i + 1).trim();
      if (key === 'UID') cur.uid = val;
      if (key === 'DTSTART') cur.start = toDate(val);
      if (key === 'DTEND') cur.end = toDate(val);
      if (key === 'SUMMARY') cur.summary = val;
    }
  }
  return events.filter((e) => e.start && e.end && e.end > e.start);
}

function toDate(v) {
  const m = /^(\d{4})(\d{2})(\d{2})/.exec(v);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

// Aplica un calendario importado a una habitación. Devuelve lo que cambió y
// los choques (una reserva de Booking sobre noches ya vendidas aquí).
export function applyImport({ store, svc, roomId, events, today }) {
  const current = store.list('blocks', { roomId, source: 'ical' });
  const seen = new Set();
  const result = { added: 0, removed: 0, conflicts: [] };
  for (const e of events) {
    if (e.end <= today) continue;
    const externalId = `${e.uid || ''}|${e.start}|${e.end}`;
    seen.add(externalId);
    if (current.some((b) => b.externalId === externalId)) continue;
    const from = e.start < today ? today : e.start;
    const to = addDays(e.end, -1);
    try {
      svc.admin.createBlock({ roomId, from, to, reason: `Booking: ${e.summary || 'reservado'}`, source: 'ical', externalId });
      result.added++;
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
      // Bloquea las noches libres y avisa de las que chocan.
      const nights = nightsBetween(from, e.end);
      const taken = new Set(store.locksFor([roomId], from, to).map((l) => l.night));
      result.conflicts.push({ roomId, from, to: e.end, nights: nights.filter((n) => taken.has(n)), summary: e.summary });
    }
  }
  for (const b of current) {
    if (!seen.has(b.externalId)) { svc.admin.removeBlock(b.id); result.removed++; }
  }
  return result;
}

// Fechas como texto 'AAAA-MM-DD' (noches de hotel, sin hora). Toda la aritmética
// se hace en UTC para que el horario de verano no mueva los días.

const DAY = 86400000;

export function parse(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) throw new Error(`Fecha inválida: ${d}`);
  const [y, m, day] = d.split('-').map(Number);
  const t = Date.UTC(y, m - 1, day);
  if (fmt(t) !== d) throw new Error(`Fecha inválida: ${d}`);
  return t;
}

export function fmt(t) {
  return new Date(t).toISOString().slice(0, 10);
}

export function isDate(d) {
  try { parse(d); return true; } catch { return false; }
}

export function addDays(d, n) {
  return fmt(parse(d) + n * DAY);
}

export function diffDays(a, b) {
  return Math.round((parse(b) - parse(a)) / DAY);
}

// Noches entre llegada (incluida) y salida (excluida).
export function nightsBetween(checkin, checkout) {
  const n = diffDays(checkin, checkout);
  const out = [];
  for (let i = 0; i < n; i++) out.push(addDays(checkin, i));
  return out;
}

export function weekday(d) {
  return new Date(parse(d)).getUTCDay(); // 0 = domingo
}

// "Hoy" según la hora de Chile continental, no la del servidor.
export function today(tz = 'America/Santiago', now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const g = (k) => parts.find((p) => p.type === k).value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function inRange(d, start, end) {
  return d >= start && d <= end;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const DIAS_CORTOS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export const names = { MESES, MESES_CORTOS, DIAS, DIAS_CORTOS };

export function human(d, { weekday: wd = false, year = false } = {}) {
  const t = new Date(parse(d));
  let s = `${t.getUTCDate()} ${MESES_CORTOS[t.getUTCMonth()]}`;
  if (year) s += ` ${t.getUTCFullYear()}`;
  if (wd) s = `${DIAS_CORTOS[t.getUTCDay()]} ${s}`;
  return s;
}

export function humanLong(d) {
  const t = new Date(parse(d));
  return `${DIAS[t.getUTCDay()]} ${t.getUTCDate()} de ${MESES[t.getUTCMonth()]} de ${t.getUTCFullYear()}`;
}

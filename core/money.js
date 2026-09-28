// Montos en pesos chilenos: siempre enteros, sin decimales.

export function clp(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '−' : ''}$${s}`;
}

export function round(n) {
  return Math.round(n);
}

// Porcentaje de un monto, redondeado al peso.
export function pct(amount, percent) {
  return Math.round((amount * percent) / 100);
}

// IVA contenido en un precio que ya lo incluye.
export function vatIncluded(total, rate = 0.19) {
  return Math.round(total - total / (1 + rate));
}

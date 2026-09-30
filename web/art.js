// Ilustraciones generadas: el paisaje de la portada (volcán Llaima, araucarias,
// niebla de Temuco) y el plano referencial de cada habitación, dibujado con
// sus medidas y camas reales mientras no haya fotos.

import { raw, esc } from './ui.js';

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Semilla fija para que el paisaje sea siempre el mismo.
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

function araucaria(ctx, x, base, h, color) {
  // Tronco recto y copa en forma de paraguas con ramas colgantes: la silueta
  // característica del bosque de araucarias.
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  const trunkW = Math.max(1.5, h * 0.035);
  ctx.fillRect(x - trunkW / 2, base - h, trunkW, h);
  const crownTop = base - h;
  const crownW = h * 0.62;
  const tiers = 4;
  for (let i = 0; i < tiers; i++) {
    const y = crownTop + i * h * 0.075;
    const w = crownW * (0.55 + (i / tiers) * 0.5);
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + h * 0.06);
    ctx.quadraticCurveTo(x - w / 4, y - h * 0.05, x, y - h * 0.02);
    ctx.quadraticCurveTo(x + w / 4, y - h * 0.05, x + w / 2, y + h * 0.06);
    ctx.quadraticCurveTo(x, y + h * 0.01, x - w / 2, y + h * 0.06);
    ctx.fill();
  }
}

export function drawLandscape(canvas, { animate = true } = {}) {
  const ctx = canvas.getContext('2d');
  let W = 0; let H = 0; let raf = 0; let t0 = performance.now();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const drops = [];

  function palette() {
    return {
      sky1: css('--sky-1'), sky2: css('--sky-2'), far: css('--hill-far'), mid: css('--hill-mid'), near: css('--hill-near'),
      snow: css('--snow'), tree: css('--tree'), mist: css('--mist'), window: css('--window'), house: css('--house'),
    };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width; H = r.height;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drops.length = 0;
    const R = rng(7);
    for (let i = 0; i < Math.round(W / 9); i++) drops.push({ x: R() * W, y: R() * H, l: 6 + R() * 10, v: 0.25 + R() * 0.35 });
  }

  function frame(now) {
    const c = palette();
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, c.sky1); g.addColorStop(1, c.sky2);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    // Volcán Llaima: cono asimétrico con nieve y una fumarola tenue.
    const narrow = W < 600;
    const vx = W * (narrow ? 0.7 : 0.64); const vy = H * (narrow ? 0.6 : 0.34); const vw = Math.max(W * 0.5, 360);
    ctx.fillStyle = c.far;
    ctx.beginPath();
    ctx.moveTo(vx - vw * 0.62, H * 0.78);
    ctx.lineTo(vx - vw * 0.06, vy);
    ctx.lineTo(vx + vw * 0.035, vy - 2);
    ctx.lineTo(vx + vw * 0.55, H * 0.78);
    ctx.fill();
    ctx.fillStyle = c.snow;
    ctx.beginPath();
    ctx.moveTo(vx - vw * 0.06, vy);
    ctx.lineTo(vx + vw * 0.035, vy - 2);
    ctx.lineTo(vx + vw * 0.13, vy + H * 0.085);
    ctx.lineTo(vx + vw * 0.07, vy + H * 0.07);
    ctx.lineTo(vx + vw * 0.02, vy + H * 0.1);
    ctx.lineTo(vx - vw * 0.04, vy + H * 0.075);
    ctx.lineTo(vx - vw * 0.1, vy + H * 0.1);
    ctx.lineTo(vx - vw * 0.16, vy + H * 0.08);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    for (let i = 0; i < 4; i++) {
      const drift = reduce ? 0 : Math.sin(t * 0.2 + i) * 4;
      ctx.fillStyle = c.mist;
      ctx.beginPath();
      ctx.ellipse(vx - vw * 0.01 + i * 10 + drift + i * i * 3, vy - 12 - i * 13, 10 + i * 6, 6 + i * 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Lomas y bosque.
    const hill = (color, y, amp, seed) => {
      const R = rng(seed);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      const pts = 7;
      const ys = Array.from({ length: pts + 1 }, () => y + (R() - 0.5) * amp);
      ctx.lineTo(0, ys[0]);
      for (let i = 0; i < pts; i++) {
        const x0 = (i / pts) * W; const x1 = ((i + 1) / pts) * W;
        ctx.quadraticCurveTo((x0 + x1) / 2, (ys[i] + ys[i + 1]) / 2 - amp * 0.2, x1, ys[i + 1]);
      }
      ctx.lineTo(W, H);
      ctx.fill();
      return ys;
    };
    hill(c.mid, H * (narrow ? 0.84 : 0.72), H * 0.08, 3);

    // Niebla baja que se mueve despacio.
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c.mist;
    for (let i = 0; i < 3; i++) {
      const x = ((reduce ? 0 : t * 6 * (i + 1)) + i * W * 0.4) % (W + 400) - 200;
      ctx.beginPath();
      ctx.ellipse(x, H * ((narrow ? 0.86 : 0.74) + i * 0.03), 260, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    const R = rng(11);
    for (let i = 0; i < 16; i++) {
      const x = R() * W; const h = H * (0.07 + R() * 0.08); const y = H * (narrow ? 0.88 : 0.8) + R() * H * 0.03;
      if ((W > 760 && x < W * 0.5) || narrow) continue; // deja limpia la zona del titular
      araucaria(ctx, x, y, h, c.mid);
    }
    hill(c.near, H * 0.86, H * 0.05, 5);

    // La casa: tejuelas de madera y una ventana encendida.
    const hx = W * 0.2; const hb = H * 0.9; const hw = Math.min(90, W * 0.16); const hh = hw * 0.62;
    ctx.fillStyle = c.house;
    ctx.fillRect(hx - hw / 2, hb - hh, hw, hh);
    ctx.beginPath();
    ctx.moveTo(hx - hw * 0.62, hb - hh + 1);
    ctx.lineTo(hx, hb - hh - hw * 0.42);
    ctx.lineTo(hx + hw * 0.62, hb - hh + 1);
    ctx.fill();
    ctx.fillStyle = c.window;
    const glow = reduce ? 1 : 0.85 + Math.sin(t * 0.8) * 0.15;
    ctx.globalAlpha = glow;
    ctx.fillRect(hx - hw * 0.28, hb - hh * 0.62, hw * 0.18, hw * 0.16);
    ctx.fillRect(hx + hw * 0.1, hb - hh * 0.62, hw * 0.18, hw * 0.16);
    ctx.fillRect(hx - hw * 0.04, hb - hh - hw * 0.2, hw * 0.08, hw * 0.1);
    ctx.globalAlpha = 1;

    const R2 = rng(19);
    for (let i = 0; i < 9; i++) {
      let x = R2() * W;
      if (Math.abs(x - hx) < hw) x += hw * 1.4;
      araucaria(ctx, x, H + 4, H * (narrow ? 0.1 + R2() * 0.1 : 0.2 + R2() * 0.2), c.tree);
    }

    // Llovizna de Temuco.
    if (!reduce) {
      ctx.strokeStyle = c.mist; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of drops) {
        const y = (d.y + t * 60 * d.v * 6) % H;
        ctx.moveTo(d.x, y); ctx.lineTo(d.x - d.l * 0.25, y + d.l);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (animate && !reduce) raf = requestAnimationFrame(frame);
  }

  resize();
  const ro = new ResizeObserver(() => { resize(); if (reduce || !animate) frame(performance.now()); });
  ro.observe(canvas);
  const mo = new MutationObserver(() => frame(performance.now()));
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const redraw = () => frame(performance.now());
  mq.addEventListener?.('change', redraw);
  // Pausa la animación cuando la portada no se ve.
  const io = new IntersectionObserver(([e]) => {
    cancelAnimationFrame(raf);
    if (e.isIntersecting && animate && !reduce) raf = requestAnimationFrame(frame);
  });
  io.observe(canvas);
  frame(performance.now());
  return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); io.disconnect(); mq.removeEventListener?.('change', redraw); };
}

// Plano referencial en planta, a escala aproximada según los m².
export function floorPlan(room, { compact = false } = {}) {
  const area = room.sizeM2 || 14;
  const ratio = area > 15 ? 1.35 : 1.2;
  const wM = Math.sqrt(area * ratio); const hM = area / wM; // metros
  const S = 26; // px por metro
  const W = wM * S; const H = hM * S;
  const pad = 22;
  const vbW = W + pad * 2; const vbH = H + pad * 2 + (compact ? 0 : 18);
  const beds = String(room.beds || '').toLowerCase();
  const doubles = (beds.match(/(\d+)\s*cama[s]?\s*doble/) || [])[1] ? +(beds.match(/(\d+)\s*cama[s]?\s*doble/)[1]) : beds.includes('doble') ? 1 : 0;
  const single = /(\d+)\s*cama[s]?\s*(?:individual(?:es)?|de\s+(?:una\s+)?plaza)/;
  const singles = (beds.match(single) || [])[1] ? +beds.match(single)[1] : /individual|plaza/.test(beds) ? 1 : 0;
  const x0 = pad; const y0 = pad;
  const parts = [];
  // Muros
  parts.push(`<rect class="fp-wall" x="${x0}" y="${y0}" width="${W}" height="${H}" rx="2"/>`);
  // Baño en la esquina superior derecha
  const bw = Math.min(1.4 * S, W * 0.34); const bh = Math.min(1.6 * S, H * 0.45);
  const ownBath = room.bathroom !== 'compartido';
  if (ownBath) {
    parts.push(`<rect class="fp-bath" x="${x0 + W - bw}" y="${y0}" width="${bw}" height="${bh}"/>`);
    parts.push(`<circle class="fp-line" cx="${x0 + W - bw / 2}" cy="${y0 + bh / 2}" r="${Math.min(bw, bh) * 0.18}"/>`);
    parts.push(`<text class="fp-t" x="${x0 + W - bw / 2}" y="${y0 + bh - 6}" text-anchor="middle">baño</text>`);
  }
  // Camas en vertical desde el muro izquierdo, cabecera arriba.
  let bx = x0 + 0.12 * S;
  const bY = y0 + 0.12 * S;
  const limit = x0 + W - (ownBath ? bw : 0) - 2;
  const bedList = [...Array(doubles).fill(1.45), ...Array(singles).fill(0.9)];
  for (const w of bedList) {
    const bW = w * S; const bH = Math.min(2.0 * S, H - 0.3 * S);
    if (bx + bW > limit && bx > x0 + 0.2 * S) break;
    const pillows = w > 1 ? [0, 1] : [0];
    parts.push(`<rect class="fp-bed" x="${bx}" y="${bY}" width="${bW}" height="${bH}" rx="3"/>` + pillows.map((k) => `<rect class="fp-pillow" x="${bx + 3 + k * (bW / 2 - 1)}" y="${bY + 3}" width="${(w > 1 ? bW / 2 : bW) - 6}" height="${0.38 * S}" rx="2"/>`).join(''));
    bx += bW + 0.15 * S;
  }
  // Cocina en el muro inferior
  if (room.kitchen) {
    const kw = Math.min(2.2 * S, W * 0.5);
    parts.push(`<rect class="fp-kitchen" x="${x0 + W - kw}" y="${y0 + H - 0.6 * S}" width="${kw}" height="${0.6 * S}"/><circle class="fp-line" cx="${x0 + W - kw * 0.3}" cy="${y0 + H - 0.3 * S}" r="5"/><circle class="fp-line" cx="${x0 + W - kw * 0.55}" cy="${y0 + H - 0.3 * S}" r="5"/>`);
  }
  // Puerta con su arco
  const dx = x0 + W * 0.52; const dw = 0.8 * S;
  parts.push(`<path class="fp-door" d="M${dx} ${y0 + H} L${dx} ${y0 + H - dw} A${dw} ${dw} 0 0 1 ${dx + dw} ${y0 + H}"/><line class="fp-gap" x1="${dx}" y1="${y0 + H}" x2="${dx + dw}" y2="${y0 + H}"/>`);
  // Ventana en el muro superior
  parts.push(`<line class="fp-window" x1="${x0 + W * 0.18}" y1="${y0}" x2="${x0 + W * 0.5}" y2="${y0}"/>`);
  if (!compact) {
    parts.push(`<text class="fp-dim" x="${x0 + W / 2}" y="${y0 + H + 18 + 12}" text-anchor="middle">${room.sizeM2 ? `${room.sizeM2} m² · plano referencial` : 'Plano referencial · medida por confirmar'}</text>`);
  }
  return raw(`<svg class="fp" viewBox="0 0 ${vbW.toFixed(0)} ${vbH.toFixed(0)}" role="img" aria-label="Plano referencial de ${esc(room.name)}${room.sizeM2 ? `, ${room.sizeM2} metros cuadrados` : ''}">${parts.join('')}</svg>`);
}

// Monograma de la marca (guía, sección 5): "SE" en Cormorant Garamond dentro
// del arco de entrada de la casa. Letras convertidas a trazos, así no depende de
// que la fuente esté cargada. Los colores vienen del CSS (.lm-arch, .lm-se).
export const logoMark = () => raw('<svg class="logo-mark" viewBox="0 0 46 56" aria-hidden="true"><path class="lm-arch" d="M4 54V24a19 19 0 0 1 38 0v30" fill="none" stroke-width="1.6"/><path class="lm-base" d="M1 54.2h44" fill="none" stroke-width="1.6" stroke-linecap="round"/><path class="lm-se" d="M11.37 28.15C11.37 28.96 11.57 29.66 11.99 30.24C12.4 30.83 12.93 31.37 13.58 31.84C14.23 32.31 14.92 32.78 15.64 33.23C16.43 33.71 17.18 34.21 17.89 34.75C18.6 35.29 19.19 35.9 19.65 36.59C20.12 37.28 20.35 38.13 20.35 39.12C20.35 40.19 20.07 41.14 19.51 41.95C18.96 42.76 18.19 43.4 17.21 43.87C16.23 44.33 15.07 44.57 13.75 44.57C13.2 44.57 12.61 44.51 12.01 44.41C11.4 44.31 10.83 44.16 10.3 43.98C9.78 43.79 9.35 43.6 9.02 43.39C8.93 43.33 8.87 43.26 8.82 43.17C8.76 43.09 8.73 42.97 8.71 42.8L8.52 38.13C8.5 38.02 8.55 37.96 8.66 37.95C8.77 37.95 8.84 37.98 8.86 38.06C9.11 38.68 9.4 39.34 9.74 40.03C10.09 40.72 10.48 41.35 10.94 41.93C11.39 42.51 11.91 42.98 12.5 43.34C13.09 43.71 13.76 43.88 14.53 43.88C15.06 43.88 15.57 43.79 16.05 43.61C16.52 43.42 16.91 43.1 17.22 42.63C17.53 42.17 17.69 41.53 17.69 40.73C17.69 39.76 17.46 38.92 17.02 38.23C16.58 37.54 16.02 36.94 15.33 36.42C14.65 35.9 13.94 35.42 13.2 34.97C12.47 34.49 11.78 34.01 11.12 33.51C10.46 33.02 9.92 32.44 9.5 31.79C9.07 31.14 8.86 30.35 8.86 29.42C8.86 28.29 9.17 27.36 9.79 26.64C10.41 25.92 11.2 25.38 12.16 25.03C13.12 24.68 14.1 24.5 15.12 24.5C15.8 24.5 16.49 24.56 17.19 24.69C17.89 24.81 18.49 24.99 18.99 25.21C19.17 25.27 19.3 25.36 19.36 25.46C19.42 25.56 19.45 25.68 19.45 25.8L19.51 29.98C19.51 30.06 19.47 30.11 19.38 30.14C19.28 30.16 19.21 30.14 19.17 30.07C19.07 29.76 18.91 29.34 18.71 28.79C18.5 28.24 18.21 27.69 17.84 27.13C17.47 26.57 17.01 26.1 16.45 25.71C15.89 25.31 15.21 25.12 14.41 25.12C13.79 25.12 13.25 25.24 12.8 25.49C12.34 25.74 11.99 26.09 11.74 26.53C11.49 26.97 11.37 27.51 11.37 28.15ZM36.73 44.19L23.29 44.19C23.22 44.19 23.19 44.13 23.19 44.01C23.19 43.88 23.22 43.82 23.29 43.82C23.97 43.82 24.47 43.77 24.8 43.67C25.14 43.57 25.35 43.36 25.47 43.05C25.58 42.74 25.64 42.28 25.64 41.69L25.64 27.35C25.64 26.75 25.58 26.3 25.47 26C25.35 25.7 25.14 25.5 24.8 25.38C24.47 25.27 23.97 25.21 23.29 25.21C23.22 25.21 23.19 25.15 23.19 25.03C23.19 24.9 23.22 24.84 23.29 24.84L36.17 24.84C36.38 24.84 36.48 24.93 36.48 25.12L36.54 29.14C36.54 29.19 36.49 29.21 36.39 29.22C36.28 29.23 36.21 29.21 36.17 29.14C35.94 27.97 35.47 27.09 34.74 26.51C34.02 25.93 33.07 25.65 31.9 25.65L30.63 25.65C30.11 25.65 29.7 25.7 29.4 25.82C29.1 25.93 28.89 26.12 28.77 26.37C28.64 26.63 28.58 26.98 28.58 27.41L28.58 41.56C28.58 42 28.64 42.35 28.75 42.63C28.87 42.91 29.05 43.1 29.29 43.22C29.54 43.33 29.89 43.39 30.35 43.39L31.86 43.39C33.27 43.39 34.4 43.06 35.27 42.38C36.14 41.71 36.76 40.72 37.13 39.39C37.15 39.33 37.22 39.31 37.33 39.33C37.44 39.35 37.5 39.39 37.5 39.43C37.42 40 37.35 40.7 37.28 41.5C37.22 42.31 37.19 43.05 37.19 43.73C37.19 44.04 37.04 44.19 36.73 44.19ZM34.99 37.2C34.99 36.33 34.7 35.67 34.12 35.21C33.55 34.76 32.68 34.53 31.52 34.53L27.19 34.53L27.19 33.73L31.55 33.73C32.71 33.73 33.57 33.53 34.12 33.14C34.68 32.75 34.96 32.18 34.96 31.44C34.96 31.37 35.02 31.34 35.13 31.34C35.25 31.34 35.3 31.37 35.3 31.44C35.3 32.1 35.3 32.61 35.29 32.98C35.28 33.36 35.27 33.74 35.27 34.13C35.27 34.63 35.29 35.12 35.32 35.6C35.35 36.09 35.36 36.62 35.36 37.2C35.36 37.24 35.3 37.26 35.18 37.26C35.05 37.26 34.99 37.24 34.99 37.2Z"/></svg>');

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

export const logoMark = () => raw(`<svg class="logo-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 29V11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M5 12.5c3-4.5 7-6 11-6s8 1.5 11 6c-3.5-1.6-7-2.2-11-2.2S8.5 10.9 5 12.5z" fill="currentColor"/><path d="M8 17c2.4-3 5-4 8-4s5.6 1 8 4c-2.6-1-5.2-1.4-8-1.4S10.6 16 8 17z" fill="currentColor"/><path d="M11 21c1.6-1.8 3.2-2.4 5-2.4s3.4.6 5 2.4c-1.6-.5-3.2-.8-5-.8s-3.4.3-5 .8z" fill="currentColor"/></svg>`);

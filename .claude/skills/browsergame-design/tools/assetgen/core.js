/**
 * Gloomwood ARPG — procedural art generator: shared core.
 *
 * Pure Canvas2D (node-canvas) drawing helpers + the locked Gloomwood palette. Every
 * generator module (icons/fx/decor/terrain/ui/mobs) builds on these. Output is
 * deterministic given a seed, so re-running produces byte-stable art.
 *
 *   npm i canvas      # one native dependency
 *   node build.js     # regenerates the whole set
 */
const { createCanvas } = require('canvas');

/** Locked palette — mirror of tokens/colors.css (the values the renderer uses). */
const P = {
  ink950: '#08090d', ink900: '#0e0f13', ink800: '#16171d', ink700: '#1f2128',
  ink600: '#2a2d36', ink500: '#3a3e4a', ink400: '#4d5260',
  gold: '#c9a24b', goldHi: '#e7d9b0', goldDk: '#6b5226', cork: '#caa46a',
  bone: '#d7dbe3', boneHi: '#e8eef7', ash: '#9aa3b2',
  hp: '#d23b3b', hpHi: '#f08a8a', hpDeep: '#6e1414',
  mana: '#3b6fd2', manaHi: '#7fa3ec', manaDeep: '#14306a',
  coin: '#ffcf5c',
  fxFire: '#ff8a3a', fxFrost: '#7fc4ff', fxArcane: '#b07ae8',
  fxPoison: '#aef07a', fxHoly: '#ffe9a8', fxBlood: '#ff2d6f',
  // bone / stone families used by decor + mobs
  boneL: '#dcd4bd', boneM: '#a39a82', boneD: '#615b48',
  stoneL: '#5a5f6e', stoneM: '#3a3e4a', stoneD: '#1b1d24',
};

function hx(h) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
function rgb(a) { return `rgb(${a[0] | 0},${a[1] | 0},${a[2] | 0})`; }
function mix(c1, c2, t) { const a = hx(c1), b = hx(c2); return rgb([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
function mix3(d, m, l, t) { return t < 0.5 ? mix(d, m, t * 2) : mix(m, l, (t - 0.5) * 2); }

/** Seeded RNG — mulberry32. */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6d2b79f5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Render `fn(ctx,w,h)` at `ss`× then downscale to W×H for clean antialiased edges. */
function makeIcon(W, H, ss, fn) {
  const big = createCanvas(W * ss, H * ss);
  const g = big.getContext('2d');
  g.scale(ss, ss); fn(g, W, H);
  const out = createCanvas(W, H);
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = true; o.quality = 'best';
  o.drawImage(big, 0, 0, W, H);
  return out;
}

/** Additive radial glow. */
function glow(g, x, y, r, col, a, additive) {
  const rad = g.createRadialGradient(x, y, 0, x, y, r);
  rad.addColorStop(0, col); rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.globalAlpha = a;
  if (additive) g.globalCompositeOperation = 'lighter';
  g.fillStyle = rad; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.restore();
}

/** Per-pixel grain (skips transparent pixels). */
function grain(canvas, amt) {
  const g = canvas.getContext('2d'); const w = canvas.width, h = canvas.height;
  const d = g.getImageData(0, 0, w, h); const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] < 8) continue;
    const n = (Math.random() - 0.5) * amt; p[i] += n; p[i + 1] += n; p[i + 2] += n;
  }
  g.putImageData(d, 0, 0);
}

/** Soft foot-shadow ellipse (decor + mobs are foot-anchored). */
function shadow(g, w, h, rx) {
  rx = rx || 0.32; const cy = h * 0.9;
  const rad = g.createRadialGradient(w / 2, cy, 0, w / 2, cy, w * rx);
  rad.addColorStop(0, 'rgba(0,0,0,0.5)'); rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad; g.save(); g.translate(w / 2, cy); g.scale(1, 0.3);
  g.beginPath(); g.arc(0, 0, w * rx, 0, 7); g.fill(); g.restore();
}

function lg(g, x0, y0, x1, y1, a, b, c) {
  const grd = g.createLinearGradient(x0, y0, x1, y1);
  grd.addColorStop(0, a); grd.addColorStop(c ? 0.55 : 1, b); if (c) grd.addColorStop(1, c);
  return grd;
}
function poly(g, pts) { g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); }
function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function limb(g, x1, y1, x2, y2, wd, col) { g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); }
function eyes(g, cx, cy, dx, r, col) { glow(g, cx - dx, cy, r * 3, col, 0.7); glow(g, cx + dx, cy, r * 3, col, 0.7); g.fillStyle = col; g.beginPath(); g.arc(cx - dx, cy, r, 0, 7); g.arc(cx + dx, cy, r, 0, 7); g.fill(); }

module.exports = { createCanvas, P, hx, rgb, mix, mix3, mulberry32, makeIcon, glow, grain, shadow, lg, poly, rr, limb, eyes };

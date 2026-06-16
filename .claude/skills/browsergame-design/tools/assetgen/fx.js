/** Spell / projectile FX — frame strips, explosion grid, arrows sheet. Native pixel dims. */
const C = require('./core');

function flame(g, cx, cy, R, seed, c1, c2, c3) {
  const rng = C.mulberry32(seed);
  C.glow(g, cx, cy, R * 1.7, c1, 0.5, true);
  g.save(); g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 7; k++) { const a = rng() * Math.PI * 2, len = R * (0.7 + rng() * 0.7), fx = cx + Math.cos(a) * R * 0.3, fy = cy + Math.sin(a) * R * 0.3; g.beginPath(); g.moveTo(fx, fy); g.quadraticCurveTo(cx + Math.cos(a) * len * 0.6, cy + Math.sin(a) * len * 0.6, cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.lineWidth = R * 0.4 * (1 - k / 9); g.strokeStyle = c2; g.lineCap = 'round'; g.stroke(); }
  g.restore();
  const grd = g.createRadialGradient(cx, cy, 0, cx, cy, R); grd.addColorStop(0, c3); grd.addColorStop(0.4, c2); grd.addColorStop(1, c1);
  g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, R * 0.8, 0, 7); g.fill();
  g.fillStyle = c3; g.beginPath(); g.arc(cx, cy, R * 0.35, 0, 7); g.fill();
}

// strip: N square frames of size S=H laid horizontally; drawFrame(g,S,i,t)
function strip(N, drawFrame) {
  return (g, W, H) => { const S = H; for (let i = 0; i < N; i++) { g.save(); g.translate(i * S, 0); drawFrame(g, S, i, i / (N - 1 || 1)); g.restore(); } };
}
function grid(cols, rows, drawCell) {
  return (g, W, H) => { const cw = W / cols, ch = H / rows; let i = 0; for (let r = 0; r < rows; r++) for (let cc = 0; cc < cols; cc++) { g.save(); g.translate(cc * cw, r * ch); drawCell(g, cw, ch, i++, r, cc); g.restore(); } };
}

const fireball = strip(6, (g, S, i, t) => { const c = S / 2; flame(g, c, c, S * (0.28 + t * 0.12), i * 7 + 3, '#7a1e08', '#ff8a3a', '#ffe9a8'); });
const firebomb = strip(6, (g, S, i, t) => { const c = S / 2; if (i < 3) { g.fillStyle = '#16171d'; g.beginPath(); g.arc(c, c + S * 0.05, S * 0.3, 0, 7); g.fill(); g.strokeStyle = '#3a3e4a'; g.lineWidth = S * 0.04; g.stroke(); C.glow(g, c, c - S * 0.3, S * 0.25, '#ffd488', 0.9, true); g.fillStyle = '#ff8a3a'; g.beginPath(); g.arc(c, c - S * 0.3, S * 0.05, 0, 7); g.fill(); } else flame(g, c, c, S * (0.3 + t * 0.18), i * 9, '#7a1e08', '#ff8a3a', '#ffe9a8'); });
const iceLance = strip(4, (g, S, i) => { const cy = S / 2, cx = S * 0.5; C.glow(g, cx, cy, S * 0.5, '#7fc4ff', 0.4, true); g.save(); g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(180,224,255,${0.4 - k * 0.08})`; g.beginPath(); g.arc(cx - S * 0.2 - k * S * 0.12, cy + Math.sin(k + i) * S * 0.08, S * 0.05, 0, 7); g.fill(); } g.restore(); g.beginPath(); g.moveTo(cx + S * 0.4, cy); g.lineTo(cx - S * 0.05, cy - S * 0.16); g.lineTo(cx - S * 0.25, cy); g.lineTo(cx - S * 0.05, cy + S * 0.16); g.closePath(); g.fillStyle = C.lg(g, cx - S * 0.25, cy, cx + S * 0.4, cy, '#1e4f8a', '#7fc4ff', '#eaf6ff'); g.fill(); g.strokeStyle = 'rgba(10,30,60,0.6)'; g.lineWidth = S * 0.03; g.stroke(); });
const arcaneBolt = strip(6, (g, S, i) => { const c = S / 2, rng = C.mulberry32(i * 13 + 1); C.glow(g, c, c, S * 0.6, '#b07ae8', 0.55, true); const grd = g.createRadialGradient(c, c, 0, c, c, S * 0.32); grd.addColorStop(0, '#f0e0ff'); grd.addColorStop(0.5, '#b07ae8'); grd.addColorStop(1, '#3d1a6e'); g.fillStyle = grd; g.beginPath(); g.arc(c, c, S * 0.3, 0, 7); g.fill(); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = '#d6abff'; g.lineWidth = S * 0.03; for (let k = 0; k < 4; k++) { const a = rng() * 7; g.beginPath(); g.moveTo(c, c); let x = c, y = c; for (let s = 0; s < 3; s++) { x += Math.cos(a) * S * 0.12 + (rng() - 0.5) * S * 0.1; y += Math.sin(a) * S * 0.12 + (rng() - 0.5) * S * 0.1; g.lineTo(x, y); } g.stroke(); } g.restore(); });
const magicOrb = strip(6, (g, S, i, t) => { const c = S / 2, pulse = 0.26 + Math.sin(t * Math.PI * 2) * 0.06; C.glow(g, c, c, S * 0.7, '#9b5cff', 0.5, true); const grd = g.createRadialGradient(c, c, 0, c, c, S * pulse); grd.addColorStop(0, '#ffffff'); grd.addColorStop(0.4, '#c79eff'); grd.addColorStop(1, '#6a30b8'); g.fillStyle = grd; g.beginPath(); g.arc(c, c, S * pulse, 0, 7); g.fill(); g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = '#e8d8ff'; for (let k = 0; k < 3; k++) { const a = t * Math.PI * 2 + k * 2.1; g.beginPath(); g.arc(c + Math.cos(a) * S * 0.34, c + Math.sin(a) * S * 0.34, S * 0.04, 0, 7); g.fill(); } g.restore(); });
const magicSparks = strip(6, (g, S, i, t) => { const c = S / 2, rng = C.mulberry32(99); C.glow(g, c, c, S * 0.5 * (0.5 + t), '#ffe9a8', 0.5 * (1 - t * 0.6), true); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = '#ffd488'; g.lineCap = 'round'; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2 + rng(), r0 = S * 0.1 * t, r1 = S * (0.12 + 0.32 * t); g.lineWidth = S * 0.04 * (1 - t * 0.5); g.beginPath(); g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); g.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.stroke(); } g.restore(); g.fillStyle = `rgba(255,244,216,${1 - t})`; g.beginPath(); g.arc(c, c, S * 0.08 * (1 - t * 0.5), 0, 7); g.fill(); });
const waterBolt = strip(6, (g, S) => { const cy = S / 2, cx = S * 0.52; C.glow(g, cx, cy, S * 0.45, '#3b6fd2', 0.4, true); g.save(); g.globalCompositeOperation = 'lighter'; for (let k = 0; k < 4; k++) { g.fillStyle = `rgba(127,163,236,${0.4 - k * 0.08})`; g.beginPath(); g.arc(cx - S * 0.18 - k * S * 0.12, cy, S * 0.05, 0, 7); g.fill(); } g.restore(); const grd = g.createRadialGradient(cx - S * 0.05, cy - S * 0.05, 0, cx, cy, S * 0.28); grd.addColorStop(0, '#cfe0ff'); grd.addColorStop(0.5, '#3b6fd2'); grd.addColorStop(1, '#14306a'); g.fillStyle = grd; g.beginPath(); g.moveTo(cx + S * 0.32, cy); g.quadraticCurveTo(cx, cy - S * 0.22, cx - S * 0.18, cy); g.quadraticCurveTo(cx, cy + S * 0.22, cx + S * 0.32, cy); g.fill(); });
const rockSling = strip(1, (g, S) => { const c = S / 2, rng = C.mulberry32(3), pts = []; for (let k = 0; k < 7; k++) { const a = k / 7 * 7, rr = S * 0.3 * (0.7 + rng() * 0.5); pts.push([c + Math.cos(a) * rr, c + Math.sin(a) * rr]); } C.poly(g, pts); g.fillStyle = C.lg(g, c, c - S * 0.3, c, c + S * 0.3, '#4d5260', '#16171d'); g.fill(); g.strokeStyle = '#08090d'; g.lineWidth = S * 0.04; g.stroke(); });
const splash = strip(6, (g, S, i, t) => { const c = S / 2; C.glow(g, c, c, S * 0.4 * (0.5 + t), '#7fc4ff', 0.4 * (1 - t * 0.5), true); g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = `rgba(180,224,255,${1 - t})`; g.lineWidth = S * 0.05 * (1 - t * 0.5); g.beginPath(); g.arc(c, c, S * (0.08 + 0.36 * t), 0, 7); g.stroke(); g.fillStyle = `rgba(220,240,255,${1 - t})`; for (let k = 0; k < 6; k++) { const a = k / 6 * 7, r = S * (0.1 + 0.34 * t); g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, S * 0.04 * (1 - t * 0.4), 0, 7); g.fill(); } g.restore(); });
const explosion = grid(4, 4, (g, W, H, i) => { const c = W / 2, t = i / 15, rng = C.mulberry32(i * 17 + 5), R = W * (0.12 + t * 0.34); if (t < 0.6) { C.glow(g, c, c, R * 2, '#ff8a3a', 0.6 * (1 - t), true); const grd = g.createRadialGradient(c, c, 0, c, c, R); grd.addColorStop(0, '#fff4d8'); grd.addColorStop(0.4, '#ff8a3a'); grd.addColorStop(0.8, '#c41f1f'); grd.addColorStop(1, 'rgba(40,10,5,0)'); g.fillStyle = grd; g.beginPath(); g.arc(c, c, R, 0, 7); g.fill(); g.save(); g.globalCompositeOperation = 'lighter'; g.fillStyle = '#ffd488'; for (let k = 0; k < 8; k++) { const a = k / 8 * 7 + rng(), r = R * (0.9 + rng() * 0.5); g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, W * 0.03, 0, 7); g.fill(); } g.restore(); } else { g.fillStyle = `rgba(60,60,68,${0.5 * (1 - t)})`; for (let k = 0; k < 5; k++) { const a = k / 5 * 7, r = R * 0.8; g.beginPath(); g.arc(c + Math.cos(a) * r, c + Math.sin(a) * r, W * 0.12 * (1 - t * 0.3), 0, 7); g.fill(); } C.glow(g, c, c, R, '#ff6a2a', 0.3 * (1 - t), true); } });
const ACOLS = ['#c9a24b', '#ff8a3a', '#7fc4ff', '#b07ae8', '#aef07a', '#d7dbe3', '#d23b3b'];
const arrows = grid(11, 14, (g, W, H, i, r, cc) => { const c = W / 2, col = ACOLS[r % ACOLS.length], ang = (cc / 11) * Math.PI * 2; g.save(); g.translate(c, c); g.rotate(ang); C.glow(g, 0, 0, W * 0.4, col, 0.35, true); g.strokeStyle = col; g.lineWidth = W * 0.07; g.lineCap = 'round'; g.beginPath(); g.moveTo(-W * 0.32, 0); g.lineTo(W * 0.3, 0); g.stroke(); g.fillStyle = col; g.beginPath(); g.moveTo(W * 0.36, 0); g.lineTo(W * 0.18, -W * 0.12); g.lineTo(W * 0.18, W * 0.12); g.closePath(); g.fill(); g.strokeStyle = col; g.lineWidth = W * 0.04; g.beginPath(); g.moveTo(-W * 0.32, 0); g.lineTo(-W * 0.24, -W * 0.1); g.moveTo(-W * 0.32, 0); g.lineTo(-W * 0.24, W * 0.1); g.stroke(); g.restore(); });

function jobs() {
  return [
    { path: 'fx/spell_fireball.png', w: 96, h: 16, ss: 4, draw: fireball },
    { path: 'fx/spell_firebomb.png', w: 96, h: 16, ss: 4, draw: firebomb },
    { path: 'fx/spell_ice_lance.png', w: 64, h: 16, ss: 4, draw: iceLance },
    { path: 'fx/spell_arcane_bolt.png', w: 96, h: 16, ss: 4, draw: arcaneBolt },
    { path: 'fx/spell_magic_orb.png', w: 96, h: 16, ss: 4, draw: magicOrb },
    { path: 'fx/spell_magic_sparks.png', w: 96, h: 16, ss: 4, draw: magicSparks },
    { path: 'fx/spell_water_bolt.png', w: 96, h: 16, ss: 4, draw: waterBolt },
    { path: 'fx/spell_rock_sling.png', w: 16, h: 16, ss: 4, draw: rockSling },
    { path: 'fx/spell_splash.png', w: 192, h: 32, ss: 4, draw: splash },
    { path: 'fx/explosion-cuzco.png', w: 256, h: 256, ss: 3, draw: explosion },
    { path: 'fx/spell_arrows.png', w: 352, h: 448, ss: 3, draw: arrows },
  ];
}
module.exports = { jobs };

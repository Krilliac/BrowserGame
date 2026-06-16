/**
 * Per-limb articulated rigs — true walk cycles (swinging legs w/ knee bend, counter-swinging
 * arms, torso bob) for the hero-class bipeds. Overrides the transform-based loops in anim.js for
 * these mobs. 4-frame idle / walk / attack strips (256×64).
 */
const C = require('./core');
const TAU = Math.PI * 2;

/** Mobs that have a hand-rigged walk (anim.js skips these so rig.js owns them). */
const RIGGED = ['hero', 'skeleton', 'orc', 'goblin'];

function seg(g, x, y, ang, len, wd, col) { const ex = x + Math.sin(ang) * len, ey = y + Math.cos(ang) * len; g.strokeStyle = col; g.lineWidth = wd; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); return [ex, ey]; }

function drawBiped(g, w, h, cfg, pose) {
  const cx = w / 2, S = w / 64, hipY = h * 0.62, shY = h * 0.4 + pose.bob, hipX = w * 0.075 * cfg.wide, shX = w * 0.12 * cfg.wide;
  const thL = h * 0.15 * cfg.tall, shL = h * 0.14 * cfg.tall, uA = h * 0.12, fA = h * 0.1;
  function leg(side, thighA, knee) { const hx = cx + side * hipX, hy = hipY; const [kx, ky] = seg(g, hx, hy, thighA, thL, cfg.legW * S, cfg.legD); const [fx, fy] = seg(g, kx, ky, thighA - knee, shL, cfg.legW * 0.85 * S, cfg.legD); g.fillStyle = cfg.foot; g.beginPath(); g.ellipse(fx + Math.sin(thighA - knee) * 2, fy, w * 0.06, h * 0.03, 0, 0, 7); g.fill(); }
  function arm(side, armA, hand) { const sx = cx + side * shX, sy = shY; const [ex, ey] = seg(g, sx, sy, armA, uA, cfg.armW * S, cfg.arm); const ha = armA + (hand || 0); const [hx, hy] = seg(g, ex, ey, ha, fA, cfg.armW * 0.85 * S, cfg.arm); return [hx, hy, ha]; }
  leg(pose.back < 0 ? -1 : 1, pose.legB, pose.kneeB);
  if (cfg.cloak) { g.fillStyle = cfg.cloak; g.beginPath(); g.moveTo(cx - shX, shY + 2); g.quadraticCurveTo(cx - shX * 1.6, hipY + h * 0.18, cx - shX * 0.7, h * 0.84); g.lineTo(cx + shX * 0.7, h * 0.84); g.quadraticCurveTo(cx + shX * 1.6, hipY + h * 0.18, cx + shX, shY + 2); g.closePath(); g.fill(); }
  arm(-1, pose.armBk, 0.1);
  leg(pose.back < 0 ? 1 : -1, pose.legF, pose.kneeF);
  g.fillStyle = cfg.bodyFill(g, shY, hipY); g.beginPath(); g.moveTo(cx - shX, shY); g.lineTo(cx + shX, shY); g.lineTo(cx + hipX * 1.4, hipY + 2); g.lineTo(cx - hipX * 1.4, hipY + 2); g.closePath(); g.fill(); if (cfg.bodyStroke) { g.strokeStyle = cfg.bodyStroke; g.lineWidth = S; g.stroke(); }
  if (cfg.torsoDetail) cfg.torsoDetail(g, cx, shY, hipY, S);
  cfg.head(g, cx, shY - h * 0.02, S, pose.bob);
  const [hx, hy, ha] = arm(1, pose.armF, pose.armHand || 0);
  if (cfg.weapon) cfg.weapon(g, hx, hy, ha, S, pose);
}

const POSE = {
  idle: (i) => { const p = i / 4 * TAU; return { legF: 0.06, legB: -0.06, kneeF: 0.06, kneeB: 0.06, bob: -Math.sin(p) * 0.9, armF: 0.12 + Math.sin(p) * 0.03, armBk: -0.12, back: -1 }; },
  walk: (i) => { const p = i / 4 * TAU; return { legF: Math.sin(p) * 0.55, legB: Math.sin(p + Math.PI) * 0.55, kneeF: Math.max(0, Math.sin(p + 1.4)) * 0.8, kneeB: Math.max(0, Math.sin(p + Math.PI + 1.4)) * 0.8, bob: -Math.abs(Math.cos(p)) * 2.2, armF: Math.sin(p + Math.PI) * 0.45, armBk: Math.sin(p) * 0.45, back: Math.sin(p) }; },
  attack: (i) => { const A = [{ armF: -1.4, bob: 1, legF: 0.2, legB: -0.3 }, { armF: -1.7, bob: 0 }, { armF: 0.5, bob: -2, legF: -0.3, legB: 0.3, armHand: 0.3 }, { armF: 0.1, bob: 0 }][i]; return Object.assign({ legF: 0, legB: 0, kneeF: 0.1, kneeB: 0.1, armBk: -0.3, back: -1, armHand: 0 }, A); },
};

const heads = {
  helmet: (g, cx, y, S) => { g.fillStyle = '#c79a6a'; g.beginPath(); g.arc(cx, y - 6, 7 * S, 0, 7); g.fill(); g.fillStyle = '#5a6170'; g.beginPath(); g.arc(cx, y - 8, 8 * S, Math.PI, 0); g.fill(); g.fillRect(cx - 8 * S, y - 9, 16 * S, 3 * S); g.fillStyle = '#1b1d24'; g.fillRect(cx - 5 * S, y - 6, 10 * S, 2 * S); },
  skull: (g, cx, y, S) => { g.fillStyle = '#dcd4bd'; g.beginPath(); g.arc(cx, y - 6, 7.5 * S, 0, 7); g.fill(); g.fillRect(cx - 5 * S, y - 2, 10 * S, 4 * S); g.fillStyle = '#1b1d24'; g.beginPath(); g.arc(cx - 3 * S, y - 6, 2 * S, 0, 7); g.arc(cx + 3 * S, y - 6, 2 * S, 0, 7); g.fill(); g.fillRect(cx - S, y - 3, 2 * S, 3 * S); },
  tusk: (g, cx, y, S) => { g.fillStyle = '#5a7a3a'; g.beginPath(); g.arc(cx, y - 6, 8 * S, 0, 7); g.fill(); g.fillStyle = '#e8e4d8'; g.beginPath(); g.moveTo(cx - 4 * S, y - 2); g.lineTo(cx - 3 * S, y + 3 * S); g.lineTo(cx - 1.5 * S, y - 2); g.moveTo(cx + 4 * S, y - 2); g.lineTo(cx + 3 * S, y + 3 * S); g.lineTo(cx + 1.5 * S, y - 2); g.fill(); C.glow(g, cx - 3 * S, y - 7, 4 * S, '#ffd24a', 0.7); C.glow(g, cx + 3 * S, y - 7, 4 * S, '#ffd24a', 0.7); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(cx - 3 * S, y - 7, 1.6 * S, 0, 7); g.arc(cx + 3 * S, y - 7, 1.6 * S, 0, 7); g.fill(); },
  ear: (g, cx, y, S) => { g.fillStyle = '#6a9e4a'; g.beginPath(); g.arc(cx, y - 5, 7 * S, 0, 7); g.fill(); g.fillStyle = '#4a7030'; g.beginPath(); g.moveTo(cx - 6 * S, y - 6); g.lineTo(cx - 14 * S, y - 9); g.lineTo(cx - 6 * S, y - 1); g.closePath(); g.moveTo(cx + 6 * S, y - 6); g.lineTo(cx + 14 * S, y - 9); g.lineTo(cx + 6 * S, y - 1); g.closePath(); g.fill(); g.fillStyle = '#ffd24a'; g.beginPath(); g.arc(cx - 2.6 * S, y - 6, 1.5 * S, 0, 7); g.arc(cx + 2.6 * S, y - 6, 1.5 * S, 0, 7); g.fill(); },
};
const weapons = {
  sword: (g, hx, hy, ang, S) => { g.strokeStyle = '#6b5226'; g.lineWidth = 3 * S; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx - Math.sin(ang + 1.5) * 2 * S, hy - Math.cos(ang + 1.5) * 2 * S); g.lineTo(hx + Math.sin(ang + 1.5) * 4 * S, hy + Math.cos(ang + 1.5) * 4 * S); g.stroke(); g.strokeStyle = '#c0c8d4'; g.lineWidth = 2.4 * S; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.sin(ang) * 22 * S, hy + Math.cos(ang) * 22 * S); g.stroke(); },
  axe: (g, hx, hy, ang, S) => { g.strokeStyle = '#6b5226'; g.lineWidth = 2.6 * S; g.lineCap = 'round'; const tx = hx + Math.sin(ang) * 20 * S, ty = hy + Math.cos(ang) * 20 * S; g.beginPath(); g.moveTo(hx, hy); g.lineTo(tx, ty); g.stroke(); g.fillStyle = '#9aa3b2'; g.beginPath(); g.moveTo(tx - Math.sin(ang + 1.5) * 2 * S, ty - Math.cos(ang + 1.5) * 2 * S); g.quadraticCurveTo(tx + Math.sin(ang) * 8 * S, ty + Math.cos(ang) * 8 * S, tx + Math.sin(ang + 1.5) * 7 * S, ty + Math.cos(ang + 1.5) * 7 * S); g.closePath(); g.fill(); },
  dagger: (g, hx, hy, ang, S) => { g.strokeStyle = '#c0c8d4'; g.lineWidth = 2 * S; g.lineCap = 'round'; g.beginPath(); g.moveTo(hx, hy); g.lineTo(hx + Math.sin(ang) * 9 * S, hy + Math.cos(ang) * 9 * S); g.stroke(); },
};

const CFG = {
  hero: { wide: 1, tall: 1, legW: 5.5, legD: '#3a3e4a', armW: 3.5, arm: '#5a6170', foot: '#2a2d36', cloak: '#7a1e2e', bodyFill: (g, s, hp) => C.lg(g, 0, s, 0, hp, '#8a93a4', '#4d5260'), bodyStroke: '#c9a24b', head: heads.helmet, weapon: weapons.sword },
  skeleton: { wide: 0.92, tall: 1, legW: 3.2, legD: '#dcd4bd', armW: 2.6, arm: '#dcd4bd', foot: '#a39a82', bodyFill: () => 'rgba(0,0,0,0)', torsoDetail: (g, cx, s, hp, S) => { g.strokeStyle = '#dcd4bd'; g.lineWidth = 4 * S; g.beginPath(); g.moveTo(cx, s); g.lineTo(cx, hp); g.stroke(); g.strokeStyle = '#a39a82'; g.lineWidth = 1.6 * S; for (let r = 0; r < 4; r++) { g.beginPath(); g.arc(cx, s + (hp - s) * 0.2 + r * (hp - s) * 0.2, 6 * S, 0.4, Math.PI - 0.4); g.stroke(); } }, head: heads.skull, weapon: weapons.sword },
  orc: { wide: 1.15, tall: 0.98, legW: 6, legD: '#3a5424', armW: 4, arm: '#5a7a3a', foot: '#3a2d20', bodyFill: (g, s, hp) => C.lg(g, 0, s, 0, hp, '#5a7a3a', '#3a5424'), torsoDetail: (g, cx, s, hp, S) => { g.fillStyle = '#5a4028'; g.fillRect(cx - 9 * S, s + (hp - s) * 0.4, 18 * S, 5 * S); }, head: heads.tusk, weapon: weapons.axe },
  goblin: { wide: 0.85, tall: 0.82, legW: 4, legD: '#4a7030', armW: 2.8, arm: '#6a9e4a', foot: '#3a2d20', bodyFill: (g, s, hp) => C.lg(g, 0, s, 0, hp, '#6a9e4a', '#4a7030'), head: heads.ear, weapon: weapons.dagger },
};

function jobs() {
  const out = [];
  for (const [name, cfg] of Object.entries(CFG)) for (const [state, pf] of Object.entries(POSE))
    out.push({ path: `mobs/${name}_${state}.png`, w: 256, h: 64, ss: 3, grain: 7, draw: (g) => { for (let i = 0; i < 4; i++) { g.save(); g.translate(i * 64, 0); C.shadow(g, 64, 64, 0.3); drawBiped(g, 64, 64, cfg, pf(i)); g.restore(); } } });
  return out;
}
module.exports = { jobs, RIGGED };

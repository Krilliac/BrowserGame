/** Mob animation strips — 4-frame idle / walk / attack loops (256×64) built from the mob draws. */
const C = require('./core');
const { MOBS } = require('./mobs');
const { RIGGED } = require('./rig');
const S = 64, N = 4, TAU = Math.PI * 2;

// Flyers / stationary mobs hover or pulse instead of striding.
const HOVER = new Set(['bat', 'slime', 'giant-worm']);

const PARAMS = {
  idle: (i) => { const t = i / N; return { bob: -Math.sin(t * TAU) * 1.2, sy: 1 + Math.sin(t * TAU) * 0.03, sx: 1 - Math.sin(t * TAU) * 0.02 }; },
  walk: (i) => { const t = i / N; return { bob: -Math.abs(Math.sin(t * TAU)) * 2.2, rot: Math.sin(t * TAU) * 0.05 }; },
  hover: (i) => { const t = i / N; return { bob: -Math.sin(t * TAU) * 2.2, sx: 1 + Math.sin(t * TAU) * 0.02 }; },
  attack: (i) => [{ rot: -0.1, bob: 1 }, { rot: -0.04 }, { rot: 0.17, sx: 1.06, sy: 1.06, bob: -2 }, { rot: 0.04 }][i],
  pulse: (i) => [{ sx: 0.96, sy: 0.96 }, { sx: 1, sy: 1 }, { sx: 1.12, sy: 1.12, bob: -2 }, { sx: 1.02, sy: 1.02 }][i],
};

/** Render one mob to a 64² sprite, matching the static mobs.js output (ss3 + grain8). */
function sprite(name) { const c = C.makeIcon(S, S, 3, MOBS[name]); C.grain(c, 8); return c; }

function frame(g, img, fx, p) {
  g.save(); const ax = S / 2, ay = S * 0.9;
  g.translate(fx + ax, (p.bob || 0) + ay); g.rotate(p.rot || 0); g.scale(p.sx || 1, p.sy || 1); g.translate(-ax, -ay);
  g.imageSmoothingEnabled = true; g.quality = 'best'; g.drawImage(img, 0, 0, S, S); g.restore();
}

function jobs() {
  const out = [];
  for (const name of Object.keys(MOBS)) {
    if (RIGGED.includes(name)) continue; // rig.js owns these (true per-limb cycles)
    const states = {
      idle: PARAMS.idle,
      walk: HOVER.has(name) ? PARAMS.hover : PARAMS.walk,
      attack: HOVER.has(name) ? PARAMS.pulse : PARAMS.attack,
    };
    for (const [state, pf] of Object.entries(states)) {
      out.push({ path: `mobs/${name}_${state}.png`, w: S * N, h: S, ss: 1, draw: (g) => { const spr = sprite(name); for (let i = 0; i < N; i++) frame(g, spr, i * S, pf(i)); } });
    }
  }
  return out;
}
module.exports = { jobs };

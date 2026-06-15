/**
 * Mob sprite sources for the original Gloomwood top-down roster (the design-system art under
 * `public/assets/curated/mobs/`). Pure data + a pure name→archetype resolver — no Pixi, no DOM — so
 * the mapping stays unit-testable (same pattern as decor-sprites.ts / ground-tiles.ts / rogues-sprites.ts).
 *
 * Each archetype ships three 4-frame horizontal strips (`<arch>_{idle,walk,attack}.png`, 256×64,
 * frame = 64²) plus a static portrait (`<arch>.png`, 64²). The renderer composes the three strips
 * into one virtual 3-row sheet (idle=row0, walk=row1, attack=row2) so a mob plugs straight into the
 * existing animated-actor pipeline (resolveAnim / cast shadows / fx-driven attack & death one-shots)
 * — see {@link MOB_CLIPS} and pixi-renderer's MOB_SHEETS.
 *
 * TIERING: this is the *tail-coverage* tier. The renderer keeps its richer generated 8/16-direction
 * sheets (adventurer/skeleton/wolf/bat/boss) as the first choice for the archetypes they cover well;
 * {@link mobArchetype} only resolves the long tail those sheets don't — demons, golems, vermin,
 * oozes, nagas, etc. — which previously fell back to the licensed 32rogues static cell or a
 * procedural orb. So the design roster ships every creature, but a handful (skeleton/bat/cultist/
 * wraith/hellhound) are intentionally left to the better generated/animated sheets.
 */

import type { ClipSet } from './animation-controller.js';

/** Web directory of the curated mob art (served from the Vite web root, `public/`). */
export const MOB_DIR = '/assets/curated/mobs';
/** Animation strip geometry: every `<arch>_<state>.png` is 4 frames of 64×64 laid out horizontally. */
export const MOB_FW = 64;
export const MOB_FH = 64;
export const MOB_FRAMES = 4;

/** The animation states each archetype ships as a separate strip file. */
export type MobState = 'idle' | 'walk' | 'attack';

export interface MobArchetype {
  /** Native px → world px multiplier so the creature lands near the other actors' on-screen height. */
  scale: number;
  /** Hover (don't stride) and cast a smaller, fainter shadow — bats, floating horrors. */
  flying?: boolean;
}

/**
 * The archetypes {@link mobArchetype} resolves to, each present as `<arch>{,_idle,_walk,_attack}.png`
 * under {@link MOB_DIR}. Scales are tuned so a 64px frame reads at roughly the same on-screen height
 * as the generated 48px actor sheets (≈46px): brutes a touch bigger, vermin a touch smaller.
 */
export const MOB_ARCHETYPES: Record<string, MobArchetype> = {
  zombie: { scale: 0.72 },
  ghoul: { scale: 0.72 },
  lich: { scale: 0.74 },
  banshee: { scale: 0.72, flying: true },
  reaper: { scale: 0.78 },
  demon: { scale: 0.86 },
  imp: { scale: 0.58, flying: true },
  orc: { scale: 0.74 },
  goblin: { scale: 0.62 },
  troll: { scale: 0.9 },
  minotaur: { scale: 0.9 },
  golem: { scale: 0.92 },
  naga: { scale: 0.8 },
  gorgon: { scale: 0.8 },
  kobold: { scale: 0.6 },
  myconid: { scale: 0.7 },
  slime: { scale: 0.66 },
  spider: { scale: 0.66 },
  'giant-rat': { scale: 0.6 },
  'giant-worm': { scale: 0.78 },
  'giant-centipede': { scale: 0.7 },
};

/**
 * First match wins — specific creature words before the generic archetypes they would otherwise
 * collide with. Mirrors rogues-sprites' MOB_RULES intent, but only for the tail the generated sheets
 * don't already cover (the renderer checks boss / wolf / skeleton / bat sheets BEFORE calling this).
 */
const MOB_ARCHETYPE_RULES: [RegExp, string][] = [
  // --- vermin / beasts (specific bodies before the generic words) ---
  [/centipede|crawler/, 'giant-centipede'],
  [/worm|grub/, 'giant-worm'],
  [/spider|brood|arachnid/, 'spider'],
  [/\brat\b|vermin|rodent/, 'giant-rat'],
  // --- amorphous / fungal ---
  [/ooze|slime|jelly|gel/, 'slime'],
  [/myconid|fungal|mushroom|spore/, 'myconid'],
  // --- demons / brutes / constructs ---
  [/imp\b/, 'imp'],
  [/demon|devil|fiend|hellspawn/, 'demon'],
  [/golem|construct|juggernaut|colossus|forge|sentinel/, 'golem'],
  [/minotaur|brute|ogre/, 'minotaur'],
  [/troll|hurler|behemoth/, 'troll'],
  // --- serpentine ---
  [/gorgon|medusa/, 'gorgon'],
  [/naga|serpentfolk|lamia/, 'naga'],
  // --- humanoids ---
  [/orc\b|orcish/, 'orc'],
  [/goblin|hobgoblin/, 'goblin'],
  [/kobold/, 'kobold'],
  // --- undead tail (skeleton/cultist/wraith are handled by the generated sheets first) ---
  [/lich|bonelord|crypt lord/, 'lich'],
  [/banshee|wailer/, 'banshee'],
  [/reaper|revenant|executioner/, 'reaper'],
  [/ghoul|ghast/, 'ghoul'],
  [/zombie|thrall|drowned|hulk|corpse/, 'zombie'],
];

/**
 * Resolve a mob display name (e.g. "Bog Shambler", "Maggath, the Devourer") to a curated archetype,
 * or undefined when no rule matches (the renderer then keeps the generated sheet or procedural orb).
 */
export function mobArchetype(name: string): string | undefined {
  const n = name.toLowerCase();
  for (const [re, arch] of MOB_ARCHETYPE_RULES) {
    if (re.test(n)) return arch;
  }
  return undefined;
}

/** The texture-alias / sheet key the renderer uses for a composed archetype sheet. */
export function mobSheetKey(arch: string): string {
  return `mob:${arch}`;
}

/** Web path of one animation strip for an archetype + state. */
export function mobStripSrc(arch: string, state: MobState): string {
  return `${MOB_DIR}/${arch}_${state}.png`;
}

/** Web path of an archetype's static portrait (the fallback / first frame). */
export function mobStaticSrc(arch: string): string {
  return `${MOB_DIR}/${arch}.png`;
}

/**
 * The clip set every composed mob sheet uses: the three strips become rows 0/1/2 of a virtual sheet
 * (idle/walk/attack), all `dirless` because the art is single-facing top-down. Plugged into the
 * renderer's resolveAnim exactly like the generated creature sheets, so attack one-shots (from the
 * server's melee FxEvents) and locomotion (idle vs walk by measured movement) work for free. Mobs
 * ship no hurt/death strip, so those one-shots no-op and resolveAnim falls back to idle/walk.
 */
export const MOB_CLIPS: ClipSet = {
  dirOrder: ['N', 'W', 'S', 'E'], // unused: every clip is dirless (single-facing art)
  clips: {
    idle: { row0: 0, startCol: 0, frames: MOB_FRAMES, perFrameMs: 150, loop: true, dirless: true },
    walk: { row0: 1, startCol: 0, frames: MOB_FRAMES, perFrameMs: 120, loop: true, dirless: true },
    attack: {
      row0: 2,
      startCol: 0,
      frames: MOB_FRAMES,
      perFrameMs: 85,
      loop: false,
      dirless: true,
    },
  },
};

/** Row index → state, so the renderer maps resolveAnim's row back to the strip it composed. */
export const MOB_STATE_BY_ROW: MobState[] = ['idle', 'walk', 'attack'];

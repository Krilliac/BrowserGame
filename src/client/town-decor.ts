/**
 * Town decor — static set-dressing for the starting town ("Aldermere") that turns the spawn
 * plaza from empty ground into a settlement. This is DATA only: world-space prop placements the
 * PixiJS renderer reads once (in setArea) and bakes into cached Graphics — it never rebuilds per
 * frame. Each prop is drawn with the same 2.5D projection, y-sorting, and soft shadow conventions
 * the actor sprites use, so props occlude/sort correctly against players.
 *
 * Layout constraints (must stay true so we never block gameplay):
 *  - The town NPC line lives at y≈560, x:580..1020 — keep the y:540..580 strip free of solid props.
 *  - Player spawn / inbound portal is at (800,600) — keep it clear.
 *  - The "To Gloomwood" portal rect is at x:1520..1600, y:500..700 — leave the east road open.
 *
 * The renderer (pixi-renderer.ts) owns HOW these are drawn; this module owns WHAT and WHERE.
 */

/** The town these props belong to — the renderer only draws decor when the area id matches. */
export const TOWN_AREA_ID = 'town';

/** Warm palette for the town's woodwork, stone, cloth and foliage (CSS hex). */
export const TOWN_PALETTE = {
  cobbleBase: '#48433a', // plaza paving fill (warmer/lighter than the grassy town ground)
  cobbleSpeck: '#5a5446', // individual cobble highlights
  cobbleEdge: '#2f2b25', // mortar / gaps between stones
  wood: '#6b4a2c', // posts, stall frames, fence rails
  woodDark: '#4a3219', // shaded wood
  stone: '#7d776b', // well rim, planter stone
  stoneDark: '#56514a',
  water: '#3f6c84', // well water
  thatch: '#b8893f', // stall awning / roof straw
  cloth: '#9c3535', // banner / awning cloth (town red)
  clothAlt: '#2f5a8c', // a second banner color (town blue)
  leaf: '#3a5836', // planter greenery
  lampGlow: 0xffcaa0, // warm lamp light tint (0xRRGGBB for the additive light layer)
} as const;

/** A lamp post: emits a soft warm glow on the additive light layer (consistent with the bloom). */
export interface TownLamp {
  kind: 'lamp';
  x: number;
  y: number;
}

/** A market stall: a wooden frame with a striped cloth/thatch awning. */
export interface TownStall {
  kind: 'stall';
  x: number;
  y: number;
  /** Awning cloth color (CSS hex) — alternated so the row of stalls reads as varied. */
  color: string;
}

/** A tall banner on a pole — billboarded upward like an actor, casts a soft shadow. */
export interface TownBanner {
  kind: 'banner';
  x: number;
  y: number;
  color: string;
}

/** A stone planter with greenery — a low accent prop. */
export interface TownPlanter {
  kind: 'planter';
  x: number;
  y: number;
}

/** A fence segment: a short run of rails between two posts, defined by its two endpoints. */
export interface TownFence {
  kind: 'fence';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** The central well / fountain — the plaza centerpiece. */
export interface TownWell {
  kind: 'well';
  x: number;
  y: number;
}

export type TownProp = TownLamp | TownStall | TownBanner | TownPlanter | TownFence | TownWell;

/**
 * The cobblestone plaza ground patch (world-space rect). Drawn subtly lighter/warmer than the open
 * town grass so the settled area reads as paved. Sits under the NPC line and the well, framed by
 * the props below. It is walkable — only a ground texture, no collision.
 */
export const TOWN_PLAZA = { x: 520, y: 500, w: 580, h: 280 } as const;

/**
 * Every town prop in world coordinates. Hand-placed (not procedural-scattered) so the plaza has a
 * deliberate, framed composition: a fenced square with a well at its heart, a row of market stalls
 * along the south, lamp posts at the corners, banners flanking the spawn, and planters as accents.
 */
export const TOWN_PROPS: readonly TownProp[] = [
  // --- Centerpiece: the well, just south of the NPC line and below the spawn point (800,600). ---
  { kind: 'well', x: 800, y: 660 },

  // --- Corner lamp posts framing the plaza (warm glow at night). Clear of the NPC strip. ---
  { kind: 'lamp', x: 560, y: 520 },
  { kind: 'lamp', x: 1040, y: 520 },
  { kind: 'lamp', x: 560, y: 760 },
  { kind: 'lamp', x: 1040, y: 760 },
  // Two more lamps lining the road east toward the Gloomwood portal.
  { kind: 'lamp', x: 1200, y: 600 },
  { kind: 'lamp', x: 1360, y: 600 },

  // --- Market stalls along the south edge of the plaza (below the well, clear of spawn). ---
  { kind: 'stall', x: 620, y: 730, color: TOWN_PALETTE.cloth },
  { kind: 'stall', x: 730, y: 745, color: TOWN_PALETTE.thatch },
  { kind: 'stall', x: 880, y: 745, color: TOWN_PALETTE.clothAlt },
  { kind: 'stall', x: 985, y: 730, color: TOWN_PALETTE.cloth },

  // --- Banners flanking the spawn approach (tall, billboarded). Kept off the y:540..580 strip. ---
  { kind: 'banner', x: 700, y: 510, color: TOWN_PALETTE.cloth },
  { kind: 'banner', x: 900, y: 510, color: TOWN_PALETTE.clothAlt },

  // --- Planters as low accents around the well and plaza edges. ---
  { kind: 'planter', x: 720, y: 650 },
  { kind: 'planter', x: 880, y: 650 },
  { kind: 'planter', x: 600, y: 690 },
  { kind: 'planter', x: 1000, y: 690 },

  // --- Fences framing the plaza perimeter, with gaps left for the spawn, NPC line, and roads. ---
  // North edge (split around the banners / NPC approach so players can walk in from the top).
  { kind: 'fence', x1: 540, y1: 505, x2: 660, y2: 505 },
  { kind: 'fence', x1: 940, y1: 505, x2: 1060, y2: 505 },
  // West edge.
  { kind: 'fence', x1: 540, y1: 505, x2: 540, y2: 775 },
  // East edge (split to leave the road to the Gloomwood portal open around y:600).
  { kind: 'fence', x1: 1060, y1: 505, x2: 1060, y2: 560 },
  { kind: 'fence', x1: 1060, y1: 640, x2: 1060, y2: 775 },
  // South edge (behind the stalls).
  { kind: 'fence', x1: 540, y1: 775, x2: 1060, y2: 775 },
];

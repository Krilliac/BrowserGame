/**
 * Sprite sources for decor props — pure data + a deterministic variant picker, no Pixi, no DOM
 * (same pattern as ground-tiles.ts / rogues-sprites.ts so the mapping stays unit-testable).
 *
 * The renderer's makeDecorProp consults this map first: kinds present here are drawn as Sprites
 * (anchored at the foot, y-sorted, soft shadow added by the renderer); kinds absent keep their
 * procedural Graphics draw. Light-emitting props (bonfire/torch/shrine) deliberately stay
 * procedural — their flames and glows are animated per frame.
 *
 * Every file under /assets/curated/decor/ was hand-picked from the extracted asset packs (see
 * public/assets/INVENTORY.md) and cropped to its content bounding box, so a sprite's canvas IS
 * its visible art (plus the pack's small baked ground shadow). Sources:
 * - grave/bones/dead-tree/tree/rock/crystal-1..3/ruin/skull-pile/thorn-plant: CraftPix `undead`
 *   pack, Objects_separately (the `shadow1` shading variant of each object).
 * - mushroom/stalagmite/crystal-4: CraftPix `cave-objects` pack, Objects_separately.
 * - horror-plant: CraftPix `cursed-land` pack, Objects_separetely (eye/tentacle/jaws/many-eyes/
 *   meat-flower/fetus fleshy plants).
 * - barrel: dungeon-objects Other_objects.png; crate: top-down-dungeon Objects.png; pot-*: the
 *   four intact amphora colors from Seliel's "breakable pots.png".
 *
 * `scale` converts the sprite's native pixels to world px (the renderer projects 1 world px =
 * 1 screen px horizontally) so each prop reads at the same size as its procedural counterpart:
 * barrel ≈ 22 px tall, crate ≈ 20, graves ≈ 24-32, trees ≈ 45-70.
 */

export interface DecorSprite {
  /** Web path of the image, served from the Vite web root (`public/`). */
  src: string;
  /** Optional sub-rect for sheet sources, in native px. Omitted = the whole image. */
  frame?: { x: number; y: number; w: number; h: number };
  /** Native px → world px multiplier. */
  scale: number;
  /** Foot anchor as a fraction of the (frame) height; defaults to 1 (the bottom edge). */
  anchorY?: number;
}

const DECOR = '/assets/curated/decor';

/** One sprite per kind, or an array of variants picked deterministically by world position. */
export const DECOR_SPRITES: Record<string, DecorSprite | DecorSprite[]> = {
  // --- Existing kinds where a sprite beats the procedural draw. ---
  barrel: { src: `${DECOR}/barrel.png`, scale: 0.54 },
  crate: { src: `${DECOR}/crate.png`, scale: 1.1 },

  // --- New set-dressing kinds for content expansion. ---
  pot: [
    { src: `${DECOR}/pot-green.png`, scale: 0.77 },
    { src: `${DECOR}/pot-red.png`, scale: 0.77 },
    { src: `${DECOR}/pot-white.png`, scale: 0.77 },
    { src: `${DECOR}/pot-amber.png`, scale: 0.77 },
  ],
  grave: [
    { src: `${DECOR}/grave-1.png`, scale: 1.4 }, // plain upright headstone
    { src: `${DECOR}/grave-2.png`, scale: 1.4 }, // leaning headstone
    { src: `${DECOR}/grave-3.png`, scale: 1.25 }, // rounded, mossy base
    { src: `${DECOR}/grave-4.png`, scale: 1.5 }, // squat framed slab
    { src: `${DECOR}/grave-5.png`, scale: 1.5 }, // arched, engraved
    { src: `${DECOR}/grave-6.png`, scale: 1.15 }, // tall monolith with rubble
  ],
  bones: [
    { src: `${DECOR}/bones-1.png`, scale: 0.9 }, // scattered small bones
    { src: `${DECOR}/bones-2.png`, scale: 0.9 }, // skull trio
    { src: `${DECOR}/bones-3.png`, scale: 0.85 }, // ribs in grass
    { src: `${DECOR}/bones-4.png`, scale: 0.65 }, // bird-skull bone pile
    { src: `${DECOR}/bones-5.png`, scale: 0.55 }, // tall rib arc
    { src: `${DECOR}/bones-6.png`, scale: 0.8 }, // ram-horned skull
  ],
  dead_tree: [
    { src: `${DECOR}/dead-tree-1.png`, scale: 0.8 }, // big pale gnarled tree
    { src: `${DECOR}/dead-tree-2.png`, scale: 0.8 },
    { src: `${DECOR}/dead-tree-3.png`, scale: 1.0 }, // small
    { src: `${DECOR}/dead-tree-4.png`, scale: 0.85 }, // fallen log
  ],
  tree: [
    { src: `${DECOR}/tree-1.png`, scale: 0.9 }, // dark leafless tree, large
    { src: `${DECOR}/tree-2.png`, scale: 0.9 },
    { src: `${DECOR}/tree-3.png`, scale: 1.1 }, // small
  ],
  rock: [
    { src: `${DECOR}/rock-1.png`, scale: 0.6 }, // big boulder cluster
    { src: `${DECOR}/rock-2.png`, scale: 0.65 },
    { src: `${DECOR}/rock-3.png`, scale: 0.75 },
    { src: `${DECOR}/rock-4.png`, scale: 0.8 }, // small
  ],
  crystal: [
    { src: `${DECOR}/crystal-1.png`, scale: 0.7 }, // green cluster, large
    { src: `${DECOR}/crystal-2.png`, scale: 0.75 },
    { src: `${DECOR}/crystal-3.png`, scale: 0.9 }, // small
    { src: `${DECOR}/crystal-4.png`, scale: 0.7 }, // blue-green cave cluster
  ],
  mushroom: [
    { src: `${DECOR}/mushroom-1.png`, scale: 0.55 }, // purple frilled cap
    { src: `${DECOR}/mushroom-2.png`, scale: 0.55 },
    { src: `${DECOR}/mushroom-3.png`, scale: 0.6 }, // blue umbrella cluster
    { src: `${DECOR}/mushroom-4.png`, scale: 0.55 },
    { src: `${DECOR}/mushroom-5.png`, scale: 0.55 }, // teal spotted cap
  ],
  stalagmite: [
    { src: `${DECOR}/stalagmite-1.png`, scale: 0.65 }, // tall layered spire
    { src: `${DECOR}/stalagmite-2.png`, scale: 0.7 },
    { src: `${DECOR}/stalagmite-3.png`, scale: 0.7 }, // small
  ],
  skull_pile: { src: `${DECOR}/skull-pile.png`, scale: 0.7 },
  ruin: [
    { src: `${DECOR}/ruin-1.png`, scale: 0.65 }, // broken arch with columns
    { src: `${DECOR}/ruin-2.png`, scale: 0.8 }, // lone column with rubble
    { src: `${DECOR}/ruin-3.png`, scale: 1.0 }, // rubble scatter
  ],
  thorn_plant: [
    { src: `${DECOR}/thorn-plant-1.png`, scale: 0.55 }, // sprawling thorn tangle
    { src: `${DECOR}/thorn-plant-2.png`, scale: 0.6 },
    { src: `${DECOR}/thorn-plant-3.png`, scale: 0.7 }, // small
  ],
  horror_plant: [
    { src: `${DECOR}/horror-plant-1.png`, scale: 0.65 }, // eyeball stalk
    { src: `${DECOR}/horror-plant-2.png`, scale: 0.6 }, // tentacle mass
    { src: `${DECOR}/horror-plant-3.png`, scale: 0.45 }, // toothed jaws plant
    { src: `${DECOR}/horror-plant-4.png`, scale: 0.65 }, // many-eyes disc
    { src: `${DECOR}/horror-plant-5.png`, scale: 0.6 }, // meat flower
    { src: `${DECOR}/horror-plant-6.png`, scale: 0.6 }, // fetus pods
  ],
};

/** Deterministic 0..1 hash of a coordinate pair (same recipe as the renderer's hash2). */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Resolve a decor kind to one sprite, picking among variants by world position so the same prop
 * always gets the same look on every client. Returns undefined for kinds without a sprite (the
 * renderer keeps its procedural draw for those).
 */
export function decorSprite(kind: string, seedX: number, seedY: number): DecorSprite | undefined {
  const entry = DECOR_SPRITES[kind];
  if (entry === undefined) return undefined;
  if (!Array.isArray(entry)) return entry;
  const idx = Math.min(entry.length - 1, Math.floor(hash2(seedX | 0, seedY | 0) * entry.length));
  return entry[idx];
}

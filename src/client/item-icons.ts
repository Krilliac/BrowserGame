/**
 * Item icons for the Canvas2D HUD panels (inventory / vault / belt), drawn from our **generated**
 * kind-keyed icon sheet (`/assets/icons/items_gen.png`, produced by `tools/assetgen/icons`) — no
 * licensed art. Every item id resolves to one of a fixed set of icon KEYS (weapon/armor/jewelry
 * categories + per-family gems + a generic fallback) through a chain: gem family → rune → material →
 * keyword rules → equipment-slot default → generic. So every seeded item id renders *something*
 * (asserted in item-icons.test.ts). Drawing is fail-soft: {@link drawItemIcon} returns false until the
 * sheet loads (or if it 404s) and the panels keep their procedural fallback.
 */

import type { ItemSlot } from '../shared/equipment.js';

/**
 * Item info lookup, injected from the DB-driven content store (main.ts wires it to the content
 * packet) so this module never imports item-data consts. Returns the item's kind (e.g. 'gem') and
 * equip slot. Defaults to "unknown" until wired, which simply falls the resolver through to the
 * keyword rules / generic icon.
 */
let resolveInfo: (id: string) => { kind: string; slot?: ItemSlot } | undefined = () => undefined;
export function setItemInfoResolver(
  fn: (id: string) => { kind: string; slot?: ItemSlot } | undefined,
): void {
  resolveInfo = fn;
}

export interface IconCell {
  col: number;
  row: number;
}

/**
 * The KEYS packed into the generated sheet, in the SAME order as `tools/assetgen/icons/cli.ts`
 * (cell = col i%8, row floor(i/8)). A test asserts these match the generated manifest.
 */
export const ICON_KEYS = [
  'sword',
  'axe',
  'bow',
  'staff',
  'mace',
  'dagger',
  'spear',
  'shield',
  'helm',
  'chest',
  'gloves',
  'boots',
  'legs',
  'amulet',
  'ring',
  'charm',
  'potion',
  'scroll',
  'tome',
  'coin',
  'rune',
  'material',
  'generic',
  'gem_ruby',
  'gem_sapphire',
  'gem_topaz',
  'gem_diamond',
  'gem_emerald',
  'gem_amethyst',
  'gem_jade',
  'gem_onyx',
  'gem_opal',
] as const;

export type IconKey = (typeof ICON_KEYS)[number];

const PER_ROW = 8;

/** The generated icon sheet (8 columns; rows derived from the key count). */
export const ITEMS_SHEET = {
  src: '/assets/icons/items_gen.png',
  cell: 32,
  cols: PER_ROW,
  rows: Math.ceil(ICON_KEYS.length / PER_ROW),
} as const;

const KEY_CELL: Record<string, IconCell> = Object.fromEntries(
  ICON_KEYS.map((k, i) => [k, { col: i % PER_ROW, row: Math.floor(i / PER_ROW) }]),
);

/** The nine gem families that have a colored cell; others fall back to a plain stone. */
const GEM_FAMILIES = new Set([
  'ruby',
  'sapphire',
  'topaz',
  'diamond',
  'emerald',
  'amethyst',
  'jade',
  'onyx',
  'opal',
]);

/** Crystalline loot materials (no gem family) → the generic 'material' cell. */
const MATERIAL_IDS = new Set(['ember_ore', 'frost_core', 'rune_shard', 'bone', 'wolf_pelt']);

/** First match wins — specific weapon words before generic armor/jewelry words. */
const KEYWORD_RULES: [RegExp, IconKey][] = [
  [/crossbow|bow/, 'bow'],
  [/dagger|shiv|knife/, 'dagger'],
  [/sword|blade|saber|falchion|cleaver/, 'sword'],
  [/axe|hatchet/, 'axe'],
  [/halberd|glaive|scythe|partisan|pike|spear|lance|trident/, 'spear'],
  [/hammer|maul|mace|morningstar|club|cudgel/, 'mace'],
  [/staff|stave|wand|rod|scepter/, 'staff'],
  [/grimoire|tome|book|codex|manual/, 'tome'],
  [/scroll/, 'scroll'],
  [/shield|buckler|targe|parma|aegis|bulwark|orb/, 'shield'],
  [/helm|coif|hood|crown|sallet|bascinet|visage|cap\b/, 'helm'],
  [/gauntlet|glove|grip|handwrap|grasp/, 'gloves'],
  [/pants|legging|legplate|chausses|legguard|greave/, 'legs'],
  [/boot|sandal|tread|sabaton/, 'boots'],
  [/amulet|pendant|locket|necklace/, 'amulet'],
  [/ring|band|loop|signet/, 'ring'],
  [/charm|talisman|idol|fetish|trinket/, 'charm'],
  [/potion|elixir|flask|vial/, 'potion'],
  [/pauldron|spaulder|mantle|shoulderplate|shoulder/, 'chest'],
  [/armor|cuirass|hauberk|plate|jerkin|brigandine|mail|robe/, 'chest'],
  [/coin|gold/, 'coin'],
  [/pelt|hide|wing|gland|bone|ore|core|shard/, 'material'],
  [/key/, 'generic'],
];

/** Per-slot default key, the safety net for any equip base without a keyword match. */
const SLOT_KEY: Record<ItemSlot, IconKey> = {
  head: 'helm',
  neck: 'amulet',
  shoulders: 'chest',
  chest: 'chest',
  hands: 'gloves',
  waist: 'generic',
  legs: 'legs',
  feet: 'boots',
  mainhand: 'sword',
  offhand: 'shield',
  ring: 'ring',
  trinket: 'charm',
};

/** Resolve an item id to an icon KEY: gem family → rune → material → keyword → slot → generic. */
export function resolveIconKey(itemId: string): IconKey {
  const info = resolveInfo(itemId);
  if (info?.kind === 'gem' && !itemId.startsWith('rune_')) {
    const fam = itemId.slice(0, itemId.lastIndexOf('_t'));
    return (GEM_FAMILIES.has(fam) ? `gem_${fam}` : 'material') as IconKey;
  }
  if (itemId.startsWith('rune_')) return 'rune';
  if (MATERIAL_IDS.has(itemId)) return 'material';
  for (const [re, key] of KEYWORD_RULES) if (re.test(itemId)) return key;
  if (info?.slot) return SLOT_KEY[info.slot];
  return 'generic';
}

/** Resolve an item id to its cell in the generated sheet. */
export function resolveIconCell(itemId: string): IconCell {
  return KEY_CELL[resolveIconKey(itemId)] ?? KEY_CELL.generic!;
}

// ---------------------------------------------------------------------------------------------
// Loader + drawing (browser-only; no-ops cleanly under vitest/node).
// ---------------------------------------------------------------------------------------------

let sheetImage: HTMLImageElement | null = null;

function ready(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/** Load the generated icon sheet. Fail-soft + no-op outside a browser (stays unit-testable). */
export function loadItemIcons(): Promise<void> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve();
  return new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      sheetImage = img;
      resolve();
    };
    img.onerror = () => resolve(); // stays not-ready; drawItemIcon keeps returning false
    img.src = ITEMS_SHEET.src;
  });
}

/**
 * Draw the icon for `itemId` into a `size`×`size` box at (x, y), nearest-neighbor. Returns false when
 * the sheet isn't loaded (yet) — the caller keeps its procedural fallback.
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  itemId: string,
  x: number,
  y: number,
  size: number,
): boolean {
  if (!ready(sheetImage)) return false;
  const cell = resolveIconCell(itemId);
  const c = ITEMS_SHEET.cell;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheetImage, cell.col * c, cell.row * c, c, c, x, y, size, size);
  ctx.restore();
  return true;
}

/**
 * Real pixel-art item icons for the Canvas2D HUD panels (inventory / vault / belt), drawn from the
 * 32rogues items sheet (`/assets/curated/items.png`, 11×26 cells of 32px) plus individually curated
 * gem / rune / material icons copied from the minerals pack into `/assets/curated/icons/`.
 *
 * Pure-data mapping + a tiny loader, following the `rogues-sprites.ts` pattern. An item id resolves
 * through a chain — curated file → exact cell → tome hash → keyword rules → equipment-slot default
 * → generic "page" cell — so every seeded item id renders *something* (asserted in
 * item-icons.test.ts). Drawing is fail-soft: {@link drawItemIcon} returns false until the images
 * load (or if one 404s) and the panels keep their procedural fallback rendering.
 */

import { equipDef, type ItemSlot } from '../shared/equipment.js';
import { GEMS } from '../shared/gems.js';

export interface IconCell {
  col: number;
  row: number;
}

/** The 32rogues items sheet: 11 columns × 26 rows of 32px cells (labels in items.txt). */
export const ITEMS_SHEET = {
  src: '/assets/curated/items.png',
  cell: 32,
  cols: 11,
  rows: 26,
} as const;

/**
 * Parse an items.txt label reference like `"16.b"` (1-indexed row, column letter a=1) into a
 * 0-indexed cell, so the map below reads exactly like the pack's label file.
 */
function at(ref: string): IconCell {
  const m = /^(\d+)\.([a-k])$/.exec(ref);
  if (!m) throw new Error(`bad items.txt cell ref: ${ref}`);
  return { col: m[2]!.charCodeAt(0) - 97, row: Number(m[1]) - 1 };
}

// ---------------------------------------------------------------------------------------------
// Curated single-file icons (gems, runes, ore-like materials) — minerals pack picks.
// ---------------------------------------------------------------------------------------------

function icon(file: string): string {
  return `/assets/curated/icons/${file}`;
}

/** Gem family → curated mineral icon; all tiers of a family share the icon (color = family). */
const GEM_FAMILY_FILES: Record<string, string> = {
  ruby: 'gem-ruby.png',
  sapphire: 'gem-sapphire.png',
  topaz: 'gem-topaz.png',
  diamond: 'gem-diamond.png',
  emerald: 'gem-emerald.png',
  amethyst: 'gem-amethyst.png',
  jade: 'gem-jade.png',
  onyx: 'gem-onyx.png',
  opal: 'gem-opal.png',
};

/** Every gem id (e.g. `ruby_t2`) → its curated icon path, derived from the shared gem catalog. */
export const GEM_ICON_FILES: Record<string, string> = Object.fromEntries(
  Object.keys(GEMS).flatMap((id) => {
    const file = GEM_FAMILY_FILES[id.slice(0, id.lastIndexOf('_t'))];
    return file ? [[id, icon(file)] as const] : [];
  }),
);

/** Runes + crystalline loot materials → curated mineral icons (one distinct stone per rune). */
const FILE_ICONS: Record<string, string> = {
  ...GEM_ICON_FILES,
  rune_el: icon('rune-el.png'),
  rune_tir: icon('rune-tir.png'),
  rune_ort: icon('rune-ort.png'),
  rune_thul: icon('rune-thul.png'),
  rune_nef: icon('rune-nef.png'),
  rune_sol: icon('rune-sol.png'),
  rune_dol: icon('rune-dol.png'),
  rune_ral: icon('rune-ral.png'),
  rune_vex: icon('rune-vex.png'),
  rune_zod: icon('rune-zod.png'),
  ember_ore: icon('material-ember-ore.png'),
  frost_core: icon('material-frost-core.png'),
  rune_shard: icon('material-rune-shard.png'),
};

/** The curated single-file icon for an item id, or undefined if it maps to the items sheet. */
export function iconFileFor(itemId: string): string | undefined {
  return FILE_ICONS[itemId];
}

// ---------------------------------------------------------------------------------------------
// items.png cell map — exact entries for every seeded item id with a distinctive icon.
// ---------------------------------------------------------------------------------------------

/** Exact item id → items.png cell (refs match items.txt labels). */
export const ITEM_ICON_CELLS: Record<string, IconCell> = {
  // --- Weapons (mainhand) ---
  rusty_sword: at('1.b'), // short sword
  iron_sword: at('1.d'), // long sword
  steel_sword: at('2.b'), // wide long sword
  mithril_blade: at('1.i'), // crystal sword
  rusted_cleaver: at('3.b'), // scimitar
  chipped_hatchet: at('4.f'), // hatchet
  splintered_cudgel: at('9.a'), // club
  bent_shiv: at('1.a'), // dagger
  bronze_falchion: at('3.c'), // large scimitar
  iron_warpike: at('7.a'), // spear
  footmans_mace: at('6.a'), // mace
  serpentine_dagger: at('1.g'), // sanguine dagger
  knights_arming_sword: at('1.e'), // bastard sword
  wardens_halberd: at('4.c'), // halberd
  reapers_scythe: at('3.a'), // shotel
  tempered_glaive: at('7.b'), // short spear
  mithril_warhammer: at('5.c'), // long warhammer
  moonsilver_saber: at('2.c'), // rapier
  frostforged_glaive: at('7.e'), // magic spear
  doomspike_partisan: at('7.d'), // trident

  // --- Off hand ---
  buckler: at('12.a'),
  wooden_shield: at('12.e'), // round shield
  tower_shield: at('12.g'), // large shield
  battered_targe: at('12.f'), // buckler 2
  splitwood_parma: at('12.e'),
  banded_heater_shield: at('12.b'), // kite shield
  iron_kite_shield: at('12.b'),
  aegis_of_the_vanguard: at('12.c'), // cross shield
  bulwark_of_the_pale_moon: at('12.g'),
  cracked_grimoire: at('22.d'), // dark tome
  emberglass_orb: at('17.c'), // crystal pendant

  // --- Head ---
  leather_cap: at('16.b'), // leather helm
  iron_helm: at('16.e'), // helm
  steel_helm: at('16.f'), // helm with chain mail
  padded_coif: at('16.a'), // cloth hood
  iron_sallet: at('16.e'),
  steel_bascinet: at('16.g'), // plate helm 1
  mithril_visage: at('16.h'), // plate helm 2
  runed_crown_of_vigil: at('16.h'),

  // --- Shoulders (no shoulder icon on the sheet; armor pieces read closest) ---
  leather_pauldrons: at('13.b'), // leather armor
  hide_spaulders: at('13.b'),
  iron_shoulderplates: at('13.e'), // scale mail
  steel_pauldrons: at('13.e'),
  mithril_mantle: at('13.e'),
  frostforged_pauldrons: at('13.e'),

  // --- Chest ---
  leather_armor: at('13.b'),
  iron_armor: at('13.d'), // chain mail
  steel_armor: at('13.f'), // chest plate
  mithril_armor: at('13.f'),
  boiled_leather_jerkin: at('13.b'),
  iron_brigandine: at('13.d'),
  steel_cuirass: at('13.f'),
  mithril_hauberk: at('13.d'),
  runed_aegis_plate: at('13.f'),

  // --- Hands ---
  leather_gloves: at('14.b'),
  rough_handwraps: at('14.a'), // cloth gloves
  iron_gauntlets: at('14.d'), // gauntlets
  steel_grips: at('14.d'),
  mithril_gauntlets: at('14.d'),
  stormbound_grasp: at('14.c'), // blue cloth gloves

  // --- Legs (cloth/leather pants read as cloth armor; metal legs as greaves) ---
  leather_pants: at('13.a'),
  tattered_leggings: at('13.a'),
  iron_greaves: at('15.d'), // greaves

  // --- Feet ---
  leather_boots: at('15.b'),
  worn_sandals: at('15.a'), // shoes
  mithril_warboots: at('15.c'), // high blue boots
  emberstride_boots: at('15.c'),

  // --- Neck ---
  pendant: at('17.b'), // metal pendant
  bloodstone_amulet: at('17.a'), // red pendant
  wyrmscale_pendant: at('17.f'), // stone pendant
  moonstone_locket: at('17.d'), // disc pendant
  amulet_of_the_vigil: at('17.e'), // cross pendant
  emberglass_pendant: at('17.a'),

  // --- Rings ---
  copper_ring: at('19.e'), // twisted gold ring
  silver_ring: at('19.b'), // silver signet ring
  runed_band: at('18.e'), // sapphire ring
  band_of_the_wolf: at('19.f'), // twisted metal ring
  signet_of_embers: at('18.d'), // ruby ring
  gilded_loop: at('18.b'), // gold band ring
  ring_of_the_tide: at('18.e'),
  obsidian_signet: at('18.f'), // onyx ring
  thornroot_band: at('18.c'), // green signet ring

  // --- Trinkets ---
  charm: at('17.c'), // crystal pendant
  hunters_charm: at('17.g'), // ankh
  idol_of_the_grove: at('17.f'),
  talisman_of_ash: at('17.d'),
  bone_fetish: at('17.g'),

  // --- Currency + loot materials (crystalline ones use curated mineral files instead) ---
  gold: at('25.b'), // small stacks of coins
  wolf_pelt: at('13.b'), // leather armor reads as a cured hide
  bone: at('23.d'), // primitive (bone-carved) key
  bat_wing: at('3.e'), // kukri — curved dark sliver, the closest wing shape
  venom_gland: at('20.e'), // green potion

  // --- Quick-use belt potions (synthetic ids; see belt.ts) ---
  potion_health: at('20.b'), // red potion
  potion_mana: at('21.d'), // blue potion
};

// ---------------------------------------------------------------------------------------------
// Fallback tiers: tome hash → keyword rules → slot defaults → generic.
// ---------------------------------------------------------------------------------------------

/** The five book/tome cells; each `tome_*` id hashes to one so shelves don't look uniform. */
const TOME_CELLS: IconCell[] = [at('22.b'), at('22.c'), at('22.d'), at('22.e'), at('22.f')];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** First match wins — specific weapon words before generic armor/jewelry words. */
const KEYWORD_RULES: [RegExp, IconCell][] = [
  [/crossbow/, at('10.a')],
  [/bow/, at('10.c')], // long bow
  [/dagger|shiv|knife/, at('1.a')],
  [/sword|blade|saber|falchion/, at('1.d')],
  [/axe|cleaver|hatchet/, at('4.b')], // battle axe
  [/hammer|maul/, at('5.b')], // short warhammer
  [/mace|morningstar/, at('6.a')],
  [/club|cudgel/, at('9.a')],
  [/halberd|glaive|scythe|partisan|pike|spear|lance|trident/, at('4.c')],
  [/staff|stave/, at('11.d')], // blue staff
  [/shield|buckler|targe|parma|aegis|bulwark/, at('12.b')],
  [/grimoire|tome|book|codex|manual/, at('22.e')],
  [/scroll/, at('22.a')],
  [/helm|coif|hood|crown|sallet|bascinet|visage|cap\b/, at('16.e')],
  [/gauntlet|glove|grip|handwrap|grasp/, at('14.d')],
  [/pants|legging|legplate|chausses|legguard|greave/, at('15.d')],
  [/boot|sandal|tread|sabaton/, at('15.b')],
  [/belt|girdle|sash|cinch/, at('25.d')], // coin purse — a pouch on a strap
  [/armor|cuirass|hauberk|plate|jerkin|brigandine|mail|robe/, at('13.f')],
  [/amulet|pendant|locket|necklace/, at('17.b')],
  [/ring|band|loop|signet/, at('18.b')],
  [/charm|talisman|idol|fetish|trinket/, at('17.f')],
  [/potion|elixir|flask|vial/, at('20.b')],
  [/key/, at('23.a')],
  [/coin|gold/, at('25.b')],
  [/pelt|hide/, at('13.b')],
];

/** Per-slot default cells, the safety net for any equip base without an exact/keyword match. */
const SLOT_CELLS: Record<ItemSlot, IconCell> = {
  head: at('16.e'),
  neck: at('17.b'),
  shoulders: at('13.e'),
  chest: at('13.f'),
  hands: at('14.a'),
  waist: at('25.d'),
  legs: at('15.d'),
  feet: at('15.b'),
  mainhand: at('1.d'),
  offhand: at('12.b'),
  ring: at('18.b'),
  trinket: at('17.f'),
};

/** Anything still unresolved draws as a loose page — never blank. */
const GENERIC_CELL = at('22.h');

/**
 * Resolve an item id to an items.png cell: exact → tome hash → keyword rules → equipment-slot
 * default → generic page. Ids with a curated file icon (gems/runes/ores) are handled by
 * {@link iconFileFor} before this is consulted.
 */
export function resolveIconCell(itemId: string): IconCell {
  const exact = ITEM_ICON_CELLS[itemId];
  if (exact) return exact;
  if (itemId.startsWith('tome_')) return TOME_CELLS[hashStr(itemId) % TOME_CELLS.length]!;
  for (const [re, cell] of KEYWORD_RULES) if (re.test(itemId)) return cell;
  const equip = equipDef(itemId);
  if (equip) return SLOT_CELLS[equip.slot];
  return GENERIC_CELL;
}

// ---------------------------------------------------------------------------------------------
// Loader + drawing (browser-only; no-ops cleanly under vitest/node).
// ---------------------------------------------------------------------------------------------

let sheetImage: HTMLImageElement | null = null;
const fileImages = new Map<string, HTMLImageElement>();

function ready(img: HTMLImageElement | null | undefined): img is HTMLImageElement {
  return !!img && img.complete && img.naturalWidth > 0;
}

/**
 * Load the items sheet and every curated gem/rune/material icon. Fail-soft: a missing image just
 * leaves its icons unloaded ({@link drawItemIcon} returns false and panels keep their procedural
 * art). No-ops (resolves immediately) outside a browser so the module stays unit-testable.
 */
export function loadItemIcons(): Promise<void> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return Promise.resolve();
  const load = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(img); // stays not-ready; drawItemIcon keeps returning false
      img.src = src;
    });
  const jobs: Promise<void>[] = [
    load(ITEMS_SHEET.src).then((img) => {
      sheetImage = img;
    }),
  ];
  for (const src of new Set(Object.values(FILE_ICONS))) {
    jobs.push(
      load(src).then((img) => {
        fileImages.set(src, img);
      }),
    );
  }
  return Promise.all(jobs).then(() => undefined);
}

/**
 * Draw the pixel-art icon for `itemId` into a `size`×`size` box at (x, y), nearest-neighbor.
 * Returns false when the icons aren't loaded (yet) — the caller keeps its procedural fallback.
 */
export function drawItemIcon(
  ctx: CanvasRenderingContext2D,
  itemId: string,
  x: number,
  y: number,
  size: number,
): boolean {
  const file = iconFileFor(itemId);
  if (file !== undefined) {
    const img = fileImages.get(file);
    if (!ready(img)) return false;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, x, y, size, size);
    ctx.restore();
    return true;
  }
  if (!ready(sheetImage)) return false;
  const cell = resolveIconCell(itemId);
  const c = ITEMS_SHEET.cell;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheetImage, cell.col * c, cell.row * c, c, c, x, y, size, size);
  ctx.restore();
  return true;
}

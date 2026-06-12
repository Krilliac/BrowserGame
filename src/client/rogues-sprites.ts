/**
 * Static sprite index for the 32rogues asset pack (CC-licensed 32×32 pixel sheets, copied to
 * `public/assets/curated/`). Pure data + pure lookup functions — no Pixi, no DOM — so the
 * renderer can pick a cell and the mapping stays unit-testable.
 *
 * Cell coordinates are 0-indexed {col,row}, hand-transcribed from the pack's label files
 * (`monsters.txt`, `rogues.txt`, `animals.txt`): a label like `5.c. lich` means row 5
 * (1-indexed), column c (a=1) → {col: 2, row: 4}.
 *
 * This is the *fallback* tier of mob art: mobs that already match an animated LPC sheet in
 * `pixi-renderer.ts` (wolves, skeletons, bats, bosses…) keep those; everything else (oozes,
 * golems, imps, spiders, writhing horrors…) resolves to a static cell here instead of a
 * procedural shape.
 */

export interface SpriteCell {
  col: number;
  row: number;
}

export interface SheetSpec {
  src: string;
  cell: number;
  cols: number;
  rows: number;
}

export const ROGUES_SHEET: SheetSpec = {
  src: '/assets/curated/rogues.png',
  cell: 32,
  cols: 7,
  rows: 7,
};

export const MONSTERS_SHEET: SheetSpec = {
  src: '/assets/curated/monsters.png',
  cell: 32,
  cols: 12,
  rows: 13,
};

export const ANIMALS_SHEET: SheetSpec = {
  src: '/assets/curated/animals.png',
  cell: 32,
  cols: 9,
  rows: 16,
};

/** monsters.png — full label index from monsters.txt (kebab-cased, slashes/parens dropped). */
export const MONSTER_CELLS: Record<string, SpriteCell> = {
  orc: { col: 0, row: 0 },
  'orc-wizard': { col: 1, row: 0 },
  goblin: { col: 2, row: 0 },
  'orc-blademaster': { col: 3, row: 0 },
  'orc-warchief': { col: 4, row: 0 },
  'goblin-archer': { col: 5, row: 0 },
  'goblin-mage': { col: 6, row: 0 },
  'goblin-brute': { col: 7, row: 0 },
  ettin: { col: 0, row: 1 },
  'two-headed-ettin': { col: 1, row: 1 },
  troll: { col: 2, row: 1 },
  'small-slime': { col: 0, row: 2 },
  'big-slime': { col: 1, row: 2 },
  slimebody: { col: 2, row: 2 },
  'merged-slimebodies': { col: 3, row: 2 },
  'faceless-monk': { col: 0, row: 3 },
  'unholy-cardinal': { col: 1, row: 3 },
  skeleton: { col: 0, row: 4 },
  'skeleton-archer': { col: 1, row: 4 },
  lich: { col: 2, row: 4 },
  'death-knight': { col: 3, row: 4 },
  zombie: { col: 4, row: 4 },
  ghoul: { col: 5, row: 4 },
  banshee: { col: 0, row: 5 },
  reaper: { col: 1, row: 5 },
  wraith: { col: 2, row: 5 },
  cultist: { col: 3, row: 5 },
  hag: { col: 4, row: 5 },
  'giant-centipede': { col: 0, row: 6 },
  lampreymander: { col: 1, row: 6 },
  'giant-earthworm': { col: 2, row: 6 },
  manticore: { col: 3, row: 6 },
  'giant-ant': { col: 4, row: 6 },
  lycanthrope: { col: 5, row: 6 },
  'giant-bat': { col: 6, row: 6 },
  'lesser-giant-ant': { col: 7, row: 6 },
  'giant-spider': { col: 8, row: 6 },
  'lesser-giant-spider': { col: 9, row: 6 },
  'dire-wolf': { col: 10, row: 6 },
  'giant-rat': { col: 11, row: 6 },
  dryad: { col: 0, row: 7 },
  wendigo: { col: 1, row: 7 },
  'rock-golem': { col: 2, row: 7 },
  centaur: { col: 3, row: 7 },
  naga: { col: 4, row: 7 },
  'forest-spirit': { col: 5, row: 7 },
  satyr: { col: 6, row: 7 },
  minotaur: { col: 7, row: 7 },
  harpy: { col: 8, row: 7 },
  gorgon: { col: 9, row: 7 },
  lizardfolk: { col: 0, row: 8 },
  drake: { col: 1, row: 8 },
  dragon: { col: 2, row: 8 },
  cockatrice: { col: 3, row: 8 },
  basilisk: { col: 4, row: 8 },
  'small-kobold': { col: 0, row: 9 },
  kobold: { col: 1, row: 9 },
  'small-myconid': { col: 0, row: 10 },
  'large-myconid': { col: 1, row: 10 },
  angel: { col: 0, row: 11 },
  imp: { col: 1, row: 11 },
  'small-writhing-mass': { col: 0, row: 12 },
  'large-writhing-mass': { col: 1, row: 12 },
  'writhing-humanoid': { col: 2, row: 12 },
};

/**
 * rogues.png — full label index from rogues.txt. The label file has two known typos:
 * `6.f. warlock` belongs to row 5 (the wizard row), and there is no row 6 group — the
 * farmer group labeled 7 sits on sheet row 6 and the peasant group labeled 8 on row 7.
 */
export const ROGUE_CELLS: Record<string, SpriteCell> = {
  dwarf: { col: 0, row: 0 },
  elf: { col: 1, row: 0 },
  ranger: { col: 2, row: 0 },
  rogue: { col: 3, row: 0 },
  bandit: { col: 4, row: 0 },
  knight: { col: 0, row: 1 },
  'male-fighter': { col: 1, row: 1 },
  'female-knight': { col: 2, row: 1 },
  'female-knight-helmetless': { col: 3, row: 1 },
  'shield-knight': { col: 4, row: 1 },
  monk: { col: 0, row: 2 },
  priest: { col: 1, row: 2 },
  'female-war-cleric': { col: 2, row: 2 },
  'male-war-cleric': { col: 3, row: 2 },
  templar: { col: 4, row: 2 },
  'schema-monk': { col: 5, row: 2 },
  'elder-schema-monk': { col: 6, row: 2 },
  'male-barbarian': { col: 0, row: 3 },
  'male-winter-barbarian': { col: 1, row: 3 },
  'female-winter-barbarian': { col: 2, row: 3 },
  swordsman: { col: 3, row: 3 },
  fencer: { col: 4, row: 3 },
  'female-barbarian': { col: 5, row: 3 },
  'female-wizard': { col: 0, row: 4 },
  'male-wizard': { col: 1, row: 4 },
  druid: { col: 2, row: 4 },
  'desert-sage': { col: 3, row: 4 },
  'dwarf-mage': { col: 4, row: 4 },
  warlock: { col: 5, row: 4 },
  'farmer-thresher': { col: 0, row: 5 },
  'farmer-scythe': { col: 1, row: 5 },
  'farmer-pitchfork': { col: 2, row: 5 },
  baker: { col: 3, row: 5 },
  blacksmith: { col: 4, row: 5 },
  scholar: { col: 5, row: 5 },
  coalburner: { col: 0, row: 6 },
  peasant: { col: 1, row: 6 },
  shopkeep: { col: 2, row: 6 },
  'elderly-woman': { col: 3, row: 6 },
  'elderly-man': { col: 4, row: 6 },
};

/**
 * animals.png — the cells this game actually uses (the sheet has ~110 labels; transcribe more as
 * needed). animals.txt numbers its groups 1,2,4…17 for a 16-row sheet — there is no row-3 group,
 * so sheet row (0-indexed) = label − 2 for labels ≥ 4 (verified against the image).
 */
export const ANIMAL_CELLS: Record<string, SpriteCell> = {
  'grizzly-bear': { col: 0, row: 0 },
  wolf: { col: 6, row: 4 },
  rat: { col: 8, row: 6 },
  snake: { col: 0, row: 7 },
  boar: { col: 7, row: 9 },
};

interface MobRule {
  re: RegExp;
  sheet: 'monsters' | 'animals';
  label: string;
}

/**
 * First match wins, so specific names (thornling, forge, pale king…) come before the generic
 * archetype words they would otherwise collide with (archer, tyrant, king…).
 */
const MOB_RULES: MobRule[] = [
  { re: /thornling/, sheet: 'monsters', label: 'dryad' },
  // --- Expansion bestiary: specific creature words, ahead of the generic archetypes below
  //     (e.g. "Shadowmaw Bear" must hit /bear/ before the /maw/ in the devourer rule). ---
  { re: /kobold/, sheet: 'monsters', label: 'kobold' },
  { re: /\bbear\b/, sheet: 'animals', label: 'grizzly-bear' },
  { re: /naga/, sheet: 'monsters', label: 'naga' },
  { re: /ettin/, sheet: 'monsters', label: 'two-headed-ettin' },
  { re: /myconid/, sheet: 'monsters', label: 'large-myconid' },
  { re: /basilisk/, sheet: 'monsters', label: 'basilisk' },
  { re: /lycan/, sheet: 'monsters', label: 'lycanthrope' },
  { re: /manticore/, sheet: 'monsters', label: 'manticore' },
  { re: /harpy/, sheet: 'monsters', label: 'harpy' },
  { re: /drake|dragon/, sheet: 'monsters', label: 'drake' },
  { re: /minotaur/, sheet: 'monsters', label: 'minotaur' },
  // --- Abyssal Throne bestiary (seed-frontier.ts): specific words before the generics. ---
  { re: /sovereign|nyxathor/, sheet: 'monsters', label: 'dragon' },
  { re: /sentinel/, sheet: 'monsters', label: 'death-knight' },
  { re: /magus/, sheet: 'monsters', label: 'unholy-cardinal' },
  { re: /hexer/, sheet: 'monsters', label: 'hag' },
  { re: /thrall/, sheet: 'monsters', label: 'zombie' },
  { re: /ravager/, sheet: 'monsters', label: 'wendigo' },
  { re: /witch|hag/, sheet: 'monsters', label: 'hag' },
  { re: /bonecaller|pale king|crypt lord|lich/, sheet: 'monsters', label: 'lich' },
  { re: /runeseer|seer/, sheet: 'monsters', label: 'unholy-cardinal' },
  { re: /warlock/, sheet: 'monsters', label: 'faceless-monk' },
  { re: /acolyte|cultist|pyre|pilgrim/, sheet: 'monsters', label: 'cultist' },
  { re: /skeleton/, sheet: 'monsters', label: 'skeleton' },
  { re: /archer/, sheet: 'monsters', label: 'skeleton-archer' },
  { re: /ghoul/, sheet: 'monsters', label: 'ghoul' },
  { re: /zombie/, sheet: 'monsters', label: 'zombie' },
  { re: /revenant/, sheet: 'monsters', label: 'reaper' },
  { re: /banshee/, sheet: 'monsters', label: 'banshee' },
  { re: /shade|wraith|spectre|ghost/, sheet: 'monsters', label: 'wraith' },
  { re: /sprite|spirit/, sheet: 'monsters', label: 'forest-spirit' },
  { re: /imp\b|devil|demon/, sheet: 'monsters', label: 'imp' },
  { re: /golem|juggernaut|colossus|forge/, sheet: 'monsters', label: 'rock-golem' },
  { re: /behemoth|wendigo/, sheet: 'monsters', label: 'wendigo' },
  { re: /wolf|warg|hound/, sheet: 'monsters', label: 'dire-wolf' },
  { re: /boar|tusk/, sheet: 'animals', label: 'boar' },
  { re: /\bbat\b/, sheet: 'monsters', label: 'giant-bat' },
  { re: /spider|brood/, sheet: 'monsters', label: 'giant-spider' },
  { re: /\brat\b/, sheet: 'monsters', label: 'giant-rat' },
  { re: /leech|lamprey/, sheet: 'monsters', label: 'lampreymander' },
  { re: /worm/, sheet: 'monsters', label: 'giant-earthworm' },
  { re: /crawler|centipede/, sheet: 'monsters', label: 'giant-centipede' },
  { re: /ooze|slime/, sheet: 'monsters', label: 'big-slime' },
  { re: /shambler/, sheet: 'monsters', label: 'merged-slimebodies' },
  { re: /strangler/, sheet: 'monsters', label: 'writhing-humanoid' },
  { re: /swarm/, sheet: 'monsters', label: 'small-writhing-mass' },
  { re: /spitter/, sheet: 'monsters', label: 'lizardfolk' },
  { re: /hurler|troll/, sheet: 'monsters', label: 'troll' },
  { re: /devourer|maw|unmaker/, sheet: 'monsters', label: 'large-writhing-mass' },
  { re: /knight|warden|tyrant|king|lord/, sheet: 'monsters', label: 'death-knight' },
  { re: /goblin/, sheet: 'monsters', label: 'goblin' },
  { re: /orc\b/, sheet: 'monsters', label: 'orc' },
];

/**
 * Resolve a game mob display name (e.g. "Bog Shambler", "Vorzel, the Throne-Tyrant") to a
 * 32rogues cell. Returns undefined for names no rule recognizes — every monster currently
 * seeded in the content DB resolves (asserted in rogues-sprites.test.ts).
 */
export function mobSpriteCell(
  name: string,
): { sheet: 'monsters' | 'animals'; col: number; row: number } | undefined {
  const n = name.toLowerCase();
  for (const rule of MOB_RULES) {
    if (!rule.re.test(n)) continue;
    const cell = rule.sheet === 'monsters' ? MONSTER_CELLS[rule.label] : ANIMAL_CELLS[rule.label];
    if (cell) return { sheet: rule.sheet, col: cell.col, row: cell.row };
  }
  return undefined;
}

/** NPC kinds (the content DB enum in src/server/db/editable.ts) → a fitting rogues.png cell. */
const NPC_LABELS: Record<string, string> = {
  vendor: 'shopkeep',
  questgiver: 'scholar',
  healer: 'priest',
  gambler: 'bandit',
  artificer: 'blacksmith',
  banker: 'elderly-man',
};

export function npcSpriteCell(npcKind: string): SpriteCell | undefined {
  const label = NPC_LABELS[npcKind];
  return label ? ROGUE_CELLS[label] : undefined;
}

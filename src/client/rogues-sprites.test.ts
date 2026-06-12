import { describe, expect, it } from 'vitest';
import {
  ANIMAL_CELLS,
  ANIMALS_SHEET,
  MONSTER_CELLS,
  MONSTERS_SHEET,
  ROGUE_CELLS,
  ROGUES_SHEET,
  mobSpriteCell,
  npcSpriteCell,
} from './rogues-sprites.js';

/** Every monster template name seeded into the content DB (MOB_TEMPLATES in src/server/mobs.ts). */
const SEEDED_MOB_NAMES = [
  'Gloom Wolf',
  'Crypt Skeleton',
  'Cave Bat',
  'Gloom Sprite',
  'Hooded Cultist',
  'Gloom Boar',
  'Crypt Lord',
  'Marsh Leech',
  'Bog Shambler',
  'Mire Spitter',
  'Fen Strangler',
  'The Fenwitch',
  'Cinder Imp',
  'Magma Crawler',
  'Deep Cultist',
  'Forge Tyrant',
  'Frost Wolf',
  'Rime Archer',
  'Avalanche Shade',
  'Tundra Behemoth',
  'The Pale King',
  'Rot Ghoul',
  'Carrion Swarm',
  'Thornling Archer',
  'Tusk Runner',
  'Plague Hound',
  'Grave Golem',
  'Ember Acolyte',
  'Abyssal Warden',
  'Bile Ooze',
  'Shardspine Hurler',
  'Gravetide Revenant',
  'Molten Colossus',
  'Wraithfrost Stalker',
  'Hollow Runeseer',
  'Obsidian Juggernaut',
  'Voidmaw Devourer',
  'Maggath, the Bonecaller',
  'Vorraxia, the Brood Mother',
  "Bal'thuzar, the Forgemaster",
  'Kaldris, the Warden Eternal',
  'Void Revenant',
  'Ashen Warlock',
  "Xal'thirun, the Unmaker",
  'Blight Knight',
  'Pyre Caster',
  'Ruin Colossus',
  'Vorzel, the Throne-Tyrant',
  // --- Expansion bestiary (seed-expansion.ts) ---
  'Thistle Kobold',
  'Mosshide Orc',
  'Shadowmaw Bear',
  'Rotfen Naga',
  'Rotfen Ettin',
  'Gloomcap Myconid',
  'Basalt Basilisk',
  'Gnarlfang Lycan',
  'Crag Manticore',
  'Riftwing Harpy',
  'Voidscale Drake',
  'Blightgore Minotaur',
];

/** NPC kinds from the content DB enum (src/server/db/editable.ts). */
const NPC_KINDS = ['vendor', 'questgiver', 'healer', 'gambler', 'artificer'];

describe('sprite sheet cell tables', () => {
  const tables = [
    { name: 'MONSTER_CELLS', cells: MONSTER_CELLS, sheet: MONSTERS_SHEET },
    { name: 'ROGUE_CELLS', cells: ROGUE_CELLS, sheet: ROGUES_SHEET },
    { name: 'ANIMAL_CELLS', cells: ANIMAL_CELLS, sheet: ANIMALS_SHEET },
  ];

  for (const { name, cells, sheet } of tables) {
    it(`${name} cells are integers inside the ${sheet.cols}x${sheet.rows} grid`, () => {
      for (const [label, cell] of Object.entries(cells)) {
        expect(Number.isInteger(cell.col), `${label} col`).toBe(true);
        expect(Number.isInteger(cell.row), `${label} row`).toBe(true);
        expect(cell.col, `${label} col`).toBeGreaterThanOrEqual(0);
        expect(cell.col, `${label} col`).toBeLessThan(sheet.cols);
        expect(cell.row, `${label} row`).toBeGreaterThanOrEqual(0);
        expect(cell.row, `${label} row`).toBeLessThan(sheet.rows);
      }
    });
  }

  it('sheet specs point at the curated asset dir with 32px cells', () => {
    for (const sheet of [MONSTERS_SHEET, ROGUES_SHEET, ANIMALS_SHEET]) {
      expect(sheet.src).toMatch(/^\/assets\/curated\/[a-z]+\.png$/);
      expect(sheet.cell).toBe(32);
    }
  });
});

describe('mobSpriteCell', () => {
  it('resolves every monster seeded in the content DB to an in-bounds cell', () => {
    for (const name of SEEDED_MOB_NAMES) {
      const hit = mobSpriteCell(name);
      expect(hit, name).toBeDefined();
      const sheet = hit!.sheet === 'monsters' ? MONSTERS_SHEET : ANIMALS_SHEET;
      expect(hit!.col, name).toBeGreaterThanOrEqual(0);
      expect(hit!.col, name).toBeLessThan(sheet.cols);
      expect(hit!.row, name).toBeGreaterThanOrEqual(0);
      expect(hit!.row, name).toBeLessThan(sheet.rows);
    }
  });

  it('picks thematically specific cells over generic archetype words', () => {
    // "Thornling Archer" is a plant creature, not a skeleton archer.
    expect(mobSpriteCell('Thornling Archer')).toEqual({
      sheet: 'monsters',
      ...MONSTER_CELLS['dryad'],
    });
    // "Forge Tyrant" reads as a construct, not a death knight.
    expect(mobSpriteCell('Forge Tyrant')).toEqual({
      sheet: 'monsters',
      ...MONSTER_CELLS['rock-golem'],
    });
    expect(mobSpriteCell('The Pale King')).toEqual({ sheet: 'monsters', ...MONSTER_CELLS['lich'] });
    expect(mobSpriteCell('Gloom Boar')).toEqual({ sheet: 'animals', ...ANIMAL_CELLS['boar'] });
    expect(mobSpriteCell('Bile Ooze')).toEqual({
      sheet: 'monsters',
      ...MONSTER_CELLS['big-slime'],
    });
    // "Shadowmaw Bear" is a bear — the "maw" in its name must not hit the devourer rule.
    expect(mobSpriteCell('Shadowmaw Bear')).toEqual({
      sheet: 'animals',
      ...ANIMAL_CELLS['grizzly-bear'],
    });
    // "Gnarlfang Lycan" is the werewolf sprite, not the generic dire wolf.
    expect(mobSpriteCell('Gnarlfang Lycan')).toEqual({
      sheet: 'monsters',
      ...MONSTER_CELLS['lycanthrope'],
    });
  });

  it('returns undefined for names no rule recognizes', () => {
    expect(mobSpriteCell('Completely Unmappable Thing')).toBeUndefined();
  });
});

describe('npcSpriteCell', () => {
  it('maps every NPC kind in the content DB enum to an in-bounds rogues cell', () => {
    for (const kind of NPC_KINDS) {
      const cell = npcSpriteCell(kind);
      expect(cell, kind).toBeDefined();
      expect(cell!.col, kind).toBeLessThan(ROGUES_SHEET.cols);
      expect(cell!.row, kind).toBeLessThan(ROGUES_SHEET.rows);
    }
  });

  it('returns undefined for unknown kinds', () => {
    expect(npcSpriteCell('mayor')).toBeUndefined();
  });
});

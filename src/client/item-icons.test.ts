import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT } from '../server/db/seed-items.js';
import { GEMS } from '../shared/gems.js';
import { RUNES } from '../shared/runewords.js';
import {
  ICON_KEYS,
  ITEMS_SHEET,
  type IconKey,
  drawItemIcon,
  loadItemIcons,
  resolveIconCell,
  resolveIconKey,
  setItemSlotResolver,
} from './item-icons.js';

// item-icons no longer imports the equipment data const; the slot fallback is injected. Wire it
// from EQUIPMENT here so the "every equipment base resolves" check still exercises the fallback.
setItemSlotResolver((id) => EQUIPMENT[id]?.slot);

/** Non-equip item ids seeded into the content DB (materials, currency, belt potions). */
const MATERIAL_IDS = [
  'gold',
  'wolf_pelt',
  'bone',
  'bat_wing',
  'rune_shard',
  'venom_gland',
  'ember_ore',
  'frost_core',
  'potion_health',
  'potion_mana',
];

/** A sample of the seeded spellbook ids (seed.ts SPELLBOOKS — all share the `tome_` prefix). */
const TOME_IDS = ['tome_slash', 'tome_fireball', 'tome_meteor', 'tome_whirlwind', 'tome_warcry'];

function expectInBounds(cell: { col: number; row: number }, label: string): void {
  expect(Number.isInteger(cell.col), `${label} col`).toBe(true);
  expect(Number.isInteger(cell.row), `${label} row`).toBe(true);
  expect(cell.col, `${label} col`).toBeGreaterThanOrEqual(0);
  expect(cell.col, `${label} col`).toBeLessThan(ITEMS_SHEET.cols);
  expect(cell.row, `${label} row`).toBeGreaterThanOrEqual(0);
  expect(cell.row, `${label} row`).toBeLessThan(ITEMS_SHEET.rows);
}

describe('ICON_KEYS layout', () => {
  it('matches the generated manifest cell-for-cell', () => {
    const manifestPath = join('public', ITEMS_SHEET.src.replace(/\.png$/, '.json'));
    expect(existsSync(manifestPath), manifestPath).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      src: string;
      cell: number;
      cells: Record<string, { col: number; row: number }>;
    };
    expect(manifest.src, 'manifest src').toBe(ITEMS_SHEET.src);
    expect(manifest.cell, 'manifest cell px').toBe(ITEMS_SHEET.cell);
    // The generated sheet must hold exactly the keys the engine resolves onto, same cells.
    expect(Object.keys(manifest.cells).sort()).toEqual([...ICON_KEYS].sort());
    ICON_KEYS.forEach((key, i) => {
      const cell = manifest.cells[key];
      expect(cell, `${key} present in manifest`).toBeDefined();
      expect(cell, key).toEqual({
        col: i % ITEMS_SHEET.cols,
        row: Math.floor(i / ITEMS_SHEET.cols),
      });
    });
  });

  it('every key resolves to an in-bounds cell', () => {
    for (const key of ICON_KEYS) expectInBounds(resolveIconCell(key), key);
  });
});

describe('resolveIconKey', () => {
  it('resolves every equipment base to a real key, in-bounds', () => {
    for (const id of Object.keys(EQUIPMENT)) {
      const key = resolveIconKey(id);
      expect(ICON_KEYS, id).toContain(key);
      expectInBounds(resolveIconCell(id), id);
    }
  });

  it('maps every gem id (all tiers) to its family key', () => {
    for (const id of Object.keys(GEMS)) {
      const fam = id.slice(0, id.lastIndexOf('_t'));
      const key = resolveIconKey(id);
      // Families with a colored cell get gem_<family>; the rest fall back to 'material'.
      const expected: IconKey = ICON_KEYS.includes(`gem_${fam}` as IconKey)
        ? (`gem_${fam}` as IconKey)
        : 'material';
      expect(key, id).toBe(expected);
      expectInBounds(resolveIconCell(id), id);
    }
  });

  it('maps every rune to the rune key', () => {
    for (const { id } of RUNES) {
      expect(resolveIconKey(id), id).toBe('rune');
      expectInBounds(resolveIconCell(id), id);
    }
  });

  it('maps materials, currency, and belt potions to sensible keys', () => {
    for (const id of MATERIAL_IDS) {
      const key = resolveIconKey(id);
      expect(ICON_KEYS, id).toContain(key);
      expectInBounds(resolveIconCell(id), id);
    }
    expect(resolveIconKey('gold')).toBe('coin');
    expect(resolveIconKey('potion_health')).toBe('potion');
    expect(resolveIconKey('potion_mana')).toBe('potion');
  });

  it('maps tomes onto the tome key', () => {
    for (const id of TOME_IDS) expect(resolveIconKey(id), id).toBe('tome');
  });

  it('applies keyword rules to ids it has never seen (specific words win)', () => {
    expect(resolveIconKey('obsidian_greatsword')).toBe('sword');
    expect(resolveIconKey('storm_crossbow')).toBe('bow'); // crossbow|bow
    expect(resolveIconKey('elixir_of_might')).toBe('potion');
    expect(resolveIconKey('ancient_war_axe')).toBe('axe');
    expect(resolveIconKey('runic_grimoire')).toBe('tome');
  });

  it('falls back to generic for completely unknown ids — never blank', () => {
    expect(resolveIconKey('totally_unknown_thing')).toBe('generic');
    expectInBounds(resolveIconCell('totally_unknown_thing'), 'unknown');
  });

  it('is stable across calls', () => {
    for (const id of ['iron_sword', 'ruby_t1', 'rune_zod', 'gold']) {
      expect(resolveIconKey(id)).toBe(resolveIconKey(id));
      expect(resolveIconCell(id)).toEqual(resolveIconCell(id));
    }
  });
});

describe('generated sheet on disk', () => {
  it('the items sheet PNG exists under public/', () => {
    expect(existsSync(join('public', ITEMS_SHEET.src)), ITEMS_SHEET.src).toBe(true);
  });
});

describe('browser-only behavior under node', () => {
  it('loadItemIcons no-ops and resolves', async () => {
    await expect(loadItemIcons()).resolves.toBeUndefined();
  });

  it('drawItemIcon returns false (sheet unloaded) without touching the context', () => {
    const ctx = {} as CanvasRenderingContext2D; // would throw if any method were called
    expect(drawItemIcon(ctx, 'iron_sword', 0, 0, 24)).toBe(false);
    expect(drawItemIcon(ctx, 'ruby_t1', 0, 0, 24)).toBe(false);
    expect(drawItemIcon(ctx, 'rune_zod', 0, 0, 24)).toBe(false);
  });
});

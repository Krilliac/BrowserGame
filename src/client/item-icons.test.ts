import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EQUIPMENT } from '../shared/equipment.js';
import { GEMS } from '../shared/gems.js';
import { RUNES } from '../shared/runewords.js';
import {
  GEM_ICON_FILES,
  ITEM_ICON_CELLS,
  ITEMS_SHEET,
  drawItemIcon,
  iconFileFor,
  loadItemIcons,
  resolveIconCell,
} from './item-icons.js';

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

const GENERIC_CELL = { col: 7, row: 21 }; // 22.h "page" — the never-blank fallback

function expectInBounds(cell: { col: number; row: number }, label: string): void {
  expect(Number.isInteger(cell.col), `${label} col`).toBe(true);
  expect(Number.isInteger(cell.row), `${label} row`).toBe(true);
  expect(cell.col, `${label} col`).toBeGreaterThanOrEqual(0);
  expect(cell.col, `${label} col`).toBeLessThan(ITEMS_SHEET.cols);
  expect(cell.row, `${label} row`).toBeGreaterThanOrEqual(0);
  expect(cell.row, `${label} row`).toBeLessThan(ITEMS_SHEET.rows);
}

describe('ITEM_ICON_CELLS', () => {
  it('every exact cell sits inside the 11x26 items sheet', () => {
    for (const [id, cell] of Object.entries(ITEM_ICON_CELLS)) expectInBounds(cell, id);
  });
});

describe('resolveIconCell', () => {
  it('resolves every equipment base to a non-generic, in-bounds cell', () => {
    for (const id of Object.keys(EQUIPMENT)) {
      const cell = resolveIconCell(id);
      expectInBounds(cell, id);
      expect(cell, id).not.toEqual(GENERIC_CELL);
    }
  });

  it('resolves materials, currency, and belt potions', () => {
    for (const id of MATERIAL_IDS.filter((m) => iconFileFor(m) === undefined)) {
      const cell = resolveIconCell(id);
      expectInBounds(cell, id);
      expect(cell, id).not.toEqual(GENERIC_CELL);
    }
  });

  it('hashes tomes onto the book cells, deterministically', () => {
    const bookRow = 21; // items.txt row 22: book / red book / dark tome / tome / tome 2
    for (const id of TOME_IDS) {
      const cell = resolveIconCell(id);
      expect(cell.row, id).toBe(bookRow);
      expect(cell.col, id).toBeGreaterThanOrEqual(1);
      expect(cell.col, id).toBeLessThanOrEqual(5);
      expect(resolveIconCell(id), id).toEqual(cell); // stable across calls
    }
  });

  it('falls back to keyword rules for ids it has never seen', () => {
    expect(resolveIconCell('obsidian_greatsword')).toEqual({ col: 3, row: 0 }); // long sword
    expect(resolveIconCell('storm_crossbow')).toEqual({ col: 0, row: 9 }); // crossbow before bow
    expect(resolveIconCell('elixir_of_might')).toEqual({ col: 1, row: 19 }); // red potion
  });

  it('returns the generic page cell for completely unknown ids — never blank', () => {
    expect(resolveIconCell('totally_unknown_thing')).toEqual(GENERIC_CELL);
  });
});

describe('curated file icons', () => {
  it('maps every gem id (all tiers) to a curated icon path', () => {
    for (const id of Object.keys(GEMS)) {
      expect(GEM_ICON_FILES[id], id).toMatch(/^\/assets\/curated\/icons\/gem-[a-z]+\.png$/);
      expect(iconFileFor(id), id).toBe(GEM_ICON_FILES[id]);
    }
  });

  it('maps every rune to a curated icon path', () => {
    for (const { id } of RUNES) {
      expect(iconFileFor(id), id).toMatch(/^\/assets\/curated\/icons\/rune-[a-z]+\.png$/);
    }
  });

  it('every curated icon path exists on disk under public/', () => {
    const paths = new Set<string>(Object.values(GEM_ICON_FILES));
    for (const { id } of RUNES) paths.add(iconFileFor(id)!);
    for (const id of ['ember_ore', 'frost_core', 'rune_shard']) paths.add(iconFileFor(id)!);
    paths.add(ITEMS_SHEET.src);
    for (const p of paths) {
      expect(existsSync(join('public', p)), p).toBe(true);
    }
  });
});

describe('browser-only behavior under node', () => {
  it('loadItemIcons no-ops and resolves', async () => {
    await expect(loadItemIcons()).resolves.toBeUndefined();
  });

  it('drawItemIcon returns false (icons unloaded) without touching the context', () => {
    const ctx = {} as CanvasRenderingContext2D; // would throw if any method were called
    expect(drawItemIcon(ctx, 'iron_sword', 0, 0, 24)).toBe(false);
    expect(drawItemIcon(ctx, 'ruby_t1', 0, 0, 24)).toBe(false);
    expect(drawItemIcon(ctx, 'rune_zod', 0, 0, 24)).toBe(false);
  });
});

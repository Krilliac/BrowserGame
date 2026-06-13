import { describe, expect, it } from 'vitest';
import { initGameDb } from './content.js';
import { config } from './config.js';
import { engineSchema, engineRows, setEngineConfig } from './engine.js';

initGameDb(':memory:');

/**
 * The Dev engine panel's data layer: the schema it renders from, content-row reads, and the
 * validated config writes. (The privileged actions live in index.ts behind the Developer gate.)
 */
describe('engine schema', () => {
  it('exposes the editable content tables + their column specs', () => {
    const s = engineSchema();
    expect(Object.keys(s.tables)).toEqual(
      expect.arrayContaining(['items', 'abilities', 'mob_templates']),
    );
    expect(s.tables.items?.pk).toBe('id');
    expect(s.tables.abilities?.columns.damage?.type).toBe('real');
  });

  it('exposes runtime config groups with current values, and the dropdown lists', () => {
    const s = engineSchema();
    expect(s.config.length).toBeGreaterThan(0);
    const all = s.config.flatMap((g) => g.fields);
    const dmg = all.find((f) => f.path === 'difficulty.mobDamage');
    expect(dmg?.value).toBe(config.difficulty.mobDamage);
    expect(s.areas.length).toBeGreaterThan(0);
    expect(s.items.length).toBeGreaterThan(0);
    expect(s.weathers).toContain('rain');
    expect(s.access.some((a) => a.name === 'Developer')).toBe(true);
  });
});

describe('engine content rows', () => {
  it('returns the rows of a known table with its columns', () => {
    const res = engineRows('items');
    expect('error' in res).toBe(false);
    if ('error' in res || res.kind !== 'rows') throw new Error('expected rows');
    expect(res.columns).toContain('id');
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it('rejects an unknown / non-whitelisted table', () => {
    const res = engineRows('accounts'); // sensitive table, not in the editable whitelist
    expect('error' in res).toBe(true);
  });
});

describe('engine config writes', () => {
  it('clamps to the field range and writes the live config', () => {
    const original = config.difficulty.mobDamage;
    try {
      expect(setEngineConfig('difficulty.mobDamage', 999)).toBe(5); // clamped to max
      expect(config.difficulty.mobDamage).toBe(5);
      expect(setEngineConfig('difficulty.mobDamage', 2)).toBe(2);
      expect(config.difficulty.mobDamage).toBe(2);
    } finally {
      setEngineConfig('difficulty.mobDamage', original);
    }
  });

  it('rounds integer knobs', () => {
    const original = config.density.cap;
    try {
      expect(setEngineConfig('density.cap', 4.7)).toBe(5);
    } finally {
      setEngineConfig('density.cap', original);
    }
  });

  it('rejects an unknown config path (no arbitrary mutation)', () => {
    expect(setEngineConfig('server.engineAdminToken', 1)).toBeNull();
    expect(setEngineConfig('nonsense.path', 1)).toBeNull();
  });
});

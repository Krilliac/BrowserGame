import { describe, expect, it } from 'vitest';
import {
  countByKind,
  formatValue,
  initInspector,
  isExpandable,
  MAX_PROPS_PER_NODE,
  NEAREST_RANGE,
  nearestEntity,
  propEntries,
  type InspectorSnapshot,
} from './inspector.js';

describe('formatValue', () => {
  it('keeps integers whole', () => {
    expect(formatValue(42)).toBe('42');
    expect(formatValue(0)).toBe('0');
    expect(formatValue(-7)).toBe('-7');
  });

  it('shows non-integers with 2dp', () => {
    expect(formatValue(3.14159)).toBe('3.14');
    expect(formatValue(-0.5)).toBe('-0.50');
  });

  it('quotes strings', () => {
    expect(formatValue('hi')).toBe('"hi"');
  });

  it('handles booleans, null, undefined, and functions', () => {
    expect(formatValue(true)).toBe('true');
    expect(formatValue(null)).toBe('null');
    expect(formatValue(undefined)).toBe('undefined');
    expect(formatValue(() => 1)).toBe('ƒ()');
  });
});

describe('isExpandable', () => {
  it('accepts objects and arrays', () => {
    expect(isExpandable({})).toBe(true);
    expect(isExpandable([1, 2])).toBe(true);
  });

  it('rejects primitives and null', () => {
    expect(isExpandable(null)).toBe(false);
    expect(isExpandable(5)).toBe(false);
    expect(isExpandable('x')).toBe(false);
    expect(isExpandable(undefined)).toBe(false);
  });
});

describe('propEntries', () => {
  it('skips _-prefixed keys', () => {
    const { entries, hidden } = propEntries({ a: 1, _b: 2, c: 3 });
    expect(entries).toEqual([
      ['a', 1],
      ['c', 3],
    ]);
    expect(hidden).toBe(0);
  });

  it('caps at MAX_PROPS_PER_NODE and reports the overflow', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < MAX_PROPS_PER_NODE + 10; i++) big[`k${i}`] = i;
    const { entries, hidden } = propEntries(big);
    expect(entries).toHaveLength(MAX_PROPS_PER_NODE);
    expect(hidden).toBe(10);
  });

  it('enumerates array indices', () => {
    const { entries } = propEntries(['a', 'b']);
    expect(entries).toEqual([
      ['0', 'a'],
      ['1', 'b'],
    ]);
  });
});

describe('nearestEntity', () => {
  const at = (x: number, y: number) => ({ x, y });

  it('returns the closest entity within range', () => {
    const a = at(10, 0);
    const b = at(5, 0);
    expect(nearestEntity([a, b], at(0, 0))).toBe(b);
  });

  it('ignores entities beyond the range', () => {
    expect(nearestEntity([at(NEAREST_RANGE + 1, 0)], at(0, 0))).toBeNull();
  });

  it('includes an entity exactly at the range boundary', () => {
    const edge = at(NEAREST_RANGE, 0);
    expect(nearestEntity([edge], at(0, 0))).toBe(edge);
  });

  it('respects a custom range', () => {
    const e = at(50, 0);
    expect(nearestEntity([e], at(0, 0), 40)).toBeNull();
    expect(nearestEntity([e], at(0, 0), 60)).toBe(e);
  });

  it('returns null for an empty list', () => {
    expect(nearestEntity([], at(0, 0))).toBeNull();
  });
});

describe('countByKind', () => {
  it('groups and sorts by kind', () => {
    const counts = countByKind([
      { kind: 'npc' },
      { kind: 'monster' },
      { kind: 'monster' },
      { kind: 'player' },
    ]);
    expect(counts).toEqual([
      ['monster', 2],
      ['npc', 1],
      ['player', 1],
    ]);
  });

  it('returns an empty list for no entities', () => {
    expect(countByKind([])).toEqual([]);
  });
});

describe('initInspector under node (no DOM)', () => {
  it('returns an inert handle instead of throwing', () => {
    const snap = (): InspectorSnapshot => ({
      net: { connected: false, areaId: '', instanceId: '', players: 0 },
      you: {},
      entities: [],
      renderer: {},
      mouseWorld: { x: 0, y: 0 },
    });
    const handle = initInspector(snap);
    expect(handle.frozen).toBe(false);
    expect(() => handle.toggle()).not.toThrow();
  });
});

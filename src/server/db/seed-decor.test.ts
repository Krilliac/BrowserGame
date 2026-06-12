import { describe, expect, it } from 'vitest';
import { AREAS } from '../../shared/areas.js';
import { EXPANSION_DECOR, type DecorRow } from './seed-decor.js';

/**
 * The kinds the client can draw: sprite-backed kinds from src/client/decor-sprites.ts plus the
 * renderer's procedural light props (torch/candle/brazier). Deliberately excludes 'shrine' —
 * shrines are gameplay objects, placed sparingly by hand in seed.ts only.
 */
const ALLOWED_KINDS = new Set([
  'pot',
  'grave',
  'bones',
  'dead_tree',
  'tree',
  'rock',
  'crystal',
  'mushroom',
  'stalagmite',
  'skull_pile',
  'ruin',
  'thorn_plant',
  'horror_plant',
  'barrel',
  'crate',
  'torch',
  'candle',
  'brazier',
]);

/** Margin from area edges, and the keep-clear radius around spawns / portal rect centers. */
const EDGE_MARGIN = 60;
const KEEP_CLEAR = 70;

/** Max light props (candle + brazier) per area — each one adds a render light source. */
const MAX_LIGHTS_PER_AREA = 10;

/**
 * Town house footprints, hardcoded from the `house` rows in TOWN_DECOR (src/server/db/seed.ts):
 * (x,y) NW corner → (x2,y2) SE corner. New props must not land inside an enterable building.
 */
const TOWN_HOUSES = [
  { x: 250, y: 360, x2: 420, y2: 500 },
  { x: 1190, y: 360, x2: 1360, y2: 500 },
  { x: 700, y: 920, x2: 900, y2: 1060 },
];

function label(row: DecorRow): string {
  return `${row.areaId}:${row.kind}@(${row.x},${row.y})`;
}

function rowsByArea(): Map<string, DecorRow[]> {
  const map = new Map<string, DecorRow[]>();
  for (const row of EXPANSION_DECOR) {
    const list = map.get(row.areaId) ?? [];
    list.push(row);
    map.set(row.areaId, list);
  }
  return map;
}

describe('EXPANSION_DECOR', () => {
  it('only references areas that exist', () => {
    const unknown = EXPANSION_DECOR.filter((row) => !(row.areaId in AREAS)).map(label);
    expect(unknown).toEqual([]);
  });

  it('dresses every area with at least one prop', () => {
    const byArea = rowsByArea();
    const bare = Object.keys(AREAS).filter((id) => (byArea.get(id) ?? []).length === 0);
    expect(bare).toEqual([]);
  });

  it('only uses kinds the renderer can draw', () => {
    const bad = EXPANSION_DECOR.filter((row) => !ALLOWED_KINDS.has(row.kind)).map(label);
    expect(bad).toEqual([]);
  });

  it('keeps every prop inside the area bounds margin', () => {
    const outOfBounds = EXPANSION_DECOR.filter((row) => {
      const def = AREAS[row.areaId];
      if (!def) return false; // covered by the unknown-area test
      return (
        row.x < EDGE_MARGIN ||
        row.x > def.width - EDGE_MARGIN ||
        row.y < EDGE_MARGIN ||
        row.y > def.height - EDGE_MARGIN
      );
    }).map(label);
    expect(outOfBounds).toEqual([]);
  });

  it('keeps every prop clear of the area spawn and portal rect centers', () => {
    const tooClose: string[] = [];
    for (const row of EXPANSION_DECOR) {
      const def = AREAS[row.areaId];
      if (!def) continue;
      const points = [
        def.spawn,
        ...def.portals.map((p) => ({ x: p.rect.x + p.rect.w / 2, y: p.rect.y + p.rect.h / 2 })),
      ];
      for (const pt of points) {
        if (Math.hypot(row.x - pt.x, row.y - pt.y) < KEEP_CLEAR) {
          tooClose.push(`${label(row)} near (${pt.x},${pt.y})`);
        }
      }
    }
    expect(tooClose).toEqual([]);
  });

  it('keeps town props out of the enterable house footprints', () => {
    const inside = EXPANSION_DECOR.filter(
      (row) =>
        row.areaId === 'town' &&
        TOWN_HOUSES.some((h) => row.x >= h.x && row.x <= h.x2 && row.y >= h.y && row.y <= h.y2),
    ).map(label);
    expect(inside).toEqual([]);
  });

  it(`places at most ${MAX_LIGHTS_PER_AREA} candles + braziers per area`, () => {
    const overlit: string[] = [];
    for (const [areaId, rows] of rowsByArea()) {
      const lights = rows.filter((r) => r.kind === 'candle' || r.kind === 'brazier').length;
      if (lights > MAX_LIGHTS_PER_AREA) overlit.push(`${areaId}: ${lights}`);
    }
    expect(overlit).toEqual([]);
  });
});

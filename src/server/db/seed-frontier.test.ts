import { describe, expect, it } from 'vitest';
import { AREAS, DUNGEONS } from '../../shared/areas.js';
import { EQUIPMENT } from './seed-items.js';
import { MOB_TEMPLATES } from '../mobs.js';
import { FRONTIER_DECOR, FRONTIER_LOOT, FRONTIER_NPCS, FRONTIER_QUESTS } from './seed-frontier.js';
import type { DecorRow } from './seed-decor.js';

/** NPC kinds from the content DB enum (src/server/db/editable.ts). */
const NPC_KINDS = new Set([
  'vendor',
  'questgiver',
  'healer',
  'gambler',
  'artificer',
  'banker',
  'recruiter',
  'riftkeeper',
]);

/** Item ids the frontier loot may reference: equipment bases plus the loot/currency rows it uses. */
const ITEM_IDS = new Set([...Object.keys(EQUIPMENT), 'gold', 'rune_shard']);

/** Margin from area edges, and the keep-clear radius around spawns / portal rect centers. */
const EDGE_MARGIN = 60;
const KEEP_CLEAR = 70;

function label(row: DecorRow): string {
  return `${row.areaId}:${row.kind}@(${row.x},${row.y})`;
}

describe('FRONTIER_NPCS', () => {
  it('places every NPC in a real area with a valid kind, in bounds', () => {
    for (const n of FRONTIER_NPCS) {
      const def = AREAS[n.areaId];
      expect(def, `${n.name}: area ${n.areaId}`).toBeDefined();
      expect(NPC_KINDS.has(n.kind), `${n.name}: kind ${n.kind}`).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(n.x).toBeLessThanOrEqual(def!.width - EDGE_MARGIN);
      expect(n.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(n.y).toBeLessThanOrEqual(def!.height - EDGE_MARGIN);
    }
  });

  it('gives Duskhaven the full rest-point service row, each pitch >= 30 px apart', () => {
    const kinds = FRONTIER_NPCS.filter((n) => n.areaId === 'duskhaven').map((n) => n.kind);
    for (const want of ['vendor', 'healer', 'banker', 'questgiver']) {
      expect(kinds, want).toContain(want);
    }
    for (let i = 0; i < FRONTIER_NPCS.length; i++) {
      for (let j = i + 1; j < FRONTIER_NPCS.length; j++) {
        const a = FRONTIER_NPCS[i]!;
        const b = FRONTIER_NPCS[j]!;
        if (a.areaId !== b.areaId) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(
          30,
        );
      }
    }
  });
});

describe('FRONTIER_DECOR', () => {
  const houses = FRONTIER_DECOR.filter((r) => r.kind === 'house');

  it('only references areas that exist', () => {
    const unknown = FRONTIER_DECOR.filter((row) => !(row.areaId in AREAS)).map(label);
    expect(unknown).toEqual([]);
  });

  it('keeps every prop (and line/footprint endpoints) inside the area bounds margin', () => {
    const outOfBounds = FRONTIER_DECOR.filter((row) => {
      const def = AREAS[row.areaId];
      if (!def) return false;
      const points = [
        { x: row.x, y: row.y },
        ...(row.x2 !== undefined && row.y2 !== undefined ? [{ x: row.x2, y: row.y2 }] : []),
      ];
      return points.some(
        (p) =>
          p.x < EDGE_MARGIN ||
          p.x > def.width - EDGE_MARGIN ||
          p.y < EDGE_MARGIN ||
          p.y > def.height - EDGE_MARGIN,
      );
    }).map(label);
    expect(outOfBounds).toEqual([]);
  });

  it('keeps every prop clear of the area spawn and portal rect centers', () => {
    const tooClose: string[] = [];
    for (const row of FRONTIER_DECOR) {
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

  it('keeps props out of the enterable house footprints (and houses have footprints)', () => {
    expect(houses.length).toBeGreaterThanOrEqual(2);
    for (const h of houses) {
      expect(typeof h.x2, label(h)).toBe('number');
      expect(typeof h.y2, label(h)).toBe('number');
    }
    const inside = FRONTIER_DECOR.filter(
      (row) =>
        row.kind !== 'house' &&
        houses.some(
          (h) =>
            row.areaId === h.areaId &&
            row.x >= h.x &&
            row.x <= h.x2! &&
            row.y >= h.y &&
            row.y <= h.y2!,
        ),
    ).map(label);
    expect(inside).toEqual([]);
  });
});

describe('FRONTIER_LOOT', () => {
  it('every row references a real mob template and a real item', () => {
    for (const l of FRONTIER_LOOT) {
      expect(MOB_TEMPLATES[l.mobTemplateId], l.mobTemplateId).toBeDefined();
      expect(ITEM_IDS.has(l.itemId), `${l.mobTemplateId}: ${l.itemId}`).toBe(true);
    }
  });

  it('covers every new Throne template, with an always-gold row each', () => {
    const newTemplates = [
      'abyss_thrall',
      'duskfire_hexer',
      'thronespawn_ravager',
      'throne_sentinel',
      'throne_magus',
      'nyxathor',
    ];
    for (const id of newTemplates) {
      const gold = FRONTIER_LOOT.find(
        (l) => l.mobTemplateId === id && l.grp === 'always' && l.itemId === 'gold',
      );
      expect(gold, id).toBeDefined();
    }
    // The apex boss drops the largest gold pile in the game.
    const apex = FRONTIER_LOOT.find((l) => l.mobTemplateId === 'nyxathor' && l.grp === 'always')!;
    expect(apex.minQty).toBeGreaterThanOrEqual(2000);
    expect(apex.maxQty).toBeLessThanOrEqual(4000);
  });
});

describe('FRONTIER_QUESTS', () => {
  it('every quest targets a real mob and any reward item exists', () => {
    for (const q of FRONTIER_QUESTS) {
      if (q.targetMob) expect(MOB_TEMPLATES[q.targetMob], q.id).toBeDefined();
      if (q.rewardItem) expect(ITEM_IDS.has(q.rewardItem), q.id).toBe(true);
    }
  });

  it('includes the apex bounty on the Sovereign', () => {
    const apex = FRONTIER_QUESTS.find((q) => q.targetMob === 'nyxathor');
    expect(apex).toBeDefined();
    expect(apex!.rewardXp).toBeGreaterThanOrEqual(50000);
  });
});

describe('frontier world graph (duskhaven + abyssal_throne)', () => {
  const pairs: [string, string][] = [
    ['frostpeak', 'duskhaven'],
    ['blighted_spire', 'abyssal_throne'],
  ];

  it('portal pairs are bidirectional', () => {
    for (const [a, b] of pairs) {
      expect(
        AREAS[a]!.portals.some((p) => p.toArea === b),
        `${a} → ${b}`,
      ).toBe(true);
      expect(
        AREAS[b]!.portals.some((p) => p.toArea === a),
        `${b} → ${a}`,
      ).toBe(true);
    }
  });

  it('arrival spawns land clear of every portal rect in the destination area', () => {
    for (const [a, b] of pairs) {
      const directions: [string, string][] = [
        [a, b],
        [b, a],
      ];
      for (const [from, to] of directions) {
        const portal = AREAS[from]!.portals.find((p) => p.toArea === to)!;
        for (const dp of AREAS[to]!.portals) {
          const inside =
            portal.toSpawn.x >= dp.rect.x &&
            portal.toSpawn.x <= dp.rect.x + dp.rect.w &&
            portal.toSpawn.y >= dp.rect.y &&
            portal.toSpawn.y <= dp.rect.y + dp.rect.h;
          expect(inside, `${from}→${to} spawn lands in a portal`).toBe(false);
        }
      }
    }
  });

  it('default spawns sit outside their own portal rects', () => {
    for (const id of ['duskhaven', 'abyssal_throne']) {
      const def = AREAS[id]!;
      for (const p of def.portals) {
        const inside =
          def.spawn.x >= p.rect.x &&
          def.spawn.x <= p.rect.x + p.rect.w &&
          def.spawn.y >= p.rect.y &&
          def.spawn.y <= p.rect.y + p.rect.h;
        expect(inside, `${id} spawn in its own portal`).toBe(false);
      }
    }
  });

  it('the Abyssal Throne dungeon population references real templates only', () => {
    const d = DUNGEONS['abyssal_throne']!;
    const refs = [...d.pool, d.boss, ...(d.miniBoss ? [d.miniBoss] : [])];
    for (const id of refs) expect(MOB_TEMPLATES[id], id).toBeDefined();
    expect(MOB_TEMPLATES[d.boss]!.level).toBe(40);
    // Floor pool mobs must stay below boss hp (>= 200 marks bosses/elites as traitless).
    for (const id of ['abyss_thrall', 'duskfire_hexer', 'thronespawn_ravager']) {
      expect(MOB_TEMPLATES[id]!.hp, id).toBeLessThan(200);
    }
  });
});

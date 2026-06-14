import { describe, expect, it } from 'vitest';
import { AREAS, AREA_THEMES, DUNGEONS } from '../../shared/areas.js';
import { EQUIPMENT } from './seed-items.js';
import { MOB_TEMPLATES, AREA_MOBS } from '../mobs.js';
import { NEW_SPELLBOOKS } from './seed-spells.js';
import { ACTS_DECOR, ACTS_LOOT, ACTS_NPCS, ACTS_QUESTS, ACTS_VENDOR_STOCK } from './seed-acts.js';
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

/** Item ids the acts loot may reference: equipment bases plus the loot/currency rows it uses. */
const ITEM_IDS = new Set([...Object.keys(EQUIPMENT), 'gold', 'rune_shard']);

/** The vendor shelf may additionally stock the late tomes registered in seed-spells.ts. */
const VENDOR_ITEM_IDS = new Set([...ITEM_IDS, ...Object.keys(NEW_SPELLBOOKS)]);

/** Every area this content pack introduces (areas.ts additions). */
const ACT2_ZONES = ['grimfrost_barrow', 'howling_barrens', 'sunken_pass'];
const ACT3_AREAS = [
  'vhalreth',
  'ashveil_desert',
  'shattered_causeway',
  'voidmarch',
  'the_unmade_court',
];
const NEW_AREAS = [...ACT2_ZONES, ...ACT3_AREAS];

/** Every monster template this content pack introduces (mobs.ts additions). */
const NEW_TEMPLATES = [
  'barrow_wight',
  'cairn_banshee',
  'barrens_warg',
  'hexpine_shaman',
  'drowned_hulk',
  'tidegrave_lurker',
  'maelgor',
  'ash_dire_wolf',
  'cinderbone_archer',
  'ashveil_gorgon',
  'causeway_golem',
  'voidtouched_centaur',
  'null_revenant',
  'sarghul',
  'vessirah',
  'court_executioner',
  'court_oracle',
  'athraxis',
];

/** Margin from area edges, and the keep-clear radius around spawns / portal rect centers. */
const EDGE_MARGIN = 60;
const KEEP_CLEAR = 70;

/** Max light props (candle + brazier) per area — each one adds a render light source. */
const MAX_LIGHTS_PER_AREA = 10;

function label(row: DecorRow): string {
  return `${row.areaId}:${row.kind}@(${row.x},${row.y})`;
}

describe('acts areas + bestiary registration', () => {
  it('every new area exists with a theme, and every new template exists', () => {
    for (const id of NEW_AREAS) {
      expect(AREAS[id], id).toBeDefined();
      expect(AREA_THEMES[id], `${id} theme`).toBeDefined();
    }
    for (const id of NEW_TEMPLATES) expect(MOB_TEMPLATES[id], id).toBeDefined();
  });

  it('combat zones have rosters of real templates; the city is safe', () => {
    expect(AREA_MOBS['vhalreth']).toEqual([]);
    for (const id of NEW_AREAS.filter((a) => a !== 'vhalreth' && a !== 'the_unmade_court')) {
      const roster = AREA_MOBS[id];
      expect(roster, id).toBeDefined();
      expect(roster!.length, id).toBeGreaterThanOrEqual(4);
      for (const s of roster!) {
        expect(MOB_TEMPLATES[s.templateId], `${id}: ${s.templateId}`).toBeDefined();
        expect(s.count, `${id}: ${s.templateId}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

describe('ACTS_NPCS', () => {
  it('places every NPC in a real area with a valid kind, in bounds', () => {
    for (const n of ACTS_NPCS) {
      const def = AREAS[n.areaId];
      expect(def, `${n.name}: area ${n.areaId}`).toBeDefined();
      expect(NPC_KINDS.has(n.kind), `${n.name}: kind ${n.kind}`).toBe(true);
      expect(n.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(n.x).toBeLessThanOrEqual(def!.width - EDGE_MARGIN);
      expect(n.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
      expect(n.y).toBeLessThanOrEqual(def!.height - EDGE_MARGIN);
    }
  });

  it("gives Vhal'reth the full service row, each pitch >= 30 px apart", () => {
    const kinds = ACTS_NPCS.filter((n) => n.areaId === 'vhalreth').map((n) => n.kind);
    for (const want of [
      'vendor',
      'healer',
      'banker',
      'gambler',
      'artificer',
      'recruiter',
      'riftkeeper',
      'questgiver',
    ]) {
      expect(kinds, want).toContain(want);
    }
    for (let i = 0; i < ACTS_NPCS.length; i++) {
      for (let j = i + 1; j < ACTS_NPCS.length; j++) {
        const a = ACTS_NPCS[i]!;
        const b = ACTS_NPCS[j]!;
        if (a.areaId !== b.areaId) continue;
        expect(Math.hypot(a.x - b.x, a.y - b.y), `${a.name} vs ${b.name}`).toBeGreaterThanOrEqual(
          30,
        );
      }
    }
  });
});

describe('ACTS_DECOR', () => {
  const houses = ACTS_DECOR.filter((r) => r.kind === 'house');

  it('only references areas that exist', () => {
    const unknown = ACTS_DECOR.filter((row) => !(row.areaId in AREAS)).map(label);
    expect(unknown).toEqual([]);
  });

  it('keeps every prop (and line/footprint endpoints) inside the area bounds margin', () => {
    const outOfBounds = ACTS_DECOR.filter((row) => {
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
    for (const row of ACTS_DECOR) {
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
    expect(houses.length).toBeGreaterThanOrEqual(4);
    for (const h of houses) {
      expect(typeof h.x2, label(h)).toBe('number');
      expect(typeof h.y2, label(h)).toBe('number');
    }
    const inside = ACTS_DECOR.filter(
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

  it(`places at most ${MAX_LIGHTS_PER_AREA} candles + braziers per area`, () => {
    const lightsByArea = new Map<string, number>();
    for (const row of ACTS_DECOR) {
      if (row.kind !== 'candle' && row.kind !== 'brazier') continue;
      lightsByArea.set(row.areaId, (lightsByArea.get(row.areaId) ?? 0) + 1);
    }
    for (const [areaId, n] of lightsByArea) {
      expect(n, areaId).toBeLessThanOrEqual(MAX_LIGHTS_PER_AREA);
    }
  });
});

describe('ACTS_LOOT', () => {
  it('every row references a real mob template and a real item', () => {
    for (const l of ACTS_LOOT) {
      expect(MOB_TEMPLATES[l.mobTemplateId], l.mobTemplateId).toBeDefined();
      expect(ITEM_IDS.has(l.itemId), `${l.mobTemplateId}: ${l.itemId}`).toBe(true);
    }
  });

  it('covers every new acts template, with an always-gold row each', () => {
    for (const id of NEW_TEMPLATES) {
      const gold = ACTS_LOOT.find(
        (l) => l.mobTemplateId === id && l.grp === 'always' && l.itemId === 'gold',
      );
      expect(gold, id).toBeDefined();
    }
    // The final boss drops the new largest gold pile in the game (above the Sovereign's 4000).
    const apex = ACTS_LOOT.find((l) => l.mobTemplateId === 'athraxis' && l.grp === 'always')!;
    expect(apex.minQty).toBeGreaterThanOrEqual(5000);
    expect(apex.maxQty).toBeLessThanOrEqual(9000);
  });
});

describe('ACTS_QUESTS', () => {
  it('every quest targets a real mob and any reward item exists', () => {
    for (const q of ACTS_QUESTS) {
      if (q.targetMob) expect(MOB_TEMPLATES[q.targetMob], q.id).toBeDefined();
      if (q.rewardItem) expect(ITEM_IDS.has(q.rewardItem), q.id).toBe(true);
    }
  });

  it('includes the apex bounty on the Unmade God, the largest reward in the game', () => {
    const apex = ACTS_QUESTS.find((q) => q.targetMob === 'athraxis');
    expect(apex).toBeDefined();
    expect(apex!.rewardXp).toBeGreaterThanOrEqual(150000);
    expect(apex!.rewardGold).toBeGreaterThanOrEqual(20000);
  });
});

describe('ACTS_VENDOR_STOCK', () => {
  it("stocks the Quartermaster in Vhal'reth with real items, positive prices, unique sort", () => {
    const vendor = ACTS_NPCS.find((n) => n.kind === 'vendor' && n.areaId === 'vhalreth')!;
    expect(vendor).toBeDefined();
    const sortOrders = new Set<number>();
    for (const s of ACTS_VENDOR_STOCK) {
      expect(s.areaId).toBe('vhalreth');
      expect(s.npcName).toBe(vendor.name);
      expect(VENDOR_ITEM_IDS.has(s.itemId), s.itemId).toBe(true);
      expect(s.price, s.itemId).toBeGreaterThan(0);
      sortOrders.add(s.sortOrder);
    }
    expect(sortOrders.size).toBe(ACTS_VENDOR_STOCK.length);
  });
});

describe('acts world graph', () => {
  const pairs: [string, string][] = [
    ['duskhaven', 'grimfrost_barrow'],
    ['grimfrost_barrow', 'howling_barrens'],
    ['howling_barrens', 'sunken_pass'],
    ['sunken_pass', 'blighted_spire'],
    ['sunken_pass', 'vhalreth'],
    ['vhalreth', 'ashveil_desert'],
    ['ashveil_desert', 'shattered_causeway'],
    ['shattered_causeway', 'voidmarch'],
    ['voidmarch', 'the_unmade_court'],
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
    for (const id of NEW_AREAS) {
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

  it('the Unmade Court dungeon references real templates, capped by the L60 final boss', () => {
    const d = DUNGEONS['the_unmade_court']!;
    const refs = [...d.pool, d.boss, ...(d.miniBoss ? [d.miniBoss] : [])];
    for (const id of refs) expect(MOB_TEMPLATES[id], id).toBeDefined();
    expect(MOB_TEMPLATES[d.boss]!.level).toBe(60);
    expect(MOB_TEMPLATES[d.boss]!.hp).toBeGreaterThanOrEqual(3000);
    // Regular floor mobs stay under boss hp (>= 200 marks bosses/elites as traitless);
    // the Court's named guards are the deliberate boss-tier exceptions.
    const guards = new Set(['court_oracle', 'court_executioner']);
    for (const id of d.pool.filter((p) => !guards.has(p))) {
      expect(MOB_TEMPLATES[id]!.hp, id).toBeLessThan(200);
    }
    for (const id of guards) {
      expect(MOB_TEMPLATES[id]!.hp, id).toBeGreaterThanOrEqual(500);
      expect(MOB_TEMPLATES[id]!.hp, id).toBeLessThanOrEqual(700);
    }
  });
});

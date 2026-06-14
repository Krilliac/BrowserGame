import { describe, expect, it } from 'vitest';
import { MOB_TEMPLATES } from '../mobs.js';
import { AREAS } from '../../shared/areas.js';
import { mobSpriteCell } from '../../client/rogues-sprites.js';
import { WILDS_AREA_MOBS, WILDS_LOOT } from './seed-wilds.js';

/**
 * Every item id referenced by WILDS_LOOT, hardcoded: materials come from seed.ts MATERIALS
 * (gold, wolf_pelt, bone, rune_shard, venom_gland, ember_ore, frost_core), equipment from
 * src/shared/equipment.ts. If one of these is ever removed from the content, this list (and
 * the loot rows using it) must change with it.
 */
const KNOWN_ITEM_IDS = new Set([
  'gold',
  'wolf_pelt',
  'bone',
  'rune_shard',
  'venom_gland',
  'ember_ore',
  'frost_core',
  'rusty_sword',
  'leather_armor',
  'steel_sword',
  'steel_armor',
  'steel_helm',
  'mithril_armor',
  'mithril_visage',
  'mithril_legplates',
  'moonsilver_saber',
]);

const LOOT_GROUPS = new Set(['always', 'main', 'rare', 'gear']);

/** The wilds template ids, derived from the spawn roster (each new mob spawns somewhere). */
const wildsTemplateIds = [...new Set(WILDS_AREA_MOBS.map((s) => s.templateId))];

describe('WILDS_AREA_MOBS', () => {
  it('references only existing mob templates and areas, with positive counts', () => {
    for (const s of WILDS_AREA_MOBS) {
      expect(MOB_TEMPLATES[s.templateId], s.templateId).toBeDefined();
      expect(AREAS[s.areaId], s.areaId).toBeDefined();
      expect(s.count, `${s.areaId}/${s.templateId} count`).toBeGreaterThan(0);
    }
  });

  it('never duplicates an (area, template) pair', () => {
    const keys = WILDS_AREA_MOBS.map((s) => `${s.areaId}/${s.templateId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('spawns the wilds bestiary across early, mid, and late zones (not all in one place)', () => {
    const areas = new Set(WILDS_AREA_MOBS.map((s) => s.areaId));
    expect(areas.size).toBeGreaterThanOrEqual(5);
  });
});

describe('WILDS_LOOT', () => {
  it('references only existing mob templates and known item ids', () => {
    for (const row of WILDS_LOOT) {
      expect(MOB_TEMPLATES[row.mobTemplateId], row.mobTemplateId).toBeDefined();
      expect(KNOWN_ITEM_IDS.has(row.itemId), row.itemId).toBe(true);
    }
  });

  it('rows are well-formed loot_entry data', () => {
    for (const row of WILDS_LOOT) {
      const label = `${row.mobTemplateId}/${row.grp}/${row.itemId}`;
      expect(LOOT_GROUPS.has(row.grp), label).toBe(true);
      expect(row.weight, label).toBeGreaterThan(0);
      expect(row.minQty, label).toBeGreaterThanOrEqual(1);
      expect(row.maxQty, label).toBeGreaterThanOrEqual(row.minQty);
      expect(row.chance, label).toBeGreaterThanOrEqual(0);
      expect(row.chance, label).toBeLessThanOrEqual(1);
      // Gated groups carry a trigger chance; the always/main groups never do.
      if (row.grp === 'rare' || row.grp === 'gear') expect(row.chance, label).toBeGreaterThan(0);
      else expect(row.chance, label).toBe(0);
    }
  });

  it('gives every wilds monster a guaranteed gold drop and a main roll', () => {
    for (const id of wildsTemplateIds) {
      const rows = WILDS_LOOT.filter((r) => r.mobTemplateId === id);
      expect(
        rows.some((r) => r.grp === 'always' && r.itemId === 'gold'),
        `${id} gold`,
      ).toBe(true);
      expect(
        rows.some((r) => r.grp === 'main'),
        `${id} main`,
      ).toBe(true);
    }
  });

  it('only describes mobs that actually spawn (no orphan loot tables)', () => {
    for (const id of new Set(WILDS_LOOT.map((r) => r.mobTemplateId))) {
      expect(wildsTemplateIds.includes(id), `${id} loot has no spawn`).toBe(true);
    }
  });
});

describe('wilds sprite coverage', () => {
  it('every wilds template name resolves to a 32rogues cell', () => {
    for (const id of wildsTemplateIds) {
      const template = MOB_TEMPLATES[id]!;
      expect(mobSpriteCell(template.name), template.name).toBeDefined();
    }
  });
});

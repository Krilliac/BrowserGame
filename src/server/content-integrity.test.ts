import { describe, expect, it } from 'vitest';
import { getContent, initGameDb } from './content.js';
import { MOB_TEMPLATES } from './mobs.js';
import { isDungeon } from '../shared/areas.js';
import { dollSlotsFor, type ItemSlot } from '../shared/equipment.js';

initGameDb(':memory:');
const c = getContent();

/**
 * Content-data integrity: the game is data-driven (areas/mobs/abilities/items/drops in SQLite), so a
 * typo in the seed — a 0-HP mob, a portal to a non-existent area, a roster naming a missing template,
 * a drop table referencing an item id that doesn't exist — would only surface as a runtime crash or
 * silent misbehavior. These tests turn that into a failing build. They enumerate EVERY record.
 */
describe('area integrity', () => {
  it('every area has positive dimensions and a spawn inside its bounds', () => {
    for (const a of c.areas()) {
      expect(a.width, `${a.id} width`).toBeGreaterThan(0);
      expect(a.height, `${a.id} height`).toBeGreaterThan(0);
      expect(a.spawn.x, `${a.id} spawn.x`).toBeGreaterThanOrEqual(0);
      expect(a.spawn.x, `${a.id} spawn.x`).toBeLessThanOrEqual(a.width);
      expect(a.spawn.y, `${a.id} spawn.y`).toBeGreaterThanOrEqual(0);
      expect(a.spawn.y, `${a.id} spawn.y`).toBeLessThanOrEqual(a.height);
    }
  });

  it('every portal leads to a real area or dungeon (no portals to nowhere)', () => {
    for (const a of c.areas()) {
      for (const p of a.portals) {
        const exists = c.area(p.toArea) !== undefined || isDungeon(p.toArea);
        expect(exists, `${a.id} → ${p.toArea}`).toBe(true);
        expect(p.rect.w, `${a.id} portal w`).toBeGreaterThan(0);
        expect(p.rect.h, `${a.id} portal h`).toBeGreaterThan(0);
      }
    }
  });

  it("every area's mob roster names a real mob template", () => {
    for (const a of c.areas()) {
      for (const entry of c.areaMobs(a.id)) {
        expect(
          c.mobTemplate(entry.templateId),
          `${a.id} roster → ${entry.templateId}`,
        ).toBeDefined();
        expect(entry.count, `${a.id} ${entry.templateId} count`).toBeGreaterThan(0);
      }
    }
  });
});

describe('mob template integrity', () => {
  const behaviors = new Set(['melee', 'ranged', 'charger']);

  it('every mob template is well-formed (positive stats, valid behavior, sane level)', () => {
    for (const [id, t] of Object.entries(MOB_TEMPLATES)) {
      expect(t.id, `${id} id`).toBe(id);
      expect(t.name, `${id} name`).toBeTruthy();
      expect(t.hp, `${id} hp`).toBeGreaterThan(0);
      expect(t.level, `${id} level`).toBeGreaterThanOrEqual(1);
      expect(t.speed, `${id} speed`).toBeGreaterThan(0);
      expect(t.damage, `${id} damage`).toBeGreaterThanOrEqual(0);
      expect(t.attackRange, `${id} attackRange`).toBeGreaterThan(0);
      expect(t.aggroRange, `${id} aggroRange`).toBeGreaterThan(0);
      expect(t.attackCooldownMs, `${id} cooldown`).toBeGreaterThan(0);
      expect(behaviors.has(t.behavior), `${id} behavior ${t.behavior}`).toBe(true);
    }
  });
});

describe('ability + item integrity', () => {
  const kinds = new Set(['melee', 'projectile', 'heal']);

  it('every ability is well-formed (valid kind, non-negative numbers)', () => {
    for (const ab of c.abilityList()) {
      expect(ab.id, 'ability id').toBeTruthy();
      expect(kinds.has(ab.kind), `${ab.id} kind ${ab.kind}`).toBe(true);
      expect(ab.damage, `${ab.id} damage`).toBeGreaterThanOrEqual(0);
      expect(ab.manaCost, `${ab.id} manaCost`).toBeGreaterThanOrEqual(0);
      expect(ab.range, `${ab.id} range`).toBeGreaterThanOrEqual(0);
    }
  });

  it('every item has an id, a kind, a name, and a non-negative sell value', () => {
    for (const item of c.items()) {
      expect(item.id, 'item id').toBeTruthy();
      expect(item.name, `${item.id} name`).toBeTruthy();
      expect(item.kind, `${item.id} kind`).toBeTruthy();
      expect(item.sellValue, `${item.id} sellValue`).toBeGreaterThanOrEqual(0);
    }
  });

  it('every spellbook teaches a REAL ability, and every equippable names a valid slot', () => {
    // The 12 item-side slot categories (ItemSlot in shared/equipment.ts; two rings share 'ring').
    const itemSlots = new Set([
      'head',
      'neck',
      'shoulders',
      'chest',
      'hands',
      'waist',
      'legs',
      'feet',
      'mainhand',
      'offhand',
      'ring',
      'trinket',
    ]);
    for (const item of c.items()) {
      if (item.teaches !== null) {
        // A tome that teaches a deleted/typo'd spell would silently fail to learn anything.
        expect(
          c.ability(item.teaches),
          `${item.id} teaches unknown ability "${item.teaches}"`,
        ).toBeDefined();
      }
      if (item.kind === 'equip') {
        expect(item.slot, `${item.id} equip slot`).not.toBeNull();
        expect(itemSlots.has(item.slot as string), `${item.id} bad slot "${item.slot}"`).toBe(true);
      }
    }
  });
});

describe('drop-table integrity (sampled)', () => {
  it('every loot a monster can roll resolves to a real item (or gold)', () => {
    // rollLoot is RNG-driven; sample a spread of constant rngs per mob to surface a typo'd drop id.
    const rngs = Array.from({ length: 25 }, (_, i) => () => i / 25);
    for (const id of Object.keys(MOB_TEMPLATES)) {
      for (const rng of rngs) {
        for (const stack of c.rollLoot(id, rng)) {
          const ok = stack.item === 'gold' || c.item(stack.item) !== undefined;
          expect(ok, `${id} drops unknown item "${stack.item}"`).toBe(true);
          expect(stack.qty, `${id} ${stack.item} qty`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('item-set integrity', () => {
  // The buff affix stats a set bonus may grant (mirrors the item_set_bonuses editable enum).
  const buffStats = new Set([
    'power',
    'hp',
    'crit',
    'multishot',
    'lifesteal',
    'swift',
    'move',
    'armor',
    'vigor',
  ]);

  it('every set names ≥2 REAL item pieces with no duplicates', () => {
    for (const s of c.itemSets()) {
      expect(s.id, 'set id').toBeTruthy();
      expect(s.pieces.length, `${s.id} piece count`).toBeGreaterThanOrEqual(2);
      expect(new Set(s.pieces).size, `${s.id} duplicate pieces`).toBe(s.pieces.length);
      for (const piece of s.pieces) {
        // A typo'd piece id would make the set silently un-completable in-game.
        expect(c.item(piece), `${s.id} piece "${piece}" is not a real item`).toBeDefined();
      }
    }
  });

  it('every set is COMPLETABLE: its pieces fit distinct doll slots', () => {
    // A set whose pieces collide on a slot (e.g. two chest pieces) can never reach its top
    // threshold — the bonus would be dead content. Rings are the one slot with capacity 2.
    for (const s of c.itemSets()) {
      const perSlot = new Map<string, number>();
      for (const piece of s.pieces) {
        const slot = c.item(piece)?.slot as ItemSlot | null | undefined;
        expect(slot, `${s.id} piece "${piece}" has no slot`).toBeTruthy();
        perSlot.set(slot as string, (perSlot.get(slot as string) ?? 0) + 1);
      }
      for (const [slot, count] of perSlot) {
        const capacity = dollSlotsFor(slot as ItemSlot).length; // ring -> 2, everything else -> 1
        expect(
          count,
          `${s.id} has ${count} '${slot}' pieces but only ${capacity} slot(s)`,
        ).toBeLessThanOrEqual(capacity);
      }
    }
  });

  it('every set bonus has a valid threshold + buff stat + positive value', () => {
    for (const s of c.itemSets()) {
      expect(s.bonuses.length, `${s.id} bonuses`).toBeGreaterThan(0);
      for (const b of s.bonuses) {
        expect(b.requiredPieces, `${s.id} threshold`).toBeGreaterThanOrEqual(2);
        expect(b.requiredPieces, `${s.id} threshold exceeds piece count`).toBeLessThanOrEqual(
          s.pieces.length,
        );
        expect(buffStats.has(b.affix.stat), `${s.id} bad bonus stat "${b.affix.stat}"`).toBe(true);
        expect(b.affix.value, `${s.id} ${b.affix.stat} value`).toBeGreaterThan(0);
      }
    }
  });
});

describe('boss-script integrity', () => {
  it('every scripted boss is a real mob template with well-formed phases', () => {
    for (const [bossId, script] of Object.entries(c.bossScripts())) {
      expect(
        c.mobTemplate(bossId),
        `boss script "${bossId}" is not a real mob template`,
      ).toBeDefined();
      expect(script.phases.length, `${bossId} phases`).toBeGreaterThan(0);
      for (const phase of script.phases) {
        expect(phase.hpBelow, `${bossId} hpBelow`).toBeGreaterThan(0);
        expect(phase.hpBelow, `${bossId} hpBelow`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('every script step references only real abilities + summon templates', () => {
    for (const [bossId, script] of Object.entries(c.bossScripts())) {
      for (const phase of script.phases) {
        for (const step of phase.loop) {
          if (step.kind === 'cast') {
            // A cast step naming a deleted/typo'd ability would silently do nothing.
            expect(
              c.ability(step.ability),
              `${bossId} casts unknown ability "${step.ability}"`,
            ).toBeDefined();
          } else if (step.kind === 'summon') {
            expect(
              c.mobTemplate(step.templateId),
              `${bossId} summons unknown template "${step.templateId}"`,
            ).toBeDefined();
            expect(step.count, `${bossId} summon count`).toBeGreaterThan(0);
            expect(step.radius, `${bossId} summon radius`).toBeGreaterThan(0);
          } else if (step.kind === 'wait' || step.kind === 'brawl') {
            expect(step.ms, `${bossId} ${step.kind} ms`).toBeGreaterThan(0);
          } else if (step.kind === 'moveTo') {
            expect(step.x, `${bossId} moveTo x`).toBeGreaterThanOrEqual(0);
            expect(step.x, `${bossId} moveTo x`).toBeLessThanOrEqual(1);
            expect(step.y, `${bossId} moveTo y`).toBeGreaterThanOrEqual(0);
            expect(step.y, `${bossId} moveTo y`).toBeLessThanOrEqual(1);
          } else if (step.kind === 'shout') {
            expect(step.text, `${bossId} shout text`).toBeTruthy();
          }
        }
      }
    }
  });
});

describe('item-proc integrity', () => {
  it('every proc on a real item has sane numbers + a status ability that does something', () => {
    for (const item of c.items()) {
      for (const p of c.itemProcs(item.id)) {
        expect(p.chance, `${item.id} proc chance`).toBeGreaterThanOrEqual(0);
        expect(p.chance, `${item.id} proc chance`).toBeLessThanOrEqual(1);
        expect(p.icdMs, `${item.id} proc icd`).toBeGreaterThanOrEqual(0);
        if (p.effect.kind === 'damage') {
          expect(p.effect.amount, `${item.id} proc damage amount`).toBeGreaterThan(0);
        } else {
          // A status proc whose ability has no on-hit effect would be a silent no-op.
          expect(
            c.abilityStatusEffects(p.effect.ability).length,
            `${item.id} status proc ability "${p.effect.ability}" applies no status`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('npc integrity', () => {
  it("every NPC has a name + kind and stands inside its area's bounds", () => {
    for (const a of c.areas()) {
      for (const npc of c.npcs(a.id)) {
        expect(npc.name, `${a.id} npc name`).toBeTruthy();
        expect(npc.kind, `${a.id} ${npc.name} kind`).toBeTruthy();
        expect(npc.x, `${a.id} ${npc.name} x`).toBeGreaterThanOrEqual(0);
        expect(npc.x, `${a.id} ${npc.name} x`).toBeLessThanOrEqual(a.width);
        expect(npc.y, `${a.id} ${npc.name} y`).toBeGreaterThanOrEqual(0);
        expect(npc.y, `${a.id} ${npc.name} y`).toBeLessThanOrEqual(a.height);
      }
    }
  });
});

describe('quest integrity', () => {
  it('every quest is well-formed and references only real mobs/items', () => {
    for (const q of c.quests()) {
      expect(q.id, 'quest id').toBeTruthy();
      expect(q.name, `${q.id} name`).toBeTruthy();
      expect(q.description, `${q.id} description`).toBeTruthy();
      expect(q.rewardGold, `${q.id} rewardGold`).toBeGreaterThanOrEqual(0);
      expect(q.rewardXp, `${q.id} rewardXp`).toBeGreaterThanOrEqual(0);

      // A kill quest must name a REAL mob template and ask for a positive count.
      if (q.targetMob !== null) {
        expect(c.mobTemplate(q.targetMob), `${q.id} target mob ${q.targetMob}`).toBeDefined();
        expect(q.targetCount, `${q.id} targetCount`).toBeGreaterThan(0);
      }
      // A collect quest must name a REAL item to turn in, in a positive amount.
      if (q.turnInItem !== null) {
        expect(c.item(q.turnInItem), `${q.id} turn-in item ${q.turnInItem}`).toBeDefined();
        expect(q.turnInCount, `${q.id} turnInCount`).toBeGreaterThan(0);
      }
      // A reward item (e.g. a spellbook) must be a real item.
      if (q.rewardItem !== null) {
        expect(c.item(q.rewardItem), `${q.id} reward item ${q.rewardItem}`).toBeDefined();
      }
    }
  });
});

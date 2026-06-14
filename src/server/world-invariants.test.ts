import { describe, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { getContent, initGameDb } from './content.js';
import { npcPos } from './test-support.js';
import { mulberry32 } from '../shared/math.js';
import { isAbilityId, type AbilityId } from '../shared/combat.js';
import type { EntityState } from '../shared/protocol.js';

initGameDb(':memory:');

/**
 * Deterministic invariant soak over the pure World simulation.
 *
 * Every roll — the driver's action choices AND the World's internal RNG — flows from this one
 * constant, so a failure is exactly reproducible: the failure message carries the seed and tick;
 * paste the seed back into SEED (if you changed it) and the run replays bit-for-bit.
 */
const SEED = 0x20260612;

const DT = 0.05; // fixed server timestep, seconds

// Player ids are pinned high: the World's local id allocator (used when, as here, the host does
// not inject one) numbers mobs/NPCs/chests/projectiles from 1 upward, and a low explicit player
// id would collide with it. The real host injects a single shared allocator instead.
const PID = 9_000_000;
const INVARIANT_EVERY = 25; // assert the full invariant set every N ticks

// Mirrors of non-exported World tuning, used only as assertion bounds.
const POTION_CAP = 8;
const BAG_SANITY_CAP = 200; // far above MAX_BAG_GEAR (30) / STASH_CAP (60): catches runaway growth
// Ground drops scatter ±15px from the kill position, so an item from a mob hugging the border can
// legitimately rest slightly outside [0,width]×[0,height]. Everything else must be strictly inside.
const ITEM_SCATTER_SLACK = 16;
// World.spawnMobAt now clamps its ±30px scatter to bounds (a bug this soak originally caught:
// border-hugging spawns were born out of bounds). Mobs must be strictly inside, like everyone.
const MOB_SPAWN_SLACK = 0;

/** Like test-support's areaWorld, but with a pinned instance seed (areaWorld rolls a random one). */
function seededAreaWorld(areaId: string, seed: number, tier = 0): World {
  const area = getContent().area(areaId);
  if (!area) throw new Error(`unknown area ${areaId}`);
  return new World(area.width, area.height, area.spawn, undefined, areaId, undefined, tier, seed);
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  if (arr.length === 0) throw new Error('pick from empty array');
  return arr[Math.floor(rng() * arr.length)]!;
}

/** A well-formed save at a given level (gold/contract/god vary per soak roster). */
function makeSave(
  name: string,
  level: number,
  gold: number,
  extra: Partial<PlayerSave> = {},
): PlayerSave {
  return {
    name,
    hue: 0,
    hp: 100,
    mana: 100,
    level,
    xp: 0, // importPlayer raises this to the level's XP floor — still non-decreasing after
    gold,
    loot: [],
    gear: [],
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
    ...extra,
  };
}

/** Walk every numeric field of a snapshot entity; any NaN/Infinity is a violation. */
function assertEntityFinite(e: EntityState, ctx: string): void {
  for (const [key, value] of Object.entries(e)) {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error(`${ctx} entity ${e.id} (${e.kind} "${e.name}") field "${key}" = ${value}`);
    }
  }
}

/**
 * The full invariant set, asserted repeatedly during a soak. Throws with a seeded, tick-stamped
 * message so any failure is a one-line repro.
 */
function assertInvariants(
  w: World,
  bounds: { width: number; height: number },
  lastXp: Map<number, number>,
  ctx: string,
): void {
  const snap = w.snapshot();

  // 1+2: finite fields, sane positions/hp, unique ids.
  const seen = new Set<number>();
  for (const e of snap) {
    assertEntityFinite(e, ctx);
    if (seen.has(e.id)) throw new Error(`${ctx} duplicate entity id ${e.id} in snapshot`);
    seen.add(e.id);
    // Projectiles legitimately overfly the border and die by TTL (tickProjectiles never clamps
    // them) — they are exempt from the bounds check but not from the finiteness check above.
    if (e.kind !== 'projectile') {
      const slack = e.kind === 'item' ? ITEM_SCATTER_SLACK : e.kind === 'mob' ? MOB_SPAWN_SLACK : 0;
      const inBounds =
        e.x >= -slack &&
        e.x <= bounds.width + slack &&
        e.y >= -slack &&
        e.y <= bounds.height + slack;
      if (!inBounds) {
        throw new Error(`${ctx} entity ${e.id} (${e.kind}) out of bounds at (${e.x}, ${e.y})`);
      }
    }
    if (e.maxHp > 0 && e.hp > e.maxHp) {
      throw new Error(`${ctx} entity ${e.id} (${e.kind}) hp ${e.hp} > maxHp ${e.maxHp}`);
    }
  }

  // 4: the whole snapshot survives a JSON wire round-trip.
  const parsed = JSON.parse(JSON.stringify(snap)) as unknown[];
  if (parsed.length !== snap.length) {
    throw new Error(`${ctx} snapshot JSON round-trip changed length`);
  }

  // 3: per-player stats stay sane (including players currently dead, who leave the snapshot).
  for (const id of w.playerIds()) {
    const s = w.playerStats(id);
    if (!s) throw new Error(`${ctx} playerStats(${id}) missing for a live player id`);
    const who = `${ctx} player ${id}`;
    if (!Number.isFinite(s.gold) || s.gold < 0) throw new Error(`${who} gold = ${s.gold}`);
    if (!Number.isFinite(s.mana) || s.mana < 0 || s.mana > s.maxMana) {
      throw new Error(`${who} mana = ${s.mana} (max ${s.maxMana})`);
    }
    if (!Number.isFinite(s.hp) || s.hp < 0 || s.hp > s.maxHp) {
      throw new Error(`${who} hp = ${s.hp} (max ${s.maxHp})`);
    }
    if (!Number.isInteger(s.level) || s.level < 1) throw new Error(`${who} level = ${s.level}`);
    if (!Number.isFinite(s.xp) || s.xp < 0) throw new Error(`${who} xp = ${s.xp}`);
    const floor = lastXp.get(id) ?? 0;
    if (s.xp < floor) throw new Error(`${who} xp decreased: ${s.xp} < ${floor}`);
    lastXp.set(id, s.xp);
    for (const kind of ['health', 'mana'] as const) {
      const n = s.potions[kind];
      if (!Number.isInteger(n) || n < 0 || n > POTION_CAP) {
        throw new Error(`${who} ${kind} potions = ${n} (cap ${POTION_CAP})`);
      }
    }
    if (s.gear.length > BAG_SANITY_CAP) throw new Error(`${who} bag grew to ${s.gear.length}`);
    const stash = w.exportPlayer(id)?.stash ?? [];
    if (stash.length > BAG_SANITY_CAP) throw new Error(`${who} stash grew to ${stash.length}`);
  }
}

/**
 * Export each surviving player, JSON round-trip the save (it crosses persistence/the host), and
 * re-import into a FRESH world of the same area — level and gold must survive the trip.
 */
function assertSavesRoundTrip(w: World, areaId: string, playerIds: number[], ctx: string): void {
  const fresh = seededAreaWorld(areaId === 'rift' ? 'town' : areaId, SEED ^ 0xdead);
  for (const id of playerIds) {
    const save = w.exportPlayer(id);
    if (!save) throw new Error(`${ctx} exportPlayer(${id}) returned nothing for a live player`);
    const wired = JSON.parse(JSON.stringify(save)) as PlayerSave;
    fresh.importPlayer(id, wired, 100, 100);
    const stats = fresh.playerStats(id);
    if (!stats) throw new Error(`${ctx} re-imported player ${id} has no stats`);
    if (stats.level !== save.level) {
      throw new Error(`${ctx} player ${id} level ${save.level} re-imported as ${stats.level}`);
    }
    if (stats.gold !== save.gold) {
      throw new Error(`${ctx} player ${id} gold ${save.gold} re-imported as ${stats.gold}`);
    }
  }
}

/** A service NPC's spot, for teleport-and-use actions during the town soak. */
interface NpcSpot {
  kind: 'gambler' | 'recruiter' | 'banker' | 'riftkeeper' | 'healer' | 'vendor' | 'artificer';
  x: number;
  y: number;
}

/**
 * One player's randomized action for this tick: a mix of legitimate play (move, cast a KNOWN
 * spell, quaff, interact, hop around, shop) and hostile-but-typed garbage (spoofed uids, bogus
 * slots/types/ids, unlearned casts, absurd tiers) that the World must shrug off.
 */
function actOnce(w: World, id: number, rng: () => number, tick: number, spots: NpcSpot[]): void {
  const roll = rng();
  if (roll < 0.3) {
    // Wander: random input direction (sometimes contradictory, sometimes idle).
    w.setInput(
      id,
      { up: rng() < 0.4, down: rng() < 0.4, left: rng() < 0.4, right: rng() < 0.4 },
      tick,
    );
  } else if (roll < 0.45) {
    // Cast a random KNOWN ability in a random direction (including the degenerate 0,0 aim).
    const known = Object.keys(w.playerStats(id)?.known ?? {}).filter(isAbilityId);
    if (known.length > 0) {
      const aim = rng();
      const dx = aim < 0.1 ? 0 : (rng() - 0.5) * 2;
      const dy = aim < 0.1 ? 0 : (rng() - 0.5) * 2;
      w.cast(id, pick(rng, known), dx, dy);
    }
  } else if (roll < 0.52) {
    w.usePotion(id, rng() < 0.5 ? 'health' : 'mana');
  } else if (roll < 0.58) {
    w.interact(id); // whatever (if anything) is nearby: vendor, healer, quest-giver...
  } else if (roll < 0.63) {
    // Small walk-teleport hop from the current position (teleport clamps to bounds).
    const pos = w.playerPos(id);
    if (pos) w.teleport(id, pos.x + (rng() - 0.5) * 400, pos.y + (rng() - 0.5) * 400);
  } else if (roll < 0.66 && spots.length > 0) {
    // Visit a service NPC and use its matching verb (gamble / hire / bank / rift / heal / sell).
    const spot = pick(rng, spots);
    w.teleport(id, spot.x + 4, spot.y + 4);
    if (spot.kind === 'gambler') w.gamble(id, pick(rng, ['mainhand', 'chest', 'ring']));
    else if (spot.kind === 'recruiter') w.hire(id, pick(rng, ['guard', 'archer', 'bogus']));
    else if (spot.kind === 'riftkeeper') w.payForRift(id, Math.floor(rng() * 12) - 1);
    else if (spot.kind === 'banker') {
      const gear = w.playerStats(id)?.gear ?? [];
      if (gear.length > 0 && rng() < 0.7) w.depositToStash(id, pick(rng, gear).uid);
      else {
        const stash = w.exportPlayer(id)?.stash ?? [];
        if (stash.length > 0) w.withdrawFromStash(id, pick(rng, stash).uid);
      }
    } else w.interact(id); // healer/vendor/artificer: open + heal via the normal interact path
  } else if (roll < 0.72) {
    // Equipment churn: equip a random bag piece or unequip a random doll slot.
    const gear = w.playerStats(id)?.gear ?? [];
    if (gear.length > 0 && rng() < 0.7) w.equip(id, pick(rng, gear).uid);
    else w.unequip(id, pick(rng, ['head', 'chest', 'mainhand', 'offhand', 'feet']));
  } else if (roll < 0.76) {
    // Spend earned points; learn from any tome that happens to be in the bag.
    w.allocateAttribute(id, pick(rng, ['strength', 'vitality', 'dexterity', 'energy']));
    w.allocateSkill(id, pick(rng, ['power_1', 'vit_1', 'crit_1', 'swift_1']));
    const tomes = Object.keys(w.playerStats(id)?.loot ?? {}).filter((i) => i.startsWith('tome_'));
    if (tomes.length > 0) w.learn(id, pick(rng, tomes));
  } else if (roll < 0.82) {
    // Hostile-but-typed garbage a malicious client could shape: every one must be a clean no-op.
    const attack = Math.floor(rng() * 8);
    if (attack === 0)
      w.cast(id, 'meteor', 1, 0); // probably never learned
    else if (attack === 1)
      w.cast(id, 'poison_spit' as AbilityId, 1e9, -1e9); // a MOB's spell
    else if (attack === 2)
      w.equip(id, 999_999_999); // spoofed uid
    else if (attack === 3)
      w.unequip(id, '__proto__'); // prototype-pollution shaped slot
    else if (attack === 4)
      w.gamble(id, 'gold'); // not a gear slot
    else if (attack === 5)
      w.payForRift(id, 2.5); // fractional tier
    else if (attack === 6) w.allocateAttribute(id, 'constructor');
    else w.learn(id, 'iron_sword'); // not a spellbook
    // Spoofed-id traffic for an entity that is not yours / does not exist.
    w.setInput(999_999, { up: true, down: false, left: false, right: false }, tick);
    w.cast(888_888, 'slash', 1, 0);
  }
  // else: do nothing this tick (idle players are part of real load too)
}

interface SoakConfig {
  label: string;
  areaId: string;
  ticks: number;
  world: World;
  roster: { id: number; save?: PlayerSave }[];
  spots?: NpcSpot[];
  /** Extra per-tick pressure (e.g. spawnMobAt waves). */
  perTick?: (w: World, tick: number, rng: () => number, playerIds: number[]) => void;
}

/** Drive one world hard for `ticks` fixed steps, asserting the invariant set as it goes. */
function runSoak(cfg: SoakConfig): void {
  const rng = mulberry32(SEED ^ cfg.ticks);
  const w = cfg.world;
  const area = getContent().area(cfg.areaId) ?? { width: 1500, height: 1300 };
  const bounds = { width: area.width, height: area.height };
  const lastXp = new Map<number, number>();
  const ids: number[] = [];

  for (const member of cfg.roster) {
    if (member.save) w.importPlayer(member.id, member.save, 120 + member.id * 40, 120);
    else w.spawn(`Fresh${member.id}`, { id: member.id });
    ids.push(member.id);
  }

  for (let tick = 1; tick <= cfg.ticks; tick++) {
    const ctx = `[${cfg.label} seed=${SEED} tick=${tick}]`;

    for (const id of ids) actOnce(w, id, rng, tick, cfg.spots ?? []);

    // Rare disconnect + immediate re-import (an area crossing / reconnect under load).
    if (rng() < 0.002) {
      const id = pick(rng, ids);
      const save = w.exportPlayer(id);
      if (!save) throw new Error(`${ctx} exportPlayer(${id}) failed before disconnect`);
      w.remove(id);
      w.importPlayer(id, save, bounds.width / 2, bounds.height / 2);
    }

    cfg.perTick?.(w, tick, rng, ids);

    // 5: tick() must never throw — fail with the seed + tick for an exact repro.
    try {
      w.tick(DT);
    } catch (err) {
      throw new Error(`${ctx} tick() threw: ${err instanceof Error ? err.stack : String(err)}`, {
        cause: err,
      });
    }

    // 6: every transient effect carries finite coordinates.
    for (const fx of w.drainEvents()) {
      if (!Number.isFinite(fx.x) || !Number.isFinite(fx.y)) {
        throw new Error(`${ctx} fx event ${fx.kind} at non-finite (${fx.x}, ${fx.y})`);
      }
    }
    // Drain the host-facing queues like the real host does (also keeps them bounded).
    w.drainNotices();
    w.drainShopOffers();
    w.drainGambleOffers();
    w.drainHireOffers();
    w.drainRiftOffers();
    w.drainArtificerOffers();
    w.drainStashOffers();
    w.drainDenEntries();

    if (tick % INVARIANT_EVERY === 0) assertInvariants(w, bounds, lastXp, ctx);
  }

  const endCtx = `[${cfg.label} seed=${SEED} end]`;
  assertInvariants(w, bounds, lastXp, endCtx);
  assertSavesRoundTrip(w, cfg.areaId, ids, endCtx);
}

describe('world invariant soak (deterministic, seeded)', () => {
  it('town: 6 mixed players survive 4000 ticks of chaotic valid+hostile traffic', () => {
    const w = seededAreaWorld('town', SEED);
    w.populateNpcs('town');
    w.populateMobs('town');
    const spots: NpcSpot[] = (
      ['gambler', 'recruiter', 'banker', 'riftkeeper', 'healer', 'vendor', 'artificer'] as const
    ).map((kind) => ({ kind, ...npcPos('town', kind) }));
    runSoak({
      label: 'town',
      areaId: 'town',
      ticks: 4000,
      world: w,
      spots,
      roster: [
        { id: PID + 1 }, // fresh level-1 spawn
        { id: PID + 2 }, // fresh level-1 spawn
        { id: PID + 3, save: makeSave('Midas', 5, 5_000) },
        { id: PID + 4, save: makeSave('Marshal', 12, 2_000, { hireling: { type: 'guard' } }) },
        // A legacy save with no `known` grandfathers to EVERY spell — broad cast coverage. God
        // mode keeps it alive and in the action the whole run.
        { id: PID + 5, save: makeSave('Ancient', 30, 50_000, { god: true }) },
        { id: PID + 6, save: makeSave('Riftbound', 9, 1_500, { loot: [['tome_fireball', 3]] }) },
      ],
    });
  });

  it('forgotten_catacombs: dungeon roll + monster waves pressed onto 4 players', () => {
    const w = seededAreaWorld('forgotten_catacombs', SEED ^ 1);
    w.populateMobs('forgotten_catacombs');
    runSoak({
      label: 'catacombs',
      areaId: 'forgotten_catacombs',
      ticks: 1600,
      world: w,
      roster: [
        { id: PID + 11, save: makeSave('Crusher', 8, 300) },
        { id: PID + 12, save: makeSave('Witch', 14, 800) },
        { id: PID + 13, save: makeSave('Warden', 20, 1_200, { hireling: { type: 'guard' } }) },
        { id: PID + 14, save: makeSave('Eternal', 25, 9_000, { god: true }) },
      ],
      perTick: (world, tick, rng, ids) => {
        // Invasion-style pressure: a fresh wave of monsters dropped onto someone every ~50 ticks.
        if (tick % 50 === 0) {
          const target = pick(rng, ids);
          for (let i = 0; i < 3; i++) {
            world.spawnMobAt(target, pick(rng, ['wolf', 'rot_ghoul', 'cultist']));
          }
        }
      },
    });
  });

  it('rift tier 5: dense procedural pack stays sane for a short violent soak', () => {
    const area = getContent().area('rift');
    if (!area) throw new Error('rift area missing from content');
    const w = new World(
      area.width,
      area.height,
      area.spawn,
      undefined,
      'rift',
      undefined,
      5,
      SEED ^ 2,
    );
    w.populateMobs('rift');
    runSoak({
      label: 'rift-t5',
      areaId: 'rift',
      ticks: 700,
      world: w,
      roster: [
        { id: PID + 21, save: makeSave('Blade', 25, 2_000) },
        { id: PID + 22, save: makeSave('Storm', 32, 4_000) },
        { id: PID + 23, save: makeSave('Aegis', 40, 8_000, { hireling: { type: 'guard' } }) },
      ],
    });
  });
});

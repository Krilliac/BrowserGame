/**
 * Bot brain — pure decision logic for AI-controlled PLAYER entities the server drives.
 *
 * A `/bot spawn N` command joins headless players (no socket) into the live World. Each tick
 * the host builds a {@link BotView} from the world snapshot + that player's stats, calls
 * {@link stepBot}, and applies the {@link BotDecision} through the normal player API
 * (`world.setInput`, `world.cast`, plus a potion-quaff path). This file imports nothing from
 * the World: it is framework-free and unit-testable with fake views, mirroring the spirit of
 * `tools/bots/behaviors.ts` but self-contained for the server.
 *
 * Determinism: every decision is a pure function of (view, state, nowMs) and the seed baked
 * into the state at spawn. No Math.random, no Date.now — variation comes from a seeded RNG
 * carried in the state so two bots with the same seed behave identically.
 */

/** A simplified ability view the host fills from the bot's known spells + content stats. */
export interface BotAbilityView {
  id: string;
  kind: 'melee' | 'projectile' | 'heal';
  damage: number;
  range: number;
  manaCost: number;
  cooldownReady: boolean;
}

/** Everything the brain reads each tick — built from a snapshot + the bot's `you` stats. */
export interface BotView {
  self: {
    x: number;
    y: number;
    hp: number;
    maxHp: number;
    mana: number;
    maxMana: number;
    level: number;
    dead: boolean;
  };
  /** Known abilities with content stats, so the brain picks the best one in range. */
  abilities: BotAbilityView[];
  /** Nearby mobs to fight. */
  mobs: { id: number; x: number; y: number; hp: number }[];
  /** Nearby ground items to walk over and loot. */
  items: { id: number; x: number; y: number }[];
  /** Area bounds, so the bot steers off the edges. */
  width: number;
  height: number;
  /** Potions held in the belt (drives the panic quaff). */
  potions: { health: number; mana: number };
}

/** What the bot wants to do this tick. `input` is always present (idle = all false). */
export interface BotDecision {
  input: { up: boolean; down: boolean; left: boolean; right: boolean };
  /** Set when the bot wants to cast this tick (aimed via dx/dy from the bot toward the target). */
  cast?: { ability: string; dx: number; dy: number };
  /** Set when the bot wants to quaff a potion this tick. */
  usePotion?: 'health' | 'mana';
}

/** Persisted per-bot scratch state. Mutated by {@link stepBot}; never read by the host. */
export interface BotState {
  mode: 'fight' | 'wander' | 'flee' | 'recover';
  /** Current wander heading in radians; re-rolled when the stretch expires. */
  wanderAngle: number;
  /** Wall-clock ms after which the current wander heading is re-rolled. */
  wanderUntil: number;
  /** Seeded RNG cursor (mutable LCG state) so variation is deterministic per seed. */
  rngState: number;
}

const IDLE = { up: false, down: false, left: false, right: false } as const;

// --- Behavior tuning ------------------------------------------------------------------
const HEAL_POTION_HP_FRAC = 0.3; // quaff a health potion below 30% hp
const FLEE_HP_FRAC = 0.25; // with no potions, run below 25% hp
const RECOVER_HP_FRAC = 0.6; // ...until hp climbs back over 60%
const ENGAGE_RANGE = 500; // start a fight only for mobs within this radius
const LOOT_RANGE = 250; // detour for items within this radius
const STOP_RANGE_FRAC = 0.85; // hold position once inside 85% of the chosen ability's range
const EDGE_MARGIN = 80; // steer back toward center within this distance of a bound
const WANDER_MIN_MS = 1000; // a wander heading lasts 1.0..2.5s
const WANDER_SPAN_MS = 1500;
const WALK_DEADZONE = 6; // per-axis deadzone so the bot doesn't jitter on target

/** Make a fresh bot state from a spawn seed. Deterministic: same seed → same future. */
export function newBotState(seed: number): BotState {
  // Normalize the seed into the LCG's range and take one initial heading from it.
  const rngState = (Math.floor(seed) >>> 0) % 2147483647 || 1;
  const state: BotState = { mode: 'wander', wanderAngle: 0, wanderUntil: 0, rngState };
  state.wanderAngle = nextFloat(state) * Math.PI * 2;
  return state;
}

/**
 * Decide what the bot does this tick. Pure given (view, state, nowMs) plus the seed in `state`.
 * Mutates only `state` (mode, wander heading, RNG cursor) — never `view`.
 */
export function stepBot(view: BotView, state: BotState, nowMs: number): BotDecision {
  if (view.self.dead) {
    state.mode = 'wander';
    return { input: { ...IDLE } };
  }

  const hpFrac = view.self.maxHp > 0 ? view.self.hp / view.self.maxHp : 1;
  const nearestMob = nearest(view.self, view.mobs);

  // --- Survival comes first ---------------------------------------------------------
  // A health potion is the cheapest save: quaff it the moment we dip under the threshold.
  if (hpFrac < HEAL_POTION_HP_FRAC && view.potions.health > 0) {
    state.mode = 'recover';
    return { input: { ...IDLE }, usePotion: 'health' };
  }

  // No potions and critically low → run directly away from the nearest threat until safe.
  const fleeing = state.mode === 'flee' || state.mode === 'recover';
  const stillRecovering = fleeing && hpFrac < RECOVER_HP_FRAC;
  if ((hpFrac < FLEE_HP_FRAC || stillRecovering) && view.potions.health <= 0) {
    if (hpFrac >= RECOVER_HP_FRAC) {
      state.mode = 'wander'; // recovered — fall through to normal behavior below
    } else {
      state.mode = 'flee';
      return { input: fleeFrom(view.self, nearestMob) };
    }
  }

  // --- Fight ------------------------------------------------------------------------
  if (nearestMob) {
    const dist = Math.hypot(nearestMob.x - view.self.x, nearestMob.y - view.self.y);
    if (dist <= ENGAGE_RANGE) {
      state.mode = 'fight';
      return fight(view, nearestMob, dist);
    }
  }

  // --- Wander / loot ----------------------------------------------------------------
  state.mode = 'wander';
  return wander(view, state, nowMs);
}

/** Engage the target: pick the best in-range affordable ability, kite to its range, cast. */
function fight(view: BotView, mob: { x: number; y: number }, dist: number): BotDecision {
  const dx = mob.x - view.self.x;
  const dy = mob.y - view.self.y;
  const choice = pickAbility(view, dist);

  // Nothing castable this tick (all on cooldown / unaffordable / out of range): close in.
  if (!choice) {
    return { input: walkToward(view.self, mob.x, mob.y) };
  }

  // Too far for the chosen ability → advance. Inside its comfortable range → hold and fire,
  // so a ranged bot naturally kites instead of running into melee.
  const stopRange = Math.max(1, choice.range) * STOP_RANGE_FRAC;
  if (choice.kind !== 'melee' && choice.range > 0 && dist > stopRange) {
    return { input: walkToward(view.self, mob.x, mob.y) };
  }
  if (choice.kind === 'melee' && dist > choice.range) {
    return { input: walkToward(view.self, mob.x, mob.y) };
  }
  return { input: { ...IDLE }, cast: { ability: choice.id, dx, dy } };
}

/**
 * The highest-damage ability that (a) is off cooldown, (b) mana affords, and (c) can reach the
 * target — melee within its reach, projectile/heal otherwise. Heals are skipped as attacks.
 * Returns undefined when nothing qualifies (caller then just closes distance).
 */
function pickAbility(view: BotView, dist: number): BotAbilityView | undefined {
  let best: BotAbilityView | undefined;
  for (const a of view.abilities) {
    if (a.kind === 'heal') continue;
    if (!a.cooldownReady) continue;
    if (a.manaCost > view.self.mana) continue;
    // Melee only connects within reach; ranged needs the target inside its travel range.
    if (a.kind === 'melee' && dist > a.range) continue;
    if (a.kind === 'projectile' && a.range > 0 && dist > a.range) continue;
    if (!best || a.damage > best.damage) best = a;
  }
  return best;
}

/** Wander: loot a nearby item if one is close, else hold a seeded heading and dodge the walls. */
function wander(view: BotView, state: BotState, nowMs: number): BotDecision {
  const item = nearest(view.self, view.items);
  if (item) {
    const dist = Math.hypot(item.x - view.self.x, item.y - view.self.y);
    if (dist <= LOOT_RANGE) return { input: walkToward(view.self, item.x, item.y) };
  }

  if (nowMs >= state.wanderUntil) {
    state.wanderAngle = nextFloat(state) * Math.PI * 2;
    state.wanderUntil = nowMs + WANDER_MIN_MS + nextFloat(state) * WANDER_SPAN_MS;
  }

  let dirX = Math.cos(state.wanderAngle);
  let dirY = Math.sin(state.wanderAngle);

  // Steer back toward the interior when hugging a bound (additive nudge toward center).
  if (view.self.x < EDGE_MARGIN) dirX += 1;
  else if (view.self.x > view.width - EDGE_MARGIN) dirX -= 1;
  if (view.self.y < EDGE_MARGIN) dirY += 1;
  else if (view.self.y > view.height - EDGE_MARGIN) dirY -= 1;

  return { input: dirToInput(dirX, dirY) };
}

// --- Geometry / input helpers ---------------------------------------------------------

/** Nearest live entity to `from`, or undefined if the list is empty. */
function nearest<T extends { x: number; y: number; hp?: number }>(
  from: { x: number; y: number },
  list: T[],
): T | undefined {
  let best: T | undefined;
  let bestDist = Infinity;
  for (const e of list) {
    if (e.hp !== undefined && e.hp <= 0) continue;
    const d = Math.hypot(e.x - from.x, e.y - from.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/** 8-dir intent toward a target with a small per-axis deadzone (no jitter once on top of it). */
function walkToward(
  from: { x: number; y: number },
  tx: number,
  ty: number,
): { up: boolean; down: boolean; left: boolean; right: boolean } {
  return {
    up: ty < from.y - WALK_DEADZONE,
    down: ty > from.y + WALK_DEADZONE,
    left: tx < from.x - WALK_DEADZONE,
    right: tx > from.x + WALK_DEADZONE,
  };
}

/** Intent pointing directly away from a threat (run for it). Idle if there is no threat. */
function fleeFrom(
  self: { x: number; y: number },
  threat: { x: number; y: number } | undefined,
): { up: boolean; down: boolean; left: boolean; right: boolean } {
  if (!threat) return { ...IDLE };
  // Walk toward the point mirrored across self — i.e. directly opposite the threat.
  return walkToward(self, self.x - (threat.x - self.x), self.y - (threat.y - self.y));
}

/** Turn a continuous direction vector into 8-dir booleans (deadzone kills near-zero axes). */
function dirToInput(
  dx: number,
  dy: number,
): { up: boolean; down: boolean; left: boolean; right: boolean } {
  const dead = 0.2;
  return {
    up: dy < -dead,
    down: dy > dead,
    left: dx < -dead,
    right: dx > dead,
  };
}

// --- Seeded RNG (Park-Miller minimal-standard LCG; mutates state.rngState) -------------

/** Advance the LCG and return a float in [0, 1). Deterministic per seed. */
function nextFloat(state: BotState): number {
  // 16807 * state mod (2^31 - 1) — stays within 53-bit float precision.
  state.rngState = (state.rngState * 16807) % 2147483647;
  return (state.rngState - 1) / 2147483646;
}

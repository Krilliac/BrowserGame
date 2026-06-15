/**
 * Scripted boss phases: a miniature action queue (the Excalibur "actions" pattern, cut down
 * to its essentials) that gives the two apex bosses real HP-driven phases. Each phase owns a
 * loop of steps — move here, shout this, cast that, summon adds, then brawl — and the World
 * drives it once per tick via stepBossScript().
 *
 * The module is pure and deterministic: it never touches the World. It reads the clock, the
 * boss's hp fraction and position, mutates only the per-boss BossScriptState it is handed,
 * and returns *what the boss should do this tick*. Returning null hands control back to the
 * normal stepMob AI — that is the brawl window, and it is where most of a fight happens.
 */

import type { AbilityId } from '../shared/combat.js';

export type BossStep =
  /** Walk to a point given in arena-relative coords (0..1 of area width/height). */
  | { kind: 'moveTo'; x: number; y: number; speedMult?: number }
  /** Stand still (facing unchanged) for `ms` — a deliberate, menacing pause. */
  | { kind: 'wait'; ms: number }
  /** Fight with the normal stepMob AI for `ms` — the script yields (returns null) throughout. */
  | { kind: 'brawl'; ms: number }
  /** Fire an existing ability once via castMobSpell (novas, bolts — along current facing). */
  | { kind: 'cast'; ability: AbilityId }
  /** Spawn `count` adds of a MOB_TEMPLATES id within `radius` px of the boss, once. */
  | { kind: 'summon'; templateId: string; count: number; radius: number }
  /** Broadcast one notice line to the instance, once (author the speaker prefix into it). */
  | { kind: 'shout'; text: string };

export type SummonStep = Extract<BossStep, { kind: 'summon' }>;

/** A scripted boss enters soft-enrage after this long in a single fight (ms). */
export const ENRAGE_AFTER_MS = 90_000;
/** Past soft-enrage, the boss's outgoing damage climbs this much per second… */
const ENRAGE_RAMP_PER_SEC = 0.05;
/** …up to this hard multiplier, so a dragged-out fight becomes a real threat (no infinite kiting). */
const ENRAGE_MAX = 3;

/**
 * A scripted boss's outgoing-damage multiplier given how long the current fight has lasted. 1.0 until
 * {@link ENRAGE_AFTER_MS}, then ramps linearly to {@link ENRAGE_MAX}. Pure — the World tracks the
 * per-boss fight clock and applies this in mobOutgoing. WHY: apex bosses with big HP pools could
 * otherwise be safely out-ranged forever; soft-enrage forces a kill window.
 */
export function bossEnrageMultiplier(elapsedMs: number): number {
  const pastSec = (elapsedMs - ENRAGE_AFTER_MS) / 1000;
  if (pastSec <= 0) return 1;
  return Math.min(ENRAGE_MAX, 1 + pastSec * ENRAGE_RAMP_PER_SEC);
}

export interface BossPhase {
  /** The phase is active while hp/maxHp < hpBelow (strict — at exactly full HP, nothing is). */
  hpBelow: number;
  loop: BossStep[];
}

/**
 * Phases are authored top-down (opener first, desperation last) and checked in order: among
 * all phases whose `hpBelow > hpFrac`, the LAST one wins. So a boss at 0.15 hp runs its final
 * phase even though the earlier thresholds also match.
 */
export interface BossScript {
  phases: BossPhase[];
}

/** Per-boss script cursor. The World stores one of these on each scripted boss mob. */
export interface BossScriptState {
  /** Active phase index (-1 = none yet — boss is unblooded and runs plain AI). */
  phase: number;
  /** Current step index within the phase loop. */
  step: number;
  /** Sim time (ms) the current step began at (set when the step initializes). */
  stepStartedAt: number;
  /** True once the current step has run its entry logic (one-shot steps fire on entry). */
  stepInitialized: boolean;
}

export function newBossScriptState(): BossScriptState {
  return { phase: -1, step: 0, stepStartedAt: 0, stepInitialized: false };
}

/** What the boss should do this tick. At most one field is set per call. */
export interface BossAction {
  /**
   * Scripted movement: (vx, vy) is a UNIT direction scaled by the step's speedMult — the
   * World multiplies by the boss template's speed (and dt) to get actual displacement.
   */
  move?: { vx: number; vy: number; facing: number };
  /** Fire this ability via castMobSpell along the boss's current facing. */
  cast?: AbilityId;
  /** Spawn these adds around the boss. */
  summon?: SummonStep;
  /** Broadcast this line to everyone in the instance. */
  shout?: string;
}

/** Close enough: a moveTo completes when the boss is within this many px of its target. */
const MOVE_ARRIVE_DIST = 12;

/**
 * Advance the script one tick. Returns the boss's scripted action, an empty object for a
 * scripted idle ('wait' — World holds the boss still), or null to fall through to the normal
 * stepMob AI ('brawl' windows, an unblooded boss, or an empty phase loop).
 *
 * Pure: mutates only `state`. Same inputs + same state always yield the same result.
 * Completed steps advance immediately within the call (a finished wait doesn't burn a tick),
 * but every action returns at once — the boss does at most one thing per tick.
 */
export function stepBossScript(
  script: BossScript,
  state: BossScriptState,
  now: number,
  hpFrac: number,
  x: number,
  y: number,
  arenaW: number,
  arenaH: number,
): BossAction | null {
  // Phase selection: the last (lowest-HP) matching phase wins.
  let phaseIdx = -1;
  for (let i = 0; i < script.phases.length; i++) {
    if (hpFrac < script.phases[i]!.hpBelow) phaseIdx = i;
  }
  if (phaseIdx < 0) return null;

  // Crossing into a new phase interrupts the current step and restarts that phase's loop.
  if (phaseIdx !== state.phase) {
    state.phase = phaseIdx;
    state.step = 0;
    state.stepStartedAt = now;
    state.stepInitialized = false;
  }

  const loop = script.phases[phaseIdx]!.loop;
  if (loop.length === 0) return null;

  // Walk at most one full loop pass this tick (guards a pathological all-zero-duration loop).
  for (let guard = 0; guard <= loop.length; guard++) {
    if (state.step >= loop.length) {
      state.step = 0; // the loop wraps back to the top
      state.stepInitialized = false;
    }
    const step = loop[state.step]!;

    if (!state.stepInitialized) {
      state.stepInitialized = true;
      state.stepStartedAt = now;
      // One-shot steps fire exactly once, on entry, then complete immediately.
      if (step.kind === 'cast') {
        advance(state);
        return { cast: step.ability };
      }
      if (step.kind === 'summon') {
        advance(state);
        return { summon: step };
      }
      if (step.kind === 'shout') {
        advance(state);
        return { shout: step.text };
      }
    }

    switch (step.kind) {
      case 'moveTo': {
        const dx = step.x * arenaW - x;
        const dy = step.y * arenaH - y;
        const dist = Math.hypot(dx, dy);
        if (dist <= MOVE_ARRIVE_DIST) {
          advance(state);
          break; // arrived — fall through to the next step this tick
        }
        const mult = step.speedMult ?? 1;
        return {
          move: { vx: (dx / dist) * mult, vy: (dy / dist) * mult, facing: Math.atan2(dy, dx) },
        };
      }
      case 'wait':
        if (now - state.stepStartedAt >= step.ms) {
          advance(state);
          break;
        }
        return {}; // scripted idle: hold position and facing, do nothing
      case 'brawl':
        if (now - state.stepStartedAt >= step.ms) {
          advance(state);
          break;
        }
        return null; // hand control to the normal stepMob AI for the window
      default:
        advance(state); // one-shot kinds were consumed on entry; never linger here
        break;
    }
  }
  return null; // exhausted the guard (all steps completed instantly) — yield this tick
}

function advance(state: BossScriptState): void {
  state.step += 1;
  state.stepInitialized = false;
}

/**
 * The authored fights, keyed by MOB_TEMPLATES id — the SEED SOURCE for the `mob_script_phases` /
 * `mob_script_steps` content tables and the fallback the live {@link BOSS_SCRIPTS} resets to. Both
 * bosses spend most of each loop brawling (normal AI — Nyxathor's charge, Athraxis's slam); the
 * scripted beats punctuate it. Treat as immutable; author new fights in the DB (or here) — the
 * executor (`stepBossScript`) and the {@link BossStep} vocabulary stay in code (a closed, safe enum;
 * content supplies only data, never executable behavior).
 */
export const DEFAULT_BOSS_SCRIPTS: Record<string, BossScript> = {
  // Nyxathor, the Abyssal Sovereign (L40 charger, the Abyssal Throne).
  nyxathor: {
    phases: [
      {
        hpBelow: 1.0,
        loop: [
          { kind: 'brawl', ms: 6000 },
          {
            kind: 'shout',
            text: 'NYXATHOR: The Abyss counted your breaths long ago. I am here to collect.',
          },
          { kind: 'cast', ability: 'shadow_bolt' },
        ],
      },
      {
        hpBelow: 0.5,
        loop: [
          { kind: 'shout', text: 'NYXATHOR: Enough sport. Come — drown with me in the dark.' },
          { kind: 'moveTo', x: 0.5, y: 0.5 },
          { kind: 'summon', templateId: 'abyss_thrall', count: 2, radius: 140 },
          { kind: 'cast', ability: 'frostnova' },
          { kind: 'brawl', ms: 5000 },
        ],
      },
      {
        hpBelow: 0.2,
        loop: [
          {
            kind: 'shout',
            text: "NYXATHOR: NO. This throne was carved from the world's first night — it will not pass to YOU!",
          },
          { kind: 'summon', templateId: 'thronespawn_ravager', count: 3, radius: 160 },
          { kind: 'cast', ability: 'infernonova' },
          { kind: 'brawl', ms: 4000 },
        ],
      },
    ],
  },

  // Athraxis, the Unmade God (L60 slammer, the Unmade Court — the end of the game).
  athraxis: {
    phases: [
      {
        hpBelow: 1.0,
        loop: [
          { kind: 'brawl', ms: 7000 },
          {
            kind: 'shout',
            text: 'ATHRAXIS: I was unmade before your sun first burned. You are not even a wound.',
          },
          { kind: 'cast', ability: 'shadow_nova' },
          { kind: 'brawl', ms: 5000 },
          { kind: 'cast', ability: 'earthshatter' },
        ],
      },
      {
        hpBelow: 0.7,
        loop: [
          {
            kind: 'shout',
            text: 'ATHRAXIS: You scratch at the husk of a god. Behold what was torn from me.',
          },
          { kind: 'moveTo', x: 0.5, y: 0.5 },
          { kind: 'cast', ability: 'earthshatter' },
          { kind: 'brawl', ms: 6000 },
          { kind: 'cast', ability: 'shadow_nova' },
          { kind: 'brawl', ms: 5000 },
        ],
      },
      {
        hpBelow: 0.4,
        loop: [
          {
            kind: 'shout',
            text: 'ATHRAXIS: Court of the Unmade — attend your god. Bring me their silence.',
          },
          { kind: 'summon', templateId: 'court_oracle', count: 1, radius: 180 },
          { kind: 'summon', templateId: 'court_executioner', count: 1, radius: 180 },
          { kind: 'cast', ability: 'infernonova' },
          { kind: 'brawl', ms: 6000 },
          { kind: 'cast', ability: 'earthshatter' },
          { kind: 'brawl', ms: 4000 },
        ],
      },
      {
        hpBelow: 0.15,
        loop: [
          {
            kind: 'shout',
            text: 'ATHRAXIS: I do not end. I AM the ending — and all things return to nothing with me!',
          },
          { kind: 'cast', ability: 'infernonova' },
          { kind: 'brawl', ms: 3000 },
          { kind: 'cast', ability: 'shadow_nova' },
          { kind: 'brawl', ms: 3000 },
          { kind: 'cast', ability: 'earthshatter' },
          { kind: 'brawl', ms: 3000 },
        ],
      },
    ],
  },
};

/**
 * The LIVE boss scripts the World reads at tick time. Initialized from {@link DEFAULT_BOSS_SCRIPTS};
 * the server overlays the `mob_script_*` DB rows onto it on content load/reload (see content.ts).
 * The object reference is stable (keys are mutated in place) so `world.ts`'s `BOSS_SCRIPTS[id]`
 * lookups always see the current data without re-importing.
 */
export const BOSS_SCRIPTS: Record<string, BossScript> = structuredClone(DEFAULT_BOSS_SCRIPTS);

/**
 * Overlay boss scripts onto the live {@link BOSS_SCRIPTS} (replacing all keys in place). An empty
 * `scripts` RESETS to {@link DEFAULT_BOSS_SCRIPTS}, so `applyBossScriptOverrides({})` restores the
 * code defaults and tests stay clean. Cloned so the live table never aliases the immutable defaults.
 */
export function applyBossScriptOverrides(scripts: Record<string, BossScript>): void {
  for (const k of Object.keys(BOSS_SCRIPTS)) delete BOSS_SCRIPTS[k];
  const src = Object.keys(scripts).length ? scripts : DEFAULT_BOSS_SCRIPTS;
  for (const [k, v] of Object.entries(src)) BOSS_SCRIPTS[k] = structuredClone(v);
}

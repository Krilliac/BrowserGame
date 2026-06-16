# Slice 3 — Ailment / Status Overhaul (maximal CC + ailment suite) — Design

**Date:** 2026-06-15
**Branch:** `loop/autonomous-20260614`
**Status:** Approved (standing autonomous authorization; user chose the maximal CC + ailment suite).
**Builds on:** Slices 1–2. Roadmap: `2026-06-15-spell-behavior-system-design.md`.

## Goal

Turn the 6-status system into a rich element-signature ailment + crowd-control suite: every damage
element imprints a signature ailment, and spells/bosses can stun, freeze, silence, fear, taunt,
knock back, and curse. Server-authoritative; built on the existing pure tick-driven `StatusSet`.

## Key decision — wire format (deviation from roadmap, justified)

The roadmap assumed a binary, near-full bitfield. **The wire is actually JSON** (`protocol.ts:450`
`JSON.stringify`), and JS numbers carry 53 bits. The client only needs status *presence* to render
tints/HUD pips; the server holds magnitudes/durations authoritatively. Therefore we **keep and expand
the `flags` bitfield** (one compact number, the field already exists, minimal change) rather than
introduce a `statuses[]` array (more bytes against the 4096-byte/snapshot cap at 20 Hz). `PROTOCOL_VERSION`
bumps to 2. This is strictly better than the roadmap's plan given the real format.

## Status model (`src/server/status-effects.ts`)

Expand `StatusId`. Grouped by mechanic so the `StatusSet` API stays small:

| Group | Statuses | Mechanic |
|---|---|---|
| DoT | `burn` (existing), `ignite`, `poison`, `bleed` | `tick()` returns summed per-second damage |
| Slow-type | `slow` (existing), `chill`, `maim` | reduce movement (folded into `slowFactor()`) |
| Outgoing-down | `weaken` (existing), `sap` | reduce damage dealt (folded into `weakenFactor()`) |
| Incoming-up | `shock`, `brittle` | raise damage taken (`vulnFactor()`) |
| Control | `stun`, `freeze`, `silence`, `fear`, `taunt` | gate/redirect AI + player |
| Curse | `curse` | combo hex: counts as both `weaken` and `brittle` magnitude |
| Buffs (existing) | `might`, `haste`, `regen` | unchanged |

`knockback` is **not** a `StatusId` — it's a one-shot positional impulse applied at hit time (see
below), because it has no duration.

### `StatusSet` API changes (keep it pure/tick-driven)

- `tick()` → `{ dotDamage, regenHeal }` (was `burnDamage`; now sums `burn+ignite+poison+bleed`).
  Keep a `burnDamage` alias temporarily if needed, but prefer renaming call sites to `dotDamage`.
- `slowFactor()` → `max(SLOW_FLOOR, 1 - (slow+chill+maim magnitudes summed, capped))`.
- `weakenFactor()` → `max(WEAKEN_FLOOR, 1 - (weaken+sap+curse))`.
- `vulnFactor()` (new) → `(1 + shock) * (1 + brittle + curse)` — multiplier on **incoming** damage.
- `rooted()` (new) → `has('stun') || has('freeze')` — cannot move or act.
- `silenced()` (new) → `rooted() || has('silence')` — cannot cast.
- `feared()` / `taunted()` (new) → `has('fear')` / `has('taunt')`.
- **Poison is the one additive-stack status** (poison "stacks"): `apply('poison', …)` sums magnitude
  (capped) instead of max — a small special-case in `apply`. All others keep the max-refresh rule.

### Control data carried outside StatusSet

`taunt` and `fear` need a source. Add to `Mob`: `tauntBy?: number` (player id) and `fearUntil`/source is
implicit (flee from nearest player). On `apply` of taunt, the world sets `mob.tauntBy`. `StatusSet`
stays pure (presence + magnitude only); the world owns the target pointers.

## Gameplay hooks (`world.ts`)

- **DoT:** mob tick (`~2931`) and player tick (`~2665`) use `dotDamage` (already wired for burn).
- **Slow/move:** `mob` `moveMul` (`~2935`) and `playerMoveMul` (`~2586`) already multiply
  `slowFactor()` — now covers chill/maim automatically.
- **Outgoing damage:** `mobOutgoing` (`~2635`) uses `weakenFactor()` — now covers sap/curse.
- **Incoming damage (NEW):** in `damageMob` and `damagePlayer`, multiply incoming by the target's
  `vulnFactor()` (shock/brittle/curse). This is the shock/brittle payoff.
- **Root (stun/freeze):** in `tickMobs`, after `statuses.tick`, `if (mob.statuses.rooted()) continue;`
  (mirrors the existing `telegraphUntil` root). In `tickPlayers`/input + `cast`, gate movement and
  casting on `player.debuffs.rooted()`.
- **Silence:** in `cast` (player) and `castMobSpell`/`executeMobAttack` (mob), `if (silenced()) return;`.
- **Fear:** in the mob chase block, when `feared()`, invert the intent toward fleeing the nearest
  player. Players are not feared this slice (player fear = input takeover is intrusive; defer).
- **Taunt:** when `mob.tauntBy` is set and that player is alive/in-range, force the mob's target to it.
- **Knockback:** a new optional field on `AbilityStatusEffect` rows (`knockback REAL`) OR a dedicated
  `ability_knockback` — simplest: a `knockback` column on `ability_status_effects` is wrong (it's
  per-effect). Use a small map seeded in `ability-effects.ts`: abilities with a knockback push. At hit
  (`damageMob` / projectile hit), if the ability has knockback, displace the mob away from the source
  by `kb` px, clamped by `resolveCircleMove`/blockers. One-shot, no status.

## Element-signature ailment content (`ability-effects.ts` + DB)

Seed `ability_status_effects` defaults by element so spells imprint their signature ailment
(data-driven; SQL-tunable):
- fire → `ignite` (DoT) ; cold → `chill` (+ `freeze` on novas) ; lightning → `shock` ;
  poison → `poison` ; physical → `bleed`.
- Specific abilities/bosses add `stun` / `silence` / `fear` / `taunt` / `curse` rows.

The `editable.ts` effect enum (`~286`) expands to the full `StatusId` set so the engine panel + DB
accept them. `StatusEffectKind` (the content type) widens to the full set.

## Protocol + client

- `protocol.ts`: document the expanded `flags` bits; bump `PROTOCOL_VERSION` to 2. (`flags` stays a
  `number`.) Bit plan: keep 1=slow,2=burn,4=weaken,8=might,16=haste,32=regen,64=enrage; add
  128=stun, 256=freeze, 512=silence, 1024=shock, 2048=poison, 4096=bleed, 8192=ignite, 16384=chill,
  32768=brittle, 65536=maim, 131072=sap, 262144=fear, 524288=taunt, 1048576=curse.
- `world.ts` snapshot: extend the player + mob flag-builders with the new bits (from the relevant
  StatusSet `has()`).
- Client: extend the sprite-tint priority chain (`pixi-renderer.ts:2401`) and the HUD pips/target
  badges (`main.ts`) for the high-signal statuses (stun/freeze/poison/bleed/shock/chill at least; the
  rest can share a generic "hexed" pip to avoid HUD clutter). A shared `STATUS_BITS` table in shared
  code keeps server + client in lockstep (single source of truth for bit↔id).

## Testing

- `status-effects.test.ts` — new factors (slowFactor covers chill/maim; weakenFactor covers sap/curse;
  vulnFactor; rooted/silenced/feared/taunted; poison additive stacking; dotDamage sums).
- `world` integration — a stun roots a mob (no movement that tick); shock raises damage taken; a
  knockback ability displaces a mob; silence blocks a mob cast.
- `protocol.test.ts` / a serialization test — the new flag bits round-trip; `PROTOCOL_VERSION` is 2.
- `ability-effects.test.ts` — element-signature rows seed + the widened enum.
- `editable.test.ts` — new effect kinds validate.

## Non-goals / deferred (noted)

- **Player fear** (input takeover) — intrusive; deferred. Players still take stun/silence (gates) but
  not forced movement.
- Distinct curse *variants* beyond the single `curse` combo — additional curses are content
  (ability_status_effects rows combining existing statuses), not new code.
- Per-element resistance interplay with ailments (e.g. fire-resist reduces ignite) — Slice 4 (stats).
- No balance pass (Slice 4).

## Risks / mitigations

- **Netcode/lifecycle (the loop's caution):** the root/silence gates mirror the existing
  `telegraphUntil` pattern exactly; incoming-damage `vulnFactor` is a single multiply in the two
  damage funcs; knockback reuses `resolveCircleMove`. Each hook is small and localized. Server stays
  authoritative; the client only reads presence bits.
- **Backward compat:** new statuses default absent; `flags` extra bits are ignored by old clients
  (JSON-tolerant); `PROTOCOL_VERSION` bump signals the change. No save migration (statuses are
  transient). `ability_status_effects` gains rows (INSERT OR IGNORE) — lands on existing DBs.
- **Determinism:** `StatusSet` stays pure; knockback/fear use positional math, no RNG except existing
  seeded ailment-chance (none added this slice — ailments apply on hit like today).
- **Single source of truth:** the `STATUS_BITS` table (shared) prevents server/client bit drift.

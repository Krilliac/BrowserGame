# Deferred Spell Behaviors (orbit, beam, + trail/lob notes) — Plan

> Improvement-loop work after the 4-slice roadmap. Picks up the Slice-1-deferred behaviors. subagent-driven; gate every commit with `NODE_OPTIONS=--use-system-ca npm run check`; trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`; branch loop/autonomous-20260614.

## Feature A — Orbit (caster-attached, persistent)

**Goal:** a `{type:'orbit', radius, angularSpeed}` behavior: the projectile circles its owner and damages enemies it sweeps (a rotating guardian). Extends the existing projectile lifecycle — no new entity, no protocol change.

**Hit semantics (the crux):** orbit projectiles **persist for their TTL** (don't consume on hit) and **re-hit a given mob on a short cooldown** (an orbiting blade laps and re-strikes), not once-ever (too weak) nor every tick (absurd DPS).

**Design:**
- `combat.ts`: add `| { type: 'orbit'; radius: number; angularSpeed: number }` to `BehaviorSpec` (angularSpeed in rad/s).
- `world.ts` `Projectile`: add `orbitAngle?: number` and `orbitHits?: Map<number, number>` (mobId → sim-time it may be hit again).
- Spawn (cast projectile branch): when the ability has an `orbit` behavior, set each spawned projectile's `orbitAngle` to its fan angle `a` (so a multishot ring spreads evenly around the circle), and a longer TTL is fine (the ability's `projectileTtlMs`). Init `orbitHits = new Map()`.
- `tickProjectiles` ON-TRAVEL (before the linear `proj.x += proj.vx*dt` at ~3627): if `proj` has an orbit behavior → look up `owner = this.players.get(proj.ownerId)`; if no owner, delete the projectile (`continue`); else `proj.orbitAngle = (proj.orbitAngle ?? 0) + orbit.angularSpeed*dt`, set `proj.x = owner.x + cos(orbitAngle)*radius`, `proj.y = owner.y + sin(orbitAngle)*radius`, and **skip the linear vx/vy position update** (wrap the existing `proj.x+=vx` / `proj.y+=vy` in an `else`). Orbit ignores homing/return.
- ON-HIT: for an orbit projectile, change the eligibility + consume:
  - Eligibility: instead of the permanent `hitMobs.has(id)` skip, an orbit projectile may hit a mob if `(proj.orbitHits.get(id) ?? 0) <= this.now`. On hit, set `proj.orbitHits.set(id, this.now + ORBIT_REHIT_MS)` (const ~350ms) — do NOT add to `hitMobs`.
  - Consume: an orbit projectile is **never consumed by a hit** (override → `consumed = false`); it lives until TTL/out-of-bounds. (Keep wall-collision deletion? An orbit attached to the owner shouldn't be wall-deleted as it sweeps — SKIP the wall-block deletion for orbit projectiles, since its position is owner-relative; bound only by TTL.)
  - Damage still flows through `applyProjectileDamage` (deterministic via this.rand). resolveHit's splash/chain/etc. don't apply to a pure orbit; keep it simple — orbit projectiles carry only the orbit behavior (+ maybe splash later).
- Wall handling: guard the `pointInAnyBlocker` deletion so orbit projectiles aren't deleted by walls (owner-relative).
- Content: assign orbit to a thematic existing ability — `arcane_orb` or `maelstrom_orb` (the "orb" abilities) read as orbiting. Pick one, give it `behaviors:[{type:'orbit', radius:48, angularSpeed:3.2}]` (with multishot it becomes a ring). Its behaviors_json was likely null → the ensureAbilityBehaviors backfill lands it on existing game.db (verify; if it already had behaviors, note the live-DB caveat).
- Client: projectiles already render; orbit projectiles just move owner-relative server-side → client interpolates them circling. No client change needed (optional: a faint tether, skip for v1).
- Tests: a world test — cast the orbit ability, advance ticks, assert a projectile's distance from the owner stays ≈ radius while its angle advances (orbiting), and that a stationary mob within the ring takes damage repeatedly over time but on a cooldown (not every tick). Deterministic now (this.rand). Keep real.

**Tasks:** (1) BehaviorSpec + Projectile fields + spawn init; (2) tickProjectiles on-travel orbit positioning (skip linear move + wall-delete for orbit); (3) on-hit re-hit-cooldown + never-consume; (4) assign to ability + test; (5) final review + push (batch with beam or push solo).

## Feature B — Beam (hitscan)

**Goal:** `{type:'beam', range, width}` — an instant line from the caster along facing on cast; hits every mob whose center is within `width` of the segment up to `range`; brief additive beam VFX. No projectile travel, no new entity.

**Design:**
- `combat.ts`: add `| { type: 'beam'; range: number; width: number }` to `BehaviorSpec`.
- `world.ts` cast: if the ability is a projectile whose behaviors include `beam`, take the BEAM branch INSTEAD of spawning projectiles: compute the segment from (player.x,player.y) along `facing` length `range`; for each mob, if its distance to the segment ≤ `width` + MOB_RADIUS, apply damage (rollAbilityDamage + crit via this.rand + resistedDamage + applyStatus, mirroring the projectile hit path; honor per-element damage + penetration + ailment mults like the projectile path) and knockback if present. Emit a new `{kind:'beam', x, y, x2, y2, element}` FxEvent (x2/y2 = segment end).
- Protocol: extend `FxEvent.kind` with `'beam'` and reuse the existing `x2/y2/element` fields (added for `arc` in Slice 3). No version bump needed (additive optional fields) — but bump if you prefer; arc already used these fields at v2.
- Client: render the beam in pixi-renderer's fx loop like the chain `arc` (additive line, element-tinted, on the dedicated arc/fx graphics) — possibly thicker/brighter.
- Content: assign beam to a thematic ability (a "lance"/"ray"/"disintegrate" — or add one). Distance-to-segment helper: write a small pure `pointToSegmentDist` (unit-test it).
- Tests: pure `pointToSegmentDist`; a world test that a beam cast damages mobs along the line and not off-axis ones.

**Tasks:** similar shape; pure segment-distance helper + tests, cast branch, FxEvent + client render, content, review, push.

## Features C/D — Trail & Lob (DEFERRED unless time permits, scoped)

- **Trail (ground zone):** needs a new persistent entity `GroundZone { id, x, y, radius, ttl, ownerId, abilityId }` — ticked each frame to damage/ailment mobs inside, serialized into the snapshot as a new entity kind (or a new `zones` array), and rendered client-side (a pulsing AoE decal). This is a meaningful new entity + protocol surface. Write a spec; build only if ≥~1.5h remains; else defer cleanly.
- **Lob (ground-target):** needs the client to send an AIM POINT (target XY) with the cast, not just a facing — a protocol change to the cast/input message + client input (tap-to-target). Then the projectile arcs to the point and bursts (splash). Write a spec; build only if time permits; else defer.

Prefer shipping orbit + beam solidly over half-building trail/lob.

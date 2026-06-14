/**
 * Bitmask flags on an individual creature SPAWN (a `creature_spawns` row — the UID/guid-level
 * placement of a monster, distinct from its `mob_templates` entry). Mirrors the TrinityCore
 * `creature` spawn model: a template defines the kind of monster; a spawn places one in the world
 * and can override aspects of it. Extend with more bits (e.g. a patrol/boss flag) as needed.
 */
export const CreatureSpawnFlags = {
  /** Force this placement to be an elite ("champion") variant regardless of the random roll. */
  ELITE: 1 << 0,
} as const;
export type CreatureSpawnFlag = (typeof CreatureSpawnFlags)[keyof typeof CreatureSpawnFlags];

/** True if `flags` has the given {@link CreatureSpawnFlags} bit set. */
export function hasSpawnFlag(flags: number, flag: CreatureSpawnFlag): boolean {
  return (flags & flag) !== 0;
}

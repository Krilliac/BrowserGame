/**
 * Mounts — owned, persistent travel-speed boosts (the ED5 mount system, ARPG-flavored). Unlike the
 * timed `sprint` self-buff or `+move` gear affix, a mount is a thing you OWN: bought once from a
 * Stablemaster, kept on the character forever, and toggled on/off at will for a large move-speed
 * multiplier. Pure data + tuning (mirrors hirelings.ts / the elite roster); the World owns the
 * owned-set, the active mount, and folding the multiplier into `playerMoveMul`.
 */

export interface MountDef {
  id: string;
  name: string;
  /** Move-speed multiplier while this mount is active (1.6 = +60% travel speed). */
  speedMult: number;
  /** Gold to buy it from a Stablemaster (a one-time, permanent purchase). */
  price: number;
}

/**
 * Code DEFAULTS for the mount roster — the seed source for the `mounts` content table and the
 * fallback the live list resets to. Treat as immutable; tune via the DB. Three tiers: a cheap
 * starter, a mid warhorse, and a premium courser, so it stays a recurring gold sink as you climb.
 */
export const DEFAULT_MOUNTS: MountDef[] = [
  { id: 'dustback_mule', name: 'Dustback Mule', speedMult: 1.4, price: 1200 },
  { id: 'war_courser', name: 'War Courser', speedMult: 1.7, price: 6000 },
  { id: 'dread_destrier', name: 'Dread Destrier', speedMult: 2.0, price: 20000 },
];

/** Look up a mount def by id from the supplied roster (the server passes the DB-loaded list). */
export function findMount(id: string, roster: readonly MountDef[]): MountDef | undefined {
  return roster.find((m) => m.id === id);
}

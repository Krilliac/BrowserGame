/**
 * Bitmask flags describing what services an NPC offers — the TrinityCore `npcflag` concept adapted
 * here. Stored as the `npc_flags` int on each `npcs` row so one NPC can offer several services at
 * once (e.g. a vendor that is also a quest-giver). The legacy single `kind` string stays as the
 * NPC's primary role + sprite; these flags drive what the E-key interaction actually offers.
 */
export const NpcFlags = {
  VENDOR: 1 << 0,
  QUESTGIVER: 1 << 1,
  HEALER: 1 << 2,
  GAMBLER: 1 << 3,
  ARTIFICER: 1 << 4,
  BANKER: 1 << 5,
  RECRUITER: 1 << 6,
  RIFTKEEPER: 1 << 7,
  STABLE: 1 << 8,
} as const;
export type NpcFlag = (typeof NpcFlags)[keyof typeof NpcFlags];

/** The flag implied by a legacy `kind` string (used to derive `npc_flags` from `kind`). */
export const KIND_TO_NPC_FLAG: Record<string, NpcFlag> = {
  vendor: NpcFlags.VENDOR,
  questgiver: NpcFlags.QUESTGIVER,
  healer: NpcFlags.HEALER,
  gambler: NpcFlags.GAMBLER,
  artificer: NpcFlags.ARTIFICER,
  banker: NpcFlags.BANKER,
  recruiter: NpcFlags.RECRUITER,
  riftkeeper: NpcFlags.RIFTKEEPER,
  stable: NpcFlags.STABLE,
};

/** True if `flags` has the given {@link NpcFlags} bit set. */
export function hasNpcFlag(flags: number, flag: NpcFlag): boolean {
  return (flags & flag) !== 0;
}

/**
 * Bitmask flags on a quest template (a `quests.flags` int) — the TrinityCore quest-flags concept.
 * Extend with more bits as needed. REPEATABLE lets a quest be taken again after completion (it is
 * not marked permanently done), turning a one-off bounty into a farmable repeat.
 */
export const QuestFlags = {
  REPEATABLE: 1 << 0,
} as const;
export type QuestFlag = (typeof QuestFlags)[keyof typeof QuestFlags];

/** True if `flags` has the given {@link QuestFlags} bit set. */
export function hasQuestFlag(flags: number, flag: QuestFlag): boolean {
  return (flags & flag) !== 0;
}

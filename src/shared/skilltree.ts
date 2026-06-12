/**
 * Passive skill / talent tree. The player earns one point per level and spends it (1 point per
 * node) to permanently allocate a passive node. Nodes are arranged in three branches — Offense,
 * Defense, Utility — across tiers 0..3, where deeper nodes require a shallower node in the same
 * branch (a small DAG, no cycles).
 *
 * This module is PURE DATA + AGGREGATION: it owns WHAT each node grants. The server folds the
 * aggregated {@link SkillEffects} into its authoritative stat recompute; the client uses it to
 * render the tree. There is no framework, server, or client code here.
 */

/**
 * The additive bonuses a set of allocated nodes contributes. Every field is a plain number that
 * defaults to 0 and is SUMMED across nodes, so the server can fold it in mechanically.
 *
 * - `power`        flat attack power.
 * - `critPct`      whole crit percentage points (e.g. 5 = +5% crit chance).
 * - `maxHpPct`     percent bonus to max HP.
 * - `lifestealPct` whole percentage points of damage returned as HP.
 * - `swiftPct`     whole percentage points of attack speed.
 * - `movePct`      whole percentage points of move speed.
 * - `armorPct`     whole percentage points of armor.
 * - `vigor`        flat HP regenerated per second.
 * - `manaRegen`    flat mana regenerated per second.
 * - `multishot`    extra projectiles fired.
 */
export interface SkillEffects {
  power: number;
  critPct: number;
  maxHpPct: number;
  lifestealPct: number;
  swiftPct: number;
  movePct: number;
  armorPct: number;
  vigor: number;
  manaRegen: number;
  multishot: number;
}

/**
 * One node in the tree. `tier` 0 nodes are always available (empty `requires`); higher tiers gate
 * on `requires` — every prerequisite node id must be allocated first. `effects` is the partial set
 * of {@link SkillEffects} this node grants.
 */
export interface SkillNode {
  id: string;
  name: string;
  desc: string;
  tier: number;
  requires: string[];
  effects: Partial<SkillEffects>;
}

/**
 * The talent tree. Three branches × tiers 0..3. Deeper nodes require a shallower node in the same
 * branch, so prerequisites always reference a strictly lower tier (the DAG has no cycles).
 */
export const SKILL_TREE: SkillNode[] = [
  // ---- Offense: power / crit / multishot ----
  {
    id: 'off-might',
    name: 'Might',
    desc: '+5 attack power.',
    tier: 0,
    requires: [],
    effects: { power: 5 },
  },
  {
    id: 'off-precision',
    name: 'Precision',
    desc: '+3% critical strike chance.',
    tier: 1,
    requires: ['off-might'],
    effects: { critPct: 3 },
  },
  {
    id: 'off-brutality',
    name: 'Brutality',
    desc: '+8 attack power.',
    tier: 1,
    requires: ['off-might'],
    effects: { power: 8 },
  },
  {
    id: 'off-deadeye',
    name: 'Deadeye',
    desc: '+5% critical strike chance.',
    tier: 2,
    requires: ['off-precision'],
    effects: { critPct: 5 },
  },
  {
    id: 'off-onslaught',
    name: 'Onslaught',
    desc: 'Capstone: +8 attack power and an extra projectile.',
    tier: 3,
    requires: ['off-brutality', 'off-deadeye'],
    effects: { power: 8, multishot: 1 },
  },

  // ---- Defense: maxHpPct / armor / vigor ----
  {
    id: 'def-toughness',
    name: 'Toughness',
    desc: '+5% maximum health.',
    tier: 0,
    requires: [],
    effects: { maxHpPct: 5 },
  },
  {
    id: 'def-plating',
    name: 'Plating',
    desc: '+4% armor.',
    tier: 1,
    requires: ['def-toughness'],
    effects: { armorPct: 4 },
  },
  {
    id: 'def-recovery',
    name: 'Recovery',
    desc: '+3 health regenerated per second.',
    tier: 1,
    requires: ['def-toughness'],
    effects: { vigor: 3 },
  },
  {
    id: 'def-bulwark',
    name: 'Bulwark',
    desc: '+6% armor.',
    tier: 2,
    requires: ['def-plating'],
    effects: { armorPct: 6 },
  },
  {
    id: 'def-juggernaut',
    name: 'Juggernaut',
    desc: 'Capstone: +8% maximum health and +5 health per second.',
    tier: 3,
    requires: ['def-bulwark', 'def-recovery'],
    effects: { maxHpPct: 8, vigor: 5 },
  },

  // ---- Utility: move / swift / lifesteal / manaRegen ----
  {
    id: 'util-fleet',
    name: 'Fleet',
    desc: '+5% movement speed.',
    tier: 0,
    requires: [],
    effects: { movePct: 5 },
  },
  {
    id: 'util-haste',
    name: 'Haste',
    desc: '+5% attack speed.',
    tier: 1,
    requires: ['util-fleet'],
    effects: { swiftPct: 5 },
  },
  {
    id: 'util-leech',
    name: 'Leech',
    desc: '+3% life steal.',
    tier: 1,
    requires: ['util-fleet'],
    effects: { lifestealPct: 3 },
  },
  {
    id: 'util-flow',
    name: 'Flow',
    desc: '+2 mana regenerated per second.',
    tier: 2,
    requires: ['util-haste'],
    effects: { manaRegen: 2 },
  },
  {
    id: 'util-vampirism',
    name: 'Vampirism',
    desc: '+4% life steal.',
    tier: 2,
    requires: ['util-leech'],
    effects: { lifestealPct: 4 },
  },
  {
    id: 'util-windrunner',
    name: 'Windrunner',
    desc: 'Capstone: +8% movement speed and +6% attack speed.',
    tier: 3,
    requires: ['util-flow', 'util-vampirism'],
    effects: { movePct: 8, swiftPct: 6 },
  },
];

/** Index for O(1) lookup by id. Built once from {@link SKILL_TREE}. */
const SKILL_INDEX: ReadonlyMap<string, SkillNode> = new Map(
  SKILL_TREE.map((node) => [node.id, node]),
);

/** The node with the given id, or `undefined` if no such node exists. */
export function skillNode(id: string): SkillNode | undefined {
  return SKILL_INDEX.get(id);
}

/**
 * True if `nodeId` is a real node, is NOT already in `allocated`, and ALL of its prerequisites are
 * already in `allocated`.
 */
export function canAllocate(nodeId: string, allocated: ReadonlySet<string>): boolean {
  const node = SKILL_INDEX.get(nodeId);
  if (node === undefined) return false;
  if (allocated.has(nodeId)) return false;
  return node.requires.every((req) => allocated.has(req));
}

/** A fresh, fully-zeroed {@link SkillEffects}. */
function zeroEffects(): SkillEffects {
  return {
    power: 0,
    critPct: 0,
    maxHpPct: 0,
    lifestealPct: 0,
    swiftPct: 0,
    movePct: 0,
    armorPct: 0,
    vigor: 0,
    manaRegen: 0,
    multishot: 0,
  };
}

/**
 * Sum the effects of every allocated node into a complete {@link SkillEffects} (all fields present,
 * 0 where nothing contributes). Unknown ids are ignored.
 */
export function aggregateSkillEffects(allocated: Iterable<string>): SkillEffects {
  const total = zeroEffects();
  for (const id of allocated) {
    const node = SKILL_INDEX.get(id);
    if (node === undefined) continue;
    for (const key of Object.keys(node.effects) as (keyof SkillEffects)[]) {
      const value = node.effects[key];
      if (value !== undefined) total[key] += value;
    }
  }
  return total;
}

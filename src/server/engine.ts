/**
 * Data layer for the Dev "Game Engine" panel. Builds the schema the panel renders from (the
 * editable content tables + the runtime-tunable config knobs + dropdown lists), reads content
 * rows, and validates/writes config knobs. The HOST (index.ts) owns the privileged actions that
 * need world/instance context (spawn, give, teleport, …) and gates the whole surface on
 * access level >= Developer; this module is the pure-ish data half.
 *
 * Config writes mutate the live `config` object; the caller then runs `applyRuntimeConfig()`
 * (world.ts) so the sim picks the new value up immediately.
 */
import { config } from './config.js';
import { getContent, getDb } from './content.js';
import { ACCESS_NAMES } from './accounts.js';
import { EDITABLE_TABLES } from './db/editable.js';
import type {
  EngineConfigGroup,
  EngineResData,
  EngineSchema,
  EngineTableSpec,
} from '../shared/protocol.js';

const ROW_LIMIT = 1000;

interface FieldDef {
  path: string; // 'group.key' into the live config object
  label: string;
  kind: 'int' | 'real';
  min: number;
  max: number;
  step: number;
}
interface GroupDef {
  label: string;
  fields: FieldDef[];
}

const r = (path: string, label: string, min: number, max: number, step: number): FieldDef => ({
  path,
  label,
  kind: 'real',
  min,
  max,
  step,
});
const i = (path: string, label: string, min: number, max: number): FieldDef => ({
  path,
  label,
  kind: 'int',
  min,
  max,
  step: 1,
});

/**
 * The runtime-tunable knobs the panel exposes — exactly the values world.ts's `applyRuntimeConfig`
 * refreshes (so every edit here takes effect live). World scaling, networking, instance caps, and
 * server/operational settings are intentionally absent: they're read once at load and need a
 * restart, so editing them live would lie about taking effect.
 */
const CONFIG_GROUPS: GroupDef[] = [
  {
    label: 'Difficulty',
    fields: [
      r('difficulty.mobDamage', 'Mob damage ×', 0.1, 5, 0.05),
      r('difficulty.mobHp', 'Mob HP ×', 0.1, 5, 0.05),
      r('difficulty.mobAggro', 'Mob aggro ×', 0.1, 3, 0.05),
      r('difficulty.levelHpScale', 'Per-level HP scale', 0, 0.3, 0.005),
      r('difficulty.eliteChance', 'Elite chance', 0, 1, 0.01),
    ],
  },
  {
    label: 'Co-op & density',
    fields: [
      r('coop.damagePerPlayer', 'Co-op dmg / player', 0, 1, 0.01),
      r('coop.damageCap', 'Co-op dmg cap ×', 1, 5, 0.1),
      r('density.perPlayer', 'Density / player', 0, 2, 0.05),
      i('density.cap', 'Density cap ×', 1, 12),
      i('density.topupPerCall', 'Density top-up / call', 1, 200),
    ],
  },
  {
    label: 'Drops',
    fields: [
      r('drops.unique', 'Unique drop', 0, 1, 0.005),
      r('drops.chestUnique', 'Chest unique', 0, 1, 0.01),
      r('drops.spellbookNormal', 'Spellbook (normal)', 0, 1, 0.001),
      r('drops.spellbookElite', 'Spellbook (elite)', 0, 1, 0.005),
      r('drops.spellbookBoss', 'Spellbook (boss)', 0, 1, 0.05),
      r('drops.gemNormal', 'Gem (normal)', 0, 1, 0.01),
      r('drops.gemElite', 'Gem (elite)', 0, 1, 0.01),
      r('drops.gemBoss', 'Gem (boss)', 0, 1, 0.05),
    ],
  },
  {
    label: 'Economy',
    fields: [
      r('economy.vendorPriceMult', 'Vendor price ×', 0.1, 5, 0.1),
      i('economy.vendorStockCap', 'Vendor stock window', 1, 50),
      i('economy.vendorRotateMs', 'Vendor rotate (ms)', 10_000, 1_200_000),
      i('economy.riftCostPerTier', 'Rift cost / tier', 0, 100_000),
      i('economy.chestGoldMin', 'Chest gold min', 0, 100_000),
      i('economy.chestGoldMax', 'Chest gold max', 0, 100_000),
      i('economy.potGoldMin', 'Pot gold min', 0, 10_000),
      i('economy.potGoldMax', 'Pot gold max', 0, 10_000),
      i('economy.artificerRerollGold', 'Artificer reroll', 0, 100_000),
      i('economy.artificerUnsocketGold', 'Artificer unsocket', 0, 100_000),
    ],
  },
  {
    label: 'Potions & items',
    fields: [
      i('potions.cap', 'Potion belt cap', 1, 50),
      i('potions.start', 'Starting potions', 0, 50),
      i('potions.heal', 'Health potion heal', 0, 100_000),
      i('potions.mana', 'Mana potion restore', 0, 100_000),
      i('potions.cooldownMs', 'Potion cooldown (ms)', 0, 60_000),
      i('items.maxBagGear', 'Bag gear cap', 1, 500),
      i('items.stashCap', 'Stash slots', 1, 1000),
      i('items.itemTtlMs', 'Dropped-loot TTL (ms)', 1000, 600_000),
    ],
  },
  {
    label: 'Progression & bounty',
    fields: [
      i('progression.skillPointsPerLevel', 'Skill points / level', 0, 10),
      i('bounty.fullMs', 'Bounty full (ms)', 1000, 600_000),
      r('bounty.maxChance', 'Bounty bonus chance', 0, 1, 0.05),
      r('bounty.invasionCorruptChance', 'Invasion corrupt', 0, 1, 0.01),
      r('bounty.bossCorruptChance', 'Boss corrupt', 0, 1, 0.005),
    ],
  },
];

const FIELD_BY_PATH = new Map<string, FieldDef>();
for (const g of CONFIG_GROUPS) for (const f of g.fields) FIELD_BY_PATH.set(f.path, f);

/** The config subtree as a flat numeric map — every CONFIG_GROUPS leaf is a number. */
function configBag(): Record<string, Record<string, number>> {
  return config as unknown as Record<string, Record<string, number>>;
}

function readConfig(path: string): number {
  const [group, key] = path.split('.');
  return configBag()[group ?? '']?.[key ?? ''] ?? 0;
}

/** Validate + clamp + write a config knob. Returns the applied value, or null for an unknown path. */
export function setEngineConfig(path: string, value: number): number | null {
  const field = FIELD_BY_PATH.get(path);
  if (!field || !Number.isFinite(value)) return null;
  let v = Math.max(field.min, Math.min(field.max, value));
  if (field.kind === 'int') v = Math.round(v);
  const [group, key] = path.split('.');
  const bag = configBag()[group ?? ''];
  if (!bag || !(key! in bag)) return null;
  bag[key!] = v;
  return v;
}

/** The whole schema the panel renders from. */
export function engineSchema(): EngineSchema {
  const content = getContent();
  const db = getDb();
  const templates = db.prepare('SELECT id, name FROM mob_templates ORDER BY id').all() as {
    id: string;
    name: string;
  }[];

  const cfg: EngineConfigGroup[] = CONFIG_GROUPS.map((g) => ({
    label: g.label,
    fields: g.fields.map((f) => ({
      path: f.path,
      label: f.label,
      kind: f.kind,
      min: f.min,
      max: f.max,
      step: f.step,
      value: readConfig(f.path),
    })),
  }));

  return {
    tables: EDITABLE_TABLES as unknown as Record<string, EngineTableSpec>,
    config: cfg,
    areas: content.areas().map((a) => ({ id: a.id, name: a.name })),
    templates: templates.map((t) => ({ id: t.id, name: t.name })),
    items: content.items().map((it) => ({ id: it.id, name: it.name })),
    weathers: ['none', 'rain', 'snow', 'fog'],
    access: Object.entries(ACCESS_NAMES).map(([value, name]) => ({ value: Number(value), name })),
  };
}

/** All rows of a content table (capped), for the DB editor's row list. */
export function engineRows(table: string): EngineResData | { error: string } {
  const spec = EDITABLE_TABLES[table];
  if (!spec) return { error: `Unknown table: ${table}` };
  const rows = getDb().prepare(`SELECT * FROM ${table} LIMIT ${ROW_LIMIT}`).all() as Record<
    string,
    unknown
  >[];
  const columns = [spec.pk, ...Object.keys(spec.columns)];
  const cleaned = rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const col of columns) {
      const v = row[col];
      out[col] = v === null || v === undefined ? null : typeof v === 'number' ? v : String(v);
    }
    return out;
  });
  return { kind: 'rows', columns, rows: cleaned };
}

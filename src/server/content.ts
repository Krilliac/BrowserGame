import { config, applyConfigOverrides } from './config.js';
import { openDatabase, type GameDatabase } from './db/database.js';
import { rollDropTable, type DropRow, type DropTable } from './drop-table.js';
import type { AreaDef, DecorProp, DungeonDef } from '../shared/areas.js';
import { DEFAULT_THEME, type AreaTheme, type WeatherKind } from '../shared/theme.js';
import type { Ability, AbilityId, BehaviorSpec, DamageElement } from '../shared/combat.js';
import type { ResistMap } from './combat-formulas.js';
import {
  hasItemFlag,
  ItemFlags,
  applyRarityOverrides,
  applyAffixRangeOverrides,
  applyAffixNameOverrides,
  type Affix,
  type ItemInstance,
  type Rarity,
  type RarityDef,
  type AffixName,
  type AffixRange,
} from '../shared/items.js';
import { pickUnique, rollUnique, type UniqueDef } from '../shared/uniques.js';
import { applyGemOverrides, type GemDef } from '../shared/gems.js';
import {
  applyRuneOverrides,
  applyRunewordOverrides,
  type RuneDef,
  type RunewordDef,
} from '../shared/runewords.js';
import { applyItemSetOverrides, type ItemSetDef } from '../shared/item-sets.js';
import { applyBossScriptOverrides, type BossScript, type BossStep } from './boss-scripts.js';
import type { ProcDef, ProcEffect } from './item-procs.js';
import type { GameEventDef } from './game-events.js';
import type { RiftModifierDef } from './rift-modifiers.js';
import type { CraftRecipe } from './crafting.js';
import { applySkillTreeOverrides, type SkillNode, type SkillEffects } from '../shared/skilltree.js';
import { KIND_TO_NPC_FLAG } from '../shared/npc-flags.js';
import {
  type MobTemplate,
  type MobTrait,
  type EliteModifier,
  DEFAULT_ELITE_MODIFIERS,
} from './mobs.js';
import { applyHirelingOverrides, type HirelingTemplate } from './hirelings.js';
import { weatherModifiers, type WeatherModifiers } from './weather-effects.js';
import type { StatusEffectKind } from './ability-effects.js';
import type { StatusId } from './status-effects.js';

/**
 * Runtime game content, loaded from the SQLite database (the source of truth) via parametrized
 * queries. The server reads everything from here, so editing the database changes the game. A
 * lazily-initialized in-memory database (seeded from the built-in content) is the default, which
 * keeps unit tests zero-config; the server points it at a file via GAME_DB.
 */
export interface ItemDef {
  id: string;
  name: string;
  kind: string; // 'equip' | 'loot' | 'currency' | 'spellbook'
  slot: string | null; // item slot for equippables (head/chest/mainhand/ring/…)
  power: number | null;
  hp: number | null;
  color: string | null;
  sellValue: number;
  /** Spellbooks only: the ability id this book teaches. */
  teaches: string | null;
  /** Bitmask of {@link ItemFlags} (e.g. LEGENDARY). */
  flags: number;
  /** Legendaries only: the base item id this unique is built on (for its rolled stats + look). */
  baseId: string | null;
  /** Legendaries only: the fixed, build-defining affixes. */
  affixes: Affix[] | null;
  /** Optional flavor line (legendaries). */
  flavor: string | null;
}

export interface NpcDef {
  name: string;
  x: number;
  y: number;
  hue: number;
  /** Primary role + sprite (e.g. 'vendor'). */
  kind: string;
  /** Bitmask of {@link NpcFlags} — the services this NPC offers (derived from kind if unset). */
  flags: number;
}

export interface QuestDef {
  id: string;
  name: string;
  description: string;
  targetMob: string | null;
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  /** Optional item granted on completion (e.g. a spellbook). */
  rewardItem: string | null;
  /** Collect quests: the item id to turn in (null for kill quests). */
  turnInItem: string | null;
  /** Collect quests: how many of {@link turnInItem} to turn in. */
  turnInCount: number;
  /** Explore quests: the area id the player must discover to complete (null otherwise). */
  exploreArea: string | null;
  /** Chain quests: a prerequisite quest id that must be completed before this one unlocks. */
  requires: string | null;
  /** Bitmask of {@link QuestFlags} (e.g. REPEATABLE). */
  flags: number;
}

/** One placed monster: its spawn UID, the template it instances, a fixed position, and spawn flags. */
export interface CreatureSpawn {
  uid: number;
  templateId: string;
  x: number;
  y: number;
  /** Bitmask of {@link CreatureSpawnFlags} (e.g. ELITE). */
  flags: number;
}

/** One row on a vendor's shelf. */
export interface StockEntry {
  itemId: string;
  price: number;
}

export interface Content {
  area(id: string): AreaDef | undefined;
  areas(): AreaDef[];
  ability(id: string): Ability | undefined;
  abilityOrder(): AbilityId[];
  abilityList(): Ability[];
  item(id: string): ItemDef | undefined;
  items(): ItemDef[];
  sellValue(itemId: string): number;
  /** The unique (legendary) catalogue, loaded from the `uniques` table. */
  uniques(): UniqueDef[];
  unique(id: string): UniqueDef | undefined;
  /** Unique defs whose base item occupies the given slot (for slot-targeted drops). */
  uniquesForSlot(slot: string): UniqueDef[];
  /** Mint a random legendary, resolving its base power/hp from the items table. */
  rollRandomUnique(uid: number, rng?: () => number): ItemInstance | undefined;
  mobTemplate(id: string): MobTemplate | undefined;
  /** Procedural dungeon population (pool/boss/elite chances) for a dungeon area, or undefined. */
  dungeon(areaId: string): DungeonDef | undefined;
  areaMobs(areaId: string): { templateId: string; count: number }[];
  /** Individual placed monsters (uid spawns) for an area — fixed-position, overridable. */
  creatureSpawns(areaId: string): CreatureSpawn[];
  npcs(areaId: string): NpcDef[];
  quests(): QuestDef[];
  quest(id: string): QuestDef | undefined;
  /** What the named vendor in the given area sells (empty for non-vendors). */
  vendorStock(areaId: string, npcName: string): StockEntry[];
  rollLoot(mobTemplateId: string, rng?: () => number): { item: string; qty: number }[];
  /** SQL sprite color override for a target ('mob:<id>' | 'npc:<kind>' | 'decor:<kind>' | …). */
  spriteTint(target: string): string | undefined;
  /** All sprite color overrides (shipped to the client in the content packet). */
  spriteTints(): Record<string, string>;
  /** Gameplay multipliers for a weather kind (DB-driven; falls back to the code default). */
  weatherMods(weather: WeatherKind): WeatherModifiers;
  /** Elite ("champion") stat modifiers a spawn can roll, in deterministic pick order. */
  eliteModifiers(): EliteModifier[];
  /** On-hit status effects (slow/burn/weaken) an ability applies — empty if it has none. */
  abilityStatusEffects(abilityId: string): AbilityStatusEffect[];
  /** The self-buff an ability grants its caster on cast — undefined if it grants none. */
  castBuff(abilityId: string): CastBuff | undefined;
  /** The shrine blessing pool (one is picked at random), in deterministic order. */
  shrineBuffs(): ShrineBuff[];
  /** True if the area is a procedural dungeon (populated from a pool, not a fixed roster). */
  isDungeon(areaId: string): boolean;
  /** Every dungeon area id (shipped to the client so it knows which portals lead to a dungeon). */
  dungeonAreaIds(): string[];
  /** Item rarity-tier definitions keyed by rarity (drop weight, stat mult, variance, color). */
  rarityTiers(): Partial<Record<Rarity, RarityDef>>;
  /** The full socketable gem catalog (overlaid onto the shared GEMS table on both sides). */
  gems(): GemDef[];
  /** The rune pool (overlaid onto the shared RUNES list; server-side runeword detection). */
  runes(): RuneDef[];
  /** The runeword recipes (overlaid onto the shared RUNEWORDS list). */
  runewords(): RunewordDef[];
  /** The item sets + threshold bonuses (overlaid onto the shared ITEM_SETS list). */
  itemSets(): ItemSetDef[];
  /** Scripted boss phases keyed by boss template id (overlaid onto the live BOSS_SCRIPTS). */
  bossScripts(): Record<string, BossScript>;
  /** The procs a base item carries (chance-on-hit/crit effects); empty if it has none. */
  itemProcs(sourceId: string): ProcDef[];
  /** Per-element damage resistances for a mob template (empty if it has none). */
  mobResists(templateId: string): ResistMap;
  /** The timed liveops game events (recurrence schedules; the host applies them on the sim clock). */
  gameEvents(): GameEventDef[];
  /** The rift mutator pool (a tiered rift rolls a couple at open; the World applies their effects). */
  riftModifiers(): RiftModifierDef[];
  /** The crafting recipes (material refinement ladder + sinks; World.craft applies them). */
  craftingRecipes(): CraftRecipe[];
  /** Affix roll ranges per scalar stat (server-only; overlaid onto the shared AFFIX_RANGES). */
  affixRanges(): Record<string, AffixRange>;
  /** Affix flavor names/tiers per stat (overlaid onto the shared AFFIX_NAMES; shipped to client). */
  affixNames(): Record<string, AffixName>;
  /** The passive skill-tree nodes (overlaid onto the shared SKILL_TREE; shipped to client). */
  skillTree(): SkillNode[];
  /** The hireling (mercenary) roster (overlaid onto the shared HIRELING_TEMPLATES; server-only). */
  hirelingTemplates(): HirelingTemplate[];
}

/** One on-hit status effect an ability carries (the runtime view of an ability_status_effects row). */
export interface AbilityStatusEffect {
  effect: StatusEffectKind;
  ms: number;
  magnitude: number;
}

/** A self-buff granted on cast (runtime view of an ability_cast_buffs row). */
export interface CastBuff {
  buff: StatusId;
  ms: number;
  magnitude: number;
}

/** A shrine blessing (runtime view of a shrine_buffs row). */
export interface ShrineBuff {
  buff: StatusId;
  ms: number;
  magnitude: number;
  label: string;
}

interface LootGroup {
  always: DropRow<string>[];
  main: DropRow<string>[];
  rare?: { chance: number; table: DropRow<string>[] };
  gear?: { chance: number; items: string[] };
}

/**
 * Linear world scale applied at CONTENT LOAD: authored data (areas.ts, seed rows, decor, NPC
 * spots) stays in its compact, hand-tunable coordinate system, and the served world comes out
 * WORLD_SCALE× as long per side — zones become real expeditions, with landmarks, chests, and
 * shrines worth walking to. Everything coordinate-bearing scales through this one boundary
 * (dimensions, spawns, portals, NPCs, decor), so the sim, client, minimap, and collision all
 * agree without touching the authored sources.
 */
const WORLD_SCALE = config.world.scale;
/** Monster roster multiplier: the ground grows 25×, the packs grow 10× — still a sparser
 *  frontier than the old per-screen density, but the hunt is never far. */
const MOB_COUNT_SCALE = config.world.mobCountScale;
/** Portal TRIGGER spans scale less than the world (a generous pad, not a wall of light);
 *  their centers scale fully so they stay where the map says they are. */
const PORTAL_SPAN_SCALE = config.world.portalSpanScale;
/** Terrain footprint size multiplier — dramatic landmark, not a screen-filling ×WORLD_SCALE wall. */
const TERRAIN_SIZE_SCALE = config.world.terrainSizeScale;
/**
 * Footprint decor whose SIZE is decoupled from WORLD_SCALE so it doesn't become a giant — only the
 * position rides the world scale. `house` keeps canonical 1× size; terrain (cliffs/massifs/boulders)
 * uses TERRAIN_SIZE_SCALE. Everything else (e.g. the town palisade) scales fully. The value is the
 * size multiplier for that kind's footprint half-extents.
 */
const SIZE_SCALED_KINDS = new Map<string, number>([
  ['house', 1],
  ['cliff', TERRAIN_SIZE_SCALE],
  ['ridge', TERRAIN_SIZE_SCALE],
  ['barrier', TERRAIN_SIZE_SCALE],
  ['wall', TERRAIN_SIZE_SCALE],
  ['mountain', TERRAIN_SIZE_SCALE],
  ['boulder', TERRAIN_SIZE_SCALE],
  ['peak', TERRAIN_SIZE_SCALE],
]);

export function loadContent(db: GameDatabase): Content {
  // Per-area environment themes (the data-driven look) — DEFAULT_THEME fills any area without a row.
  const themes = new Map<string, AreaTheme>();
  for (const r of db.prepare('SELECT * FROM area_theme').all() as AreaThemeRow[]) {
    themes.set(r.area_id, rowToTheme(r));
  }

  // Static set-dressing props per area (tents, palisade, bonfire…). Optional columns map to optional
  // fields only when non-null, so exactOptionalPropertyTypes stays happy.
  //
  // Object SIZE vs world SCALE: the world is inflated ×WORLD_SCALE so zones are real expeditions, but
  // a building should not become a ×WORLD_SCALE GIANT — it should sit where the big world places it
  // yet render at its canonical (retail) size. So for CANONICAL_SIZE_KINDS we scale the footprint's
  // CENTER by the world scale but keep its authored half-extents (1× size). Everything else (terrain
  // cliffs/massifs, the town palisade) keeps scaling fully, so terrain stays dramatic and walls still
  // ring the world. Positions, spacing, ranges, and mob density are untouched.
  const decor = new Map<string, DecorProp[]>();
  for (const r of db.prepare('SELECT * FROM decor').all() as DecorRow[]) {
    const prop: DecorProp = { kind: r.kind, x: r.x * WORLD_SCALE, y: r.y * WORLD_SCALE };
    const hasFoot = r.x2 !== null && r.y2 !== null;
    const sizeScale = SIZE_SCALED_KINDS.get(r.kind);
    if (hasFoot && sizeScale !== undefined) {
      // Position rides the world scale; footprint size uses the (smaller) per-kind size scale.
      const cx = ((r.x + r.x2!) / 2) * WORLD_SCALE;
      const cy = ((r.y + r.y2!) / 2) * WORLD_SCALE;
      const hw = (Math.abs(r.x2! - r.x) / 2) * sizeScale;
      const hh = (Math.abs(r.y2! - r.y) / 2) * sizeScale;
      prop.x = cx - hw;
      prop.y = cy - hh;
      prop.x2 = cx + hw;
      prop.y2 = cy + hh;
    } else {
      if (r.x2 !== null) prop.x2 = r.x2 * WORLD_SCALE;
      if (r.y2 !== null) prop.y2 = r.y2 * WORLD_SCALE;
    }
    if (r.color !== null) prop.color = r.color;
    if (r.scale !== null) prop.scale = r.scale;
    const list = decor.get(r.area_id) ?? [];
    list.push(prop);
    decor.set(r.area_id, list);
  }

  const areas = new Map<string, AreaDef>();
  for (const a of db.prepare('SELECT * FROM areas').all() as AreaRow[]) {
    const portals = (
      db.prepare('SELECT * FROM portals WHERE area_id = ?').all(a.id) as PortalRow[]
    ).map((p) => {
      // Scale the rect's CENTER by the world scale but its span by the (smaller) portal span
      // scale — the pad stays findable without becoming a region-sized wall of light.
      const cx = (p.rect_x + p.rect_w / 2) * WORLD_SCALE;
      const cy = (p.rect_y + p.rect_h / 2) * WORLD_SCALE;
      const w = p.rect_w * PORTAL_SPAN_SCALE;
      const h = p.rect_h * PORTAL_SPAN_SCALE;
      return {
        rect: { x: cx - w / 2, y: cy - h / 2, w, h },
        toArea: p.to_area,
        toSpawn: { x: p.to_spawn_x * WORLD_SCALE, y: p.to_spawn_y * WORLD_SCALE },
        label: p.label,
      };
    });
    areas.set(a.id, {
      id: a.id,
      name: a.name,
      width: a.width * WORLD_SCALE,
      height: a.height * WORLD_SCALE,
      spawn: { x: a.spawn_x * WORLD_SCALE, y: a.spawn_y * WORLD_SCALE },
      playerCap: a.player_cap,
      portals,
      theme: themes.get(a.id) ?? DEFAULT_THEME,
      decor: decor.get(a.id) ?? [],
    });
  }

  const abilities = new Map<string, Ability>();
  const order: AbilityId[] = [];
  for (const r of db.prepare('SELECT * FROM abilities ORDER BY sort_order').all() as AbilityRow[]) {
    const ability: Ability = {
      id: r.id as AbilityId,
      name: r.name,
      key: r.key,
      kind: r.kind as Ability['kind'],
      damage: r.damage,
      range: r.range,
      cooldownMs: r.cooldown_ms,
      manaCost: r.mana_cost,
      color: r.color,
      radius: r.radius,
      element: (r.element ?? 'physical') as DamageElement,
    };
    if (r.melee_half_angle !== null) ability.meleeHalfAngle = r.melee_half_angle;
    if (r.projectile_speed !== null) ability.projectileSpeed = r.projectile_speed;
    if (r.projectile_ttl_ms !== null) ability.projectileTtlMs = r.projectile_ttl_ms;
    if (r.behaviors_json) {
      try {
        ability.behaviors = JSON.parse(r.behaviors_json) as BehaviorSpec[];
      } catch {
        // malformed JSON → no behaviors (plain projectile); never crash content load
      }
    }
    abilities.set(r.id, ability);
    order.push(r.id as AbilityId);
  }

  const items = new Map<string, ItemDef>();
  for (const r of db.prepare('SELECT * FROM items').all() as ItemRow[]) {
    items.set(r.id, {
      id: r.id,
      name: r.name,
      kind: r.kind,
      slot: r.slot as ItemDef['slot'],
      power: r.power,
      hp: r.hp,
      color: r.color,
      sellValue: r.sell_value,
      teaches: r.teaches,
      flags: r.flags,
      baseId: r.base_id,
      affixes: r.affixes !== null ? (JSON.parse(r.affixes) as Affix[]) : null,
      flavor: r.flavor,
    });
  }

  // UNIQUE (legendary) catalogue — now merged into the `items` table: a legendary is any item row
  // with the LEGENDARY flag, carrying its `baseId` (the base it is built on) + fixed `affixes`.
  const uniqueDefs: UniqueDef[] = [];
  const uniquesById = new Map<string, UniqueDef>();
  for (const it of items.values()) {
    if (!hasItemFlag(it.flags, ItemFlags.LEGENDARY) || it.baseId === null || it.affixes === null) {
      continue;
    }
    const def: UniqueDef = {
      id: it.id,
      name: it.name,
      baseId: it.baseId,
      affixes: it.affixes,
      ...(it.flavor !== null ? { flavor: it.flavor } : {}),
    };
    uniqueDefs.push(def);
    uniquesById.set(def.id, def);
  }
  const uniquesForSlot = (slot: string): UniqueDef[] =>
    uniqueDefs.filter((d) => items.get(d.baseId)?.slot === slot);

  // Procedural dungeon population — DB-driven balance content (pool stored as a JSON array).
  const dungeons = new Map<string, DungeonDef>();
  for (const r of db.prepare('SELECT * FROM dungeons').all() as DungeonRow[]) {
    dungeons.set(r.area_id, {
      pool: JSON.parse(r.pool) as string[],
      boss: r.boss,
      ...(r.mini_boss !== null ? { miniBoss: r.mini_boss } : {}),
      miniBossChance: r.mini_boss_chance,
      eliteChance: r.elite_chance,
      minMobs: r.min_mobs,
      maxMobs: r.max_mobs,
    });
  }

  const stock = new Map<string, StockEntry[]>();
  for (const r of db
    .prepare('SELECT * FROM vendor_stock ORDER BY sort_order')
    .all() as VendorStockRow[]) {
    const key = `${r.area_id}/${r.npc_name}`;
    const list = stock.get(key) ?? [];
    list.push({ itemId: r.item_id, price: r.price });
    stock.set(key, list);
  }

  const mobTemplates = new Map<string, MobTemplate>();
  for (const r of db.prepare('SELECT * FROM mob_templates').all() as MobRow[]) {
    const template: MobTemplate = {
      id: r.id,
      name: r.name,
      hp: r.hp,
      level: r.level,
      hue: r.hue,
      speed: r.speed,
      aggroRange: r.aggro_range,
      attackRange: r.attack_range,
      damage: r.damage,
      attackCooldownMs: r.attack_cooldown_ms,
      behavior: r.behavior === 'ranged' ? 'ranged' : r.behavior === 'charger' ? 'charger' : 'melee',
      telegraphMs: r.telegraph_ms,
    };
    if (r.projectile_speed !== null) template.projectileSpeed = r.projectile_speed;
    if (r.kite_range !== null) template.kiteRange = r.kite_range;
    if (r.slam_radius !== null) template.slamRadius = r.slam_radius;
    if (r.dash_speed !== null) template.dashSpeed = r.dash_speed;
    if (r.spell !== null) template.spell = r.spell as AbilityId;
    if (r.support !== null) template.support = r.support as AbilityId;
    if (r.traits !== null) template.traits = JSON.parse(r.traits) as MobTrait[];
    mobTemplates.set(r.id, template);
  }

  const areaMobs = new Map<string, { templateId: string; count: number }[]>();
  for (const r of db.prepare('SELECT * FROM area_mobs').all() as AreaMobRow[]) {
    const list = areaMobs.get(r.area_id) ?? [];
    list.push({ templateId: r.template_id, count: r.count * MOB_COUNT_SCALE });
    areaMobs.set(r.area_id, list);
  }

  const npcs = new Map<string, NpcDef[]>();
  for (const r of db.prepare('SELECT * FROM npcs').all() as NpcRow[]) {
    const list = npcs.get(r.area_id) ?? [];
    list.push({
      name: r.name,
      x: r.x * WORLD_SCALE,
      y: r.y * WORLD_SCALE,
      hue: r.hue,
      kind: r.kind,
      // Fall back to the kind-implied flag if the column has not been populated/overridden.
      flags: r.npc_flags || (KIND_TO_NPC_FLAG[r.kind] ?? 0),
    });
    npcs.set(r.area_id, list);
  }

  // Individual creature spawns (uid-level placements), grouped by area. Positions are authored in
  // the compact coordinate space, so scale them like NPCs/decor.
  const creatureSpawns = new Map<string, CreatureSpawn[]>();
  for (const r of db.prepare('SELECT * FROM creature_spawns').all() as CreatureSpawnRow[]) {
    const list = creatureSpawns.get(r.area_id) ?? [];
    list.push({
      uid: r.uid,
      templateId: r.template_id,
      x: r.x * WORLD_SCALE,
      y: r.y * WORLD_SCALE,
      flags: r.flags,
    });
    creatureSpawns.set(r.area_id, list);
  }

  const quests = (db.prepare('SELECT * FROM quests').all() as QuestRow[]).map((q) => ({
    id: q.id,
    name: q.name,
    description: q.description,
    targetMob: q.target_mob,
    targetCount: q.target_count,
    rewardGold: q.reward_gold,
    rewardXp: q.reward_xp,
    rewardItem: q.reward_item ?? null,
    turnInItem: q.turn_in_item ?? null,
    turnInCount: q.turn_in_count ?? 0,
    exploreArea: q.explore_area ?? null,
    requires: q.requires ?? null,
    flags: q.flags ?? 0,
  }));

  const loot = new Map<string, LootGroup>();
  for (const r of db.prepare('SELECT * FROM loot_entry').all() as LootRow[]) {
    let g = loot.get(r.mob_template_id);
    if (!g) {
      g = { always: [], main: [] };
      loot.set(r.mob_template_id, g);
    }
    const row: DropRow<string> = {
      value: r.item_id,
      weight: r.weight,
      min: r.min_qty,
      max: r.max_qty,
    };
    if (r.is_nothing) row.nothing = true;
    if (r.grp === 'always') g.always.push(row);
    else if (r.grp === 'main') g.main.push(row);
    else if (r.grp === 'rare') {
      if (!g.rare) g.rare = { chance: r.chance, table: [] };
      g.rare.table.push(row);
    } else if (r.grp === 'gear') {
      if (!g.gear) g.gear = { chance: r.chance, items: [] };
      g.gear.items.push(r.item_id);
    }
  }

  // SQL sprite color overrides: multiply-tints applied at render time so one image source spawns
  // many variations (and the look can be pushed dark/gritty) without editing the files.
  const tints = new Map<string, string>();
  for (const r of db.prepare('SELECT * FROM sprite_tints').all() as {
    target: string;
    tint: string;
  }[]) {
    tints.set(r.target, r.tint);
  }

  // Weather gameplay multipliers (DB is the runtime authority; the pure weatherModifiers() function
  // is the seed source and the per-kind fallback if a row is ever missing).
  const weatherMods = new Map<string, WeatherModifiers>();
  for (const r of db.prepare('SELECT * FROM weather_modifiers').all() as WeatherModRow[]) {
    weatherMods.set(r.weather, { moveScale: r.move_scale, aggroScale: r.aggro_scale });
  }

  // Elite ("champion") modifier roster, ordered so the spawn-time pick stays deterministic. Empty
  // table falls back to the code defaults.
  const eliteMods = (
    db.prepare('SELECT * FROM elite_modifiers ORDER BY sort_order').all() as EliteModRow[]
  ).map((r) => ({ id: r.id, name: r.name, hp: r.hp_mult, dmg: r.damage_mult, spd: r.speed_mult }));

  // Per-ability on-hit status effects (slow/burn/weaken). An ability with no row carries none.
  const statusEffects = new Map<string, AbilityStatusEffect[]>();
  for (const r of db
    .prepare('SELECT * FROM ability_status_effects ORDER BY ability_id, effect')
    .all() as AbilityStatusRow[]) {
    const list = statusEffects.get(r.ability_id) ?? [];
    list.push({ effect: r.effect, ms: r.duration_ms, magnitude: r.magnitude });
    statusEffects.set(r.ability_id, list);
  }

  // Per-ability self-buff granted on cast (one per ability).
  const castBuffs = new Map<string, CastBuff>();
  for (const r of db.prepare('SELECT * FROM ability_cast_buffs').all() as CastBuffRow[]) {
    castBuffs.set(r.ability_id, { buff: r.buff, ms: r.duration_ms, magnitude: r.magnitude });
  }

  // Shrine blessing pool, ordered so the random pick stays deterministic.
  const shrineBuffs = (
    db.prepare('SELECT * FROM shrine_buffs ORDER BY sort_order').all() as ShrineBuffRow[]
  ).map((r) => ({ buff: r.buff, ms: r.duration_ms, magnitude: r.magnitude, label: r.label }));

  // Item rarity tiers (drop weight, stat scaling, color). Overlaid onto the shared RARITY table.
  const rarityTiers: Partial<Record<Rarity, RarityDef>> = {};
  for (const r of db
    .prepare('SELECT * FROM rarity_tiers ORDER BY sort_order')
    .all() as RarityRow[]) {
    rarityTiers[r.rarity] = {
      name: r.name,
      weight: r.weight,
      statMult: r.stat_mult,
      variance: r.variance,
      color: r.color,
    };
  }

  // Gem catalog (socketable bonuses). Overlaid onto the shared GEMS table.
  const gems = (db.prepare('SELECT * FROM gems').all() as GemRow[]).map((r) => {
    const def: GemDef = {
      id: r.id,
      name: r.name,
      color: r.color,
      stat: r.stat as GemDef['stat'],
      value: r.value,
      tier: r.tier,
    };
    if (r.mult !== 1) def.mult = r.mult;
    if (r.grants_homing !== 0) def.grantsHoming = true;
    return def;
  });

  // Rune pool + runeword recipes (server-side runeword detection). Recipe sequence is the
  // comma-joined rune list; bonuses are reassembled from runeword_bonuses in sort order.
  const runes = (db.prepare('SELECT * FROM runes').all() as RuneRow[]).map((r) => ({
    id: r.id,
    name: r.name,
  }));
  const bonusStmt = db.prepare(
    'SELECT stat, value FROM runeword_bonuses WHERE runeword_id = ? ORDER BY sort_order',
  );
  const runewords = (db.prepare('SELECT * FROM runewords').all() as RunewordRow[]).map((r) => {
    const bonuses = (bonusStmt.all(r.id) as { stat: string; value: number }[]).map((b) => ({
      stat: b.stat as Affix['stat'],
      value: b.value,
    }));
    const def: RunewordDef = {
      id: r.id,
      name: r.name,
      runes: r.runes.split(',').filter((s) => s.length > 0),
      bonuses,
    };
    if (r.flavor !== null) def.flavor = r.flavor;
    return def;
  });

  // Item sets: membership (comma-separated base ids) + threshold bonuses, server-side stat folding.
  const setBonusStmt = db.prepare(
    'SELECT required_pieces, stat, value FROM item_set_bonuses WHERE set_id = ? ORDER BY sort_order',
  );
  const itemSets = (db.prepare('SELECT * FROM item_sets').all() as ItemSetRow[]).map((r) => {
    const bonuses = (
      setBonusStmt.all(r.id) as { required_pieces: number; stat: string; value: number }[]
    ).map((b) => ({
      requiredPieces: b.required_pieces,
      affix: { stat: b.stat as Affix['stat'], value: b.value },
    }));
    const def: ItemSetDef = {
      id: r.id,
      name: r.name,
      pieces: r.pieces.split(',').filter((s) => s.length > 0),
      bonuses,
    };
    if (r.flavor !== null) def.flavor = r.flavor;
    return def;
  });

  // Scripted boss phases: rebuild Record<bossId, BossScript> from the phase + step rows. Each step
  // row only fills the columns its `kind` uses; rowToStep validates that and DROPS malformed rows
  // (a bad SQL edit degrades a fight gracefully — it never crashes the boss tick).
  const stepStmt = db.prepare(
    'SELECT * FROM mob_script_steps WHERE phase_id = ? ORDER BY sort_order',
  );
  const bossScripts: Record<string, BossScript> = {};
  for (const p of db
    .prepare('SELECT * FROM mob_script_phases ORDER BY template_id, sort_order')
    .all() as MobScriptPhaseRow[]) {
    const loop = (stepStmt.all(p.id) as MobScriptStepRow[])
      .map(rowToBossStep)
      .filter((s): s is BossStep => s !== null);
    (bossScripts[p.template_id] ??= { phases: [] }).phases.push({ hpBelow: p.hp_below, loop });
  }

  // Item procs, keyed by source base-item id. A stable per-source index gives each proc an id for
  // ICD bookkeeping. Malformed rows (a status proc with no ability, a damage proc with no positive
  // amount) are dropped so a bad SQL edit can't crash the hit path.
  const itemProcs = new Map<string, ProcDef[]>();
  for (const r of db
    .prepare('SELECT * FROM item_procs ORDER BY source_id, sort_order')
    .all() as ItemProcRow[]) {
    let effect: ProcEffect | null = null;
    if (r.effect === 'status' && r.ability) effect = { kind: 'status', ability: r.ability };
    else if (r.effect === 'damage' && r.amount !== null && r.amount > 0)
      effect = { kind: 'damage', amount: r.amount };
    if (!effect) continue;
    const list = itemProcs.get(r.source_id) ?? [];
    list.push({
      id: `${r.source_id}#${list.length}`,
      sourceId: r.source_id,
      trigger: r.trigger === 'onCrit' ? 'onCrit' : 'onHit',
      chance: r.chance,
      icdMs: r.icd_ms,
      effect,
    });
    itemProcs.set(r.source_id, list);
  }

  // Mob resistances by template id (sparse — only non-zero resists get a row). Looked up at the
  // damage site to reduce typed (elemental) hits; a missing element means no resistance.
  const mobResists = new Map<string, ResistMap>();
  for (const r of db.prepare('SELECT * FROM mob_resists').all() as MobResistRow[]) {
    const m = mobResists.get(r.template_id) ?? {};
    m[r.element as DamageElement] = r.value;
    mobResists.set(r.template_id, m);
  }

  // Timed game events: recurrence schedules. snake_case → camelCase; nullable optional fields dropped
  // so they stay truly absent (exactOptionalPropertyTypes). The host runs the pure schedule math.
  const gameEvents = (db.prepare('SELECT * FROM game_events').all() as GameEventRow[]).map((r) => {
    const ev: GameEventDef = {
      id: r.id,
      name: r.name,
      periodMin: r.period_min,
      lengthMin: r.length_min,
    };
    if (r.xp_bonus !== null) ev.xpBonus = r.xp_bonus;
    if (r.gold_bonus !== null && r.gold_bonus !== undefined) ev.goldBonus = r.gold_bonus;
    if (r.announce !== null) ev.announce = r.announce;
    return ev;
  });

  // Crafting recipes: header + I/O rows rebuilt into CraftRecipe shape (inputs/outputs in sort order).
  const ioStmt = db.prepare(
    'SELECT role, item_id, qty FROM crafting_recipe_io WHERE recipe_id = ? ORDER BY role, sort_order',
  );
  const craftingRecipes = (
    db.prepare('SELECT id, name FROM crafting_recipes').all() as { id: string; name: string }[]
  ).map((h) => {
    const io = ioStmt.all(h.id) as { role: string; item_id: string; qty: number }[];
    return {
      id: h.id,
      name: h.name,
      inputs: io.filter((x) => x.role === 'input').map((x) => ({ itemId: x.item_id, qty: x.qty })),
      outputs: io
        .filter((x) => x.role === 'output')
        .map((x) => ({ itemId: x.item_id, qty: x.qty })),
    };
  });

  // Rift modifiers: the mutator pool. snake_case → camelCase; all fields present (DB has defaults).
  const riftModifiers = (db.prepare('SELECT * FROM rift_modifiers').all() as RiftModifierRow[]).map(
    (r) => ({
      id: r.id,
      name: r.name,
      desc: r.descr,
      minTier: r.min_tier,
      mobDamageMult: r.mob_damage_mult,
      mobHpMult: r.mob_hp_mult,
      mobSpeedMult: r.mob_speed_mult,
      lootQuantityBonus: r.loot_quantity_bonus,
      xpBonus: r.xp_bonus,
    }),
  );

  // Affix roll ranges (server-only) + flavor names/tiers (client-coupled). A NULL up_to is Infinity.
  const affixRanges: Record<string, AffixRange> = {};
  for (const r of db.prepare('SELECT * FROM affix_ranges').all() as AffixRangeRow[]) {
    affixRanges[r.stat] = { min: r.min_value, max: r.max_value };
  }
  const tierStmt = db.prepare(
    'SELECT up_to, word FROM affix_name_tiers WHERE stat = ? ORDER BY sort_order',
  );
  const affixNames: Record<string, AffixName> = {};
  for (const r of db.prepare('SELECT * FROM affix_names').all() as AffixNameRow[]) {
    const tiers = (tierStmt.all(r.stat) as { up_to: number | null; word: string }[]).map((t) => ({
      upTo: t.up_to === null ? Infinity : t.up_to,
      word: t.word,
    }));
    affixNames[r.stat] = { kind: r.kind === 'suffix' ? 'suffix' : 'prefix', tiers };
  }

  // Passive skill tree: nodes + ordered prereqs + per-key effects, rebuilt into SkillNode shape.
  const reqStmt = db.prepare(
    'SELECT requires_id FROM skill_node_requires WHERE node_id = ? ORDER BY sort_order',
  );
  const effStmt = db.prepare('SELECT effect, value FROM skill_node_effects WHERE node_id = ?');
  const skillTree = (db.prepare('SELECT * FROM skill_nodes').all() as SkillNodeRow[]).map((r) => {
    const requires = (reqStmt.all(r.id) as { requires_id: string }[]).map((x) => x.requires_id);
    const effects: Partial<SkillEffects> = {};
    for (const e of effStmt.all(r.id) as { effect: string; value: number }[]) {
      effects[e.effect as keyof SkillEffects] = e.value;
    }
    return { id: r.id, name: r.name, desc: r.desc, tier: r.tier, requires, effects };
  });

  // Hireling (mercenary) roster. Overlaid onto the shared HIRELING_TEMPLATES (server-only AI).
  const hirelingTemplates = (
    db.prepare('SELECT * FROM hireling_templates').all() as HirelingRow[]
  ).map((r) => {
    const t: HirelingTemplate = {
      type: r.type,
      name: r.name,
      behavior: r.behavior === 'ranged' ? 'ranged' : 'melee',
      speed: r.speed,
      attackRange: r.attack_range,
      attackCooldownMs: r.attack_cooldown_ms,
    };
    if (r.kite_range !== null) t.kiteRange = r.kite_range;
    return t;
  });

  return {
    area: (id) => areas.get(id),
    areas: () => [...areas.values()],
    ability: (id) => abilities.get(id),
    abilityOrder: () => [...order],
    abilityList: () => order.map((id) => abilities.get(id)!),
    item: (id) => items.get(id),
    items: () => [...items.values()],
    sellValue: (id) => items.get(id)?.sellValue ?? 0,
    uniques: () => [...uniqueDefs],
    unique: (id) => uniquesById.get(id),
    uniquesForSlot,
    rollRandomUnique: (uid, rng = Math.random) => {
      const def = pickUnique(uniqueDefs, rng);
      if (!def) return undefined;
      const base = items.get(def.baseId);
      return rollUnique(uid, def, { power: base?.power ?? 0, hp: base?.hp ?? 0 }, rng);
    },
    mobTemplate: (id) => mobTemplates.get(id),
    dungeon: (areaId) => dungeons.get(areaId),
    areaMobs: (areaId) => areaMobs.get(areaId) ?? [],
    creatureSpawns: (areaId) => creatureSpawns.get(areaId) ?? [],
    npcs: (areaId) => npcs.get(areaId) ?? [],
    quests: () => quests,
    quest: (id) => quests.find((q) => q.id === id),
    vendorStock: (areaId, npcName) => stock.get(`${areaId}/${npcName}`) ?? [],
    rollLoot: (mobId, rng = Math.random) => {
      const g = loot.get(mobId);
      if (!g) return [];
      const table: DropTable<string> = { main: g.main };
      if (g.always.length) table.always = g.always;
      if (g.rare) table.rare = g.rare;
      const out = rollDropTable(table, rng).map((d) => ({ item: d.value, qty: d.qty }));
      if (g.gear && rng() < g.gear.chance) {
        const item = g.gear.items[Math.floor(rng() * g.gear.items.length)];
        if (item) out.push({ item, qty: 1 });
      }
      return out;
    },
    spriteTint: (target) => tints.get(target),
    spriteTints: () => Object.fromEntries(tints),
    weatherMods: (weather) => weatherMods.get(weather) ?? weatherModifiers(weather),
    eliteModifiers: () => (eliteMods.length ? eliteMods : DEFAULT_ELITE_MODIFIERS),
    abilityStatusEffects: (abilityId) => statusEffects.get(abilityId) ?? [],
    castBuff: (abilityId) => castBuffs.get(abilityId),
    shrineBuffs: () => shrineBuffs,
    isDungeon: (areaId) => dungeons.has(areaId),
    dungeonAreaIds: () => [...dungeons.keys()],
    rarityTiers: () => rarityTiers,
    gems: () => gems,
    runes: () => runes,
    runewords: () => runewords,
    itemSets: () => itemSets,
    bossScripts: () => bossScripts,
    itemProcs: (sourceId) => itemProcs.get(sourceId) ?? [],
    mobResists: (templateId) => mobResists.get(templateId) ?? {},
    gameEvents: () => gameEvents,
    riftModifiers: () => riftModifiers,
    craftingRecipes: () => craftingRecipes,
    affixRanges: () => affixRanges,
    affixNames: () => affixNames,
    skillTree: () => skillTree,
    hirelingTemplates: () => hirelingTemplates,
  };
}

// --- lazy singleton -------------------------------------------------------------------
let activeDb: GameDatabase | undefined;
let activeContent: Content | undefined;

/** Initialize (or replace) the content database. The server calls this with a file path. */
export function initGameDb(file?: string): Content {
  activeDb = openDatabase(file ?? ':memory:');
  applyConfigOverrides(activeDb); // overlay the game_config tuning rows onto the code defaults
  activeContent = loadContent(activeDb);
  applyRarityOverrides(activeContent.rarityTiers()); // overlay DB rarity tuning onto shared RARITY
  applyGemOverrides(activeContent.gems()); // overlay the DB gem catalog onto shared GEMS
  applyRuneOverrides(activeContent.runes()); // overlay rune pool onto shared RUNES
  applyRunewordOverrides(activeContent.runewords()); // overlay runeword recipes onto shared RUNEWORDS
  applyItemSetOverrides(activeContent.itemSets()); // overlay item sets onto shared ITEM_SETS
  applyBossScriptOverrides(activeContent.bossScripts()); // overlay boss scripts onto live BOSS_SCRIPTS
  applyAffixRangeOverrides(activeContent.affixRanges()); // overlay affix roll ranges
  applyAffixNameOverrides(activeContent.affixNames()); // overlay affix flavor names
  applySkillTreeOverrides(activeContent.skillTree()); // overlay the passive skill tree
  applyHirelingOverrides(activeContent.hirelingTemplates()); // overlay the hireling roster
  return activeContent;
}

export function getContent(): Content {
  if (!activeContent) initGameDb(process.env.GAME_DB);
  return activeContent!;
}

/**
 * Re-read all content from the live database and swap it in. Called after a runtime edit (e.g. the
 * /settheme command or a direct SQL change) so the next content broadcast reflects the new data.
 */
export function reloadContent(): Content {
  if (!activeDb) return getContent();
  applyConfigOverrides(activeDb); // re-overlay tuning so a direct game_config SQL edit takes effect
  activeContent = loadContent(activeDb);
  applyRarityOverrides(activeContent.rarityTiers()); // re-overlay rarity tuning on reload
  applyGemOverrides(activeContent.gems()); // re-overlay gem catalog on reload
  applyRuneOverrides(activeContent.runes()); // re-overlay rune pool on reload
  applyRunewordOverrides(activeContent.runewords()); // re-overlay runeword recipes on reload
  applyItemSetOverrides(activeContent.itemSets()); // re-overlay item sets on reload
  applyBossScriptOverrides(activeContent.bossScripts()); // re-overlay boss scripts on reload
  applyAffixRangeOverrides(activeContent.affixRanges()); // re-overlay affix roll ranges on reload
  applyAffixNameOverrides(activeContent.affixNames()); // re-overlay affix flavor names on reload
  applySkillTreeOverrides(activeContent.skillTree()); // re-overlay the passive skill tree on reload
  applyHirelingOverrides(activeContent.hirelingTemplates()); // re-overlay the hireling roster on reload
  return activeContent;
}

/** The live database handle (for dynamic data like accounts). Initializes lazily if needed. */
export function getDb(): GameDatabase {
  if (!activeDb) initGameDb(process.env.GAME_DB);
  return activeDb!;
}

/** Map a raw area_theme row (snake_case columns, 0/1 booleans) to the wire AreaTheme. */
function rowToTheme(r: AreaThemeRow): AreaTheme {
  return {
    groundBase: r.ground_base,
    groundSpeck: r.ground_speck,
    prop: r.prop as AreaTheme['prop'],
    propDensity: r.prop_density,
    atmoColor: r.atmo_color,
    atmoAlpha: r.atmo_alpha,
    outdoor: r.outdoor !== 0,
    particleColor: r.particle_color,
    particleCount: r.particle_count,
    particleRise: r.particle_rise,
    particleFlicker: r.particle_flicker !== 0,
    weather: r.weather as AreaTheme['weather'],
    weatherIntensity: r.weather_intensity,
    fogColor: r.fog_color,
    lightAmbient: r.light_ambient,
    gradeSaturation: r.grade_saturation,
    gradeBrightness: r.grade_brightness,
    gradeContrast: r.grade_contrast,
    spriteTint: r.sprite_tint,
  };
}

// --- row types ------------------------------------------------------------------------
interface AreaRow {
  id: string;
  name: string;
  width: number;
  height: number;
  spawn_x: number;
  spawn_y: number;
  player_cap: number;
}
interface AreaThemeRow {
  area_id: string;
  ground_base: string;
  ground_speck: string;
  prop: string;
  prop_density: number;
  atmo_color: string;
  atmo_alpha: number;
  outdoor: number;
  particle_color: string;
  particle_count: number;
  particle_rise: number;
  particle_flicker: number;
  weather: string;
  weather_intensity: number;
  fog_color: string;
  light_ambient: number;
  grade_saturation: number;
  grade_brightness: number;
  grade_contrast: number;
  sprite_tint: string;
}
interface DecorRow {
  area_id: string;
  kind: string;
  x: number;
  y: number;
  x2: number | null;
  y2: number | null;
  color: string | null;
  scale: number | null;
}
interface PortalRow {
  rect_x: number;
  rect_y: number;
  rect_w: number;
  rect_h: number;
  to_area: string;
  to_spawn_x: number;
  to_spawn_y: number;
  label: string;
}
interface AbilityRow {
  id: string;
  name: string;
  key: string;
  kind: string;
  damage: number;
  range: number;
  cooldown_ms: number;
  mana_cost: number;
  color: string;
  melee_half_angle: number | null;
  projectile_speed: number | null;
  projectile_ttl_ms: number | null;
  behaviors_json: string | null;
  radius: number;
  element: string | null;
}
interface ItemRow {
  id: string;
  name: string;
  kind: string;
  slot: string | null;
  power: number | null;
  hp: number | null;
  color: string | null;
  sell_value: number;
  teaches: string | null;
  flags: number;
  base_id: string | null;
  affixes: string | null;
  flavor: string | null;
}
interface DungeonRow {
  area_id: string;
  pool: string;
  boss: string;
  mini_boss: string | null;
  mini_boss_chance: number;
  elite_chance: number;
  min_mobs: number;
  max_mobs: number;
}
interface VendorStockRow {
  area_id: string;
  npc_name: string;
  item_id: string;
  price: number;
  sort_order: number;
}
interface MobRow {
  id: string;
  name: string;
  hp: number;
  level: number;
  hue: number;
  speed: number;
  aggro_range: number;
  attack_range: number;
  damage: number;
  attack_cooldown_ms: number;
  behavior: string;
  telegraph_ms: number;
  projectile_speed: number | null;
  kite_range: number | null;
  slam_radius: number | null;
  dash_speed: number | null;
  spell: string | null;
  support: string | null;
  traits: string | null;
}
interface AreaMobRow {
  area_id: string;
  template_id: string;
  count: number;
}
interface CreatureSpawnRow {
  uid: number;
  area_id: string;
  template_id: string;
  x: number;
  y: number;
  flags: number;
}
interface NpcRow {
  area_id: string;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
  npc_flags: number;
}
interface QuestRow {
  id: string;
  name: string;
  description: string;
  target_mob: string | null;
  target_count: number;
  reward_gold: number;
  reward_xp: number;
  reward_item: string | null;
  turn_in_item: string | null;
  turn_in_count: number;
  explore_area: string | null;
  requires: string | null;
  flags: number;
}
interface LootRow {
  mob_template_id: string;
  grp: string;
  item_id: string;
  weight: number;
  min_qty: number;
  max_qty: number;
  is_nothing: number;
  chance: number;
}
interface WeatherModRow {
  weather: WeatherKind;
  move_scale: number;
  aggro_scale: number;
}
interface EliteModRow {
  id: string;
  name: string;
  hp_mult: number;
  damage_mult: number;
  speed_mult: number;
  sort_order: number;
}
interface AbilityStatusRow {
  ability_id: string;
  effect: StatusEffectKind;
  duration_ms: number;
  magnitude: number;
}
interface CastBuffRow {
  ability_id: string;
  buff: StatusId;
  duration_ms: number;
  magnitude: number;
}
interface ShrineBuffRow {
  id: string;
  buff: StatusId;
  duration_ms: number;
  magnitude: number;
  label: string;
  sort_order: number;
}
interface RarityRow {
  rarity: Rarity;
  name: string;
  weight: number;
  stat_mult: number;
  variance: number;
  color: string;
  sort_order: number;
}
interface GemRow {
  id: string;
  name: string;
  color: string;
  stat: string;
  value: number;
  tier: number;
  mult: number;
  grants_homing: number;
}
interface RuneRow {
  id: string;
  name: string;
}
interface RunewordRow {
  id: string;
  name: string;
  runes: string;
  flavor: string | null;
}
interface MobResistRow {
  template_id: string;
  element: string;
  value: number;
}
interface GameEventRow {
  id: string;
  name: string;
  period_min: number;
  length_min: number;
  xp_bonus: number | null;
  gold_bonus: number | null;
  announce: string | null;
}
interface RiftModifierRow {
  id: string;
  name: string;
  descr: string;
  min_tier: number;
  mob_damage_mult: number;
  mob_hp_mult: number;
  mob_speed_mult: number;
  loot_quantity_bonus: number;
  xp_bonus: number;
}
interface ItemProcRow {
  source_id: string;
  trigger: string;
  chance: number;
  icd_ms: number;
  effect: string;
  amount: number | null;
  ability: string | null;
}
interface ItemSetRow {
  id: string;
  name: string;
  pieces: string;
  flavor: string | null;
}
interface MobScriptPhaseRow {
  id: number;
  template_id: string;
  hp_below: number;
  sort_order: number;
}
interface MobScriptStepRow {
  kind: string;
  x: number | null;
  y: number | null;
  speed_mult: number | null;
  ms: number | null;
  ability: string | null;
  summon_template: string | null;
  summon_count: number | null;
  summon_radius: number | null;
  text: string | null;
}

/**
 * Rebuild one {@link BossStep} from a DB row, or return null if the row is malformed (wrong `kind`
 * or a missing required column for that kind). Null rows are dropped on load so a bad SQL edit
 * degrades a fight rather than crashing the boss tick — the executor only ever sees valid steps.
 */
function rowToBossStep(r: MobScriptStepRow): BossStep | null {
  switch (r.kind) {
    case 'moveTo':
      if (r.x === null || r.y === null) return null;
      return r.speed_mult === null
        ? { kind: 'moveTo', x: r.x, y: r.y }
        : { kind: 'moveTo', x: r.x, y: r.y, speedMult: r.speed_mult };
    case 'wait':
      return r.ms === null ? null : { kind: 'wait', ms: r.ms };
    case 'brawl':
      return r.ms === null ? null : { kind: 'brawl', ms: r.ms };
    case 'cast':
      return r.ability === null ? null : { kind: 'cast', ability: r.ability as AbilityId };
    case 'summon':
      if (r.summon_template === null || r.summon_count === null || r.summon_radius === null) {
        return null;
      }
      return {
        kind: 'summon',
        templateId: r.summon_template,
        count: r.summon_count,
        radius: r.summon_radius,
      };
    case 'shout':
      return r.text === null ? null : { kind: 'shout', text: r.text };
    default:
      return null;
  }
}
interface AffixRangeRow {
  stat: string;
  min_value: number;
  max_value: number;
}
interface AffixNameRow {
  stat: string;
  kind: string;
}
interface SkillNodeRow {
  id: string;
  name: string;
  desc: string;
  tier: number;
}
interface HirelingRow {
  type: string;
  name: string;
  behavior: string;
  speed: number;
  attack_range: number;
  kite_range: number | null;
  attack_cooldown_ms: number;
}

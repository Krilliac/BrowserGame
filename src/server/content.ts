import { config, applyConfigOverrides } from './config.js';
import { openDatabase, type GameDatabase } from './db/database.js';
import { rollDropTable, type DropRow, type DropTable } from './drop-table.js';
import type { AreaDef, DecorProp, DungeonDef } from '../shared/areas.js';
import { DEFAULT_THEME, type AreaTheme, type WeatherKind } from '../shared/theme.js';
import type { Ability, AbilityId } from '../shared/combat.js';
import { type MobTemplate, type EliteModifier, DEFAULT_ELITE_MODIFIERS } from './mobs.js';
import { weatherModifiers, type WeatherModifiers } from './weather-effects.js';
import type { StatusEffectKind } from './ability-effects.js';
import { applyRarityOverrides, type Rarity, type RarityDef } from '../shared/items.js';
import { applyGemOverrides, type GemDef } from '../shared/gems.js';
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
}

export interface NpcDef {
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
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
  mobTemplate(id: string): MobTemplate | undefined;
  areaMobs(areaId: string): { templateId: string; count: number }[];
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
  /** Procedural-dungeon definition for an area (pool/boss/…), or undefined if it isn't a dungeon. */
  dungeon(areaId: string): DungeonDef | undefined;
  /** True if the area is a procedural dungeon (populated from a pool, not a fixed roster). */
  isDungeon(areaId: string): boolean;
  /** Every dungeon area id (shipped to the client so it knows which portals lead to a dungeon). */
  dungeonAreaIds(): string[];
  /** Item rarity-tier definitions keyed by rarity (drop weight, stat mult, variance, color). */
  rarityTiers(): Partial<Record<Rarity, RarityDef>>;
  /** The full socketable gem catalog (overlaid onto the shared GEMS table on both sides). */
  gems(): GemDef[];
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
    };
    if (r.melee_half_angle !== null) ability.meleeHalfAngle = r.melee_half_angle;
    if (r.projectile_speed !== null) ability.projectileSpeed = r.projectile_speed;
    if (r.projectile_ttl_ms !== null) ability.projectileTtlMs = r.projectile_ttl_ms;
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
    });
    npcs.set(r.area_id, list);
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

  // Procedural dungeon definitions: scalar fields + the ordered monster pool, rebuilt into the
  // shared DungeonDef shape the world simulation already consumes.
  const poolStmt = db.prepare(
    'SELECT template_id FROM dungeon_pool WHERE area_id = ? ORDER BY sort_order',
  );
  const dungeons = new Map<string, DungeonDef>();
  for (const r of db.prepare('SELECT * FROM dungeons').all() as DungeonRow[]) {
    const pool = (poolStmt.all(r.area_id) as { template_id: string }[]).map((p) => p.template_id);
    const def: DungeonDef = {
      pool,
      boss: r.boss,
      miniBossChance: r.mini_boss_chance,
      eliteChance: r.elite_chance,
      minMobs: r.min_mobs,
      maxMobs: r.max_mobs,
    };
    if (r.mini_boss !== null) def.miniBoss = r.mini_boss;
    dungeons.set(r.area_id, def);
  }

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
  const gems = (db.prepare('SELECT * FROM gems').all() as GemRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    stat: r.stat as GemDef['stat'],
    value: r.value,
    tier: r.tier,
  }));

  return {
    area: (id) => areas.get(id),
    areas: () => [...areas.values()],
    ability: (id) => abilities.get(id),
    abilityOrder: () => [...order],
    abilityList: () => order.map((id) => abilities.get(id)!),
    item: (id) => items.get(id),
    items: () => [...items.values()],
    sellValue: (id) => items.get(id)?.sellValue ?? 0,
    mobTemplate: (id) => mobTemplates.get(id),
    areaMobs: (areaId) => areaMobs.get(areaId) ?? [],
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
    dungeon: (areaId) => dungeons.get(areaId),
    isDungeon: (areaId) => dungeons.has(areaId),
    dungeonAreaIds: () => [...dungeons.keys()],
    rarityTiers: () => rarityTiers,
    gems: () => gems,
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
  radius: number;
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
}
interface AreaMobRow {
  area_id: string;
  template_id: string;
  count: number;
}
interface NpcRow {
  area_id: string;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: string;
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
interface DungeonRow {
  area_id: string;
  boss: string;
  mini_boss: string | null;
  mini_boss_chance: number;
  elite_chance: number;
  min_mobs: number;
  max_mobs: number;
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
}

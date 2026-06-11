import { openDatabase, type GameDatabase } from './db/database.js';
import { rollDropTable, type DropRow, type DropTable } from './drop-table.js';
import type { AreaDef, DecorProp } from '../shared/areas.js';
import { DEFAULT_THEME, type AreaTheme } from '../shared/theme.js';
import type { Ability, AbilityId } from '../shared/combat.js';
import type { MobTemplate } from './mobs.js';

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
}

interface LootGroup {
  always: DropRow<string>[];
  main: DropRow<string>[];
  rare?: { chance: number; table: DropRow<string>[] };
  gear?: { chance: number; items: string[] };
}

export function loadContent(db: GameDatabase): Content {
  // Per-area environment themes (the data-driven look) — DEFAULT_THEME fills any area without a row.
  const themes = new Map<string, AreaTheme>();
  for (const r of db.prepare('SELECT * FROM area_theme').all() as AreaThemeRow[]) {
    themes.set(r.area_id, rowToTheme(r));
  }

  // Static set-dressing props per area (tents, palisade, bonfire…). Optional columns map to optional
  // fields only when non-null, so exactOptionalPropertyTypes stays happy.
  const decor = new Map<string, DecorProp[]>();
  for (const r of db.prepare('SELECT * FROM decor').all() as DecorRow[]) {
    const prop: DecorProp = { kind: r.kind, x: r.x, y: r.y };
    if (r.x2 !== null) prop.x2 = r.x2;
    if (r.y2 !== null) prop.y2 = r.y2;
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
    ).map((p) => ({
      rect: { x: p.rect_x, y: p.rect_y, w: p.rect_w, h: p.rect_h },
      toArea: p.to_area,
      toSpawn: { x: p.to_spawn_x, y: p.to_spawn_y },
      label: p.label,
    }));
    areas.set(a.id, {
      id: a.id,
      name: a.name,
      width: a.width,
      height: a.height,
      spawn: { x: a.spawn_x, y: a.spawn_y },
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
    list.push({ templateId: r.template_id, count: r.count });
    areaMobs.set(r.area_id, list);
  }

  const npcs = new Map<string, NpcDef[]>();
  for (const r of db.prepare('SELECT * FROM npcs').all() as NpcRow[]) {
    const list = npcs.get(r.area_id) ?? [];
    list.push({ name: r.name, x: r.x, y: r.y, hue: r.hue, kind: r.kind });
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
  };
}

// --- lazy singleton -------------------------------------------------------------------
let activeDb: GameDatabase | undefined;
let activeContent: Content | undefined;

/** Initialize (or replace) the content database. The server calls this with a file path. */
export function initGameDb(file?: string): Content {
  activeDb = openDatabase(file ?? ':memory:');
  activeContent = loadContent(activeDb);
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
  activeContent = loadContent(activeDb);
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

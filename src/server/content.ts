import { openDatabase, type GameDatabase } from './db/database.js';
import { rollDropTable, type DropRow, type DropTable } from './drop-table.js';
import type { AreaDef } from '../shared/areas.js';
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
  kind: string; // 'equip' | 'loot' | 'currency'
  slot: 'weapon' | 'armor' | null;
  power: number | null;
  hp: number | null;
  color: string | null;
  sellValue: number;
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
}

export interface Content {
  area(id: string): AreaDef | undefined;
  areas(): AreaDef[];
  ability(id: string): Ability | undefined;
  abilityOrder(): AbilityId[];
  item(id: string): ItemDef | undefined;
  sellValue(itemId: string): number;
  mobTemplate(id: string): MobTemplate | undefined;
  areaMobs(areaId: string): { templateId: string; count: number }[];
  npcs(areaId: string): NpcDef[];
  quests(): QuestDef[];
  rollLoot(mobTemplateId: string, rng?: () => number): { item: string; qty: number }[];
}

interface LootGroup {
  always: DropRow<string>[];
  main: DropRow<string>[];
  rare?: { chance: number; table: DropRow<string>[] };
  gear?: { chance: number; items: string[] };
}

export function loadContent(db: GameDatabase): Content {
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
    });
  }

  const mobTemplates = new Map<string, MobTemplate>();
  for (const r of db.prepare('SELECT * FROM mob_templates').all() as MobRow[]) {
    mobTemplates.set(r.id, {
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
    });
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
    item: (id) => items.get(id),
    sellValue: (id) => items.get(id)?.sellValue ?? 0,
    mobTemplate: (id) => mobTemplates.get(id),
    areaMobs: (areaId) => areaMobs.get(areaId) ?? [],
    npcs: (areaId) => npcs.get(areaId) ?? [],
    quests: () => quests,
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

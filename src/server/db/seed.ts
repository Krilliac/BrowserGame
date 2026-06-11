import type { Database } from 'better-sqlite3';
import { AREAS, AREA_THEMES } from '../../shared/areas.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ABILITIES, ABILITY_ORDER } from '../../shared/combat.js';
import { EQUIPMENT } from '../../shared/equipment.js';
import { MOB_TEMPLATES, AREA_MOBS } from '../mobs.js';
import { LOOT_TABLES } from '../loot.js';
import { SELL_VALUES } from '../vendor.js';
import { GEMS } from '../../shared/gems.js';
import { AccessLevel, accountCount, createAccount } from '../accounts.js';

/** Display names + colors for the non-equipment loot materials (and gold). */
const MATERIALS: Record<string, { name: string; color: string }> = {
  gold: { name: 'Gold', color: '#f2c14e' },
  wolf_pelt: { name: 'Wolf Pelt', color: '#9c7a4d' },
  bone: { name: 'Bone', color: '#e8e2d0' },
  bat_wing: { name: 'Bat Wing', color: '#7a5a8a' },
  rune_shard: { name: 'Rune Shard', color: '#5fb0e0' },
  venom_gland: { name: 'Venom Gland', color: '#9fd86a' },
  ember_ore: { name: 'Ember Ore', color: '#ff8a3a' },
  frost_core: { name: 'Frost Core', color: '#a8e0ff' },
};

/**
 * Spellbooks: one tome per ability. Reading one learns the spell (or ranks it up — the Diablo 1
 * duplicate rule). The starter spells' tomes (slash/fireball) are deliberately *not* on the vendor
 * shelf — they only drop, as chase rank-up books. Prices ≈ 25× a level-appropriate kill's gold EV;
 * sell values ≈ 40% of price. Design: wiki/research/spell-acquisition-design.md.
 */
const SPELLBOOKS: Record<string, { name: string; color: string; teaches: string; sell: number }> = {
  tome_slash: { name: 'Tome of the Blade', color: '#e8e8e8', teaches: 'slash', sell: 100 },
  tome_fireball: { name: 'Tome of Fire', color: '#ff7a33', teaches: 'fireball', sell: 100 },
  tome_arrow: { name: 'Tome of the Hunt', color: '#d9c08a', teaches: 'arrow', sell: 120 },
  tome_frost: { name: 'Tome of Frost', color: '#7fd4ff', teaches: 'frost', sell: 120 },
  tome_heal: { name: 'Tome of Mending', color: '#7cfc7c', teaches: 'heal', sell: 60 },
  tome_lightning: { name: 'Tome of Storms', color: '#b388ff', teaches: 'lightning', sell: 280 },
  tome_cleave: { name: 'Tome of the Reaver', color: '#e0a060', teaches: 'cleave', sell: 160 },
  tome_venom: { name: 'Tome of Venom', color: '#9fd86a', teaches: 'venom', sell: 200 },
  tome_meteor: { name: 'Tome of Cataclysm', color: '#ff5a2a', teaches: 'meteor', sell: 360 },
};

/** The town Merchant's shelf: the deterministic acquisition path (drops are the exciting one). */
const MERCHANT_STOCK: { item: string; price: number }[] = [
  { item: 'tome_heal', price: 150 },
  { item: 'tome_arrow', price: 300 },
  { item: 'tome_frost', price: 300 },
  { item: 'tome_lightning', price: 700 },
  { item: 'rusty_sword', price: 20 },
  { item: 'wooden_shield', price: 45 },
  { item: 'leather_armor', price: 55 },
  { item: 'iron_sword', price: 90 },
  { item: 'iron_helm', price: 70 },
  { item: 'tome_cleave', price: 400 },
  { item: 'tome_venom', price: 500 },
  { item: 'tome_meteor', price: 900 },
];

/** Equipment a slain monster can drop, by tier, with the group trigger chance. */
const GEAR_DROPS: Record<string, { chance: number; items: string[] }> = {
  wolf: { chance: 0.15, items: ['rusty_sword', 'leather_armor'] },
  bat: { chance: 0.15, items: ['rusty_sword', 'leather_armor'] },
  skeleton: { chance: 0.15, items: ['iron_sword', 'iron_armor'] },
  crypt_lord: { chance: 0.3, items: ['iron_sword', 'iron_armor'] },
  // Marsh drops steel; the Fenwitch is a near-guaranteed upgrade source.
  bog_shambler: { chance: 0.18, items: ['steel_sword', 'steel_armor', 'steel_helm'] },
  fen_strangler: { chance: 0.2, items: ['steel_sword', 'steel_armor', 'tower_shield'] },
  fenwitch: { chance: 0.6, items: ['steel_sword', 'steel_armor', 'steel_helm', 'tower_shield'] },
  // Mines deepen the steel tier; the Forge Tyrant starts mixing in mithril.
  magma_crawler: { chance: 0.2, items: ['steel_sword', 'steel_armor', 'steel_helm'] },
  forge_tyrant: { chance: 0.6, items: ['steel_sword', 'mithril_blade', 'mithril_armor'] },
  // Frostpeak is the mithril tier; the Pale King is the jackpot.
  avalanche_shade: { chance: 0.22, items: ['mithril_blade', 'mithril_armor', 'runed_band'] },
  tundra_behemoth: { chance: 0.25, items: ['mithril_blade', 'mithril_armor', 'tower_shield'] },
  pale_king: { chance: 0.7, items: ['mithril_blade', 'mithril_armor', 'runed_band'] },
};

/** Seed the database from the built-in content if it is empty. Idempotent. Parametrized. */
export function seed(db: Database): void {
  const count = db.prepare('SELECT COUNT(*) AS n FROM areas').get() as { n: number };
  if (count.n === 0) {
    const tx = db.transaction(() => {
      seedAreas(db);
      seedAbilities(db);
      seedItems(db);
      seedMobs(db);
      seedLoot(db);
      seedNpcs(db);
      seedQuests(db);
    });
    tx();
  }
  seedAccounts(db); // separate so existing content DBs still get the default account
  ensureSpellbookContent(db); // separate so pre-spellbook DBs gain the new rows without a wipe
}

/**
 * Upsert the spellbook-era content into a DB seeded before it existed: the tome items, the
 * Merchant's shelf, and the wolf_cull quest reward retune. Idempotent — INSERT OR IGNORE plus
 * guarded UPDATEs — so it is safe to run on every boot (fresh DBs no-op).
 */
function ensureSpellbookContent(db: Database): void {
  const insItem = db.prepare(
    'INSERT OR IGNORE INTO items (id,name,kind,slot,power,hp,color,sell_value,teaches) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const [id, b] of Object.entries(SPELLBOOKS)) {
    insItem.run(id, b.name, 'spellbook', null, null, null, b.color, b.sell, b.teaches);
  }
  // New abilities (and their tomes) reach an already-seeded DB here: insert each ability row only if
  // missing, so the content packet exposes new spells without a wipe.
  const abilityHas = db.prepare('SELECT 1 FROM abilities WHERE id = ?');
  const abilityIns = db.prepare(
    `INSERT INTO abilities
       (id,name,key,kind,damage,range,cooldown_ms,mana_cost,color,melee_half_angle,projectile_speed,projectile_ttl_ms,radius,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  ABILITY_ORDER.forEach((id, i) => {
    if (abilityHas.get(id)) return;
    const a = ABILITIES[id];
    abilityIns.run(
      a.id,
      a.name,
      a.key,
      a.kind,
      a.damage,
      a.range,
      a.cooldownMs,
      a.manaCost,
      a.color,
      a.meleeHalfAngle ?? null,
      a.projectileSpeed ?? null,
      a.projectileTtlMs ?? null,
      a.radius,
      i,
    );
  });

  // Merchant shelf: insert each item only if that (Merchant, item) line isn't already present, so
  // new tomes appear on the shelf for existing servers too.
  const stockHas = db.prepare(
    "SELECT 1 FROM vendor_stock WHERE area_id = 'town' AND npc_name = 'Merchant' AND item_id = ?",
  );
  const stockIns = db.prepare(
    'INSERT INTO vendor_stock (area_id,npc_name,item_id,price,sort_order) VALUES (?,?,?,?,?)',
  );
  MERCHANT_STOCK.forEach((s, i) => {
    if (!stockHas.get(s.item)) stockIns.run('town', 'Merchant', s.item, s.price, i);
  });
  // The guaranteed third spell ~15 minutes in, and quest gold at ~12× the area's per-kill EV.
  db.prepare(
    "UPDATE quests SET reward_item = 'tome_heal' WHERE id = 'wolf_cull' AND reward_item IS NULL",
  ).run();
  db.prepare(
    "UPDATE quests SET reward_gold = 150 WHERE id = 'wolf_cull' AND reward_gold = 50",
  ).run();

  // Gems are content items (kind 'gem') so the client gets their name + color via the content
  // packet. Their stats/socket logic live in shared/gems.ts; here we just register them as items.
  // Sell value scales loosely with tier so a spare gem is still worth a little gold.
  for (const g of Object.values(GEMS)) {
    insItem.run(g.id, g.name, 'gem', null, null, null, g.color, g.tier * 10, null);
  }

  // Town service NPCs added after the original seed — insert by name only if missing.
  const npcExists = db.prepare('SELECT 1 FROM npcs WHERE area_id = ? AND name = ?');
  const npcIns = db.prepare('INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)');
  const ensureNpc = (
    area: string,
    name: string,
    x: number,
    y: number,
    hue: number,
    kind: string,
  ): void => {
    if (!npcExists.get(area, name)) npcIns.run(area, name, x, y, hue, kind);
  };
  ensureNpc('town', 'Sister Oona', 860, 560, 140, 'healer');
  ensureNpc('town', 'Lucky Marn', 940, 560, 300, 'gambler');
  ensureNpc('town', 'Coalhand the Artificer', 580, 560, 25, 'artificer');

  // Collect/turn-in quests added after the original seed (id is the PK, so OR IGNORE dedups).
  const insQuest = db.prepare(
    'INSERT OR IGNORE INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp,reward_item,turn_in_item,turn_in_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const q of QUESTS) {
    if (!q.turnInItem) continue; // only the new collect quests need retro-seeding
    insQuest.run(
      q.id,
      q.name,
      q.description,
      null,
      0,
      q.rewardGold,
      q.rewardXp,
      null,
      q.turnInItem,
      q.turnInCount ?? 0,
    );
  }
}

/** Seed a default developer account if none exists. Password from DEV_PASSWORD (default insecure). */
function seedAccounts(db: Database): void {
  if (accountCount(db) > 0) return;
  const password = process.env.DEV_PASSWORD ?? 'changeme';
  if (password === 'changeme') {
    console.warn(
      '[accounts] seeding dev account with default password — set DEV_PASSWORD to secure it.',
    );
  }
  createAccount(db, 'dev', password, AccessLevel.Developer);
}

function seedAreas(db: Database): void {
  const area = db.prepare(
    'INSERT INTO areas (id,name,width,height,spawn_x,spawn_y,player_cap) VALUES (?,?,?,?,?,?,?)',
  );
  const portal = db.prepare(
    'INSERT INTO portals (area_id,rect_x,rect_y,rect_w,rect_h,to_area,to_spawn_x,to_spawn_y,label) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  const theme = db.prepare(
    `INSERT INTO area_theme
       (area_id,ground_base,ground_speck,prop,prop_density,atmo_color,atmo_alpha,outdoor,
        particle_color,particle_count,particle_rise,particle_flicker,weather,weather_intensity,
        fog_color,light_ambient,grade_saturation,grade_brightness,grade_contrast,sprite_tint)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const a of Object.values(AREAS)) {
    area.run(a.id, a.name, a.width, a.height, a.spawn.x, a.spawn.y, a.playerCap);
    for (const p of a.portals) {
      portal.run(
        a.id,
        p.rect.x,
        p.rect.y,
        p.rect.w,
        p.rect.h,
        p.toArea,
        p.toSpawn.x,
        p.toSpawn.y,
        p.label,
      );
    }
    const t = AREA_THEMES[a.id] ?? DEFAULT_THEME;
    theme.run(
      a.id,
      t.groundBase,
      t.groundSpeck,
      t.prop,
      t.propDensity,
      t.atmoColor,
      t.atmoAlpha,
      t.outdoor ? 1 : 0,
      t.particleColor,
      t.particleCount,
      t.particleRise,
      t.particleFlicker ? 1 : 0,
      t.weather,
      t.weatherIntensity,
      t.fogColor,
      t.lightAmbient,
      t.gradeSaturation,
      t.gradeBrightness,
      t.gradeContrast,
      t.spriteTint,
    );
  }
}

function seedAbilities(db: Database): void {
  const ins = db.prepare(
    `INSERT INTO abilities
       (id,name,key,kind,damage,range,cooldown_ms,mana_cost,color,melee_half_angle,projectile_speed,projectile_ttl_ms,radius,sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const id of ABILITY_ORDER) {
    const a = ABILITIES[id];
    ins.run(
      a.id,
      a.name,
      a.key,
      a.kind,
      a.damage,
      a.range,
      a.cooldownMs,
      a.manaCost,
      a.color,
      a.meleeHalfAngle ?? null,
      a.projectileSpeed ?? null,
      a.projectileTtlMs ?? null,
      a.radius,
      ABILITY_ORDER.indexOf(id),
    );
  }
}

function seedItems(db: Database): void {
  const ins = db.prepare(
    'INSERT INTO items (id,name,kind,slot,power,hp,color,sell_value,teaches) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  // Equipment.
  for (const e of Object.values(EQUIPMENT)) {
    ins.run(e.id, e.name, 'equip', e.slot, e.power ?? null, e.hp ?? null, e.color, 0, null);
  }
  // Materials + currency.
  for (const [id, m] of Object.entries(MATERIALS)) {
    const kind = id === 'gold' ? 'currency' : 'loot';
    ins.run(id, m.name, kind, null, null, null, m.color, SELL_VALUES[id] ?? 0, null);
  }
  // Spellbooks land via ensureSpellbookContent (shared with the existing-DB upgrade path).
}

function seedMobs(db: Database): void {
  const mob = db.prepare(
    `INSERT INTO mob_templates
       (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms,
        behavior,telegraph_ms,projectile_speed,kite_range,slam_radius,dash_speed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const t of Object.values(MOB_TEMPLATES)) {
    mob.run(
      t.id,
      t.name,
      t.hp,
      t.level,
      t.hue,
      t.speed,
      t.aggroRange,
      t.attackRange,
      t.damage,
      t.attackCooldownMs,
      t.behavior,
      t.telegraphMs,
      t.projectileSpeed ?? null,
      t.kiteRange ?? null,
      t.slamRadius ?? null,
      t.dashSpeed ?? null,
    );
  }
  const am = db.prepare('INSERT INTO area_mobs (area_id,template_id,count) VALUES (?,?,?)');
  for (const [areaId, spawns] of Object.entries(AREA_MOBS)) {
    for (const s of spawns) am.run(areaId, s.templateId, s.count);
  }
}

function seedLoot(db: Database): void {
  const ins = db.prepare(
    'INSERT INTO loot_entry (mob_template_id,grp,item_id,weight,min_qty,max_qty,is_nothing,chance) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (const [mobId, table] of Object.entries(LOOT_TABLES)) {
    for (const r of table.always ?? []) {
      ins.run(mobId, 'always', r.value, r.weight, r.min ?? 1, r.max ?? r.min ?? 1, 0, 0);
    }
    for (const r of table.main) {
      ins.run(
        mobId,
        'main',
        r.value,
        r.weight,
        r.min ?? 1,
        r.max ?? r.min ?? 1,
        r.nothing ? 1 : 0,
        0,
      );
    }
    if (table.rare) {
      for (const r of table.rare.table) {
        ins.run(
          mobId,
          'rare',
          r.value,
          r.weight,
          r.min ?? 1,
          r.max ?? r.min ?? 1,
          0,
          table.rare.chance,
        );
      }
    }
  }
  // Bosses have no LOOT_TABLES entry; give them a fat gold drop directly.
  ins.run('crypt_lord', 'always', 'gold', 1, 50, 150, 0, 0);
  ins.run('fenwitch', 'always', 'gold', 1, 80, 220, 0, 0);
  ins.run('forge_tyrant', 'always', 'gold', 1, 150, 400, 0, 0);
  ins.run('pale_king', 'always', 'gold', 1, 300, 700, 0, 0);
  // Equipment ("gear") drops.
  for (const [mobId, gear] of Object.entries(GEAR_DROPS)) {
    for (const item of gear.items) ins.run(mobId, 'gear', item, 1, 1, 1, 0, gear.chance);
  }
}

function seedNpcs(db: Database): void {
  const ins = db.prepare('INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)');
  // A town plaza: the merchant and the quest-giver stand together near the spawn/portal,
  // flanked by a healer and a gambler — the minimum-viable ARPG town services.
  ins.run('town', 'Merchant', 660, 560, 45, 'vendor');
  ins.run('town', 'Elder Maeve', 740, 560, 190, 'questgiver');
  ins.run('town', 'Sister Oona', 860, 560, 140, 'healer');
  ins.run('town', 'Lucky Marn', 940, 560, 300, 'gambler');
  // A quest-giver near the arrival point of each new area, so the content is discoverable.
  ins.run('marsh', 'Bogged Pilgrim', 1100, 280, 95, 'questgiver');
  ins.run('mines', 'Stranded Miner', 900, 280, 18, 'questgiver');
  ins.run('frostpeak', 'Frostbound Warden', 1000, 300, 205, 'questgiver');
}

/** Quests, keyed by area. Kill-N for now (the implemented type); each new area's boss rewards a tome. */
const QUESTS: {
  id: string;
  name: string;
  description: string;
  targetMob: string | null;
  targetCount: number;
  rewardGold: number;
  rewardXp: number;
  rewardItem: string | null;
  turnInItem?: string;
  turnInCount?: number;
}[] = [
  {
    id: 'wolf_cull',
    name: 'Wolf Cull',
    description: 'Slay 5 Gloom Wolves prowling Gloomwood.',
    targetMob: 'wolf',
    targetCount: 5,
    rewardGold: 150,
    rewardXp: 80,
    rewardItem: 'tome_heal',
  },
  {
    id: 'warm_hides',
    name: 'Warm Hides',
    description: 'Gather 8 Wolf Pelts for the tanner.',
    targetMob: null,
    targetCount: 0,
    rewardGold: 120,
    rewardXp: 90,
    rewardItem: null,
    turnInItem: 'wolf_pelt',
    turnInCount: 8,
  },
  {
    id: 'old_bones',
    name: 'Old Bones',
    description: 'Bring 12 Bones to the keeper of the dead.',
    targetMob: null,
    targetCount: 0,
    rewardGold: 250,
    rewardXp: 240,
    rewardItem: null,
    turnInItem: 'bone',
    turnInCount: 12,
  },
  {
    id: 'crypt_cleanse',
    name: 'Still the Bones',
    description: 'Put 8 Crypt Skeletons back to rest in the Shadow Crypt.',
    targetMob: 'skeleton',
    targetCount: 8,
    rewardGold: 260,
    rewardXp: 220,
    rewardItem: 'tome_lightning',
  },
  {
    id: 'marsh_witch',
    name: 'The Fenwitch',
    description: 'Hunt down the Fenwitch haunting Rotfen Marsh.',
    targetMob: 'fenwitch',
    targetCount: 1,
    rewardGold: 400,
    rewardXp: 500,
    rewardItem: 'tome_frost',
  },
  {
    id: 'mines_tyrant',
    name: 'Break the Forge',
    description: 'Destroy the Forge Tyrant deep in the Emberdeep Mines.',
    targetMob: 'forge_tyrant',
    targetCount: 1,
    rewardGold: 700,
    rewardXp: 900,
    rewardItem: 'tome_arrow',
  },
  {
    id: 'frost_king',
    name: 'The Pale King',
    description: 'End the reign of the Pale King atop Frostpeak Pass.',
    targetMob: 'pale_king',
    targetCount: 1,
    rewardGold: 1200,
    rewardXp: 1800,
    rewardItem: null,
  },
];

function seedQuests(db: Database): void {
  const ins = db.prepare(
    'INSERT INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp,reward_item,turn_in_item,turn_in_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const q of QUESTS) {
    ins.run(
      q.id,
      q.name,
      q.description,
      q.targetMob,
      q.targetCount,
      q.rewardGold,
      q.rewardXp,
      q.rewardItem,
      q.turnInItem ?? null,
      q.turnInCount ?? 0,
    );
  }
}

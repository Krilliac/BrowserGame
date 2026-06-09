import type { Database } from 'better-sqlite3';
import { AREAS, AREA_THEMES } from '../../shared/areas.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ABILITIES, ABILITY_ORDER } from '../../shared/combat.js';
import { EQUIPMENT } from '../../shared/equipment.js';
import { MOB_TEMPLATES, AREA_MOBS } from '../mobs.js';
import { LOOT_TABLES } from '../loot.js';
import { SELL_VALUES } from '../vendor.js';
import { AccessLevel, accountCount, createAccount } from '../accounts.js';

/** Display names + colors for the non-equipment loot materials (and gold). */
const MATERIALS: Record<string, { name: string; color: string }> = {
  gold: { name: 'Gold', color: '#f2c14e' },
  wolf_pelt: { name: 'Wolf Pelt', color: '#9c7a4d' },
  bone: { name: 'Bone', color: '#e8e2d0' },
  bat_wing: { name: 'Bat Wing', color: '#7a5a8a' },
  rune_shard: { name: 'Rune Shard', color: '#5fb0e0' },
};

/** Equipment a slain monster can drop, by tier, with the group trigger chance. */
const GEAR_DROPS: Record<string, { chance: number; items: string[] }> = {
  wolf: { chance: 0.15, items: ['rusty_sword', 'leather_armor'] },
  bat: { chance: 0.15, items: ['rusty_sword', 'leather_armor'] },
  skeleton: { chance: 0.15, items: ['iron_sword', 'iron_armor'] },
  crypt_lord: { chance: 0.3, items: ['iron_sword', 'iron_armor'] },
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
        fog_color,light_ambient)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
    'INSERT INTO items (id,name,kind,slot,power,hp,color,sell_value) VALUES (?,?,?,?,?,?,?,?)',
  );
  // Equipment.
  for (const e of Object.values(EQUIPMENT)) {
    ins.run(e.id, e.name, 'equip', e.slot, e.power ?? null, e.hp ?? null, e.color, 0);
  }
  // Materials + currency.
  for (const [id, m] of Object.entries(MATERIALS)) {
    const kind = id === 'gold' ? 'currency' : 'loot';
    ins.run(id, m.name, kind, null, null, null, m.color, SELL_VALUES[id] ?? 0);
  }
}

function seedMobs(db: Database): void {
  const mob = db.prepare(
    `INSERT INTO mob_templates
       (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
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
  // The boss has no LOOT_TABLES entry; give it a gold drop directly.
  ins.run('crypt_lord', 'always', 'gold', 1, 50, 150, 0, 0);
  // Equipment ("gear") drops.
  for (const [mobId, gear] of Object.entries(GEAR_DROPS)) {
    for (const item of gear.items) ins.run(mobId, 'gear', item, 1, 1, 1, 0, gear.chance);
  }
}

function seedNpcs(db: Database): void {
  db.prepare('INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)').run(
    'town',
    'Merchant',
    660,
    560,
    45,
    'vendor',
  );
}

function seedQuests(db: Database): void {
  db.prepare(
    'INSERT INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp) VALUES (?,?,?,?,?,?,?)',
  ).run('wolf_cull', 'Wolf Cull', 'Slay 5 Gloom Wolves prowling Gloomwood.', 'wolf', 5, 50, 80);
}

import type { Database } from 'better-sqlite3';
import { config, TUNABLE_SECTIONS } from '../config.js';
import { AREAS, AREA_THEMES, type DecorProp } from '../../shared/areas.js';
import { DEFAULT_THEME } from '../../shared/theme.js';
import { ABILITIES, ABILITY_ORDER } from '../../shared/combat.js';
import { EQUIPMENT } from '../../shared/equipment.js';
import { MOB_TEMPLATES, AREA_MOBS, DEFAULT_ELITE_MODIFIERS } from '../mobs.js';
import { weatherModifiers } from '../weather-effects.js';
import {
  DEFAULT_ABILITY_STATUS_EFFECTS,
  DEFAULT_CAST_BUFFS,
  DEFAULT_SHRINE_BUFFS,
} from '../ability-effects.js';
import { WEATHER_KINDS } from '../../shared/theme.js';
import { LOOT_TABLES } from '../loot.js';
import { SELL_VALUES } from '../vendor.js';
import { GEMS } from '../../shared/gems.js';
import { RUNES } from '../../shared/runewords.js';
import { AccessLevel, accountCount, createAccount } from '../accounts.js';
import { EXPANSION_AREA_MOBS, EXPANSION_LOOT } from './seed-expansion.js';
import { EXPANSION_DECOR } from './seed-decor.js';
import { ensureSpellTomeContent } from './seed-spells.js';
import { FRONTIER_NPCS, FRONTIER_DECOR, FRONTIER_LOOT, FRONTIER_QUESTS } from './seed-frontier.js';
import { ACTS_NPCS, ACTS_DECOR, ACTS_LOOT, ACTS_QUESTS, ACTS_VENDOR_STOCK } from './seed-acts.js';

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

  // --- Expanded spellbook tomes (one per new ability). dropSpellbook() picks uniformly from all
  //     kind:'spellbook' items, so registering these makes every book drop roll from the full pool. ---
  tome_emberbolt: { name: 'Tome of Embers', color: '#ff9a4d', teaches: 'emberbolt', sell: 90 },
  tome_frostshard: {
    name: 'Tome of Frost Shards',
    color: '#aee7ff',
    teaches: 'frostshard',
    sell: 95,
  },
  tome_sparkjolt: { name: 'Tome of Sparks', color: '#cdb4ff', teaches: 'sparkjolt', sell: 85 },
  tome_frostlance: {
    name: 'Tome of the Frost Lance',
    color: '#7fd4ff',
    teaches: 'frostlance',
    sell: 150,
  },
  tome_flamewave: {
    name: 'Tome of the Flame Wave',
    color: '#ff6a2a',
    teaches: 'flamewave',
    sell: 170,
  },
  tome_frostnova: {
    name: 'Tome of the Frost Nova',
    color: '#bff0ff',
    teaches: 'frostnova',
    sell: 200,
  },
  tome_staticburst: {
    name: 'Tome of the Static Burst',
    color: '#c0a6ff',
    teaches: 'staticburst',
    sell: 190,
  },
  tome_chainspark: {
    name: 'Tome of the Chain Spark',
    color: '#b388ff',
    teaches: 'chainspark',
    sell: 230,
  },
  tome_cinderorb: {
    name: 'Tome of the Cinder Orb',
    color: '#ff7e3a',
    teaches: 'cinderorb',
    sell: 250,
  },
  tome_glacierspike: {
    name: 'Tome of the Glacier Spike',
    color: '#6fc6ff',
    teaches: 'glacierspike',
    sell: 320,
  },
  tome_thunderlance: {
    name: 'Tome of the Thunder Lance',
    color: '#9a7bff',
    teaches: 'thunderlance',
    sell: 330,
  },
  tome_infernonova: {
    name: 'Tome of the Inferno Nova',
    color: '#ff5320',
    teaches: 'infernonova',
    sell: 360,
  },
  tome_poison_spit: {
    name: 'Tome of Poison Spit',
    color: '#7ccf3a',
    teaches: 'poison_spit',
    sell: 130,
  },
  tome_shadow_bolt: {
    name: 'Tome of the Shadow Bolt',
    color: '#8a5bd6',
    teaches: 'shadow_bolt',
    sell: 160,
  },
  tome_draining_touch: {
    name: 'Tome of Draining Touch',
    color: '#a23bbf',
    teaches: 'draining_touch',
    sell: 150,
  },
  tome_entangling_vines: {
    name: 'Tome of Entangling Vines',
    color: '#4a9e52',
    teaches: 'entangling_vines',
    sell: 140,
  },
  tome_arcane_orb: {
    name: 'Tome of the Arcane Orb',
    color: '#3fa9f5',
    teaches: 'arcane_orb',
    sell: 200,
  },
  tome_radiant_smite: {
    name: 'Tome of Radiant Smite',
    color: '#ffd966',
    teaches: 'radiant_smite',
    sell: 185,
  },
  tome_curse_of_decay: {
    name: 'Tome of the Curse of Decay',
    color: '#6b8e2a',
    teaches: 'curse_of_decay',
    sell: 175,
  },
  tome_shadow_nova: {
    name: 'Tome of the Shadow Nova',
    color: '#5a3a8c',
    teaches: 'shadow_nova',
    sell: 195,
  },
  tome_consecration: {
    name: 'Tome of Consecration',
    color: '#ffe9a8',
    teaches: 'consecration',
    sell: 210,
  },
  tome_lesser_mend: {
    name: 'Tome of Lesser Mend',
    color: '#9be8a0',
    teaches: 'lesser_mend',
    sell: 120,
  },
  tome_greater_restoration: {
    name: 'Tome of Greater Restoration',
    color: '#e8f5b0',
    teaches: 'greater_restoration',
    sell: 230,
  },
  tome_natures_renewal: {
    name: "Tome of Nature's Renewal",
    color: '#6fd98f',
    teaches: 'natures_renewal',
    sell: 175,
  },
  tome_quick_jab: {
    name: 'Drill of the Quick Jab',
    color: '#e8e8ee',
    teaches: 'quick_jab',
    sell: 70,
  },
  tome_skewer: { name: 'Drill of the Skewer', color: '#cfd2d8', teaches: 'skewer', sell: 95 },
  tome_broadsweep: {
    name: 'Manual of the Broadsweep',
    color: '#d4d8de',
    teaches: 'broadsweep',
    sell: 120,
  },
  tome_whirlwind: {
    name: 'Manual of the Whirlwind',
    color: '#d8d8e0',
    teaches: 'whirlwind',
    sell: 160,
  },
  tome_bladestorm: {
    name: 'Codex of the Bladestorm',
    color: '#c2c6cf',
    teaches: 'bladestorm',
    sell: 220,
  },
  tome_crushing_smash: {
    name: 'Tome of the Crushing Smash',
    color: '#b8bcc4',
    teaches: 'crushing_smash',
    sell: 180,
  },
  tome_skullbreaker: {
    name: 'Tome of the Skullbreaker',
    color: '#a8acb4',
    teaches: 'skullbreaker',
    sell: 240,
  },
  tome_rend: { name: 'Manual of the Rend', color: '#b22b2b', teaches: 'rend', sell: 150 },
  tome_hamstring: {
    name: 'Manual of the Hamstring',
    color: '#9aa2b0',
    teaches: 'hamstring',
    sell: 130,
  },
  tome_throwing_axe: {
    name: 'Manual of the Throwing Axe',
    color: '#cdd1d7',
    teaches: 'throwing_axe',
    sell: 110,
  },
  tome_warcry: { name: 'Tome of the War Cry', color: '#ffb347', teaches: 'warcry', sell: 200 },
  tome_sprint: { name: 'Tome of Sprinting', color: '#7cf0ff', teaches: 'sprint', sell: 180 },
  tome_renew: { name: 'Tome of Renewal', color: '#9be8a0', teaches: 'renew', sell: 200 },
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
  // A starter selection from the expanded pool; the rest are found as drops out in the world.
  { item: 'tome_quick_jab', price: 150 },
  { item: 'tome_emberbolt', price: 200 },
  { item: 'tome_frostshard', price: 210 },
  { item: 'tome_sparkjolt', price: 190 },
  { item: 'tome_skewer', price: 210 },
  { item: 'tome_throwing_axe', price: 250 },
  { item: 'tome_lesser_mend', price: 280 },
  { item: 'tome_hamstring', price: 300 },
  { item: 'tome_poison_spit', price: 300 },
  { item: 'tome_entangling_vines', price: 320 },
  { item: 'tome_sprint', price: 380 },
  { item: 'tome_warcry', price: 420 },
  { item: 'tome_renew', price: 440 },
];

/** Equipment a slain monster can drop, by tier, with the group trigger chance. */
const GEAR_DROPS: Record<string, { chance: number; items: string[] }> = {
  wolf: { chance: 0.3, items: ['rusty_sword', 'leather_armor'] },
  bat: { chance: 0.3, items: ['rusty_sword', 'leather_armor'] },
  skeleton: { chance: 0.3, items: ['iron_sword', 'iron_armor'] },
  crypt_lord: { chance: 0.5, items: ['iron_sword', 'iron_armor'] },
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
      seedDecor(db);
      seedQuests(db);
    });
    tx();
  }
  seedAccounts(db); // separate so existing content DBs still get the default account
  ensureSpellbookContent(db); // separate so pre-spellbook DBs gain the new rows without a wipe
  ensureSpellTomeContent(db); // the expanded spell roster's tomes + vendor shelf lines
  ensureWorldExpansion(db); // dungeons, new monsters, and the dungeon entrance portals
  ensureDecor(db); // set-dressing props per area (idempotent: no-op once an area has decor)
  ensureExpansionContent(db); // hand-placed decor, new-monster rosters/loot, sprite tints
  ensureFrontierContent(db); // Duskhaven village + the Abyssal Throne (NPCs, decor, loot, quests)
  ensureActsContent(db); // the Act 2 road + all of Act 3 (Vhalreth, its zones, the Unmade Court)
  ensureDenContent(db); // the generic cellar/den interior (procedural mini-dungeon shell)
  ensureWeatherModifiers(db); // per-WeatherKind gameplay multipliers (seeded from code defaults)
  ensureEliteModifiers(db); // champion stat-modifier roster (seeded from code defaults)
  ensureAbilityStatusEffects(db); // per-ability on-hit slow/burn/weaken (seeded from code defaults)
  ensureAbilityCastBuffs(db); // per-ability self-buff on cast (seeded from code defaults)
  ensureShrineBuffs(db); // shrine blessing pool (seeded from code defaults)
  ensureGameConfig(db); // global game-tuning overlay (seeded from the config.ts defaults)
  cleanupStrayTerrain(db); // remove any solid-terrain decor that leaked into safe/non-terrain areas
}

/**
 * Seed the per-WeatherKind gameplay multipliers from the code defaults (weather-effects.ts).
 * Idempotent: INSERT OR IGNORE keyed on the weather kind, so an existing row's tuning is preserved.
 */
function ensureWeatherModifiers(db: Database): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO weather_modifiers (weather,move_scale,aggro_scale) VALUES (?,?,?)',
  );
  for (const kind of WEATHER_KINDS) {
    const m = weatherModifiers(kind);
    ins.run(kind, m.moveScale, m.aggroScale);
  }
}

/**
 * Seed the elite ("champion") modifier roster from the code defaults (mobs.ts). Idempotent:
 * INSERT OR IGNORE keyed on id, so a designer's edited multipliers survive a restart.
 */
function ensureEliteModifiers(db: Database): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO elite_modifiers (id,name,hp_mult,damage_mult,speed_mult,sort_order) VALUES (?,?,?,?,?,?)',
  );
  DEFAULT_ELITE_MODIFIERS.forEach((m, i) => ins.run(m.id, m.name, m.hp, m.dmg, m.spd, i));
}

/**
 * Seed the per-ability on-hit status effects (slow/burn/weaken) from the code defaults
 * (ability-effects.ts). Idempotent: INSERT OR IGNORE keyed on (ability_id, effect), so a designer's
 * retuned durations/magnitudes survive a restart.
 */
function ensureAbilityStatusEffects(db: Database): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ability_status_effects (ability_id,effect,duration_ms,magnitude) VALUES (?,?,?,?)',
  );
  for (const e of DEFAULT_ABILITY_STATUS_EFFECTS) ins.run(e.abilityId, e.effect, e.ms, e.magnitude);
}

/**
 * Seed the per-ability self-buff-on-cast rows from the code defaults (ability-effects.ts).
 * Idempotent: INSERT OR IGNORE keyed on ability_id, so designer edits survive a restart.
 */
function ensureAbilityCastBuffs(db: Database): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO ability_cast_buffs (ability_id,buff,duration_ms,magnitude) VALUES (?,?,?,?)',
  );
  for (const b of DEFAULT_CAST_BUFFS) ins.run(b.abilityId, b.buff, b.ms, b.magnitude);
}

/**
 * Seed the shrine blessing pool from the code defaults (ability-effects.ts). Idempotent:
 * INSERT OR IGNORE keyed on id; sort_order fixes the deterministic pick order.
 */
function ensureShrineBuffs(db: Database): void {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO shrine_buffs (id,buff,duration_ms,magnitude,label,sort_order) VALUES (?,?,?,?,?,?)',
  );
  DEFAULT_SHRINE_BUFFS.forEach((b, i) => ins.run(b.id, b.buff, b.ms, b.magnitude, b.label, i));
}

/**
 * Seed the global game-tuning overlay from the code defaults: one `<section>.<field> = value` row
 * per numeric field of each whitelisted GAMEPLAY section (config.ts TUNABLE_SECTIONS). Idempotent:
 * INSERT OR IGNORE keyed on the dotted key, so an operator's rebalanced values survive a restart.
 * Plumbing/secret sections (server.*) are never written here.
 */
function ensureGameConfig(db: Database): void {
  const ins = db.prepare('INSERT OR IGNORE INTO game_config (key,value) VALUES (?,?)');
  const groups = config as unknown as Record<string, Record<string, unknown>>;
  for (const section of TUNABLE_SECTIONS) {
    for (const [field, value] of Object.entries(groups[section] ?? {})) {
      if (typeof value === 'number') ins.run(`${section}.${field}`, value);
    }
  }
}

/**
 * Remove solid-terrain decor (cliffs/mountains/boulders) from areas that should never have it — the
 * safe town/villages. Idempotent: deletes nothing once clean. This scrubs stray rows (e.g. terrain
 * accidentally seeded into town during development) so a village never sprouts a mountain.
 */
function cleanupStrayTerrain(db: Database): void {
  db.prepare(
    `DELETE FROM decor WHERE kind IN ('cliff','ridge','barrier','wall','mountain','boulder','peak')
       AND area_id IN ('town','duskhaven')`,
  ).run();
}

/**
 * Upsert the Act 2/3 content (the combat road off Duskhaven, the city of Vhalreth, the Act 3
 * zones, and the Unmade Court) into an already-seeded DB. Same idempotent guards as the
 * frontier; areas/portals/themes/templates/rosters flow through ensureWorldExpansion.
 */
function ensureActsContent(db: Database): void {
  const npcExists = db.prepare('SELECT 1 FROM npcs WHERE area_id = ? AND name = ?');
  const npcIns = db.prepare('INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)');
  for (const n of ACTS_NPCS) {
    if (!npcExists.get(n.areaId, n.name)) npcIns.run(n.areaId, n.name, n.x, n.y, n.hue, n.kind);
  }

  const decorKindCount = db.prepare(
    'SELECT COUNT(*) AS n FROM decor WHERE area_id = ? AND kind = ?',
  );
  const decorIns = db.prepare(
    'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
  );
  const byAreaKind = new Map<string, typeof ACTS_DECOR>();
  for (const d of ACTS_DECOR) {
    const key = `${d.areaId}/${d.kind}`;
    byAreaKind.set(key, [...(byAreaKind.get(key) ?? []), d]);
  }
  for (const rows of byAreaKind.values()) {
    const first = rows[0]!;
    const { n } = decorKindCount.get(first.areaId, first.kind) as { n: number };
    if (n > 0) continue;
    for (const d of rows) {
      decorIns.run(
        d.areaId,
        d.kind,
        d.x,
        d.y,
        d.x2 ?? null,
        d.y2 ?? null,
        d.color ?? null,
        d.scale ?? null,
      );
    }
  }

  const lootExists = db.prepare('SELECT 1 FROM loot_entry WHERE mob_template_id = ? LIMIT 1');
  const lootIns = db.prepare(
    'INSERT INTO loot_entry (mob_template_id,grp,item_id,weight,min_qty,max_qty,is_nothing,chance) VALUES (?,?,?,?,?,?,?,?)',
  );
  const lootMobs = new Set(ACTS_LOOT.map((l) => l.mobTemplateId));
  for (const mobId of lootMobs) {
    if (lootExists.get(mobId)) continue;
    for (const l of ACTS_LOOT) {
      if (l.mobTemplateId !== mobId) continue;
      lootIns.run(mobId, l.grp, l.itemId, l.weight, l.minQty, l.maxQty, l.isNothing, l.chance);
    }
  }

  const insQuest = db.prepare(
    'INSERT OR IGNORE INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp,reward_item,turn_in_item,turn_in_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const q of ACTS_QUESTS) {
    insQuest.run(
      q.id,
      q.name,
      q.description,
      q.targetMob,
      q.targetCount,
      q.rewardGold,
      q.rewardXp,
      q.rewardItem ?? null,
      q.turnInItem ?? null,
      q.turnInCount ?? 0,
    );
  }

  const stockExists = db.prepare(
    'SELECT 1 FROM vendor_stock WHERE area_id = ? AND npc_name = ? LIMIT 1',
  );
  const stockIns = db.prepare(
    'INSERT INTO vendor_stock (area_id,npc_name,item_id,price,sort_order) VALUES (?,?,?,?,?)',
  );
  const stockVendors = new Set(ACTS_VENDOR_STOCK.map((s) => `${s.areaId}/${s.npcName}`));
  for (const key of stockVendors) {
    const [areaId, npcName] = key.split('/') as [string, string];
    if (stockExists.get(areaId, npcName)) continue;
    for (const s of ACTS_VENDOR_STOCK) {
      if (s.areaId !== areaId || s.npcName !== npcName) continue;
      stockIns.run(s.areaId, s.npcName, s.itemId, s.price, s.sortOrder);
    }
  }

  // Tint-variant recolors: Act 2/3 monsters reusing earlier sprite sheets read as their own
  // creatures through the sprite_tints system (one source, many palettes).
  const tintIns = db.prepare('INSERT OR IGNORE INTO sprite_tints (target,tint) VALUES (?,?)');
  const ACT_TINTS: [string, string][] = [
    ['mob:ash_dire_wolf', '#c8beb4'], // ash-grey wolf
    ['mob:barrow_wight', '#b8d0e8'], // grave-frost wraith
    ['mob:drowned_hulk', '#8fb4b8'], // waterlogged zombie
    ['mob:null_revenant', '#b09ad0'], // void reaper
    ['mob:causeway_golem', '#a8a4b8'], // pale bridge-stone
    ['mob:court_executioner', '#d0a0b8'], // court-rose death-knight
    ['mob:athraxis', '#9a86b4'], // the hollowed angel, void-dimmed
  ];
  for (const [target, tint] of ACT_TINTS) tintIns.run(target, tint);
}

/**
 * The DEN: one small generic cellar interior that every procedural mini-dungeon instance uses
 * (house basements + hidden wilderness dens, the Diablo cellar loop). The exit portal's authored
 * destination is a placeholder — the InstanceManager routes a den's exit back to wherever the
 * player descended (Instance.returnTo). Authored tiny: the world scale turns 260×200 into a
 * cellar-sized 1300×1000 room. Idempotent on the area id.
 */
function ensureDenContent(db: Database): void {
  if (db.prepare('SELECT 1 FROM areas WHERE id = ?').get('den')) return;
  db.prepare(
    'INSERT INTO areas (id,name,width,height,spawn_x,spawn_y,player_cap) VALUES (?,?,?,?,?,?,?)',
  ).run('den', 'A Forgotten Cellar', 260, 200, 130, 140, 4);
  db.prepare(
    `INSERT INTO area_theme
       (area_id,ground_base,ground_speck,prop,prop_density,atmo_color,atmo_alpha,outdoor,
        particle_color,particle_count,particle_rise,particle_flicker,weather,weather_intensity,
        fog_color,light_ambient,grade_saturation,grade_brightness,grade_contrast,sprite_tint)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    'den',
    '#171310',
    '#241d16',
    'none',
    0,
    '#120c08',
    0.38,
    0,
    '#caa46a',
    14,
    4,
    1,
    'none',
    0.5,
    '#0a0806',
    0.42,
    0.8,
    0.92,
    1.12,
    '#cfc4b0',
  );
  db.prepare(
    'INSERT INTO portals (area_id,rect_x,rect_y,rect_w,rect_h,to_area,to_spawn_x,to_spawn_y,label) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run('den', 115, 4, 30, 14, 'town', 160, 120, '↑ Climb out');
  const decorIns = db.prepare(
    'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
  );
  const DEN_DECOR: [string, number, number][] = [
    ['candle', 30, 30],
    ['candle', 228, 36],
    ['candle', 132, 178],
    ['pot', 40, 168],
    ['pot', 52, 162],
    ['pot', 216, 170],
    ['pot', 224, 178],
    ['bones', 80, 60],
    ['bones', 196, 132],
    ['crate', 36, 60],
    ['barrel', 226, 64],
    ['rock', 130, 100],
  ];
  for (const [kind, x, y] of DEN_DECOR) decorIns.run('den', kind, x, y, null, null, null, null);
}

/**
 * Upsert the frontier content (the Duskhaven village + Abyssal Throne endgame dungeon) into an
 * already-seeded DB. Areas/portals/themes/templates/rosters flow through ensureWorldExpansion;
 * this covers the NPC, decor, loot, quest, and vendor-shelf rows. Idempotent like its siblings.
 */
function ensureFrontierContent(db: Database): void {
  const npcExists = db.prepare('SELECT 1 FROM npcs WHERE area_id = ? AND name = ?');
  const npcIns = db.prepare('INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)');
  for (const n of FRONTIER_NPCS) {
    if (!npcExists.get(n.areaId, n.name)) npcIns.run(n.areaId, n.name, n.x, n.y, n.hue, n.kind);
  }

  const decorKindCount = db.prepare(
    'SELECT COUNT(*) AS n FROM decor WHERE area_id = ? AND kind = ?',
  );
  const decorIns = db.prepare(
    'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
  );
  const byAreaKind = new Map<string, typeof FRONTIER_DECOR>();
  for (const d of FRONTIER_DECOR) {
    const key = `${d.areaId}/${d.kind}`;
    byAreaKind.set(key, [...(byAreaKind.get(key) ?? []), d]);
  }
  for (const rows of byAreaKind.values()) {
    const first = rows[0]!;
    const { n } = decorKindCount.get(first.areaId, first.kind) as { n: number };
    if (n > 0) continue;
    for (const d of rows) {
      decorIns.run(
        d.areaId,
        d.kind,
        d.x,
        d.y,
        d.x2 ?? null,
        d.y2 ?? null,
        d.color ?? null,
        d.scale ?? null,
      );
    }
  }

  const lootExists = db.prepare('SELECT 1 FROM loot_entry WHERE mob_template_id = ? LIMIT 1');
  const lootIns = db.prepare(
    'INSERT INTO loot_entry (mob_template_id,grp,item_id,weight,min_qty,max_qty,is_nothing,chance) VALUES (?,?,?,?,?,?,?,?)',
  );
  const lootMobs = new Set(FRONTIER_LOOT.map((l) => l.mobTemplateId));
  for (const mobId of lootMobs) {
    if (lootExists.get(mobId)) continue;
    for (const l of FRONTIER_LOOT) {
      if (l.mobTemplateId !== mobId) continue;
      lootIns.run(mobId, l.grp, l.itemId, l.weight, l.minQty, l.maxQty, l.isNothing, l.chance);
    }
  }

  const insQuest = db.prepare(
    'INSERT OR IGNORE INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp,reward_item,turn_in_item,turn_in_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const q of FRONTIER_QUESTS) {
    insQuest.run(
      q.id,
      q.name,
      q.description,
      q.targetMob,
      q.targetCount,
      q.rewardGold,
      q.rewardXp,
      q.rewardItem ?? null,
      q.turnInItem ?? null,
      q.turnInCount ?? 0,
    );
  }

  // Duskhaven's Provisioner sells the Act 2 essentials (steel/mithril basics + a mid tome) so the
  // village is a real outfitting stop, not just a bed.
  const stockExists = db.prepare(
    'SELECT 1 FROM vendor_stock WHERE area_id = ? AND npc_name = ? LIMIT 1',
  );
  const stockIns = db.prepare(
    'INSERT INTO vendor_stock (area_id,npc_name,item_id,price,sort_order) VALUES (?,?,?,?,?)',
  );
  if (!stockExists.get('duskhaven', 'Maela the Provisioner')) {
    const shelf: [string, number][] = [
      ['steel_sword', 900],
      ['steel_armor', 1100],
      ['mithril_blade', 2400],
      ['mithril_armor', 2800],
      ['tome_divine_mending', 950],
    ];
    shelf.forEach(([itemId, price], i) =>
      stockIns.run('duskhaven', 'Maela the Provisioner', itemId, price, i),
    );
  }
}

/**
 * Upsert the asset-expansion content into an already-seeded DB: hand-placed decor (pots, graves,
 * candles…), the new 32rogues-roster monsters' spawns + loot, and the example `sprite_tints`
 * color overrides. Idempotent: decor guards per (area, kind); spawns per (area, template); loot
 * per mob having ANY rows; tints on the target primary key.
 */
function ensureExpansionContent(db: Database): void {
  // Hand-placed decor: insert an area's rows of a kind only when it has none of that kind yet
  // (the original ensureDecor guard is per-area, which would skip areas that already had ANY
  // decor — the town's tents must not block its new pots).
  const decorKindCount = db.prepare(
    'SELECT COUNT(*) AS n FROM decor WHERE area_id = ? AND kind = ?',
  );
  const decorIns = db.prepare(
    'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
  );
  const byAreaKind = new Map<string, typeof EXPANSION_DECOR>();
  for (const d of EXPANSION_DECOR) {
    const key = `${d.areaId}/${d.kind}`;
    byAreaKind.set(key, [...(byAreaKind.get(key) ?? []), d]);
  }
  for (const rows of byAreaKind.values()) {
    const first = rows[0]!;
    const { n } = decorKindCount.get(first.areaId, first.kind) as { n: number };
    if (n > 0) continue;
    for (const d of rows) {
      decorIns.run(
        d.areaId,
        d.kind,
        d.x,
        d.y,
        d.x2 ?? null,
        d.y2 ?? null,
        d.color ?? null,
        d.scale ?? null,
      );
    }
  }

  // New-monster area rosters (guarded by area+template, like the act expansion).
  const areaMobExists = db.prepare('SELECT 1 FROM area_mobs WHERE area_id = ? AND template_id = ?');
  const areaMobIns = db.prepare('INSERT INTO area_mobs (area_id,template_id,count) VALUES (?,?,?)');
  for (const s of EXPANSION_AREA_MOBS) {
    if (!areaMobExists.get(s.areaId, s.templateId)) areaMobIns.run(s.areaId, s.templateId, s.count);
  }

  // New-monster loot: skip a mob entirely once it has any loot rows.
  const lootExists = db.prepare('SELECT 1 FROM loot_entry WHERE mob_template_id = ? LIMIT 1');
  const lootIns = db.prepare(
    'INSERT INTO loot_entry (mob_template_id,grp,item_id,weight,min_qty,max_qty,is_nothing,chance) VALUES (?,?,?,?,?,?,?,?)',
  );
  const lootMobs = new Set(EXPANSION_LOOT.map((l) => l.mobTemplateId));
  for (const mobId of lootMobs) {
    if (lootExists.get(mobId)) continue;
    for (const l of EXPANSION_LOOT) {
      if (l.mobTemplateId !== mobId) continue;
      lootIns.run(mobId, l.grp, l.itemId, l.weight, l.minQty, l.maxQty, l.isNothing, l.chance);
    }
  }

  // Example SQL sprite color overrides — the dark/gritty variation system. Multiply tints over
  // the shared sprite sources; edit/add rows live via /set sprite_tints <target> tint <hex>.
  const tintIns = db.prepare('INSERT OR IGNORE INTO sprite_tints (target,tint) VALUES (?,?)');
  const TINTS: [string, string][] = [
    ['decor:tree', '#93a08c'], // Gloomwood canopy: drained, mossy grey-green
    ['decor:dead_tree', '#b8a89c'], // ashen driftwood
    ['decor:grave', '#aeb4cc'], // cold moonlit headstones
    ['decor:ruin', '#b0a8a0'], // dusty collapsed stone
    ['mob:rot_ghoul', '#a8c096'], // putrid green hide
    ['mob:gravetide_revenant', '#92aed0'], // drowned blue
    ['mob:mosshide_orc', '#9ec09a'], // moss-stained skin (sprite shared with future orc kin)
  ];
  for (const [target, tint] of TINTS) tintIns.run(target, tint);
}

/**
 * Upsert the dungeon-era content (new monster templates, the four dungeon areas + their themes, and
 * the dungeon entrance/return portals) into an already-seeded DB. Idempotent: INSERT OR IGNORE keyed
 * on the primary keys, and portals are guarded by (area_id, to_area) since that table has no natural
 * key. Safe to run every boot (a fresh DB seeded these already, so this no-ops).
 */
function ensureWorldExpansion(db: Database): void {
  const insMob = db.prepare(
    `INSERT OR IGNORE INTO mob_templates
       (id,name,hp,level,hue,speed,aggro_range,attack_range,damage,attack_cooldown_ms,
        behavior,telegraph_ms,projectile_speed,kite_range,slam_radius,dash_speed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const t of Object.values(MOB_TEMPLATES)) {
    insMob.run(
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

  const insArea = db.prepare(
    'INSERT OR IGNORE INTO areas (id,name,width,height,spawn_x,spawn_y,player_cap) VALUES (?,?,?,?,?,?,?)',
  );
  const insTheme = db.prepare(
    `INSERT OR IGNORE INTO area_theme
       (area_id,ground_base,ground_speck,prop,prop_density,atmo_color,atmo_alpha,outdoor,
        particle_color,particle_count,particle_rise,particle_flicker,weather,weather_intensity,
        fog_color,light_ambient,grade_saturation,grade_brightness,grade_contrast,sprite_tint)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const portalExists = db.prepare('SELECT 1 FROM portals WHERE area_id = ? AND to_area = ?');
  const insPortal = db.prepare(
    'INSERT INTO portals (area_id,rect_x,rect_y,rect_w,rect_h,to_area,to_spawn_x,to_spawn_y,label) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const a of Object.values(AREAS)) {
    insArea.run(a.id, a.name, a.width, a.height, a.spawn.x, a.spawn.y, a.playerCap);
    const t = AREA_THEMES[a.id] ?? DEFAULT_THEME;
    insTheme.run(
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
    // Only insert a portal that isn't already present for this (area → destination) pair, so the new
    // dungeon entrances appear on existing overworld areas without duplicating the original portals.
    for (const p of a.portals) {
      if (portalExists.get(a.id, p.toArea)) continue;
      insPortal.run(
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
  }

  // Quests (incl. the dungeon boss bounties) — INSERT OR IGNORE on the id PK, with full kill-quest
  // fields so an existing DB gains them correctly (the spellbook path only handled collect quests).
  const insQuestFull = db.prepare(
    'INSERT OR IGNORE INTO quests (id,name,description,target_mob,target_count,reward_gold,reward_xp,reward_item,turn_in_item,turn_in_count) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  for (const q of QUESTS) {
    insQuestFull.run(
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

  // Area-mob rosters for new OVERWORLD areas (dungeons populate procedurally, not from this table).
  // Guarded by (area_id, template_id) since area_mobs has no natural key.
  const areaMobExists = db.prepare('SELECT 1 FROM area_mobs WHERE area_id = ? AND template_id = ?');
  const areaMobIns = db.prepare('INSERT INTO area_mobs (area_id,template_id,count) VALUES (?,?,?)');
  for (const [areaId, spawns] of Object.entries(AREA_MOBS)) {
    for (const s of spawns) {
      if (!areaMobExists.get(areaId, s.templateId)) areaMobIns.run(areaId, s.templateId, s.count);
    }
  }

  // New act bosses have no drop table — give them a fat gold drop, like the other overworld bosses.
  const bossGoldExists = db.prepare(
    "SELECT 1 FROM loot_entry WHERE mob_template_id = ? AND grp = 'always' AND item_id = 'gold'",
  );
  const bossGoldIns = db.prepare(
    'INSERT INTO loot_entry (mob_template_id,grp,item_id,weight,min_qty,max_qty,is_nothing,chance) VALUES (?,?,?,?,?,?,?,?)',
  );
  const actBossGold: [string, number, number][] = [
    ['xalthirun', 400, 900],
    ['throne_tyrant', 700, 1500],
  ];
  for (const [mob, min, max] of actBossGold) {
    if (!bossGoldExists.get(mob)) bossGoldIns.run(mob, 'always', 'gold', 1, min, max, 0, 0);
  }

  // Quest-giver NPCs for the new overworld zones (idempotent by area + name), like the other zones.
  const zoneNpcExists = db.prepare('SELECT 1 FROM npcs WHERE area_id = ? AND name = ?');
  const zoneNpcIns = db.prepare(
    'INSERT INTO npcs (area_id,name,x,y,hue,kind) VALUES (?,?,?,?,?,?)',
  );
  const zoneNpcs: [string, string, number, number, number][] = [
    ['sundered_wastes', 'The Exiled Seer', 280, 1000, 285],
    ['blighted_spire', 'The Last Warden', 280, 1000, 110],
  ];
  for (const [area, name, x, y, hue] of zoneNpcs) {
    if (!zoneNpcExists.get(area, name)) zoneNpcIns.run(area, name, x, y, hue, 'questgiver');
  }
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
  // Equipment bases: seedItems() only runs on a fresh DB, so the expanded loot pool reaches an
  // already-seeded DB here. INSERT OR IGNORE keeps it idempotent (existing rows untouched).
  for (const e of Object.values(EQUIPMENT)) {
    insItem.run(e.id, e.name, 'equip', e.slot, e.power ?? null, e.hp ?? null, e.color, 0, null);
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
  // Gear (and thus affixed/named items) should drop often enough to feel like loot — bump any
  // stingy early gear chance up to 0.3 for already-seeded DBs. Idempotent (only raises, never loops).
  db.prepare("UPDATE loot_entry SET chance = 0.3 WHERE grp = 'gear' AND chance < 0.3").run();

  // Gems are content items (kind 'gem') so the client gets their name + color via the content
  // packet. Their stats/socket logic live in shared/gems.ts; here we just register them as items.
  // Sell value scales loosely with tier so a spare gem is still worth a little gold.
  for (const g of Object.values(GEMS)) {
    insItem.run(g.id, g.name, 'gem', null, null, null, g.color, g.tier * 10, null);
  }
  // Runes (for runewords): socketable like gems, registered as content items so the client gets
  // their name + color. The runeword detection lives in shared/runewords.ts.
  for (const r of RUNES) {
    insItem.run(r.id, r.name, 'gem', null, null, null, '#d8b25a', 50, null);
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
  ensureNpc('town', 'Vault Keeper', 1020, 560, 40, 'banker');
  ensureNpc('town', 'Captain Aldric', 700, 620, 210, 'recruiter');
  ensureNpc('town', 'Saelis the Riftkeeper', 760, 680, 270, 'riftkeeper');

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
  const password = config.server.devPassword;
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

// Canvas/wood tints reused across the camp props.
const CANVAS = '#c8b48a'; // tent / awning canvas
const WAGON_WOOD = '#6b4a2c';

/**
 * The starting town as a Diablo-II-style Rogue-Encampment camp: a spiked wooden PALISADE ring with
 * a gate on the east road, a central BONFIRE, canvas TENTS behind the service NPCs, a merchant
 * WAGON, a blacksmith ANVIL, scattered CRATES/BARRELS/HAY, and TORCH poles around the perimeter.
 * World coords (town is 1600×1200; spawn (800,600); NPC line y≈560, x580..1020; east portal road
 * around y600). Placements keep the NPC strip, the spawn, and the gate road clear.
 */
const TOWN_DECOR: readonly DecorProp[] = [
  // --- Palisade ring (spiked stake wall), with a gate gap on the east toward the Gloomwood road. ---
  { kind: 'palisade', x: 470, y: 440, x2: 1130, y2: 440 }, // north
  { kind: 'palisade', x: 470, y: 440, x2: 470, y2: 820 }, // west
  { kind: 'palisade', x: 470, y: 820, x2: 1130, y2: 820 }, // south
  { kind: 'palisade', x: 1130, y: 440, x2: 1130, y2: 555 }, // east (above the gate)
  { kind: 'palisade', x: 1130, y: 645, x2: 1130, y2: 820 }, // east (below the gate)
  { kind: 'gate', x: 1130, y: 600 }, // the camp gate, on the road east

  // --- Central bonfire: the camp's heart, south of the spawn/NPC line. ---
  { kind: 'bonfire', x: 800, y: 712 },

  // --- Canvas tents behind the service NPCs (the camp's residents). ---
  { kind: 'tent', x: 560, y: 478, color: CANVAS },
  { kind: 'tent', x: 690, y: 466, color: CANVAS },
  { kind: 'tent', x: 800, y: 460, color: CANVAS, scale: 1.15 }, // the big central tent (Akara's)
  { kind: 'tent', x: 910, y: 466, color: CANVAS },
  { kind: 'tent', x: 1040, y: 478, color: CANVAS },

  // --- Blacksmith anvil (by the Artificer) + the merchant's wagon (by the gambler/merchant). ---
  { kind: 'anvil', x: 520, y: 520 },
  { kind: 'wagon', x: 1050, y: 516, color: WAGON_WOOD },

  // --- Supplies: crates, barrels, hay bales tucked along the camp edges (clear of the NPC walk). ---
  { kind: 'crate', x: 512, y: 700 },
  { kind: 'crate', x: 556, y: 742 },
  { kind: 'crate', x: 1058, y: 700 },
  { kind: 'barrel', x: 600, y: 752 },
  { kind: 'barrel', x: 980, y: 752 },
  { kind: 'barrel', x: 1024, y: 726 },
  { kind: 'hay', x: 648, y: 690 },
  { kind: 'hay', x: 956, y: 690 },

  // --- Torch poles ringing the camp + flanking the gate (warm light at night). ---
  { kind: 'torch', x: 486, y: 452 },
  { kind: 'torch', x: 1114, y: 452 },
  { kind: 'torch', x: 486, y: 808 },
  { kind: 'torch', x: 1114, y: 808 },
  { kind: 'torch', x: 1120, y: 556 }, // gate, north post
  { kind: 'torch', x: 1120, y: 644 }, // gate, south post

  // --- Enterable timber HOUSES (footprint = (x,y) NW corner → (x2,y2) SE corner; color = walls).
  // The renderer fades each roof to near-transparent while you stand inside, so you can see your
  // character within. Placed away from the camp, spawn, and NPC line so they read as their own
  // buildings. Door is on the south wall (renderer convention).
  { kind: 'house', x: 250, y: 360, x2: 420, y2: 500, color: '#7a5636' },
  { kind: 'house', x: 1190, y: 360, x2: 1360, y2: 500, color: '#6e5a3e' },
  { kind: 'house', x: 700, y: 920, x2: 900, y2: 1060, color: '#7a5636' },

  // --- A shrine by the bonfire: step onto it to be blessed with a timed buff (recharges). ---
  { kind: 'shrine', x: 800, y: 772, color: '#7fd0ff' },

  // --- A loot chest tucked inside the south house — a reward for stepping indoors. ---
  { kind: 'chest', x: 800, y: 985, color: '#b9863f' },
];

/** Decor for the Hollowroot Caverns: shrines + chests tucked in the dark to reward exploring. */
const HOLLOWROOT_DECOR: readonly DecorProp[] = [
  { kind: 'shrine', x: 400, y: 820, color: '#9a7fff' },
  { kind: 'shrine', x: 1320, y: 1040, color: '#7fffd0' },
  { kind: 'chest', x: 760, y: 560, color: '#b9863f' },
  { kind: 'chest', x: 1180, y: 980, color: '#b9863f' },
];

/** All set-dressing decor, keyed by area. seedDecor/ensureDecor consume this. */
const DECOR: Record<string, readonly DecorProp[]> = {
  town: TOWN_DECOR,
  hollowroot: HOLLOWROOT_DECOR,
};

/** Insert one area's decor props. */
function seedAreaDecor(db: Database, areaId: string, props: readonly DecorProp[]): void {
  const ins = db.prepare(
    'INSERT INTO decor (area_id,kind,x,y,x2,y2,color,scale) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (const d of props) {
    ins.run(areaId, d.kind, d.x, d.y, d.x2 ?? null, d.y2 ?? null, d.color ?? null, d.scale ?? null);
  }
}

/** Insert every area's decor. Called inside the fresh-DB seed transaction. */
function seedDecor(db: Database): void {
  for (const [areaId, props] of Object.entries(DECOR)) seedAreaDecor(db, areaId, props);
}

/** Idempotently add each area's decor to an already-seeded DB (per-area no-op once it has props). */
function ensureDecor(db: Database): void {
  const countFor = db.prepare('SELECT COUNT(*) AS n FROM decor WHERE area_id = ?');
  for (const [areaId, props] of Object.entries(DECOR)) {
    const { n } = countFor.get(areaId) as { n: number };
    if (n === 0) seedAreaDecor(db, areaId, props);
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
  ins.run('town', 'Vault Keeper', 1020, 560, 40, 'banker');
  // A quest-giver near the arrival point of each new area, so the content is discoverable.
  ins.run('marsh', 'Bogged Pilgrim', 1100, 280, 95, 'questgiver');
  ins.run('mines', 'Stranded Miner', 900, 280, 18, 'questgiver');
  ins.run('frostpeak', 'Frostbound Warden', 1000, 300, 205, 'questgiver');
  ins.run('sundered_wastes', 'The Exiled Seer', 280, 1000, 285, 'questgiver');
  ins.run('blighted_spire', 'The Last Warden', 280, 1000, 110, 'questgiver');
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
  // --- Dungeon boss bounties: clear each dungeon's end-boss for a spell-tome reward ---
  {
    id: 'dungeon_catacombs',
    name: 'Silence the Bonecaller',
    description: 'Descend into the Forgotten Catacombs and destroy Maggath, the Bonecaller.',
    targetMob: 'maggath',
    targetCount: 1,
    rewardGold: 500,
    rewardXp: 600,
    rewardItem: 'tome_shadow_bolt',
  },
  {
    id: 'dungeon_hive',
    name: 'Burn the Brood',
    description: 'Cleanse the Writhing Hive and slay Vorraxia, the Brood Mother.',
    targetMob: 'vorraxia',
    targetCount: 1,
    rewardGold: 800,
    rewardXp: 1000,
    rewardItem: 'tome_poison_spit',
  },
  {
    id: 'dungeon_forge',
    name: 'Quench the Forge',
    description: "Break into the Infernal Forge and end Bal'thuzar, the Forgemaster.",
    targetMob: 'balthuzar',
    targetCount: 1,
    rewardGold: 1100,
    rewardXp: 1500,
    rewardItem: 'tome_infernonova',
  },
  {
    id: 'dungeon_vault',
    name: 'The Warden Eternal',
    description: 'Breach the Frozen Vault and shatter Kaldris, the Warden Eternal.',
    targetMob: 'kaldris',
    targetCount: 1,
    rewardGold: 1600,
    rewardXp: 2200,
    rewardItem: 'tome_glacierspike',
  },
  {
    id: 'act2_unmaker',
    name: 'The Unmaker',
    description: "Cross into the Sundered Wastes and end Xal'thirun, the Unmaker.",
    targetMob: 'xalthirun',
    targetCount: 1,
    rewardGold: 2000,
    rewardXp: 3000,
    rewardItem: 'tome_thunderlance',
  },
  {
    id: 'wastes_revenants',
    name: 'Thin the Revenants',
    description: 'Cull 8 Void Revenants haunting the Sundered Wastes.',
    targetMob: 'void_revenant',
    targetCount: 8,
    rewardGold: 900,
    rewardXp: 1200,
    rewardItem: 'tome_chainspark',
  },
  {
    id: 'act3_tyrant',
    name: 'The Throne-Tyrant',
    description: 'Scale the Blighted Spire and cast down Vorzel, the Throne-Tyrant.',
    targetMob: 'throne_tyrant',
    targetCount: 1,
    rewardGold: 3000,
    rewardXp: 4500,
    rewardItem: 'tome_meteor',
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

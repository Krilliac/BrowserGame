import { clamp } from '../shared/math.js';
import { moveVector } from '../shared/movement.js';
import {
  MAX_NAME_LENGTH,
  PLAYER_SPEED,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type EntityState,
  type InputState,
} from '../shared/protocol.js';
import {
  HP_REGEN_PER_SEC,
  MANA_REGEN_PER_SEC,
  MOB_RADIUS,
  MOB_RESPAWN_MS,
  PLAYER_MAX_HP,
  PLAYER_MAX_MANA,
  PLAYER_RADIUS,
  PLAYER_RESPAWN_MS,
  type AbilityId,
  type FxEvent,
} from '../shared/combat.js';
import { aimAngle, circlesOverlap, inMeleeCone } from './combat.js';
import {
  applyCrit,
  attackRoll,
  BASE_CRIT_CHANCE,
  defenceRoll,
  rollCrit,
  rollDamage,
  rolledHit,
} from './combat-formulas.js';
import {
  gearSellValue,
  rollItemInstance,
  type BaseItem,
  type ItemInstance,
} from '../shared/items.js';
import { stepMob, type MobTemplate, type MobView, type PlayerView } from './mobs.js';
import { levelForXp, levelProgress, maxHpForLevel, xpForLevel, xpReward } from './progression.js';
import { StatusSet } from './status-effects.js';
import { getContent } from './content.js';
import { weatherModifiers } from './weather-effects.js';
import type { WeatherKind } from '../shared/theme.js';

const PICKUP_RADIUS = 30;
const ITEM_TTL_MS = 30_000;
const INTERACT_RANGE = 70;
const DASH_MS = 300; // how long a charger's lunge lasts

// Living loot meta — a "hunting bounty" per monster type that regenerates while it is left alone and
// is consumed on a kill, so the first kills after a lull are richer and spam-farming yields base loot.
const BOUNTY_FULL_MS = 60_000; // a minute untouched = a full bounty
const BOUNTY_MAX_CHANCE = 0.5; // bonus-drop chance at a full bounty

// Elite ("champion") monsters: a small chance to spawn a beefed-up variant with a flavor modifier.
const ELITE_CHANCE = 0.09;
const ELITE_MODIFIERS: { name: string; hp: number; dmg: number; spd: number }[] = [
  { name: 'Swift', hp: 2.0, dmg: 1.3, spd: 1.6 }, // fast and harassing
  { name: 'Brutal', hp: 2.4, dmg: 1.9, spd: 1.0 }, // hits like a truck
  { name: 'Vigorous', hp: 3.4, dmg: 1.4, spd: 1.0 }, // a damage sponge
];

export interface SpawnOptions {
  id?: number;
  x?: number;
  y?: number;
  hue?: number;
}

interface Player {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  facing: number;
  hp: number;
  maxHp: number;
  mana: number;
  level: number;
  xp: number;
  gold: number;
  loot: Map<string, number>;
  /** Unequipped gear instances in the bag (rolled rarity + stats). */
  gear: ItemInstance[];
  equipment: { weapon: ItemInstance | null; armor: ItemInstance | null };
  power: number;
  /** Crit chance in [0,1]: base plus the sum of equipped +crit affixes. */
  critChance: number;
  /** Extra projectiles per projectile cast, from equipped +multishot affixes. */
  multishot: number;
  god: boolean;
  quests: Map<string, number>; // questId -> kill progress
  questsDone: Set<string>;
  input: InputState;
  lastSeq: number;
  cooldowns: Map<AbilityId, number>;
  dead: boolean;
  respawnAt: number;
}

/** Serializable player state, carried across area instances on a portal crossing. */
export interface PlayerSave {
  name: string;
  hue: number;
  hp: number;
  mana: number;
  level: number;
  xp: number;
  gold: number;
  loot: [string, number][];
  gear: ItemInstance[];
  weapon: ItemInstance | null;
  armor: ItemInstance | null;
  god: boolean;
  quests: [string, number][];
  questsDone: string[];
}

interface Mob {
  id: number;
  templateId: string;
  name: string;
  x: number;
  y: number;
  homeX: number;
  homeY: number;
  hue: number;
  facing: number;
  hp: number;
  maxHp: number;
  level: number;
  attackCd: number;
  wanderAngle: number | null;
  wanderUntil: number;
  statuses: StatusSet;
  lastAttacker: number;
  dead: boolean;
  respawnAt: number;
  /** Attack wind-up: sim time (ms) the telegraphed strike lands at (0 = not winding up). */
  telegraphUntil: number;
  /** Aim locked when the wind-up started (so a moving player can dodge out of it). */
  telegraphFacing: number;
  telegraphTargetId: number;
  /** Charger dash: sim time (ms) the lunge ends at (0 = not dashing). */
  dashUntil: number;
  dashVx: number;
  dashVy: number;
  /** Players already struck by the current dash (each is hit at most once per lunge). */
  dashHit: Set<number>;
  /** Elite ("champion") flag + its stat multipliers; bigger, deadlier, drops better loot. */
  elite: boolean;
  dmgMult: number;
  spdMult: number;
}

interface Projectile {
  id: number;
  abilityId: AbilityId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
  damage: number;
  radius: number;
  ownerId: number;
  ownerLevel: number;
  /** Owner's crit chance at fire time (player projectiles); 0 for mob projectiles. */
  critChance: number;
  /** True for an enemy (mob) projectile — it damages players instead of mobs. */
  hostile: boolean;
}

interface GroundItem {
  id: number;
  itemId: string;
  qty: number;
  x: number;
  y: number;
  ttl: number;
  /** Set for gear drops: the rolled instance the picker-up receives. */
  instance?: ItemInstance;
}

interface Npc {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: 'vendor' | 'questgiver';
}

/**
 * The authoritative simulation for ONE area instance: players, monsters, projectiles, and
 * combat. Pure of any networking/timers so it is fully testable and could run in its own
 * process (the AreaServer model). Inputs/casts come in, the world advances by a fixed dt,
 * a snapshot + transient effects go out. No client ever writes state directly.
 */
export class World {
  private localId = 1;
  private readonly allocId: () => number;
  private now = 0; // accumulated sim time, ms (drives cooldowns/respawns)

  private readonly players = new Map<number, Player>();
  private readonly mobs = new Map<number, Mob>();
  private readonly projectiles = new Map<number, Projectile>();
  private readonly items = new Map<number, GroundItem>();
  private readonly npcs = new Map<number, Npc>();
  private events: FxEvent[] = [];
  private notices: { playerId: number; text: string }[] = [];
  /** Living-loot meta: sim time (ms) each monster type was last killed, for the hunting bounty. */
  private readonly lastKillAt = new Map<string, number>();
  // Server-authoritative weather modifiers (so weather affects gameplay, not just visuals).
  private moveScale = 1;
  private aggroScale = 1;

  constructor(
    private readonly width: number = WORLD_WIDTH,
    private readonly height: number = WORLD_HEIGHT,
    private readonly spawnPoint: { x: number; y: number } = {
      x: WORLD_WIDTH / 2,
      y: WORLD_HEIGHT / 2,
    },
    allocId?: () => number,
  ) {
    this.allocId = allocId ?? (() => this.localId++);
  }

  /**
   * Apply the area's weather as gameplay modifiers (move speed, monster aggro range). Called by the
   * instance manager on creation and re-applied when a live theme edit changes the weather.
   */
  applyWeather(weather: WeatherKind): void {
    const mods = weatherModifiers(weather);
    this.moveScale = mods.moveScale;
    this.aggroScale = mods.aggroScale;
  }

  /** Populate the area's monsters. Called once by the instance manager after construction. */
  populateMobs(areaId: string): void {
    const content = getContent();
    for (const spawn of content.areaMobs(areaId)) {
      const template = content.mobTemplate(spawn.templateId);
      if (!template) continue;
      for (let i = 0; i < spawn.count; i++) {
        this.createMob(
          template,
          80 + Math.random() * (this.width - 160),
          80 + Math.random() * (this.height - 160),
        );
      }
    }
  }

  private createMob(template: MobTemplate, x: number, y: number): void {
    const id = this.allocId();
    // Elite ("champion") roll: a rare, beefed-up variant with a modifier prefix. Bosses (very high
    // HP) never roll elite — they are already special.
    const isBoss = template.hp >= 200;
    const elite = !isBoss && Math.random() < ELITE_CHANCE;
    const mod = elite
      ? (ELITE_MODIFIERS[Math.floor(Math.random() * ELITE_MODIFIERS.length)] ?? null)
      : null;
    const hp = mod ? Math.round(template.hp * mod.hp) : template.hp;
    this.mobs.set(id, {
      id,
      templateId: template.id,
      name: mod ? `${mod.name} ${template.name}` : template.name,
      x,
      y,
      homeX: x,
      homeY: y,
      hue: template.hue,
      facing: 0,
      hp,
      maxHp: hp,
      level: template.level,
      attackCd: 0,
      wanderAngle: null,
      wanderUntil: 0,
      statuses: new StatusSet(),
      lastAttacker: 0,
      dead: false,
      respawnAt: 0,
      telegraphUntil: 0,
      telegraphFacing: 0,
      telegraphTargetId: 0,
      dashUntil: 0,
      dashVx: 0,
      dashVy: 0,
      dashHit: new Set(),
      elite,
      dmgMult: mod ? mod.dmg : 1,
      spdMult: mod ? mod.spd : 1,
    });
  }

  /** Place static NPCs for the area (from the content DB). Called once after construction. */
  populateNpcs(areaId: string): void {
    for (const npc of getContent().npcs(areaId)) {
      const id = this.allocId();
      const kind = npc.kind === 'questgiver' ? 'questgiver' : 'vendor';
      this.npcs.set(id, { id, name: npc.name, x: npc.x, y: npc.y, hue: npc.hue, kind });
    }
  }

  /** Interact with the nearest in-range NPC: a vendor buys loot, a quest-giver offers quests. */
  interact(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    for (const npc of this.npcs.values()) {
      if (Math.hypot(player.x - npc.x, player.y - npc.y) > INTERACT_RANGE) continue;
      if (npc.kind === 'vendor') this.sellToVendor(player);
      else this.talkToQuestGiver(player);
      return;
    }
  }

  /** Sell the player's whole bag (materials + gear) to a vendor for gold. */
  private sellToVendor(player: Player): void {
    const content = getContent();
    let gold = 0;
    for (const [item, qty] of player.loot) {
      const value = content.sellValue(item);
      if (value <= 0 || qty <= 0) continue;
      gold += value * qty;
      player.loot.delete(item);
    }
    for (const inst of player.gear) gold += gearSellValue(inst);
    player.gear = [];
    if (gold <= 0) return;
    player.gold += gold;
    this.events.push({ kind: 'coin', x: player.x, y: player.y, value: gold });
  }

  /** Offer the next un-taken quest, or report progress if there is nothing new. */
  private talkToQuestGiver(player: Player): void {
    const quests = getContent().quests();
    const next = quests.find((q) => !player.quests.has(q.id) && !player.questsDone.has(q.id));
    if (next) {
      player.quests.set(next.id, 0);
      this.notify(player.id, `Quest accepted: ${next.name} — ${next.description}`);
      return;
    }
    const active = quests.find((q) => player.quests.has(q.id));
    if (active) {
      const got = player.quests.get(active.id) ?? 0;
      this.notify(player.id, `In progress: ${active.name} (${got}/${active.targetCount})`);
    } else {
      this.notify(player.id, 'No new quests right now — well done, adventurer.');
    }
  }

  /** Equip a gear instance (by uid) from the player's bag, returning displaced gear to the bag. */
  equip(id: number, uid: number): void {
    const player = this.players.get(id);
    if (!player) return;
    const idx = player.gear.findIndex((g) => g.uid === uid);
    if (idx < 0) return;
    const inst = player.gear[idx]!;
    const def = getContent().item(inst.baseId);
    const slot = def?.slot;
    if (slot !== 'weapon' && slot !== 'armor') return;

    player.gear.splice(idx, 1);
    const previous = player.equipment[slot];
    if (previous) player.gear.push(previous);
    player.equipment[slot] = inst;
    this.recomputeStats(player);
  }

  /** Derive power, max HP, and crit chance from level, equipped base stats, and affixes. */
  private recomputeStats(player: Player): void {
    let power = player.equipment.weapon?.power ?? 0;
    let bonusHp = player.equipment.armor?.hp ?? 0;
    let crit = BASE_CRIT_CHANCE;
    let multishot = 0;
    for (const inst of [player.equipment.weapon, player.equipment.armor]) {
      if (!inst) continue;
      for (const a of inst.affixes ?? []) {
        if (a.stat === 'power') power += a.value;
        else if (a.stat === 'hp') bonusHp += a.value;
        else if (a.stat === 'crit') crit += a.value / 100;
        else if (a.stat === 'multishot') multishot += a.value;
      }
    }
    player.power = power;
    player.critChance = crit;
    player.multishot = multishot;
    player.maxHp = maxHpForLevel(player.level) + bonusHp;
    if (player.hp > player.maxHp) player.hp = player.maxHp;
  }

  // --- GM / chat-command support (gated by access level in commands.ts) ----------------

  teleport(id: number, x: number, y: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.x = clamp(x, 0, this.width);
    p.y = clamp(y, 0, this.height);
  }

  healFull(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.hp = p.maxHp;
    p.mana = PLAYER_MAX_MANA;
  }

  /** Spawn a monster near the player. Returns false for an unknown template. */
  spawnMobAt(playerId: number, templateId: string): boolean {
    const p = this.players.get(playerId);
    if (!p) return false;
    const template = getContent().mobTemplate(templateId);
    if (!template) return false;
    this.createMob(template, p.x + (Math.random() - 0.5) * 60, p.y + (Math.random() - 0.5) * 60);
    return true;
  }

  /**
   * Add an item to a player's bag. Equipment becomes rolled gear instance(s) in the gear bag;
   * materials/currency stack in the loot map. Returns false for an unknown item id.
   */
  giveItem(id: number, itemId: string, qty: number): boolean {
    const p = this.players.get(id);
    const def = getContent().item(itemId);
    if (!p || !def) return false;
    const n = Math.max(1, qty);
    if (def.kind === 'equip' && (def.slot === 'weapon' || def.slot === 'armor')) {
      const base: BaseItem = {
        id: def.id,
        name: def.name,
        slot: def.slot,
        power: def.power,
        hp: def.hp,
      };
      for (let i = 0; i < n; i++) p.gear.push(rollItemInstance(this.allocId(), base));
    } else {
      p.loot.set(itemId, (p.loot.get(itemId) ?? 0) + n);
    }
    return true;
  }

  setLevel(id: number, level: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.xp = xpForLevel(Math.max(1, level));
    p.level = levelForXp(p.xp);
    this.recomputeStats(p);
  }

  addXp(id: number, amount: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.xp = Math.max(0, p.xp + amount);
    p.level = levelForXp(p.xp);
    this.recomputeStats(p);
  }

  toggleGod(id: number): boolean {
    const p = this.players.get(id);
    if (!p) return false;
    p.god = !p.god;
    return p.god;
  }

  killAllMobs(): number {
    let n = 0;
    for (const mob of this.mobs.values()) {
      if (mob.dead) continue;
      mob.dead = true;
      mob.respawnAt = this.now + MOB_RESPAWN_MS;
      this.events.push({ kind: 'death', x: mob.x, y: mob.y });
      n++;
    }
    return n;
  }

  playerPos(id: number): { x: number; y: number } | undefined {
    const p = this.players.get(id);
    return p ? { x: p.x, y: p.y } : undefined;
  }

  playerNames(): string[] {
    return [...this.players.values()].map((p) => p.name);
  }

  /** Create a player. Pass an explicit id to keep identity stable across area transfers. */
  spawn(name: string, opts: SpawnOptions = {}): number {
    const id = opts.id ?? this.allocId();
    this.players.set(id, {
      id,
      name: sanitizeName(name),
      x: opts.x ?? this.spawnPoint.x,
      y: opts.y ?? this.spawnPoint.y,
      hue: opts.hue ?? (id * 47) % 360,
      facing: 0,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      mana: PLAYER_MAX_MANA,
      level: 1,
      xp: 0,
      gold: 0,
      loot: new Map(),
      gear: [],
      equipment: { weapon: null, armor: null },
      power: 0,
      critChance: BASE_CRIT_CHANCE,
      multishot: 0,
      god: false,
      quests: new Map(),
      questsDone: new Set(),
      input: { up: false, down: false, left: false, right: false },
      lastSeq: 0,
      cooldowns: new Map(),
      dead: false,
      respawnAt: 0,
    });
    return id;
  }

  /** Snapshot a player's persistent state to carry across an area transfer. */
  exportPlayer(id: number): PlayerSave | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    return {
      name: p.name,
      hue: p.hue,
      hp: p.hp,
      mana: p.mana,
      level: p.level,
      xp: p.xp,
      gold: p.gold,
      loot: [...p.loot],
      gear: [...p.gear],
      weapon: p.equipment.weapon,
      armor: p.equipment.armor,
      god: p.god,
      quests: [...p.quests],
      questsDone: [...p.questsDone],
    };
  }

  /** Restore a player (with stable id) from a save, at the given position. */
  importPlayer(id: number, save: PlayerSave, x: number, y: number): void {
    this.spawn(save.name, { id, x, y, hue: save.hue });
    const p = this.players.get(id);
    if (!p) return;
    p.level = save.level;
    p.xp = save.xp;
    p.gold = save.gold;
    p.loot = new Map(save.loot);
    p.gear = [...save.gear];
    p.equipment = { weapon: save.weapon, armor: save.armor };
    p.god = save.god;
    p.quests = new Map(save.quests);
    p.questsDone = new Set(save.questsDone);
    this.recomputeStats(p);
    p.hp = Math.min(save.hp, p.maxHp);
    p.mana = save.mana;
  }

  remove(id: number): void {
    this.players.delete(id);
  }

  setInput(id: number, input: InputState, seq = 0): void {
    const player = this.players.get(id);
    if (!player) return;
    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    };
    if (seq > player.lastSeq) player.lastSeq = seq;
  }

  /** Cast an ability aimed in direction (dx,dy). Validated server-side: alive, cooldown, mana. */
  cast(id: number, abilityId: AbilityId, dx: number, dy: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const ability = getContent().ability(abilityId);
    if (!ability) return;
    if ((player.cooldowns.get(abilityId) ?? 0) > 0 || player.mana < ability.manaCost) return;

    const facing = aimAngle(dx, dy, player.facing);
    player.facing = facing;
    player.mana -= ability.manaCost;
    player.cooldowns.set(abilityId, ability.cooldownMs);
    this.events.push({ kind: 'cast', x: player.x, y: player.y, facing, abilityId });

    if (ability.kind === 'heal') {
      player.hp = Math.min(player.maxHp, player.hp + ability.damage);
    } else if (ability.kind === 'melee') {
      const halfAngle = ability.meleeHalfAngle ?? 0.6;
      for (const mob of this.mobs.values()) {
        if (mob.dead) continue;
        if (inMeleeCone(player.x, player.y, facing, mob.x, mob.y, ability.range, halfAngle)) {
          const base = rollAbilityDamage(player.level, mob.level, ability.damage + player.power);
          const crit = base > 0 && rollCrit(Math.random, player.critChance);
          const dmg = applyCrit(base, crit);
          this.damageMob(mob, dmg, abilityId, player.id, crit);
          if (dmg > 0) applyStatus(mob, abilityId);
        }
      }
    } else {
      // Multishot affixes add extra projectiles, fanned around the aim — gear shapes the kit.
      const speed = ability.projectileSpeed ?? 300;
      const count = 1 + player.multishot;
      const spread = 0.18; // radians between adjacent shots
      for (let i = 0; i < count; i++) {
        const a = facing + (i - (count - 1) / 2) * spread;
        const pid = this.allocId();
        this.projectiles.set(pid, {
          id: pid,
          abilityId,
          x: player.x,
          y: player.y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          ttl: ability.projectileTtlMs ?? 1200,
          damage: ability.damage + player.power,
          radius: ability.radius,
          ownerId: player.id,
          ownerLevel: player.level,
          critChance: player.critChance,
          hostile: false,
        });
      }
    }
  }

  /** Advance the simulation by dt seconds. */
  tick(dt: number): void {
    this.now += dt * 1000;
    this.tickPlayers(dt);
    this.tickMobs(dt);
    this.tickProjectiles(dt);
    this.tickItems(dt);
  }

  private tickPlayers(dt: number): void {
    for (const player of this.players.values()) {
      if (player.dead) {
        if (this.now >= player.respawnAt) this.respawnPlayer(player);
        continue;
      }
      player.mana = Math.min(PLAYER_MAX_MANA, player.mana + MANA_REGEN_PER_SEC * dt);
      player.hp = Math.min(player.maxHp, player.hp + HP_REGEN_PER_SEC * dt);
      for (const [ability, remaining] of player.cooldowns) {
        const next = remaining - dt * 1000;
        if (next <= 0) player.cooldowns.delete(ability);
        else player.cooldowns.set(ability, next);
      }

      const { dx, dy } = moveVector(player.input);
      if (dx !== 0 || dy !== 0) {
        const speed = PLAYER_SPEED * this.moveScale; // weather may slow movement
        player.x = clamp(player.x + dx * speed * dt, 0, this.width);
        player.y = clamp(player.y + dy * speed * dt, 0, this.height);
        player.facing = Math.atan2(dy, dx);
      }
    }
  }

  private tickMobs(dt: number): void {
    const views: PlayerView[] = [...this.players.values()].map((p) => ({
      id: p.id,
      x: p.x,
      y: p.y,
      alive: !p.dead,
    }));

    for (const mob of this.mobs.values()) {
      if (mob.dead) {
        if (this.now >= mob.respawnAt) this.respawnMob(mob);
        continue;
      }
      if (mob.attackCd > 0) mob.attackCd -= dt * 1000;

      // Status effects: burn deals DoT (attributed to the last attacker), slow scales movement.
      const burn = mob.statuses.tick(dt * 1000).burnDamage;
      if (burn > 0) this.damageMob(mob, burn, undefined, mob.lastAttacker);
      if (mob.dead) continue;
      const slow = mob.statuses.slowFactor();

      const template = getContent().mobTemplate(mob.templateId)!;

      // Charger lunge: while dashing, the mob barrels along its locked aim, striking each player it
      // passes through once. Overrides normal movement/attack until the dash ends.
      if (mob.dashUntil > 0) {
        if (this.now >= mob.dashUntil) {
          mob.dashUntil = 0;
        } else {
          mob.x = clamp(mob.x + mob.dashVx * dt, 0, this.width);
          mob.y = clamp(mob.y + mob.dashVy * dt, 0, this.height);
          for (const player of this.players.values()) {
            if (player.dead || mob.dashHit.has(player.id)) continue;
            if (circlesOverlap(mob.x, mob.y, MOB_RADIUS, player.x, player.y, PLAYER_RADIUS)) {
              this.damagePlayer(player, template.damage * mob.dmgMult);
              mob.dashHit.add(player.id);
            }
          }
          continue;
        }
      }

      // Attack wind-up: a telegraphed mob is rooted, facing its locked aim. The strike lands when
      // the wind-up elapses — moving out of the way during it is how a player dodges.
      if (mob.telegraphUntil > 0) {
        mob.facing = mob.telegraphFacing;
        if (this.now >= mob.telegraphUntil) {
          mob.telegraphUntil = 0;
          this.executeMobAttack(mob, template);
          mob.attackCd = template.attackCooldownMs;
        }
        continue;
      }

      const view: MobView = { x: mob.x, y: mob.y, template, attackReady: mob.attackCd <= 0 };
      const intent = stepMob(view, views, this.aggroScale); // weather may dampen aggro range

      if (intent.attackTargetId !== null) {
        const target = this.players.get(intent.attackTargetId);
        if (target && !target.dead) {
          mob.facing = intent.facing ?? mob.facing;
          mob.telegraphFacing = mob.facing;
          mob.telegraphTargetId = target.id;
          if (template.telegraphMs > 0) {
            // Begin the wind-up; show the tell so the player can react.
            mob.telegraphUntil = this.now + template.telegraphMs;
            // A slammer shows an AoE circle; a charger telegraphs the lunge as an aimed line; plain
            // melee shows a strike arc; ranged shows its aim line.
            const tellStyle: 'melee' | 'ranged' | 'slam' = template.slamRadius
              ? 'slam'
              : template.behavior === 'melee'
                ? 'melee'
                : 'ranged';
            const tele: FxEvent = {
              kind: 'telegraph',
              x: mob.x,
              y: mob.y,
              facing: mob.facing,
              value: template.telegraphMs,
              behavior: tellStyle,
            };
            if (template.slamRadius) tele.radius = template.slamRadius;
            this.events.push(tele);
          } else {
            this.executeMobAttack(mob, template);
            mob.attackCd = template.attackCooldownMs;
          }
        }
      } else if (intent.vx !== 0 || intent.vy !== 0) {
        mob.x = clamp(mob.x + intent.vx * slow * mob.spdMult * dt, 0, this.width);
        mob.y = clamp(mob.y + intent.vy * slow * mob.spdMult * dt, 0, this.height);
        if (intent.facing !== null) mob.facing = intent.facing;
      } else {
        this.wander(mob, dt, template.speed * slow * mob.spdMult);
      }
    }
  }

  /**
   * Resolve a mob's attack at the moment its wind-up completes. Melee strikes the locked target if
   * it is still in reach (so dodging out of range whiffs it); ranged fires a hostile projectile
   * along the locked aim (so side-stepping the line dodges it).
   */
  private executeMobAttack(mob: Mob, template: MobTemplate): void {
    if (template.behavior === 'charger') {
      // Begin the lunge along the locked aim; contact damage is applied during the dash ticks.
      mob.dashUntil = this.now + DASH_MS;
      const dashSpeed = (template.dashSpeed ?? 480) * mob.spdMult;
      mob.dashVx = Math.cos(mob.telegraphFacing) * dashSpeed;
      mob.dashVy = Math.sin(mob.telegraphFacing) * dashSpeed;
      mob.dashHit.clear();
      this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
      return;
    }
    if (template.behavior === 'ranged') {
      const speed = template.projectileSpeed ?? 280;
      const pid = this.allocId();
      this.projectiles.set(pid, {
        id: pid,
        abilityId: 'arrow', // sprite hint only; the client tints hostile projectiles separately
        x: mob.x,
        y: mob.y,
        vx: Math.cos(mob.telegraphFacing) * speed,
        vy: Math.sin(mob.telegraphFacing) * speed,
        ttl: 2400,
        damage: template.damage * mob.dmgMult,
        radius: 8,
        ownerId: 0,
        ownerLevel: template.level,
        critChance: 0,
        hostile: true,
      });
      this.events.push({ kind: 'cast', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
      return;
    }
    // Melee: a slam hits everyone within slamRadius; a normal strike hits the locked target if it
    // is still in reach. Either way, dodging out of range during the wind-up avoids the hit.
    if (template.slamRadius) {
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (Math.hypot(player.x - mob.x, player.y - mob.y) <= template.slamRadius + PLAYER_RADIUS) {
          this.damagePlayer(player, template.damage * mob.dmgMult);
        }
      }
      this.events.push({ kind: 'slam', x: mob.x, y: mob.y, radius: template.slamRadius });
      return;
    }
    const target = this.players.get(mob.telegraphTargetId);
    const reach = template.attackRange + PLAYER_RADIUS;
    if (target && !target.dead && Math.hypot(target.x - mob.x, target.y - mob.y) <= reach) {
      this.damagePlayer(target, template.damage * mob.dmgMult);
    }
    this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.telegraphFacing });
  }

  private tickProjectiles(dt: number): void {
    for (const proj of this.projectiles.values()) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.ttl -= dt * 1000;

      let consumed = false;
      if (proj.hostile) {
        // Enemy projectile: hits the first living, non-godmode player it overlaps.
        for (const player of this.players.values()) {
          if (player.dead) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, player.x, player.y, PLAYER_RADIUS)) {
            this.damagePlayer(player, proj.damage);
            consumed = true;
            break;
          }
        }
      } else {
        for (const mob of this.mobs.values()) {
          if (mob.dead) continue;
          if (circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) {
            const base = rollAbilityDamage(proj.ownerLevel, mob.level, proj.damage);
            const crit = base > 0 && rollCrit(Math.random, proj.critChance);
            const dmg = applyCrit(base, crit);
            this.damageMob(mob, dmg, proj.abilityId, proj.ownerId, crit);
            if (dmg > 0) applyStatus(mob, proj.abilityId);
            consumed = true;
            break;
          }
        }
      }
      if (consumed || proj.ttl <= 0 || this.outOfBounds(proj.x, proj.y)) {
        this.projectiles.delete(proj.id);
      }
    }
  }

  private wander(mob: Mob, dt: number, speed: number): void {
    if (this.now >= mob.wanderUntil) {
      mob.wanderAngle = Math.random() < 0.6 ? Math.random() * Math.PI * 2 : null;
      mob.wanderUntil = this.now + 800 + Math.random() * 1600;
    }
    // Leash back home if we have drifted too far.
    const homeDist = Math.hypot(mob.x - mob.homeX, mob.y - mob.homeY);
    if (homeDist > 220) mob.wanderAngle = Math.atan2(mob.homeY - mob.y, mob.homeX - mob.x);
    if (mob.wanderAngle === null) return;
    mob.x = clamp(mob.x + Math.cos(mob.wanderAngle) * speed * 0.35 * dt, 0, this.width);
    mob.y = clamp(mob.y + Math.sin(mob.wanderAngle) * speed * 0.35 * dt, 0, this.height);
    mob.facing = mob.wanderAngle;
  }

  private damageMob(
    mob: Mob,
    amount: number,
    abilityId: AbilityId | undefined,
    attackerId: number,
    crit = false,
  ): void {
    if (attackerId !== 0) mob.lastAttacker = attackerId;
    mob.hp -= amount;
    const hit: FxEvent = { kind: 'hit', x: mob.x, y: mob.y, value: Math.ceil(amount) };
    if (abilityId !== undefined) hit.abilityId = abilityId;
    if (crit) hit.crit = true;
    this.events.push(hit);
    if (mob.hp <= 0) {
      mob.dead = true;
      mob.respawnAt = this.now + MOB_RESPAWN_MS;
      this.events.push({ kind: 'death', x: mob.x, y: mob.y });
      this.onMobKilled(mob);
    }
  }

  /** Award XP to the killer and drop loot on the ground. */
  private onMobKilled(mob: Mob): void {
    const killer = this.players.get(mob.lastAttacker);
    if (killer) {
      killer.xp += xpReward(mob.level) * (mob.elite ? 3 : 1); // champions give a big XP bonus
      const newLevel = levelForXp(killer.xp);
      if (newLevel > killer.level) {
        this.notify(killer.id, `You reached level ${newLevel}!`);
        this.events.push({ kind: 'levelup', x: killer.x, y: killer.y, value: newLevel });
      }
      killer.level = newLevel;
      this.recomputeStats(killer);
      this.progressQuests(killer, mob.templateId);
    }
    // Loot (materials + gear) comes from the DB-backed content drop tables. Equipment items roll a
    // rarity + stats into a unique instance; materials/currency drop as plain stacks.
    const content = getContent();
    for (const stack of content.rollLoot(mob.templateId)) {
      const id = this.allocId();
      const item: GroundItem = {
        id,
        itemId: stack.item,
        qty: stack.qty,
        x: mob.x + (Math.random() - 0.5) * 30,
        y: mob.y + (Math.random() - 0.5) * 30,
        ttl: ITEM_TTL_MS,
      };
      const def = content.item(stack.item);
      if (def && def.kind === 'equip' && (def.slot === 'weapon' || def.slot === 'armor')) {
        const base: BaseItem = {
          id: def.id,
          name: def.name,
          slot: def.slot,
          power: def.power,
          hp: def.hp,
        };
        item.instance = rollItemInstance(this.allocId(), base);
      }
      this.items.set(id, item);
    }

    // Champion bonus: a pile of gold + one guaranteed, rarity-bumped piece of gear.
    if (mob.elite) {
      this.dropGround('gold', 30 + Math.floor(Math.random() * 50), mob.x, mob.y);
      this.dropBonusGear(mob.x, mob.y, 2);
    }

    // Living loot meta: consume this monster type's accumulated hunting bounty. A long lull since the
    // last kill (or a never-farmed type) means a high chance of a bonus rarity-bumped drop; the kill
    // resets the timer, so farming the same spot quickly depletes it back to base loot.
    const last = this.lastKillAt.get(mob.templateId);
    const bounty = last === undefined ? 1 : Math.min(1, (this.now - last) / BOUNTY_FULL_MS);
    this.lastKillAt.set(mob.templateId, this.now);
    if (Math.random() < bounty * BOUNTY_MAX_CHANCE) {
      this.dropBonusGear(mob.x, mob.y, 1);
      if (killer) this.notify(killer.id, 'A hunting bounty! Fresh quarry yields richer loot.');
    }
  }

  /** Drop one random equipment piece as a rolled, rarity-bumped instance (elite + bounty rewards). */
  private dropBonusGear(x: number, y: number, rarityBump: number): void {
    const equips = getContent()
      .items()
      .filter((i) => i.kind === 'equip' && (i.slot === 'weapon' || i.slot === 'armor'));
    const def = equips[Math.floor(Math.random() * equips.length)];
    if (!def) return;
    const base: BaseItem = {
      id: def.id,
      name: def.name,
      slot: def.slot as 'weapon' | 'armor',
      power: def.power,
      hp: def.hp,
    };
    const ground = this.dropGround(def.id, 1, x, y);
    ground.instance = rollItemInstance(this.allocId(), base, Math.random, rarityBump);
  }

  /** Spawn a ground item (gold or a material/gear stack) with a little scatter. Returns it. */
  private dropGround(itemId: string, qty: number, x: number, y: number): GroundItem {
    const id = this.allocId();
    const item: GroundItem = {
      id,
      itemId,
      qty,
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 30,
      ttl: ITEM_TTL_MS,
    };
    this.items.set(id, item);
    return item;
  }

  // --- quests + per-player notices -----------------------------------------------------

  private notify(playerId: number, text: string): void {
    this.notices.push({ playerId, text });
  }

  /** Drain per-player system notices (quest completions, level-ups) for the host to deliver. */
  drainNotices(): { playerId: number; text: string }[] {
    const drained = this.notices;
    this.notices = [];
    return drained;
  }

  /** Accept a quest from the content DB. Returns a status message. */
  acceptQuest(playerId: number, questId: string): string {
    const player = this.players.get(playerId);
    if (!player) return 'no such player';
    const quest = getContent().quest(questId);
    if (!quest) return `No such quest: ${questId}`;
    if (player.questsDone.has(questId)) return `Already completed: ${quest.name}`;
    if (player.quests.has(questId)) return `Already on quest: ${quest.name}`;
    player.quests.set(questId, 0);
    return `Quest accepted: ${quest.name} — ${quest.description}`;
  }

  /** Human-readable quest log lines (available + in-progress + done). */
  questLog(playerId: number): string[] {
    const player = this.players.get(playerId);
    if (!player) return [];
    return getContent()
      .quests()
      .map((q) => {
        if (player.questsDone.has(q.id)) return `✓ ${q.name} (done)`;
        if (player.quests.has(q.id)) {
          return `▸ ${q.name}: ${player.quests.get(q.id)}/${q.targetCount} — ${q.description}`;
        }
        return `· ${q.name} [${q.id}] — /accept ${q.id}`;
      });
  }

  private progressQuests(player: Player, mobTemplateId: string): void {
    const content = getContent();
    for (const [questId, kills] of player.quests) {
      const quest = content.quest(questId);
      if (!quest || quest.targetMob !== mobTemplateId) continue;
      const next = kills + 1;
      if (next >= quest.targetCount) {
        player.quests.delete(questId);
        player.questsDone.add(questId);
        player.gold += quest.rewardGold;
        player.xp += quest.rewardXp;
        player.level = levelForXp(player.xp);
        this.recomputeStats(player);
        this.notify(
          player.id,
          `Quest complete: ${quest.name}! +${quest.rewardGold}g +${quest.rewardXp}xp`,
        );
      } else {
        player.quests.set(questId, next);
      }
    }
  }

  /** Decay dropped items and let nearby players pick them up. */
  private tickItems(dt: number): void {
    for (const item of this.items.values()) {
      item.ttl -= dt * 1000;
      if (item.ttl <= 0) {
        this.items.delete(item.id);
        continue;
      }
      for (const player of this.players.values()) {
        if (player.dead) continue;
        if (Math.hypot(player.x - item.x, player.y - item.y) <= PICKUP_RADIUS) {
          if (item.itemId === 'gold') {
            player.gold += item.qty;
            this.events.push({ kind: 'coin', x: item.x, y: item.y, value: item.qty });
          } else if (item.instance) {
            player.gear.push(item.instance);
            this.events.push({
              kind: 'pickup',
              x: item.x,
              y: item.y,
              rarity: item.instance.rarity,
            });
          } else {
            player.loot.set(item.itemId, (player.loot.get(item.itemId) ?? 0) + item.qty);
            this.events.push({ kind: 'pickup', x: item.x, y: item.y });
          }
          this.items.delete(item.id);
          break;
        }
      }
    }
  }

  private damagePlayer(player: Player, amount: number): void {
    if (player.god) return;
    player.hp -= amount;
    this.events.push({ kind: 'hit', x: player.x, y: player.y, value: amount });
    if (player.hp <= 0) {
      player.hp = 0;
      player.dead = true;
      player.respawnAt = this.now + PLAYER_RESPAWN_MS;
      this.events.push({ kind: 'death', x: player.x, y: player.y });
    }
  }

  private respawnPlayer(player: Player): void {
    player.dead = false;
    player.hp = player.maxHp;
    player.mana = PLAYER_MAX_MANA;
    player.x = this.spawnPoint.x;
    player.y = this.spawnPoint.y;
    player.cooldowns.clear();
  }

  private respawnMob(mob: Mob): void {
    const template = getContent().mobTemplate(mob.templateId)!;
    mob.dead = false;
    mob.hp = template.hp;
    mob.x = mob.homeX;
    mob.y = mob.homeY;
    mob.attackCd = 0;
  }

  private outOfBounds(x: number, y: number): boolean {
    return x < 0 || y < 0 || x > this.width || y > this.height;
  }

  snapshot(): EntityState[] {
    const out: EntityState[] = [];
    for (const p of this.players.values()) {
      if (p.dead) continue;
      out.push({
        id: p.id,
        x: p.x,
        y: p.y,
        name: p.name,
        hue: p.hue,
        kind: 'player',
        facing: p.facing,
        hp: Math.ceil(p.hp),
        maxHp: p.maxHp,
        level: p.level,
      });
    }
    for (const m of this.mobs.values()) {
      if (m.dead) continue;
      const flags = (m.statuses.has('slow') ? 1 : 0) | (m.statuses.has('burn') ? 2 : 0);
      const mob: EntityState = {
        id: m.id,
        x: m.x,
        y: m.y,
        name: m.name,
        hue: m.hue,
        kind: 'mob',
        facing: m.facing,
        hp: Math.ceil(m.hp),
        maxHp: m.maxHp,
        level: m.level,
      };
      if (flags > 0) mob.flags = flags;
      if (m.elite) mob.elite = true;
      out.push(mob);
    }
    for (const proj of this.projectiles.values()) {
      const e: EntityState = {
        id: proj.id,
        x: proj.x,
        y: proj.y,
        name: '',
        hue: 0,
        kind: 'projectile',
        facing: Math.atan2(proj.vy, proj.vx),
        hp: 0,
        maxHp: 0,
        level: 0,
        abilityId: proj.abilityId,
      };
      if (proj.hostile) e.hostile = true;
      out.push(e);
    }
    for (const item of this.items.values()) {
      const e: EntityState = {
        id: item.id,
        x: item.x,
        y: item.y,
        name: '',
        hue: 0,
        kind: 'item',
        facing: 0,
        hp: 0,
        maxHp: 0,
        level: 0,
        itemId: item.itemId,
        qty: item.qty,
      };
      if (item.instance) e.rarity = item.instance.rarity;
      out.push(e);
    }
    for (const npc of this.npcs.values()) {
      out.push({
        id: npc.id,
        x: npc.x,
        y: npc.y,
        name: npc.name,
        hue: npc.hue,
        kind: 'npc',
        facing: Math.PI / 2,
        hp: 0,
        maxHp: 0,
        level: 0,
        npcKind: npc.kind,
      });
    }
    return out;
  }

  /** Return and clear the transient effects accumulated since the last drain. */
  drainEvents(): FxEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** Personal stats for the 'you' message (kept off the shared snapshot). */
  playerStats(id: number):
    | {
        hp: number;
        maxHp: number;
        mana: number;
        maxMana: number;
        dead: boolean;
        level: number;
        xp: number;
        xpInto: number;
        xpNext: number;
        gold: number;
        loot: Record<string, number>;
        gear: ItemInstance[];
        respawnIn: number;
        power: number;
        critChance: number;
        weapon: ItemInstance | null;
        armor: ItemInstance | null;
        x: number;
        y: number;
        ackSeq: number;
      }
    | undefined {
    const p = this.players.get(id);
    if (!p) return undefined;
    const progress = levelProgress(p.xp);
    return {
      hp: Math.ceil(p.hp),
      maxHp: p.maxHp,
      mana: Math.floor(p.mana),
      maxMana: PLAYER_MAX_MANA,
      dead: p.dead,
      level: p.level,
      xp: p.xp,
      xpInto: progress.intoLevel,
      xpNext: progress.neededForNext,
      gold: p.gold,
      loot: Object.fromEntries(p.loot),
      gear: p.gear,
      respawnIn: p.dead ? Math.max(0, Math.ceil(p.respawnAt - this.now)) : 0,
      power: p.power,
      critChance: p.critChance,
      weapon: p.equipment.weapon,
      armor: p.equipment.armor,
      x: p.x,
      y: p.y,
      ackSeq: p.lastSeq,
    };
  }

  /** Player count (used for instance cap + GC). Excludes monsters. */
  get population(): number {
    return this.players.size;
  }

  /** All player ids in this instance (including dead/respawning) — for snapshot + chat routing. */
  playerIds(): number[] {
    return [...this.players.keys()];
  }

  nameOf(id: number): string | undefined {
    return this.players.get(id)?.name;
  }
}

/**
 * OSRS-inspired hit resolution layered on our ability damage: an accuracy roll (attacker level
 * vs monster level) decides hit/miss; on a hit, damage is rolled in the upper half of the
 * ability's base damage so hits still feel meaningful. Returns 0 on a miss.
 */
function rollAbilityDamage(
  attackerLevel: number,
  defenderLevel: number,
  baseDamage: number,
): number {
  const atk = attackRoll(attackerLevel, 8); // small inherent accuracy so early hits mostly land
  const def = defenceRoll(defenderLevel);
  if (!rolledHit(atk, def)) return 0;
  const half = Math.ceil(baseDamage * 0.5);
  return half + rollDamage(baseDamage - half);
}

/** Map an ability's on-hit effect onto a monster: Frostbolt slows, Fireball burns. */
function applyStatus(mob: { statuses: StatusSet }, abilityId: AbilityId): void {
  if (abilityId === 'frost') mob.statuses.apply('slow', 1500, 0.4);
  else if (abilityId === 'fireball') mob.statuses.apply('burn', 2000, 8);
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Adventurer';
}

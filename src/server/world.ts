import { clamp } from '../shared/math.js';
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
  PLAYER_RESPAWN_MS,
  type AbilityId,
  type FxEvent,
} from '../shared/combat.js';
import { aimAngle, circlesOverlap, inMeleeCone } from './combat.js';
import { attackRoll, defenceRoll, rollDamage, rolledHit } from './combat-formulas.js';
import { stepMob, type MobView, type PlayerView } from './mobs.js';
import { levelForXp, levelProgress, maxHpForLevel, xpReward } from './progression.js';
import { StatusSet } from './status-effects.js';
import { getContent } from './content.js';

const PICKUP_RADIUS = 30;
const ITEM_TTL_MS = 30_000;
const INTERACT_RANGE = 70;

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
  equipment: { weapon: string | null; armor: string | null };
  power: number;
  input: InputState;
  cooldowns: Map<AbilityId, number>;
  dead: boolean;
  respawnAt: number;
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
}

interface GroundItem {
  id: number;
  itemId: string;
  qty: number;
  x: number;
  y: number;
  ttl: number;
}

interface Npc {
  id: number;
  name: string;
  x: number;
  y: number;
  hue: number;
  kind: 'vendor';
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

  /** Populate the area's monsters. Called once by the instance manager after construction. */
  populateMobs(areaId: string): void {
    const content = getContent();
    for (const spawn of content.areaMobs(areaId)) {
      const template = content.mobTemplate(spawn.templateId);
      if (!template) continue;
      for (let i = 0; i < spawn.count; i++) {
        const id = this.allocId();
        const x = 80 + Math.random() * (this.width - 160);
        const y = 80 + Math.random() * (this.height - 160);
        this.mobs.set(id, {
          id,
          templateId: template.id,
          name: template.name,
          x,
          y,
          homeX: x,
          homeY: y,
          hue: template.hue,
          facing: 0,
          hp: template.hp,
          maxHp: template.hp,
          level: template.level,
          attackCd: 0,
          wanderAngle: null,
          wanderUntil: 0,
          statuses: new StatusSet(),
          lastAttacker: 0,
          dead: false,
          respawnAt: 0,
        });
      }
    }
  }

  /** Place static NPCs for the area (from the content DB). Called once after construction. */
  populateNpcs(areaId: string): void {
    for (const npc of getContent().npcs(areaId)) {
      const id = this.allocId();
      this.npcs.set(id, { id, name: npc.name, x: npc.x, y: npc.y, hue: npc.hue, kind: 'vendor' });
    }
  }

  /** Interact with the nearest in-range NPC: the vendor buys the player's loot for gold. */
  interact(id: number): void {
    const player = this.players.get(id);
    if (!player || player.dead) return;
    const content = getContent();
    for (const npc of this.npcs.values()) {
      if (Math.hypot(player.x - npc.x, player.y - npc.y) > INTERACT_RANGE) continue;
      if (npc.kind !== 'vendor') continue;
      let gold = 0;
      for (const [item, qty] of player.loot) {
        const value = content.sellValue(item);
        if (value <= 0 || qty <= 0) continue;
        gold += value * qty;
        player.loot.delete(item);
      }
      if (gold <= 0) return;
      player.gold += gold;
      this.events.push({ kind: 'cast', x: player.x, y: player.y });
      return;
    }
  }

  /** Equip an item from the player's bag, returning any displaced gear to the bag. */
  equip(id: number, itemId: string): void {
    const player = this.players.get(id);
    if (!player || (player.loot.get(itemId) ?? 0) < 1) return;
    const def = getContent().item(itemId);
    if (!def || def.kind !== 'equip' || (def.slot !== 'weapon' && def.slot !== 'armor')) return;

    const remaining = (player.loot.get(itemId) ?? 0) - 1;
    if (remaining <= 0) player.loot.delete(itemId);
    else player.loot.set(itemId, remaining);

    const previous = player.equipment[def.slot];
    if (previous) player.loot.set(previous, (player.loot.get(previous) ?? 0) + 1);
    player.equipment[def.slot] = itemId;
    this.recomputeStats(player);
  }

  /** Derive power + max HP from level and equipped gear. */
  private recomputeStats(player: Player): void {
    const content = getContent();
    const weapon = player.equipment.weapon;
    const armor = player.equipment.armor;
    player.power = weapon ? (content.item(weapon)?.power ?? 0) : 0;
    player.maxHp = maxHpForLevel(player.level) + (armor ? (content.item(armor)?.hp ?? 0) : 0);
    if (player.hp > player.maxHp) player.hp = player.maxHp;
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
      equipment: { weapon: null, armor: null },
      power: 0,
      input: { up: false, down: false, left: false, right: false },
      cooldowns: new Map(),
      dead: false,
      respawnAt: 0,
    });
    return id;
  }

  remove(id: number): void {
    this.players.delete(id);
  }

  setInput(id: number, input: InputState): void {
    const player = this.players.get(id);
    if (!player) return;
    player.input = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
    };
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
          const dmg = rollAbilityDamage(player.level, mob.level, ability.damage + player.power);
          this.damageMob(mob, dmg, abilityId, player.id);
          if (dmg > 0) applyStatus(mob, abilityId);
        }
      }
    } else {
      const pid = this.allocId();
      this.projectiles.set(pid, {
        id: pid,
        abilityId,
        x: player.x,
        y: player.y,
        vx: Math.cos(facing) * (ability.projectileSpeed ?? 300),
        vy: Math.sin(facing) * (ability.projectileSpeed ?? 300),
        ttl: ability.projectileTtlMs ?? 1200,
        damage: ability.damage + player.power,
        radius: ability.radius,
        ownerId: player.id,
        ownerLevel: player.level,
      });
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
        player.x = clamp(player.x + dx * PLAYER_SPEED * dt, 0, this.width);
        player.y = clamp(player.y + dy * PLAYER_SPEED * dt, 0, this.height);
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
      const view: MobView = { x: mob.x, y: mob.y, template, attackReady: mob.attackCd <= 0 };
      const intent = stepMob(view, views);

      if (intent.attackTargetId !== null) {
        const target = this.players.get(intent.attackTargetId);
        if (target && !target.dead) {
          this.damagePlayer(target, template.damage);
          mob.attackCd = template.attackCooldownMs;
          mob.facing = intent.facing ?? mob.facing;
          this.events.push({ kind: 'melee', x: mob.x, y: mob.y, facing: mob.facing });
        }
      } else if (intent.vx !== 0 || intent.vy !== 0) {
        mob.x = clamp(mob.x + intent.vx * slow * dt, 0, this.width);
        mob.y = clamp(mob.y + intent.vy * slow * dt, 0, this.height);
        if (intent.facing !== null) mob.facing = intent.facing;
      } else {
        this.wander(mob, dt, template.speed * slow);
      }
    }
  }

  private tickProjectiles(dt: number): void {
    for (const proj of this.projectiles.values()) {
      proj.x += proj.vx * dt;
      proj.y += proj.vy * dt;
      proj.ttl -= dt * 1000;

      let consumed = false;
      for (const mob of this.mobs.values()) {
        if (mob.dead) continue;
        if (circlesOverlap(proj.x, proj.y, proj.radius, mob.x, mob.y, MOB_RADIUS)) {
          const dmg = rollAbilityDamage(proj.ownerLevel, mob.level, proj.damage);
          this.damageMob(mob, dmg, proj.abilityId, proj.ownerId);
          if (dmg > 0) applyStatus(mob, proj.abilityId);
          consumed = true;
          break;
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
  ): void {
    if (attackerId !== 0) mob.lastAttacker = attackerId;
    mob.hp -= amount;
    const hit: FxEvent = { kind: 'hit', x: mob.x, y: mob.y, value: Math.ceil(amount) };
    if (abilityId !== undefined) hit.abilityId = abilityId;
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
      killer.xp += xpReward(mob.level);
      killer.level = levelForXp(killer.xp);
      this.recomputeStats(killer);
    }
    // Loot (materials + gear) comes from the DB-backed content drop tables.
    for (const stack of getContent().rollLoot(mob.templateId)) {
      const id = this.allocId();
      this.items.set(id, {
        id,
        itemId: stack.item,
        qty: stack.qty,
        x: mob.x + (Math.random() - 0.5) * 30,
        y: mob.y + (Math.random() - 0.5) * 30,
        ttl: ITEM_TTL_MS,
      });
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
          if (item.itemId === 'gold') player.gold += item.qty;
          else player.loot.set(item.itemId, (player.loot.get(item.itemId) ?? 0) + item.qty);
          this.events.push({ kind: 'cast', x: item.x, y: item.y });
          this.items.delete(item.id);
          break;
        }
      }
    }
  }

  private damagePlayer(player: Player, amount: number): void {
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
      out.push(mob);
    }
    for (const proj of this.projectiles.values()) {
      out.push({
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
      });
    }
    for (const item of this.items.values()) {
      out.push({
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
      });
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
        respawnIn: number;
        power: number;
        weapon: string;
        armor: string;
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
      respawnIn: p.dead ? Math.max(0, Math.ceil(p.respawnAt - this.now)) : 0,
      power: p.power,
      weapon: p.equipment.weapon ?? '',
      armor: p.equipment.armor ?? '',
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

function moveVector(input: InputState): { dx: number; dy: number } {
  let dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx !== 0 && dy !== 0) {
    const inv = 1 / Math.SQRT2;
    dx *= inv;
    dy *= inv;
  }
  return { dx, dy };
}

function sanitizeName(name: string): string {
  const trimmed = (name ?? '').trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : 'Adventurer';
}

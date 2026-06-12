/**
 * Offline Act-1 pacing simulator — "plays" the game at the pure-World level (no network, no
 * renderer) with a simple, honest player policy, then prints a leveling-pace balance report.
 * This is the tuning instrument for the hard difficulty + exponential XP curve: run it before
 * and after a balance change and diff the tables. It never modifies any balance numbers.
 *
 *   npx tsx tools/playtest/pacing.ts [--seed N] [--levelCap N] [--verbose]
 */
import { initGameDb, getContent } from '../../src/server/content.js';
import { World, type PlayerSave } from '../../src/server/world.js';
import { ABILITIES, type AbilityId } from '../../src/shared/combat.js';
import { SKILL_TREE } from '../../src/shared/skilltree.js';
import { dollSlotsFor, type ItemSlot } from '../../src/shared/equipment.js';
import type { InputState } from '../../src/shared/protocol.js';
import type { ItemInstance } from '../../src/shared/items.js';

type Stats = NonNullable<ReturnType<World['playerStats']>>;

const DT = 0.05; // one fixed server tick, seconds
const MAX_SIM_SECONDS = 4 * 3600; // 288k ticks
const PLAYER_ID = 1;
const NOTICE_RANGE = 600; // "I see a monster" radius — fight inside it, sweep toward packs beyond
const LOOT_DETOUR = 350; // walk over nearby drops between fights (pickup is automatic at 30px)
const POTION_AT = 0.4; // quaff a health potion below 40% hp
const FLEE_AT = 0.25; // below 25% with an empty belt: run away for 3s
const FLEE_SECONDS = 3;
const TOWN_TRIP_SECONDS = 45; // flat walk-time proxy for the portal trek there and back
const TRIP_KILL_INTERVAL = 60; // also restock every N kills, like a human selling a full bag
const TTK_LEVELS = [3, 8, 13, 18];
const ACT1_EXIT_LEVEL = 18;
const ACT1_TARGET = { min: 2.5 * 3600, max: 6 * 3600 };
/** Act 1 hunting grounds by level band; move on when `untilLevel` is reached. */
const BANDS = [
  { area: 'wilderness', untilLevel: 7 },
  { area: 'marsh', untilLevel: 12 },
  { area: 'mines', untilLevel: 16 },
  { area: 'frostpeak', untilLevel: Infinity },
];

const IDLE: InputState = { up: false, down: false, left: false, right: false };

/** 4-directional intent toward a point, with a small deadzone (same shape as tools/bots). */
function toward(from: { x: number; y: number }, tx: number, ty: number): InputState {
  const dead = 6;
  return {
    up: ty < from.y - dead,
    down: ty > from.y + dead,
    left: tx < from.x - dead,
    right: tx > from.x + dead,
  };
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function fmt(seconds: number): string {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/**
 * The simulated player's combat reflexes — what a competent human does each ~100ms: quaff when
 * low, flee when out of potions, face the nearest mob, hold ranged stand-off when a projectile
 * spell is known, slash when adjacent. Pure over World's public API; reused by the TTK probe.
 */
class Policy {
  private cooldownUntil = new Map<string, number>();
  private potionReadyAt = 0;
  fleeUntil = 0;

  step(w: World, id: number, stats: Stats, now: number): void {
    if (stats.dead) return w.setInput(id, IDLE);
    const hpFrac = stats.hp / stats.maxHp;
    if (now >= this.potionReadyAt) {
      if (hpFrac < POTION_AT && stats.potions.health > 0) {
        w.usePotion(id, 'health');
        this.potionReadyAt = now + 2.6; // server-enforced shared belt cooldown is 2.5s
      } else if (stats.mana < 20 && stats.potions.mana > 0) {
        w.usePotion(id, 'mana');
        this.potionReadyAt = now + 2.6;
      }
    }
    const ents = w.snapshot();
    const mobs = ents.filter((e) => e.kind === 'mob' && e.hp > 0);
    let mob = mobs[0];
    for (const m of mobs) if (dist(stats, m) < dist(stats, mob!)) mob = m;

    if (this.fleeUntil <= now && hpFrac < FLEE_AT && stats.potions.health <= 0) {
      this.fleeUntil = now + FLEE_SECONDS; // disengage: no potions left and nearly dead
    }
    if (this.fleeUntil > now) {
      if (!mob) return w.setInput(id, IDLE);
      const away = toward(stats, mob.x, mob.y); // invert: run FROM the nearest threat
      return w.setInput(id, { up: away.down, down: away.up, left: away.right, right: away.left });
    }
    if (!mob) return w.setInput(id, IDLE);

    const d = dist(stats, mob);
    if (d > NOTICE_RANGE) {
      // Out of sight: sweep toward the nearest pack (a human reads the map), looting en route.
      let drop;
      for (const e of ents) {
        if (e.kind !== 'item' && e.kind !== 'pot') continue;
        if (dist(stats, e) <= LOOT_DETOUR && (!drop || dist(stats, e) < dist(stats, drop)))
          drop = e;
      }
      const goal = drop ?? mob;
      return w.setInput(id, toward(stats, goal.x, goal.y));
    }

    // Fight: pick the hardest-hitting known melee + projectile the mana pool can pay for.
    const known = Object.keys(stats.known).filter((k): k is AbilityId => k in ABILITIES);
    const pick = (kind: 'melee' | 'projectile') =>
      known
        .filter((k) => ABILITIES[k].kind === kind)
        .sort((a, b) => ABILITIES[b].damage - ABILITIES[a].damage)[0];
    const melee = pick('melee');
    const ranged = pick('projectile');
    const heal = known
      .filter((k) => ABILITIES[k].kind === 'heal' && ABILITIES[k].damage > 0)
      .sort((a, b) => ABILITIES[b].damage - ABILITIES[a].damage)[0];

    const ready = (a: AbilityId) =>
      (this.cooldownUntil.get(a) ?? 0) <= now && stats.mana >= ABILITIES[a].manaCost;
    const cast = (a: AbilityId) => {
      w.cast(id, a, mob!.x - stats.x, mob!.y - stats.y);
      this.cooldownUntil.set(a, now + ABILITIES[a].cooldownMs / 1000);
    };
    if (heal && hpFrac < 0.6 && ready(heal)) {
      w.cast(id, heal, 1, 0);
      this.cooldownUntil.set(heal, now + ABILITIES[heal].cooldownMs / 1000);
    } else if (melee && d <= ABILITIES[melee].range * 0.9 && ready(melee)) cast(melee);
    else if (ranged && d <= ABILITIES[ranged].range * 0.95 && ready(ranged)) cast(ranged);

    // Close to ability range: hold a ranged stand-off when affordable, else walk into melee.
    const standoff =
      ranged && stats.mana >= ABILITIES[ranged].manaCost
        ? ABILITIES[ranged].range * 0.55
        : melee
          ? ABILITIES[melee].range * 0.7
          : 30;
    w.setInput(id, d > standoff ? toward(stats, mob.x, mob.y) : IDLE);
  }
}

class Sim {
  private nextId = 1000; // entity ids above the player's, shared across every world we build
  private simTime = 0;
  private kills = 0;
  private deaths = 0;
  private potionsUsed = 0;
  private townTrips = 0;
  private disengageTime = 0;
  private killsSinceTrip = 0;
  private recordedLevel = 1;
  private rows: {
    level: number;
    t: number;
    kills: number;
    deaths: number;
    gold: number;
    potions: number;
    trips: number;
  }[] = [];
  private ttk: { level: number; mob: string; median: number }[] = [];
  private policy = new Policy();

  constructor(
    private readonly seed: number,
    private readonly levelCap: number,
    private readonly verbose: boolean,
  ) {}

  private log(msg: string): void {
    if (this.verbose) console.log(`  [${fmt(this.simTime)}] ${msg}`);
  }

  private makeWorld(areaId: string): World {
    const area = getContent().area(areaId);
    if (!area) throw new Error(`pacing: unknown area ${areaId}`);
    let h = 0;
    for (const c of areaId) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const w = new World(
      area.width,
      area.height,
      area.spawn,
      () => this.nextId++,
      areaId,
      undefined,
      0,
      (this.seed ^ h) >>> 0,
    );
    w.populateMobs(areaId);
    w.populateNpcs(areaId);
    return w;
  }

  /** Bag/character upkeep a player does between pulls: read tomes, spend points, equip upgrades. */
  private maintain(w: World, id: number): void {
    let st = w.playerStats(id)!;
    for (const itemId of Object.keys(st.loot)) {
      if (getContent().item(itemId)?.kind === 'spellbook') w.learn(id, itemId);
    }
    const attrOrder = ['strength', 'vitality', 'strength', 'vitality', 'dexterity'];
    for (let i = 0; w.playerStats(id)!.attrPoints > 0 && i < 200; i++) {
      w.allocateAttribute(id, attrOrder[i % attrOrder.length]!);
    }
    let spent = true;
    while (spent && w.playerStats(id)!.skillPoints > 0) {
      spent = false;
      for (const node of SKILL_TREE) {
        const before = w.playerStats(id)!.skillPoints;
        if (before <= 0) break;
        w.allocateSkill(id, node.id); // validates prerequisites server-side; no-op if blocked
        if (w.playerStats(id)!.skillPoints < before) spent = true;
      }
    }
    // Equip any bag piece that beats the weakest equipped item sharing its doll slot.
    const score = (g: ItemInstance) => g.power + 0.6 * g.hp + 4 * (g.affixes?.length ?? 0);
    st = w.playerStats(id)!;
    for (const g of [...st.gear]) {
      const slot = getContent().item(g.baseId)?.slot as ItemSlot | null | undefined;
      if (!slot) continue;
      const slots = dollSlotsFor(slot);
      const worst = Math.min(...slots.map((s) => (st.equipment[s] ? score(st.equipment[s]!) : 0)));
      if (score(g) > worst) {
        w.equip(id, g.uid);
        st = w.playerStats(id)!;
      }
    }
  }

  /** The sanctioned shortcut: hop to town, sell, buy tomes, refill at the healer, hop back. */
  private townTrip(w: World, id: number): void {
    const here = w.playerStats(id)!;
    const back = { x: here.x, y: here.y };
    const save = w.exportPlayer(id)!;
    w.remove(id);
    const town = this.makeWorld('town');
    const npcs = getContent().npcs('town');
    const vendor = npcs.find((n) => n.kind === 'vendor') ?? npcs[0]!;
    town.importPlayer(id, save, vendor.x, vendor.y);
    this.maintain(town, id); // learn drop tomes + equip upgrades BEFORE selling the bag
    town.sell(id);
    for (const s of getContent().vendorStock('town', 'Merchant')) {
      const def = getContent().item(s.itemId);
      if (def?.kind !== 'spellbook' || !def.teaches) continue;
      const st = town.playerStats(id)!;
      if (st.known[def.teaches] !== undefined || st.gold < s.price) continue;
      town.buy(id, s.itemId);
      town.learn(id, s.itemId);
    }
    const healer = npcs.find((n) => n.kind === 'healer');
    if (healer) {
      town.teleport(id, healer.x, healer.y);
      town.interact(id); // full heal + belt refilled to the cap
    }
    for (let i = 0; i < TOWN_TRIP_SECONDS / DT; i++) {
      town.tick(DT);
      this.simTime += DT;
    }
    town.drainEvents();
    town.drainNotices();
    town.drainShopOffers();
    const out = town.exportPlayer(id)!;
    town.remove(id);
    w.importPlayer(id, out, back.x, back.y);
    this.townTrips++;
    this.killsSinceTrip = 0;
    this.log(`town trip #${this.townTrips} (gold ${out.gold}, spells ${out.known?.length ?? 0})`);
  }

  /** 1v1 time-to-kill vs the closest-level Act-1 mob, in a scratch arena (median of 5 trials). */
  private probeTtk(save: PlayerSave, level: number): void {
    const c = getContent();
    let best: { id: string; name: string; level: number } | undefined;
    for (const band of BANDS) {
      for (const s of c.areaMobs(band.area)) {
        const t = c.mobTemplate(s.templateId);
        if (!t || t.hp >= 200) continue; // skip bosses
        if (!best || Math.abs(t.level - level) < Math.abs(best.level - level)) best = t;
      }
    }
    if (!best) return;
    const times: number[] = [];
    for (let trial = 0; trial < 5; trial++) {
      const w = new World(
        1600,
        1600,
        { x: 800, y: 800 },
        () => this.nextId++,
        'wilderness',
        undefined,
        0,
        (this.seed * 7919 + level * 101 + trial) >>> 0,
      );
      w.importPlayer(
        PLAYER_ID,
        { ...save, hp: 99999, mana: 100, potions: { health: 8, mana: 8 } },
        800,
        800,
      );
      w.spawnMobAt(PLAYER_ID, best.id);
      const policy = new Policy();
      let t = 0;
      while (t < 90) {
        const st = w.playerStats(PLAYER_ID)!;
        if (st.dead) break;
        policy.step(w, PLAYER_ID, st, t);
        w.tick(DT);
        t += DT;
        w.drainEvents();
        w.drainNotices();
        if (!w.snapshot().some((e) => e.kind === 'mob' && e.hp > 0)) break;
      }
      times.push(Math.min(t, 90));
    }
    times.sort((a, b) => a - b);
    this.ttk.push({ level, mob: `${best.name} (L${best.level})`, median: times[2]! });
  }

  run(): void {
    let bandIdx = 0;
    let w = this.makeWorld(BANDS[0]!.area);
    w.spawn('Pacegauge', { id: PLAYER_ID });
    let prevDead = false;
    let prevPotions = w.playerStats(PLAYER_ID)!.potions;
    let tickCount = 0;

    while (this.simTime < MAX_SIM_SECONDS) {
      let stats = w.playerStats(PLAYER_ID)!;
      if (stats.level >= this.levelCap) break;
      if (stats.level >= BANDS[bandIdx]!.untilLevel) {
        bandIdx++;
        const save = w.exportPlayer(PLAYER_ID)!;
        w.remove(PLAYER_ID);
        const nextArea = getContent().area(BANDS[bandIdx]!.area)!;
        w = this.makeWorld(BANDS[bandIdx]!.area);
        w.importPlayer(PLAYER_ID, save, nextArea.spawn.x, nextArea.spawn.y);
        stats = w.playerStats(PLAYER_ID)!;
        this.log(`moves on to ${BANDS[bandIdx]!.area} at L${stats.level}`);
      }
      if (tickCount % 40 === 0) this.maintain(w, PLAYER_ID); // every 2s of sim time
      const tripNeeded = stats.potions.health === 0 || this.killsSinceTrip >= TRIP_KILL_INTERVAL;
      if (tripNeeded && !stats.dead) {
        // Only hop when safe-ish: no mob close by, or healthy enough to walk out of the pull.
        const mobNear = w
          .snapshot()
          .some((e) => e.kind === 'mob' && e.hp > 0 && dist(stats, e) < 400);
        if (!mobNear || stats.hp / stats.maxHp > 0.6) {
          this.townTrip(w, PLAYER_ID);
          prevPotions = w.playerStats(PLAYER_ID)!.potions;
          continue;
        }
      }
      if (tickCount % 2 === 0) this.policy.step(w, PLAYER_ID, stats, this.simTime); // 10Hz decisions
      if (this.policy.fleeUntil > this.simTime) this.disengageTime += DT;
      w.tick(DT);
      this.simTime += DT;
      tickCount++;

      const deathEvents = w.drainEvents().filter((e) => e.kind === 'death').length;
      for (const n of w.drainNotices()) this.log(n.text);
      stats = w.playerStats(PLAYER_ID)!;
      const playerDied = stats.dead && !prevDead;
      if (playerDied) {
        this.deaths++;
        this.log(`dies (death #${this.deaths}) at L${stats.level}`);
      }
      const killed = Math.max(0, deathEvents - (playerDied ? 1 : 0));
      this.kills += killed;
      this.killsSinceTrip += killed;
      this.potionsUsed +=
        Math.max(0, prevPotions.health - stats.potions.health) +
        Math.max(0, prevPotions.mana - stats.potions.mana);
      while (stats.level > this.recordedLevel) {
        this.recordedLevel++;
        this.rows.push({
          level: this.recordedLevel,
          t: this.simTime,
          kills: this.kills,
          deaths: this.deaths,
          gold: stats.gold,
          potions: this.potionsUsed,
          trips: this.townTrips,
        });
        this.log(`reaches L${this.recordedLevel} (${this.kills} kills)`);
        if (TTK_LEVELS.includes(this.recordedLevel))
          this.probeTtk(w.exportPlayer(PLAYER_ID)!, this.recordedLevel);
      }
      prevDead = stats.dead;
      prevPotions = stats.potions;
    }
  }

  report(): void {
    console.log(
      `\n=== Act 1 pacing report — seed ${this.seed}, cap L${this.levelCap} / ${fmt(MAX_SIM_SECONDS)} sim ===`,
    );
    console.log('Lvl | Reached  | Per-level | Kills | Deaths | Gold  | Potions | Trips');
    let prevT = 0;
    const deltas: number[] = [];
    for (const r of this.rows) {
      const d = r.t - prevT;
      deltas.push(d);
      console.log(
        `${String(r.level).padStart(3)} | ${fmt(r.t).padStart(8)} | ${fmt(d).padStart(9)} | ${String(r.kills).padStart(5)} | ${String(r.deaths).padStart(6)} | ${String(r.gold).padStart(5)} | ${String(r.potions).padStart(7)} | ${String(r.trips).padStart(5)}`,
      );
      prevT = r.t;
    }
    const last = this.rows[this.rows.length - 1];
    console.log(
      `Totals: L${last?.level ?? 1} in ${fmt(this.simTime)} — ${this.kills} kills, ${this.deaths} deaths, ${this.potionsUsed} potions, ${this.townTrips} town trips`,
    );
    console.log(
      `Disengage (flee) time: ${fmt(this.disengageTime)} (${((100 * this.disengageTime) / Math.max(1, this.simTime)).toFixed(1)}% of run) — frustration proxy`,
    );
    for (const t of this.ttk)
      console.log(
        `TTK at L${t.level} vs ${t.mob}: ${t.median >= 90 ? '>90s (unresolved)' : `${t.median.toFixed(1)}s`} (median of 5)`,
      );

    console.log('Verdicts:');
    const exit = this.rows.find((r) => r.level === ACT1_EXIT_LEVEL);
    if (!exit)
      console.log(
        `  [FAIL] Act 1 exit: never reached L${ACT1_EXIT_LEVEL} inside the ${fmt(MAX_SIM_SECONDS)} cap (stalled at L${last?.level ?? 1}) — too slow / a wall.`,
      );
    else {
      const ok = exit.t >= ACT1_TARGET.min && exit.t <= ACT1_TARGET.max;
      console.log(
        `  [${ok ? 'PASS' : 'FAIL'}] Act 1 exit (L${ACT1_EXIT_LEVEL}) at ${fmt(exit.t)} — target ${fmt(ACT1_TARGET.min)}..${fmt(ACT1_TARGET.max)}.`,
      );
    }
    const sorted = [...deltas].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    this.rows.forEach((r, i) => {
      const d = deltas[i]!;
      if (median < 30 || r.level <= 2) return; // too little signal to flag
      if (d > 2.5 * median)
        console.log(
          `  [WARN] L${r.level} took ${fmt(d)} (${(d / median).toFixed(1)}x the median level) — a wall.`,
        );
      else if (d < 0.3 * median)
        console.log(
          `  [WARN] L${r.level} took ${fmt(d)} (${(d / median).toFixed(1)}x the median level) — a cliff.`,
        );
    });
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

initGameDb(':memory:'); // the default-seeded content — identical to a fresh game.db
const sim = new Sim(
  Number(arg('seed') ?? 1),
  Number(arg('levelCap') ?? 20),
  process.argv.includes('--verbose'),
);
const started = Date.now();
sim.run();
sim.report();
console.log(`(wall clock: ${((Date.now() - started) / 1000).toFixed(1)}s)`);

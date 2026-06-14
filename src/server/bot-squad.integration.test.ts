import { describe, expect, it } from 'vitest';
import { World, type PlayerSave } from './world.js';
import { getContent, initGameDb } from './content.js';
import { stepBot, newBotState, type BotView } from './bot-brain.js';
import { coordinateSquad, type SquadMemberInput, type SquadMobInput } from './bot-squad.js';
import { SquadMetrics } from './bot-metrics.js';
import type { AbilityId } from '../shared/combat.js';

initGameDb(':memory:');

/**
 * Integration soak: drive a real 3-bot COOPERATING squad through the pure World for a few thousand
 * ticks, wiring the brain + squad coordinator + metrics exactly as the host does. This proves the
 * cooperation loop runs against the actual simulation without throwing, that the squad makes
 * progress (XP), and that the metrics recorder fills in. Deterministic: a fixed instance seed.
 */
const DT = 0.05;
const SEED = 0x5eed;

function save(name: string, level: number): PlayerSave {
  return {
    name,
    hue: 0,
    hp: 100,
    mana: 100,
    level,
    xp: 0,
    gold: 0,
    loot: [],
    gear: [],
    equipment: {},
    god: false,
    quests: [],
    questsDone: [],
  } as PlayerSave;
}

describe('cooperating squad — World integration soak', () => {
  it('runs a 3-bot squad through the live simulation without crashing, and progresses', () => {
    const area = getContent().area('wilderness')!;
    const world = new World(
      area.width,
      area.height,
      area.spawn,
      undefined,
      'wilderness',
      undefined,
      0,
      SEED,
    );
    const ids = [9_000_001, 9_000_002, 9_000_003];
    ids.forEach((id, i) =>
      world.importPlayer(id, save(`Bot${i}`, 5), area.spawn.x + i * 30, area.spawn.y),
    );

    const states = new Map(ids.map((id) => [id, newBotState(id)]));
    const seq = new Map(ids.map((id) => [id, 0]));
    const metrics = new SquadMetrics(1, ['Bot0', 'Bot1', 'Bot2'], 0);
    const startXp = ids.reduce((s, id) => s + (world.playerStats(id)?.xp ?? 0), 0);

    const TICKS = 4000; // 200s sim
    expect(() => {
      for (let t = 0; t < TICKS; t++) {
        const simMs = t * 1000 * DT;
        // Keep a steady trickle of foes next to the squad so the co-op fight loop is exercised
        // deterministically (we're testing cooperation, not ambient spawn density).
        if (t % 50 === 0) {
          world.spawnMobAt(ids[t % ids.length]!, 'wolf');
          world.spawnMobAt(ids[(t + 1) % ids.length]!, 'wolf');
        }
        const snap = world.snapshot();
        const mobs = snap.filter((e) => e.kind === 'mob' && e.hp > 0);
        const items = snap.filter((e) => e.kind === 'item');

        // Coordinate the squad (roles / focus-fire / regroup), exactly like the host does.
        const members: SquadMemberInput[] = [];
        for (const id of ids) {
          const st = world.playerStats(id);
          const e = snap.find((s) => s.id === id);
          if (!st || !e) continue;
          members.push({
            id,
            x: e.x,
            y: e.y,
            hpFrac: st.maxHp > 0 ? st.hp / st.maxHp : 0,
            maxHp: st.maxHp,
            level: st.level,
            dead: st.dead,
            hasHeal: Object.keys(st.known).some(
              (a) => getContent().ability(a as AbilityId)?.kind === 'heal',
            ),
          });
        }
        const squadMobs: SquadMobInput[] = mobs.map((m) => ({
          id: m.id,
          x: m.x,
          y: m.y,
          hp: m.hp,
          level: m.level,
          boss: m.maxHp >= 1500,
          elite: m.elite === true,
        }));
        const ctx = coordinateSquad(members, squadMobs);

        for (const id of ids) {
          const st = world.playerStats(id);
          const me = snap.find((e) => e.id === id);
          if (!st || !me) continue;
          const sq: NonNullable<BotView['squad']> = { role: ctx.role.get(id) ?? 'dps' };
          if (ctx.focusTarget) sq.focusTarget = ctx.focusTarget;
          if (ctx.rally) sq.rally = ctx.rally;
          const view: BotView = {
            self: {
              x: me.x,
              y: me.y,
              hp: st.hp,
              maxHp: st.maxHp,
              mana: st.mana,
              maxMana: st.maxMana,
              level: st.level,
              dead: st.dead,
            },
            abilities: Object.keys(st.known).flatMap((aid) => {
              const a = getContent().ability(aid as AbilityId);
              return a
                ? [
                    {
                      id: aid,
                      kind: a.kind,
                      damage: a.damage,
                      range: a.range,
                      manaCost: a.manaCost,
                      cooldownReady: true,
                    },
                  ]
                : [];
            }),
            mobs: mobs
              .filter((m) => Math.hypot(m.x - me.x, m.y - me.y) < 700)
              .map((m) => ({ id: m.id, x: m.x, y: m.y, hp: m.hp })),
            items: items.map((it) => ({ id: it.id, x: it.x, y: it.y })),
            width: area.width,
            height: area.height,
            potions: st.potions,
            squad: sq,
          };
          const d = stepBot(view, states.get(id)!, simMs);
          world.setInput(id, d.input, (seq.get(id) ?? 0) + 1);
          seq.set(id, (seq.get(id) ?? 0) + 1);
          if (d.cast) world.cast(id, d.cast.ability as AbilityId, d.cast.dx, d.cast.dy);
          if (d.usePotion) world.usePotion(id, d.usePotion);
        }

        // Sample metrics every ~2s, like the host's throttle.
        if (t % 40 === 0) {
          const levels = ids.map((id) => world.playerStats(id)?.level ?? 0);
          const xp = ids.reduce((s, id) => s + (world.playerStats(id)?.xp ?? 0), 0);
          metrics.sample({
            simMs,
            area: 'wilderness',
            alive: ids.filter((id) => !world.playerStats(id)?.dead).length,
            lvlAvg: levels.reduce((a, b) => a + b, 0) / levels.length,
            lvlMin: Math.min(...levels),
            lvlMax: Math.max(...levels),
            goldSum: ids.reduce((s, id) => s + (world.playerStats(id)?.gold ?? 0), 0),
            gearAvg: 0,
            xpSum: xp,
          });
        }
        world.tick(DT);
      }
    }).not.toThrow();

    const endXp = ids.reduce((s, id) => s + (world.playerStats(id)?.xp ?? 0), 0);
    expect(endXp).toBeGreaterThan(startXp); // the squad fought things and earned XP
    const report = metrics.report();
    expect(report.samples.length).toBeGreaterThan(5); // metrics recorded the run
    expect(report.milestones.some((m) => m.area === 'wilderness')).toBe(true);
  });
});

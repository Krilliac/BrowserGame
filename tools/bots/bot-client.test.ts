/**
 * Tests for the bot harness.
 *
 * 1. BotBrain unit tests with hand-built snapshot views — deterministic, no socket, fast.
 * 2. One integration test that boots the REAL server as a child process (GAME_DB=:memory:
 *    on a free port) and drives a real BotClient through join + snapshots.
 *
 * Run by `npm test` (the root vitest config globs `tools/**` too), or on its own with
 * `npx vitest run tools/bots/bot-client.test.ts`.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { EntityState } from '../../src/shared/protocol.js';
import { AREAS } from '../../src/shared/areas.js';
import { BotBrain, walkToward, type BrainView } from './behaviors.js';
import { BotClient } from './bot-client.js';

const town = AREAS.town!; // the start area always exists (noUncheckedIndexedAccess)

function viewWith(overrides: Partial<BrainView>): BrainView {
  return {
    now: 1000,
    x: town.spawn.x,
    y: town.spawn.y,
    dead: false,
    bagCount: 0,
    selfId: 1,
    entities: [],
    area: town,
    ...overrides,
  };
}

function mob(id: number, x: number, y: number, hp = 50): EntityState {
  return { id, x, y, name: 'Mob', hue: 0, kind: 'mob', facing: 0, hp, maxHp: 50, level: 1 };
}

describe('walkToward', () => {
  it('produces directional intent toward a target with a deadzone', () => {
    const i = walkToward({ x: 100, y: 100 }, 200, 50);
    expect(i.right).toBe(true);
    expect(i.left).toBe(false);
    expect(i.up).toBe(true);
    expect(i.down).toBe(false);
  });

  it('is idle when already on top of the target', () => {
    const i = walkToward({ x: 100, y: 100 }, 100, 100);
    expect(i).toEqual({ up: false, down: false, left: false, right: false });
  });
});

describe('BotBrain — wander profile', () => {
  it('always WANDERs and stays in bounds even with mobs present', () => {
    const brain = new BotBrain('wander', () => 0.5);
    const action = brain.decide(viewWith({ entities: [mob(2, 850, 600)] }));
    expect(brain.state).toBe('WANDER');
    expect(action.cast).toBeUndefined();
  });
});

describe('BotBrain — grind profile', () => {
  it('walks toward a distant mob without casting yet', () => {
    const brain = new BotBrain('grind', () => 0.5);
    const action = brain.decide(viewWith({ entities: [mob(2, 1400, 600)] }));
    expect(brain.state).toBe('FIGHT');
    expect(action.cast).toBeUndefined();
    expect(action.input.right).toBe(true);
  });

  it('casts arrow at a mob once in range', () => {
    const brain = new BotBrain('grind', () => 0.5);
    const action = brain.decide(viewWith({ entities: [mob(2, 900, 600)] }));
    expect(brain.state).toBe('FIGHT');
    expect(action.cast?.ability).toBe('arrow');
    expect(action.cast?.dx).toBeGreaterThan(0);
  });

  it('respects the cast cooldown (no double-cast on back-to-back ticks)', () => {
    const brain = new BotBrain('grind', () => 0.5);
    const a1 = brain.decide(viewWith({ now: 1000, entities: [mob(2, 900, 600)] }));
    const a2 = brain.decide(viewWith({ now: 1050, entities: [mob(2, 900, 600)] }));
    expect(a1.cast).toBeDefined();
    expect(a2.cast).toBeUndefined();
  });

  it('detours to LOOT a nearby ground item when no mobs remain', () => {
    const item: EntityState = {
      id: 3,
      x: 870,
      y: 600,
      name: 'Loot',
      hue: 0,
      kind: 'item',
      facing: 0,
      hp: 0,
      maxHp: 0,
      level: 0,
    };
    const brain = new BotBrain('grind', () => 0.5);
    const action = brain.decide(viewWith({ entities: [item] }));
    expect(brain.state).toBe('LOOT');
    expect(action.input.right).toBe(true);
  });

  it('heads to VENDOR and interacts when the bag is heavy and a vendor is in range', () => {
    const vendor: EntityState = {
      id: 4,
      x: 805,
      y: 600,
      name: 'Vendor',
      hue: 0,
      kind: 'npc',
      npcKind: 'vendor',
      facing: 0,
      hp: 0,
      maxHp: 0,
      level: 0,
    };
    const brain = new BotBrain('grind', () => 0.5);
    const action = brain.decide(viewWith({ bagCount: 20, entities: [vendor] }));
    expect(brain.state).toBe('VENDOR');
    expect(action.interact).toBe(true);
  });

  it('stays idle while dead', () => {
    const brain = new BotBrain('grind', () => 0.5);
    const action = brain.decide(viewWith({ dead: true, entities: [mob(2, 900, 600)] }));
    expect(action.input).toEqual({ up: false, down: false, left: false, right: false });
  });
});

describe('BotBrain — hopper profile', () => {
  it('walks into a portal rect once its hop timer elapses', () => {
    const brain = new BotBrain('hopper', () => 0, 0);
    // Far-future "now" guarantees the hop timer has elapsed.
    const action = brain.decide(viewWith({ now: 1_000_000, entities: [] }));
    expect(brain.state).toBe('PORTAL_HOP');
    expect(action.input.right).toBe(true); // town's only portal is on the east edge
  });
});

// --- Integration: real server, real socket ------------------------------------------
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

describe('BotClient against a real server', () => {
  let server: ChildProcess | undefined;

  afterAll(() => {
    server?.kill();
  });

  it('joins, gets a welcome, content, and streaming snapshots', async () => {
    const port = await freePort();
    const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
    const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
    const entry = join(repoRoot, 'src', 'server', 'index.ts');

    server = spawn(process.execPath, [tsxCli, entry], {
      cwd: repoRoot,
      env: {
        ...process.env,
        PORT: String(port),
        GAME_DB: ':memory:',
        INSTANCING: 'single',
        TICK_RATE: '20',
      },
      stdio: 'ignore',
    });

    // Wait for the port to accept connections.
    const url = `ws://localhost:${port}`;
    const deadline = Date.now() + 20_000;
    const bot = new BotClient({ url, name: 'test-bot', connectTimeoutMs: 2000 });
    let joined = false;
    while (Date.now() < deadline && !joined) {
      try {
        await bot.connect();
        joined = true;
      } catch {
        await new Promise((r) => setTimeout(r, 300));
      }
    }
    expect(joined).toBe(true);
    expect(bot.selfId).toBeGreaterThan(0);
    expect(bot.areas.size).toBeGreaterThan(0);

    // Snapshots should stream in within a second or two.
    const snapDeadline = Date.now() + 5000;
    while (bot.metrics.snapshots < 5 && Date.now() < snapDeadline) {
      bot.sendInput({ up: false, down: false, left: false, right: true });
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(bot.metrics.snapshots).toBeGreaterThanOrEqual(5);
    expect(bot.metrics.decodeErrors).toBe(0);
    expect(bot.you).not.toBeNull();

    bot.close();
  }, 30_000);
});

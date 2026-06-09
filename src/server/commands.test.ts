import { describe, expect, it } from 'vitest';
import { World } from './world.js';
import { isCommand, runCommand, type CommandContext } from './commands.js';
import { AccessLevel } from './accounts.js';

interface Captures {
  replies: string[];
  broadcasts: string[];
  level: number | null;
}

function makeCtx(
  world: World,
  playerId: number,
  accessLevel: number,
): {
  ctx: CommandContext;
  cap: Captures;
} {
  const cap: Captures = { replies: [], broadcasts: [], level: null };
  const ctx: CommandContext = {
    accessLevel,
    args: [],
    playerId,
    areaId: 'town',
    world,
    reply: (t) => cap.replies.push(t),
    broadcast: (t) => cap.broadcasts.push(t),
    name: () => 'Tester',
    login: (u, p) => (u === 'dev' && p === 'secret' ? AccessLevel.Developer : null),
    setAccessLevel: (l) => {
      cap.level = l;
    },
    listPlayers: () => world.playerNames(),
    setAccessFor: () => true,
  };
  return { ctx, cap };
}

describe('commands', () => {
  it('detects slash commands', () => {
    expect(isCommand('/help')).toBe(true);
    expect(isCommand('hello')).toBe(false);
  });

  it('help and roll are available to players', () => {
    const world = new World();
    const id = world.spawn('Tester');
    const { ctx, cap } = makeCtx(world, id, AccessLevel.Player);
    runCommand('/help', ctx);
    expect(cap.replies.join(' ')).toContain('/help');
    runCommand('/roll 6', ctx);
    expect(cap.broadcasts.join(' ')).toMatch(/rolls \d+ \(1-6\)/);
  });

  it('gates GM commands by access level', () => {
    const world = new World();
    const id = world.spawn('Tester');

    const asPlayer = makeCtx(world, id, AccessLevel.Player);
    runCommand('/tp 100 200', asPlayer.ctx);
    expect(asPlayer.cap.replies.join(' ')).toContain("don't have access");
    expect(world.playerPos(id)).not.toEqual({ x: 100, y: 200 });

    const asGm = makeCtx(world, id, AccessLevel.GameMaster);
    runCommand('/tp 100 200', asGm.ctx);
    expect(world.playerPos(id)).toEqual({ x: 100, y: 200 });
  });

  it('login elevates access via the provided callback', () => {
    const world = new World();
    const id = world.spawn('Tester');
    const { ctx, cap } = makeCtx(world, id, AccessLevel.Player);
    runCommand('/login dev secret', ctx);
    expect(cap.level).toBe(AccessLevel.Developer);
    expect(cap.replies.join(' ')).toContain('Developer');

    runCommand('/login dev wrong', ctx);
    expect(cap.replies.join(' ')).toContain('Login failed');
  });

  it('rejects unknown commands', () => {
    const world = new World();
    const id = world.spawn('Tester');
    const { ctx, cap } = makeCtx(world, id, AccessLevel.Admin);
    runCommand('/frobnicate', ctx);
    expect(cap.replies.join(' ')).toContain('Unknown command');
  });
});

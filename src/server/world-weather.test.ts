import { describe, expect, it } from 'vitest';
import { PLAYER_SPEED } from '../shared/protocol.js';
import { World } from './world.js';
import { stepMob, MOB_TEMPLATES, type MobView, type PlayerView } from './mobs.js';

describe('weather affects gameplay (server-authoritative)', () => {
  it('snow slows player movement by the weather move scale', () => {
    const world = new World();
    const id = world.spawn('Mover');
    world.applyWeather('snow'); // moveScale 0.82
    world.setInput(id, { up: false, down: false, left: false, right: true });
    const before = world.playerPos(id)!.x;
    world.tick(1); // one full second
    const dx = world.playerPos(id)!.x - before;
    expect(dx).toBeCloseTo(PLAYER_SPEED * 0.82, 1);
  });

  it('fog shrinks effective monster aggro range', () => {
    const wolf = MOB_TEMPLATES.wolf!;
    const mob: MobView = { x: 0, y: 0, template: wolf, attackReady: false };
    // A player just inside normal aggro range, but outside it once fog (0.55) is applied.
    const dist = wolf.aggroRange * 0.8;
    const players: PlayerView[] = [{ id: 1, x: dist, y: 0, alive: true }];
    expect(
      stepMob(mob, players, 1).attackTargetId !== null || stepMob(mob, players, 1).vx !== 0,
    ).toBe(true); // notices the player without weather
    const foggy = stepMob(mob, players, 0.55);
    expect(foggy.vx).toBe(0);
    expect(foggy.attackTargetId).toBeNull(); // fog: doesn't notice the player
  });
});

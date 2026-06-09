import { describe, expect, it } from 'vitest';
import { Predictor } from './predictor.js';
import { PLAYER_SPEED, type InputState } from '../shared/protocol.js';

const RIGHT: InputState = { up: false, down: false, left: false, right: true };
const NONE: InputState = { up: false, down: false, left: false, right: false };

describe('Predictor', () => {
  it('predicts immediately from input after init', () => {
    const p = new Predictor();
    p.reconcile(0, 100, 100, 1 / 30); // initializes from authority
    expect(p.ready).toBe(true);
    p.step(RIGHT, 1); // one full second
    expect(p.x).toBeCloseTo(100 + PLAYER_SPEED, 5);
    expect(p.y).toBe(100);
  });

  it('clamps prediction to world bounds', () => {
    const p = new Predictor();
    p.setBounds(500, 500);
    p.reconcile(0, 480, 100, 1 / 30);
    for (let i = 0; i < 50; i++) p.step(RIGHT, 1);
    expect(p.x).toBe(500);
  });

  it('converges to the server when reconciling matching inputs', () => {
    const dt = 1 / 30;
    const p = new Predictor();
    p.reconcile(0, 0, 0, dt);
    // Predict 10 steps of moving right; server confirms the same movement up to seq 10.
    for (let i = 0; i < 10; i++) p.step(RIGHT, dt);
    const serverX = 10 * (PLAYER_SPEED * dt); // server integrated the same inputs
    p.reconcile(10, serverX, 0, dt);
    expect(p.x).toBeCloseTo(serverX, 3);
  });

  it('snaps on a large authoritative correction (teleport)', () => {
    const dt = 1 / 30;
    const p = new Predictor();
    p.reconcile(0, 0, 0, dt);
    p.step(NONE, dt);
    p.reconcile(1, 1000, 1000, dt); // server says we're far away
    expect(p.x).toBe(1000);
    expect(p.y).toBe(1000);
  });
});

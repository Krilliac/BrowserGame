import { clamp, moveVector } from '../shared/movement.js';
import { PLAYER_SPEED, type InputState } from '../shared/protocol.js';
import { resolveCircleMove, PLAYER_COLLISION_RADIUS, type Blockers } from '../shared/collision.js';

/**
 * Client-side prediction + server reconciliation (Gambetta's model). The local player is simulated
 * immediately from input so movement feels instant, instead of being rendered ~100ms in the past
 * like remote entities. Each input is tagged with a sequence number; when the server acks a seq
 * (in the `you` message) with the authoritative position, we rebase on it and replay the inputs it
 * hasn't processed yet, smoothing out any small residual error.
 *
 * Because the movement math is shared with the server (`shared/movement.ts`) and both integrate the
 * same constant velocity, prediction converges instead of rubber-banding.
 */
const CORRECTION = 0.35; // fraction of residual error corrected per reconcile (smooths)
const SNAP_DIST = 80; // hard-snap threshold (teleport / large desync)

export class Predictor {
  x = 0;
  y = 0;
  ready = false;
  private seq = 0;
  private width = 2000;
  private height = 2000;
  // Solid colliders for the current area — rects (house walls, cliffs, barriers) AND circles
  // (mountains, boulders). Set on area change from the SAME decor the server uses, so prediction
  // resolves collisions identically (no rubber-banding).
  private blockers: Blockers = { rects: [], circles: [] };
  // Each pending input records the speed multiplier active when it was sent, so replaying it during
  // reconciliation integrates exactly like the server did (which scales by weather/affix/buff/slow).
  private pending: { seq: number; input: InputState; moveMul: number }[] = [];

  setBounds(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }

  /** Set the area's solid geometry (must be the SAME blockers the server collides against). */
  setBlockers(blockers: Blockers): void {
    this.blockers = blockers;
  }

  /** Drop prediction (e.g. on area change); the next reconcile re-initializes from authority. */
  reset(): void {
    this.ready = false;
    this.pending = [];
  }

  /**
   * Advance the local prediction by one fixed step and record the input. `moveMul` is the server's
   * current effective move multiplier (weather × +move affix × haste × slow), so prediction matches
   * the authoritative integration; defaults to 1 if the server hasn't reported one yet.
   */
  step(input: InputState, dt: number, moveMul = 1): number {
    this.seq++;
    const p = { x: this.x, y: this.y };
    this.apply(input, dt, p, moveMul);
    this.x = p.x;
    this.y = p.y;
    this.pending.push({ seq: this.seq, input, moveMul });
    if (this.pending.length > 240) this.pending.shift();
    return this.seq;
  }

  /** Rebase on the authoritative state for `ackSeq`, then replay unacknowledged inputs. */
  reconcile(ackSeq: number, ax: number, ay: number, dt: number): void {
    if (!this.ready) {
      this.x = ax;
      this.y = ay;
      this.pending = [];
      this.ready = true;
      return;
    }
    while (this.pending.length && this.pending[0]!.seq <= ackSeq) this.pending.shift();
    const p = { x: ax, y: ay };
    for (const cmd of this.pending) this.apply(cmd.input, dt, p, cmd.moveMul);
    const err = Math.hypot(p.x - this.x, p.y - this.y);
    if (err > SNAP_DIST) {
      this.x = p.x;
      this.y = p.y;
    } else {
      this.x += (p.x - this.x) * CORRECTION;
      this.y += (p.y - this.y) * CORRECTION;
    }
  }

  private apply(
    input: InputState,
    dt: number,
    target: { x: number; y: number },
    moveMul: number,
  ): void {
    const { dx, dy } = moveVector(input);
    const speed = PLAYER_SPEED * moveMul;
    const nx = clamp(target.x + dx * speed * dt, 0, this.width);
    const ny = clamp(target.y + dy * speed * dt, 0, this.height);
    // Same resolveCircleMove the server runs, against the same blockers — keeps prediction in lockstep.
    const resolved = resolveCircleMove(
      target.x,
      target.y,
      nx,
      ny,
      PLAYER_COLLISION_RADIUS,
      this.blockers.rects,
      this.blockers.circles,
    );
    target.x = resolved.x;
    target.y = resolved.y;
  }
}

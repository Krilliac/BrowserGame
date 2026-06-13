/**
 * Client-side sprite animation state machine. Turns the renderer's old "idle vs walk frame index"
 * into named clips (idle / walk / attack / cast / hurt / death) driven by movement + the server's
 * FxEvents. Pure and framework-free (no Pixi) so it is unit-tested; the renderer owns the textures
 * and just asks `resolve()` for the (row, col) to display each frame.
 *
 * AUTHORITY: animation is 100% cosmetic. It never gates damage, cooldowns, or movement — its only
 * inputs are measured world-delta, `facing`, an HP-drop flag, and the FxEvents the server already
 * emits. A one-shot (attack/cast/hurt/death) is triggered by an event and plays to completion.
 */

export type AnimState = 'idle' | 'walk' | 'attack' | 'cast' | 'hurt' | 'death';
export type Dir = 'N' | 'W' | 'S' | 'E';

/** One animation clip: a horizontal run of frames on a row (or a direction-offset row). */
export interface Clip {
  /** Base sheet row (for directional clips the actual row is `row0 + dirIndex`). */
  row0: number;
  /** First column of the run. */
  startCol: number;
  /** Number of frames. */
  frames: number;
  /** Milliseconds per frame. */
  perFrameMs: number;
  /** Looping (locomotion) vs one-shot (actions). */
  loop: boolean;
  /** If true the clip uses a single row regardless of facing (e.g. the LPC hurt/death row). */
  dirless?: boolean;
}

/** A sheet's animation definition: its per-direction row order + the clips it actually has. */
export interface ClipSet {
  /** Maps a Dir to its row offset within a block: index = dirOrder.indexOf(dir). */
  dirOrder: Dir[];
  /**
   * Direction count for this sheet (RENDER-09). Omitted/4 → the classic `dirOrder` cardinal mapping
   * (unchanged). 8 or 16 → the sheet has that many directional rows, ordered clockwise from East
   * (E, then clockwise), and the row offset is `dirIndex(facing, dirCount)`. A higher-direction hero
   * sheet rotates more smoothly; mobs that only ship 4-dir art simply omit this and are unaffected.
   */
  dirCount?: 4 | 8 | 16;
  clips: Partial<Record<AnimState, Clip>>;
}

/** The priority order: a higher-priority state wins while it is active. */
const ONE_SHOTS: AnimState[] = ['death', 'hurt', 'cast', 'attack'];

/** Mutable per-actor animation state the renderer keeps alongside each sprite. */
export interface AnimView {
  /** The active one-shot, or null when in locomotion (idle/walk). */
  action: AnimState | null;
  /** Sim-clock ms the current one-shot started. */
  actionStart: number;
  /** Sim-clock ms the current one-shot ends (after which locomotion resumes). */
  actionUntil: number;
  /** True once a death one-shot has played — death holds its last frame forever. */
  dead: boolean;
}

export function newAnimView(): AnimView {
  return { action: null, actionStart: 0, actionUntil: 0, dead: false };
}

/** Quantize a facing angle (radians) to a cardinal direction. */
export function dirOf(facing: number): Dir {
  const q = ((Math.round(facing / (Math.PI / 2)) % 4) + 4) % 4;
  return (['E', 'S', 'W', 'N'] as const)[q]!;
}

/**
 * Quantize a facing angle to a directional ROW INDEX for an N-direction sheet (RENDER-09): index 0
 * is East and increases clockwise (E → S → W → N, matching `dirOf` at N=4), since screen +y points
 * south. Used by sheets that declare `dirCount` 8 or 16 for smoother rotation. Pure → unit-tested.
 */
export function dirIndex(facing: number, dirCount: number): number {
  const n = Math.max(1, Math.round(dirCount));
  const step = (Math.PI * 2) / n;
  return ((Math.round(facing / step) % n) + n) % n;
}

/**
 * Begin a one-shot animation (called from an FxEvent or an HP-drop). Ignored if the sheet has no
 * such clip, or if a strictly higher-priority one-shot is already playing (death > hurt > cast >
 * attack). `death` latches `dead` so the actor never animates anything else again.
 */
export function triggerOneShot(v: AnimView, state: AnimState, now: number, set: ClipSet): void {
  const clip = set.clips[state];
  if (!clip || !ONE_SHOTS.includes(state)) return;
  if (v.dead) return; // a corpse stays a corpse
  // Don't let a lower/equal-priority action interrupt one already in flight.
  if (v.action && now < v.actionUntil) {
    if (ONE_SHOTS.indexOf(state) >= ONE_SHOTS.indexOf(v.action)) return;
  }
  v.action = state;
  v.actionStart = now;
  v.actionUntil = now + clip.frames * clip.perFrameMs;
  if (state === 'death') v.dead = true;
}

/**
 * Resolve the (row, col) to show this frame. Death holds its last frame; an active one-shot plays
 * to completion (no loop); otherwise locomotion picks walk (moving) or idle, falling back to those
 * when an action clip is missing on this sheet.
 */
export function resolveAnim(
  v: AnimView,
  set: ClipSet,
  facing: number,
  moving: boolean,
  now: number,
): { row: number; col: number } {
  // Death is terminal: play the death clip and hold its last frame.
  if (v.dead) {
    const clip = set.clips.death ?? set.clips.hurt;
    if (clip) return frameAt(set, facing, clip, clip.frames - 1);
  }

  // An in-flight one-shot owns the pose until it ends.
  if (v.action && now < v.actionUntil) {
    const clip = set.clips[v.action];
    if (clip) {
      const idx = Math.min(clip.frames - 1, Math.floor((now - v.actionStart) / clip.perFrameMs));
      return frameAt(set, facing, clip, idx);
    }
  }
  v.action = null; // one-shot finished (or its clip vanished) → back to locomotion

  const state: AnimState = moving ? 'walk' : 'idle';
  const clip = set.clips[state] ?? set.clips.walk ?? set.clips.idle;
  if (!clip) return { row: 0, col: 0 };
  const idx = clip.loop
    ? Math.floor(now / clip.perFrameMs) % clip.frames
    : Math.min(clip.frames - 1, Math.floor((now - v.actionStart) / clip.perFrameMs));
  return frameAt(set, facing, clip, idx);
}

/**
 * Row/col for a frame. Directional clips offset their row by the facing's direction index: a sheet
 * declaring `dirCount` 8/16 uses the clockwise-from-East `dirIndex` (RENDER-09); otherwise the
 * classic 4-cardinal `dirOrder` mapping is used unchanged. `dirless` clips ignore facing entirely.
 */
function frameAt(
  set: ClipSet,
  facing: number,
  clip: Clip,
  frameIdx: number,
): { row: number; col: number } {
  let dirIdx = 0;
  if (!clip.dirless) {
    dirIdx =
      set.dirCount && set.dirCount > 4
        ? dirIndex(facing, set.dirCount)
        : Math.max(0, set.dirOrder.indexOf(dirOf(facing)));
  }
  return { row: clip.row0 + dirIdx, col: clip.startCol + frameIdx };
}

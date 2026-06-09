import type { FxEvent } from '../shared/combat.js';

/**
 * A transient visual effect paired with the time it was received, so the renderer can fade it
 * out over its lifetime. (Drawing now lives in the PixiJS renderer — see pixi-renderer.ts.)
 */
export interface TimedFx {
  ev: FxEvent;
  t0: number;
}

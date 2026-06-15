/**
 * Pure merge of player gem modifiers into an ability's behavior list (Slice 2). Framework-free and
 * deterministic. The world reads the player's gem-derived modifier stats and calls this at cast to
 * produce the effective behavior list before initialCharges. Increases an existing matching behavior
 * or adds a missing one; splash AoE is a radius multiplier on real splash only (never granted to a
 * single-target bolt). `multishot` and the spell-damage `mult` are handled by the caller. CLONES the
 * input so the shared ability behavior objects are never mutated.
 */
import type { BehaviorSpec } from '../shared/combat.js';

export interface SpellMods {
  chainAdd: number;
  pierceAdd: number;
  forkAdd: number;
  spellAoe: number;
  homingAdd: number;
}

export function applyModifiers(behaviors: BehaviorSpec[], mods: SpellMods): BehaviorSpec[] {
  const out: BehaviorSpec[] = behaviors.map((b) => ({ ...b }));

  if (mods.chainAdd > 0) {
    const c = out.find((b) => b.type === 'chain');
    if (c && c.type === 'chain') c.count += mods.chainAdd;
    else out.push({ type: 'chain', count: mods.chainAdd, range: 150, falloff: 0.75 });
  }
  if (mods.pierceAdd > 0) {
    const p = out.find((b) => b.type === 'pierce');
    if (p && p.type === 'pierce') p.count += mods.pierceAdd;
    else out.push({ type: 'pierce', count: mods.pierceAdd, falloff: 0.9 });
  }
  if (mods.forkAdd > 0) {
    const f = out.find((b) => b.type === 'fork');
    if (f && f.type === 'fork') f.count += mods.forkAdd;
    else out.push({ type: 'fork', count: mods.forkAdd, spreadRad: 0.35, falloff: 0.6 });
  }
  if (mods.spellAoe > 0) {
    const s = out.find((b) => b.type === 'splash');
    if (s && s.type === 'splash') s.radius = Math.round(s.radius * (1 + mods.spellAoe));
  }
  if (mods.homingAdd > 0 && !out.some((b) => b.type === 'homing')) {
    out.push({ type: 'homing', turnRate: 3.5, acquireRange: 220 });
  }
  return out;
}

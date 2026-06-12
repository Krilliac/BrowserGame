import { describe, expect, it } from 'vitest';
import {
  BOSS_SCRIPTS,
  newBossScriptState,
  stepBossScript,
  type BossScript,
  type BossScriptState,
} from './boss-scripts.js';
import { ABILITIES } from '../shared/combat.js';
import { MOB_TEMPLATES } from './mobs.js';

const ARENA = 1000; // square test arena, so 0.5/0.5 is (500, 500)

/** A small fixture exercising every step kind across two phases. */
const fixture: BossScript = {
  phases: [
    {
      hpBelow: 1.0,
      loop: [
        { kind: 'shout', text: 'opener' },
        { kind: 'brawl', ms: 1000 },
        { kind: 'cast', ability: 'frostnova' },
      ],
    },
    {
      hpBelow: 0.5,
      loop: [
        { kind: 'moveTo', x: 0.5, y: 0.5, speedMult: 2 },
        { kind: 'summon', templateId: 'abyss_thrall', count: 2, radius: 140 },
        { kind: 'wait', ms: 500 },
      ],
    },
  ],
};

function step(
  state: BossScriptState,
  now: number,
  hpFrac: number,
  x = 100,
  y = 100,
  script: BossScript = fixture,
) {
  return stepBossScript(script, state, now, hpFrac, x, y, ARENA, ARENA);
}

describe('phase selection', () => {
  it('returns null at exactly full HP (hpBelow is strict, so an unblooded boss runs plain AI)', () => {
    const state = newBossScriptState();
    expect(step(state, 0, 1.0)).toBeNull();
    expect(state.phase).toBe(-1);
  });

  it('activates phase 0 once blooded (hpFrac just under 1.0)', () => {
    const state = newBossScriptState();
    expect(step(state, 0, 0.999)).toEqual({ shout: 'opener' });
    expect(state.phase).toBe(0);
  });

  it('stays in phase 0 at exactly the next threshold (0.5 < 0.5 is false)', () => {
    const state = newBossScriptState();
    step(state, 0, 0.5);
    expect(state.phase).toBe(0);
  });

  it('selects the last matching phase when several thresholds match', () => {
    const state = newBossScriptState();
    step(state, 0, 0.3); // matches hpBelow 1.0 AND 0.5 — the later (lower) phase wins
    expect(state.phase).toBe(1);
  });
});

describe('moveTo', () => {
  it('emits a unit direction scaled by speedMult, facing the target', () => {
    const state = newBossScriptState();
    // Phase 1 step 0: moveTo (0.5, 0.5) => (500, 500), boss at (100, 500): straight +x.
    const action = step(state, 0, 0.3, 100, 500);
    expect(action?.move).toBeDefined();
    expect(action!.move!.vx).toBeCloseTo(2, 5); // unit (1, 0) × speedMult 2
    expect(action!.move!.vy).toBeCloseTo(0, 5);
    expect(action!.move!.facing).toBeCloseTo(0, 5);
  });

  it('defaults speedMult to 1 (move vector has unit magnitude)', () => {
    const script: BossScript = {
      phases: [{ hpBelow: 1.0, loop: [{ kind: 'moveTo', x: 0.7, y: 0.2 }] }],
    };
    const action = step(newBossScriptState(), 0, 0.9, 100, 100, script);
    expect(Math.hypot(action!.move!.vx, action!.move!.vy)).toBeCloseTo(1, 5);
  });

  it('completes within 12px of the target and falls through to the next step', () => {
    const state = newBossScriptState();
    // Boss within arrive distance of (500, 500): moveTo completes, summon fires same tick.
    const action = step(state, 0, 0.3, 495, 500);
    expect(action?.summon).toEqual({
      kind: 'summon',
      templateId: 'abyss_thrall',
      count: 2,
      radius: 140,
    });
    expect(state.step).toBe(2); // cursor sits on the wait step
  });
});

describe('one-shot steps (shout / cast / summon)', () => {
  it('fires exactly once per loop pass, then fires again on the next pass', () => {
    const script: BossScript = {
      phases: [
        {
          hpBelow: 1.0,
          loop: [
            { kind: 'shout', text: 'hi' },
            { kind: 'wait', ms: 1000 },
          ],
        },
      ],
    };
    const state = newBossScriptState();
    expect(step(state, 0, 0.9, 100, 100, script)).toEqual({ shout: 'hi' }); // fires on entry
    expect(step(state, 10, 0.9, 100, 100, script)).toEqual({}); // wait — no re-fire
    expect(step(state, 500, 0.9, 100, 100, script)).toEqual({}); // still waiting
    expect(step(state, 1010, 0.9, 100, 100, script)).toEqual({ shout: 'hi' }); // next pass
  });

  it('cast fires once then the cursor advances', () => {
    const state = newBossScriptState();
    step(state, 0, 0.9); // shout
    step(state, 10, 0.9); // brawl begins (null)
    const action = step(state, 1010, 0.9); // brawl over → cast fires
    expect(action).toEqual({ cast: 'frostnova' });
    expect(state.step).toBe(3); // past the cast — next call wraps the loop
  });
});

describe('brawl', () => {
  it('returns null for its whole duration, then advances', () => {
    const state = newBossScriptState();
    step(state, 0, 0.9); // shout consumed
    expect(step(state, 10, 0.9)).toBeNull(); // brawl starts at now=10
    expect(step(state, 500, 0.9)).toBeNull();
    expect(step(state, 1009, 0.9)).toBeNull(); // 999ms elapsed — still brawling
    expect(step(state, 1010, 0.9)).toEqual({ cast: 'frostnova' }); // 1000ms — done
  });
});

describe('loop wrap', () => {
  it('wraps back to step 0 after the last step completes', () => {
    const state = newBossScriptState();
    expect(step(state, 0, 0.9)).toEqual({ shout: 'opener' });
    step(state, 10, 0.9); // brawl
    expect(step(state, 1010, 0.9)).toEqual({ cast: 'frostnova' });
    expect(step(state, 1020, 0.9)).toEqual({ shout: 'opener' }); // wrapped
    expect(state.step).toBe(1);
  });
});

describe('phase interrupt', () => {
  it('crossing a threshold mid-step resets to step 0 of the new phase', () => {
    const state = newBossScriptState();
    step(state, 0, 0.9); // shout
    expect(step(state, 10, 0.9)).toBeNull(); // mid-brawl in phase 0
    const action = step(state, 20, 0.3, 100, 500); // dropped below 0.5 — interrupt
    expect(state.phase).toBe(1);
    expect(state.step).toBe(0);
    expect(action?.move).toBeDefined(); // phase 1 opens with its moveTo
  });
});

describe('determinism', () => {
  it('identical inputs and state yield identical actions and state, call after call', () => {
    const a = newBossScriptState();
    const b = newBossScriptState();
    const times = [0, 10, 500, 1010, 1020, 2030, 3040];
    for (const now of times) {
      expect(step(a, now, 0.9)).toEqual(step(b, now, 0.9));
      expect(a).toEqual(b);
    }
  });
});

describe('authored scripts', () => {
  it('keys match real boss templates', () => {
    for (const bossId of Object.keys(BOSS_SCRIPTS)) {
      expect(MOB_TEMPLATES[bossId], `boss template ${bossId}`).toBeDefined();
    }
  });

  it('only reference real ability and summon-template ids', () => {
    for (const [bossId, script] of Object.entries(BOSS_SCRIPTS)) {
      for (const phase of script.phases) {
        for (const s of phase.loop) {
          if (s.kind === 'cast') {
            expect(ABILITIES[s.ability], `${bossId} casts ${s.ability}`).toBeDefined();
          }
          if (s.kind === 'summon') {
            expect(MOB_TEMPLATES[s.templateId], `${bossId} summons ${s.templateId}`).toBeDefined();
          }
        }
      }
    }
  });

  it('phases are authored top-down (hpBelow strictly decreasing) with a 1.0 opener', () => {
    for (const [bossId, script] of Object.entries(BOSS_SCRIPTS)) {
      expect(script.phases[0]?.hpBelow, bossId).toBe(1.0);
      for (let i = 1; i < script.phases.length; i++) {
        expect(script.phases[i]!.hpBelow, `${bossId} phase ${i}`).toBeLessThan(
          script.phases[i - 1]!.hpBelow,
        );
      }
    }
  });

  it('every phase loop contains a brawl window (the boss must return to normal AI)', () => {
    for (const [bossId, script] of Object.entries(BOSS_SCRIPTS)) {
      for (const [i, phase] of script.phases.entries()) {
        expect(
          phase.loop.some((s) => s.kind === 'brawl'),
          `${bossId} phase ${i} has a brawl`,
        ).toBe(true);
      }
    }
  });
});

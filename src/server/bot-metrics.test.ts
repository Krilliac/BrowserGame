import { describe, expect, it } from 'vitest';
import { SquadMetrics, reportToMarkdown, type RunSample } from './bot-metrics.js';

const SEC = 1000;

function sample(over: Partial<RunSample> & { simMs: number }): RunSample {
  return {
    area: 'wilderness',
    alive: 3,
    lvlAvg: 5,
    lvlMin: 4,
    lvlMax: 6,
    goldSum: 100,
    gearAvg: 50,
    xpSum: 1000,
    ...over,
  };
}

describe('SquadMetrics', () => {
  it('records milestones from sampled areas with time-since-previous and level gained', () => {
    const m = new SquadMetrics(1, ['Roan', 'Mira'], 0);
    m.sample(sample({ simMs: 0, area: 'town', lvlAvg: 1 }));
    m.sample(sample({ simMs: 60 * SEC, area: 'wilderness', lvlAvg: 6 }));
    m.sample(sample({ simMs: 200 * SEC, area: 'marsh', lvlAvg: 11 }));
    const r = m.report();
    const areas = r.milestones.map((x) => x.area);
    expect(areas).toEqual(['town', 'wilderness', 'marsh']);
    const marsh = r.milestones.find((x) => x.area === 'marsh')!;
    expect(marsh.sincePrevMs).toBe(140 * SEC);
    expect(marsh.lvlGained).toBeCloseTo(5);
  });

  it('records the boss kill, total time, and a boss-attempts finding', () => {
    const m = new SquadMetrics(1, ['Roan'], 0);
    m.sample(sample({ simMs: 0, area: 'town', lvlAvg: 1 }));
    m.noteArea('the_unmade_court', 100 * SEC, 58);
    m.noteDeath({
      simMs: 110 * SEC,
      name: 'Roan',
      area: 'the_unmade_court',
      level: 58,
      cause: 'Athraxis, the Unmade God',
    });
    m.noteBossKill(180 * SEC);
    const r = m.report();
    expect(r.bossKilled).toBe(true);
    expect(r.totalMs).toBe(180 * SEC);
    expect(r.bossAttempts).toBe(1);
    expect(r.findings.some((f) => f.kind === 'boss-attempts')).toBe(true);
  });

  it('flags a death hotspot with the dominant cause', () => {
    const m = new SquadMetrics(1, ['Roan'], 0);
    m.noteDeath({
      simMs: 10 * SEC,
      name: 'Roan',
      area: 'voidmarch',
      level: 50,
      cause: 'Void Reaver',
    });
    m.noteDeath({
      simMs: 20 * SEC,
      name: 'Mira',
      area: 'voidmarch',
      level: 50,
      cause: 'Void Reaver',
    });
    m.noteDeath({ simMs: 30 * SEC, name: 'Korg', area: 'mines', level: 14, cause: 'Kobold' });
    const r = m.report();
    const hot = r.findings.find((f) => f.kind === 'death-hotspot');
    expect(hot).toBeDefined();
    expect(hot!.detail).toContain('voidmarch');
    expect(hot!.detail).toContain('Void Reaver');
  });

  it('detects a progression stall (a long stretch with no top-level gain)', () => {
    const m = new SquadMetrics(1, ['Roan'], 0);
    m.sample(sample({ simMs: 0, lvlMax: 20, lvlAvg: 20 }));
    // Stuck at L20 for a long time…
    for (let t = 60; t <= 600; t += 60)
      m.sample(sample({ simMs: t * SEC, lvlMax: 20, lvlAvg: 20 }));
    m.sample(sample({ simMs: 660 * SEC, lvlMax: 21, lvlAvg: 21 }));
    const r = m.report();
    expect(r.findings.some((f) => f.kind === 'stall')).toBe(true);
  });

  it('a "wipe-risk" finding when it reached endgame but never killed the boss', () => {
    const m = new SquadMetrics(1, ['Roan'], 0);
    m.noteArea('the_unmade_court', 100 * SEC, 58);
    m.noteDeath({
      simMs: 110 * SEC,
      name: 'Roan',
      area: 'the_unmade_court',
      level: 58,
      cause: 'Athraxis, the Unmade God',
    });
    const r = m.report();
    expect(r.bossKilled).toBe(false);
    expect(r.findings.some((f) => f.kind === 'wipe-risk')).toBe(true);
  });

  it('renders a markdown report with the key sections', () => {
    const m = new SquadMetrics(1, ['Roan', 'Mira'], 0);
    m.sample(sample({ simMs: 0, area: 'town', lvlAvg: 1 }));
    m.noteBossKill(120 * SEC);
    const md = reportToMarkdown(m.report());
    expect(md).toContain('# Bot-squad run report');
    expect(md).toContain('## Timeline');
    expect(md).toContain('## Deaths');
    expect(md).toContain('## Improvement findings');
    expect(md).toContain('Killed the final boss');
  });
});

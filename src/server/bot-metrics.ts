/**
 * Bot-squad run metrics — records a cooperating squad's journey from spawn to the final boss and
 * turns it into a report (`botrun-report.md` + `botrun-report.json`) plus auto-generated improvement
 * findings. The host (`index.ts`) feeds it throttled samples of the squad's aggregate state, the
 * first arrival in each milestone zone, every death (with a best-effort cause), and the moment the
 * Unmade Court boss dies; {@link SquadMetrics.report} then derives the timeline, curves, and findings.
 *
 * The recording + report-building logic is pure and unit-tested ({@link SquadMetrics}); only
 * {@link writeReport} touches the filesystem. All times are SIM milliseconds (tick × ms/tick) passed
 * in by the host, so a report is reproducible regardless of wall-clock and works at any tick rate.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** A periodic snapshot of the squad's aggregate state (one row of the progression curves). */
export interface RunSample {
  simMs: number;
  area: string;
  alive: number;
  lvlAvg: number;
  lvlMin: number;
  lvlMax: number;
  goldSum: number;
  /** Mean equipped-gear score across the squad (power + hp·0.5 + affix value). */
  gearAvg: number;
  /** Total XP across the squad — the progression proxy used for stall detection. */
  xpSum: number;
}

/** First arrival in one of the advancement-ladder zones. */
export interface Milestone {
  area: string;
  simMs: number;
  lvlAvg: number;
}

/** One bot death, with a best-effort cause (the nearest mob at the death site). */
export interface DeathRecord {
  simMs: number;
  name: string;
  area: string;
  level: number;
  cause: string;
}

/** A single improvement finding derived from the run data. */
export interface Finding {
  kind: 'slow-band' | 'death-hotspot' | 'stall' | 'boss-attempts' | 'wipe-risk';
  detail: string;
}

/** The machine-readable report (mirrors the markdown). */
export interface RunReport {
  owner: number;
  members: string[];
  startedSimMs: number;
  endedSimMs: number;
  totalMs: number;
  bossKilled: boolean;
  finalLevelAvg: number;
  deaths: DeathRecord[];
  bossAttempts: number;
  milestones: (Milestone & { sincePrevMs: number; lvlGained: number })[];
  samples: RunSample[];
  findings: Finding[];
}

const ENDGAME_AREA = 'the_unmade_court';

/** Records one squad's run and builds its report. One instance per owner (reset on `/bot clear`). */
export class SquadMetrics {
  private samples: RunSample[] = [];
  private milestones: Milestone[] = [];
  private deaths: DeathRecord[] = [];
  private memberNames: string[];
  private bossKillMs?: number;
  private lastSimMs = 0;
  private readonly seenAreas = new Set<string>();

  constructor(
    readonly owner: number,
    members: string[],
    readonly startedSimMs: number,
  ) {
    this.memberNames = [...members];
    this.lastSimMs = startedSimMs;
  }

  /** Keep the member roster current (names can fill in as bots are placed). */
  setMembers(members: string[]): void {
    this.memberNames = [...members];
  }

  get bossKilled(): boolean {
    return this.bossKillMs !== undefined;
  }

  /** Record a progression sample (the host throttles these, e.g. once a second). */
  sample(s: RunSample): void {
    this.samples.push(s);
    this.lastSimMs = Math.max(this.lastSimMs, s.simMs);
    // Treat any sampled area as "arrived" too, in case a milestone zone is entered between hops.
    this.noteArea(s.area, s.simMs, s.lvlAvg);
  }

  /** Record the first arrival in `area` (no-op for repeats). */
  noteArea(area: string, simMs: number, lvlAvg: number): void {
    if (this.seenAreas.has(area)) return;
    this.seenAreas.add(area);
    this.milestones.push({ area, simMs, lvlAvg });
    this.lastSimMs = Math.max(this.lastSimMs, simMs);
  }

  noteDeath(rec: DeathRecord): void {
    this.deaths.push(rec);
    this.lastSimMs = Math.max(this.lastSimMs, rec.simMs);
  }

  noteBossKill(simMs: number): void {
    if (this.bossKillMs === undefined) this.bossKillMs = simMs;
    this.lastSimMs = Math.max(this.lastSimMs, simMs);
  }

  /** Build the report (pure — no IO). */
  report(): RunReport {
    const endedSimMs = this.bossKillMs ?? this.lastSimMs;
    const last = this.samples[this.samples.length - 1];
    const milestones = this.milestones
      .slice()
      .sort((a, b) => a.simMs - b.simMs)
      .map((m, i, arr) => {
        const prev = arr[i - 1];
        return {
          ...m,
          sincePrevMs: prev ? m.simMs - prev.simMs : m.simMs - this.startedSimMs,
          lvlGained: prev ? Math.max(0, m.lvlAvg - prev.lvlAvg) : m.lvlAvg,
        };
      });
    const bossAttempts = this.deaths.filter((d) => d.area === ENDGAME_AREA).length;
    return {
      owner: this.owner,
      members: this.memberNames,
      startedSimMs: this.startedSimMs,
      endedSimMs,
      totalMs: Math.max(0, endedSimMs - this.startedSimMs),
      bossKilled: this.bossKilled,
      finalLevelAvg: last?.lvlAvg ?? 0,
      deaths: this.deaths.slice(),
      bossAttempts,
      milestones,
      samples: this.samples.slice(),
      findings: this.deriveFindings(milestones, bossAttempts),
    };
  }

  /** Mine the run data for actionable balance/AI findings. */
  private deriveFindings(milestones: RunReport['milestones'], bossAttempts: number): Finding[] {
    const out: Finding[] = [];

    // Slowest band: the milestone hop with the worst time-per-level-gained.
    let worst: { area: string; ms: number; lvl: number } | undefined;
    for (const m of milestones) {
      if (m.lvlGained <= 0) continue;
      const perLvl = m.sincePrevMs / m.lvlGained;
      if (!worst || perLvl > worst.ms / Math.max(1, worst.lvl)) {
        worst = { area: m.area, ms: m.sincePrevMs, lvl: m.lvlGained };
      }
    }
    if (worst) {
      out.push({
        kind: 'slow-band',
        detail: `Slowest stretch: reaching ${worst.area} took ${fmtDur(worst.ms)} for ${worst.lvl.toFixed(1)} levels (${fmtDur(worst.ms / Math.max(1, worst.lvl))}/level) — likely under-geared or over-tuned here.`,
      });
    }

    // Death hotspot: the area with the most deaths + its most common cause.
    if (this.deaths.length) {
      const byArea = new Map<string, DeathRecord[]>();
      for (const d of this.deaths) byArea.set(d.area, [...(byArea.get(d.area) ?? []), d]);
      let hotArea = '';
      let hot: DeathRecord[] = [];
      for (const [area, list] of byArea) {
        if (list.length > hot.length) {
          hotArea = area;
          hot = list;
        }
      }
      const cause = topCount(hot.map((d) => d.cause));
      const pct = Math.round((hot.length / this.deaths.length) * 100);
      out.push({
        kind: 'death-hotspot',
        detail: `${hot.length}/${this.deaths.length} deaths (${pct}%) happened in ${hotArea}${cause ? `, most to "${cause}"` : ''} — consider easing this zone or improving squad tactics here.`,
      });
    }

    // Stall: the longest sampled stretch with no gain in the squad's top level.
    const stall = longestStall(this.samples);
    if (stall && stall.ms > 0) {
      out.push({
        kind: 'stall',
        detail: `Longest progression stall: ${fmtDur(stall.ms)} with no level gain around ${stall.area} (L${stall.lvl}) — a pacing wall or a gear/ability gap.`,
      });
    }

    // Boss: how many wipes before the kill (or that it was never killed).
    if (this.bossKilled) {
      out.push({
        kind: 'boss-attempts',
        detail:
          bossAttempts > 0
            ? `Final boss killed after ${bossAttempts} death(s) in the Unmade Court — survivable but punishing.`
            : `Final boss killed with no deaths in the Unmade Court — the squad out-geared it (could tune up).`,
      });
    } else if (this.seenAreas.has(ENDGAME_AREA)) {
      out.push({
        kind: 'wipe-risk',
        detail: `Reached the Unmade Court but did NOT kill the boss (${bossAttempts} death(s) so far) — the squad is stuck on the final fight.`,
      });
    }
    return out;
  }
}

/** Render a report to markdown. */
export function reportToMarkdown(r: RunReport): string {
  const L: string[] = [];
  L.push(`# Bot-squad run report`);
  L.push('');
  L.push(`**Squad:** ${r.members.join(', ') || '(unnamed)'}  •  **Members:** ${r.members.length}`);
  L.push(
    `**Outcome:** ${r.bossKilled ? '✅ Killed the final boss (Athraxis, the Unmade God)' : '❌ Did not kill the final boss'}`,
  );
  L.push(
    `**Total time (sim):** ${fmtDur(r.totalMs)}  •  **Final avg level:** ${r.finalLevelAvg.toFixed(1)}  •  **Deaths:** ${r.deaths.length}`,
  );
  L.push('');
  L.push(`## Timeline (milestone zones)`);
  L.push('');
  L.push(`| Zone | Reached (sim) | +since prev | Avg level |`);
  L.push(`|------|---------------|-------------|-----------|`);
  for (const m of r.milestones) {
    L.push(
      `| ${m.area} | ${fmtDur(m.simMs - r.startedSimMs)} | ${fmtDur(m.sincePrevMs)} | ${m.lvlAvg.toFixed(1)} |`,
    );
  }
  L.push('');
  L.push(`## Progression curves (sampled)`);
  L.push('');
  L.push(`| Time | Zone | Alive | Lvl (min/avg/max) | Gold | Gear |`);
  L.push(`|------|------|-------|-------------------|------|------|`);
  for (const s of sampleEvery(r.samples, 12)) {
    L.push(
      `| ${fmtDur(s.simMs - r.startedSimMs)} | ${s.area} | ${s.alive} | ${s.lvlMin}/${s.lvlAvg.toFixed(1)}/${s.lvlMax} | ${Math.round(s.goldSum)} | ${s.gearAvg.toFixed(0)} |`,
    );
  }
  L.push('');
  L.push(`## Deaths (${r.deaths.length})`);
  L.push('');
  if (r.deaths.length) {
    L.push(`| Time | Bot | Zone | Level | Cause |`);
    L.push(`|------|-----|------|-------|-------|`);
    for (const d of r.deaths) {
      L.push(
        `| ${fmtDur(d.simMs - r.startedSimMs)} | ${d.name} | ${d.area} | ${d.level} | ${d.cause} |`,
      );
    }
  } else {
    L.push(`_No deaths — a flawless run._`);
  }
  L.push('');
  L.push(`## Improvement findings`);
  L.push('');
  if (r.findings.length) for (const f of r.findings) L.push(`- **[${f.kind}]** ${f.detail}`);
  else L.push(`_No notable issues detected._`);
  L.push('');
  return L.join('\n');
}

/** Write the report to `botrun-report.md` + `botrun-report.json` under `dir` (default cwd). */
export function writeReport(
  r: RunReport,
  dir: string = process.cwd(),
): { md: string; json: string } {
  const md = join(dir, 'botrun-report.md');
  const json = join(dir, 'botrun-report.json');
  writeFileSync(md, reportToMarkdown(r), 'utf8');
  writeFileSync(json, JSON.stringify(r, null, 2), 'utf8');
  return { md, json };
}

// --- helpers --------------------------------------------------------------------------

/** The longest run of consecutive samples whose `lvlMax` never increased. */
function longestStall(samples: RunSample[]): { ms: number; area: string; lvl: number } | undefined {
  if (samples.length < 2) return undefined;
  let bestMs = 0;
  let best: { ms: number; area: string; lvl: number } | undefined;
  let runStart = samples[0]!;
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i]!;
    if (s.lvlMax > runStart.lvlMax) {
      runStart = s;
      continue;
    }
    const ms = s.simMs - runStart.simMs;
    if (ms > bestMs) {
      bestMs = ms;
      best = { ms, area: s.area, lvl: s.lvlMax };
    }
  }
  return best;
}

/** The most frequent string in a list (ties → first seen), or undefined when empty. */
function topCount(list: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const s of list) counts.set(s, (counts.get(s) ?? 0) + 1);
  let top: string | undefined;
  let n = 0;
  for (const [s, c] of counts) {
    if (c > n) {
      top = s;
      n = c;
    }
  }
  return top;
}

/** Down-sample a long list to ~`max` rows for the markdown table (keeps first + last). */
function sampleEvery<T>(list: T[], max: number): T[] {
  if (list.length <= max) return list;
  const step = Math.ceil(list.length / max);
  const out: T[] = [];
  for (let i = 0; i < list.length; i += step) out.push(list[i]!);
  if (out[out.length - 1] !== list[list.length - 1]) out.push(list[list.length - 1]!);
  return out;
}

/** Human-friendly duration from milliseconds (e.g. "1h 03m", "4m 12s", "8s"). */
function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

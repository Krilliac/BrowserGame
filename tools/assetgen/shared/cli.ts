/**
 * Shared CLI plumbing for every generator: parse `--seed`, `--check` (dry run — validate the spec and
 * report what WOULD be written, no files), `--out` override. Keeps each generator's `cli.ts` to just
 * "describe the artifacts, hand them to runGenerator".
 */

import { writeJson, writePng } from './manifest.ts';

export interface CliArgs {
  seed: number;
  check: boolean;
  out: string | undefined;
}

export function parseArgs(argv: string[]): CliArgs {
  let seed = 1;
  let check = false;
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') seed = Number(argv[++i]) >>> 0;
    else if (a === '--check') check = true;
    else if (a === '--out') out = argv[++i];
  }
  return { seed, check, out };
}

export interface Artifact {
  path: string;
  png?: Uint8Array;
  json?: unknown;
}

/**
 * Write (or, under --check, just report) a batch of artifacts. All-or-nothing: artifacts are produced
 * fully in memory by the generator before any are written, so a spec error aborts with nothing on disk.
 */
export function emit(args: CliArgs, label: string, artifacts: Artifact[]): void {
  if (args.check) {
    console.log(`[${label}] --check OK — would write ${artifacts.length} artifact(s):`);
    for (const a of artifacts) console.log(`  ${a.path}${a.png ? ` (${a.png.length} B png)` : ''}`);
    return;
  }
  for (const a of artifacts) {
    if (a.png) writePng(a.path, a.png);
    if (a.json !== undefined) writeJson(a.path, a.json);
  }
  console.log(`[${label}] wrote ${artifacts.length} artifact(s) (seed ${args.seed}).`);
}

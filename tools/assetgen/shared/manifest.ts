/**
 * Atomic output helpers + a tiny spec validator. "No partial writes": each artifact is written to a
 * temp file and renamed into place, so a crash never leaves a half-written PNG/JSON in `public/`.
 * (A hand-rolled validator stands in for zod — same intent, zero added dependency.)
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

function atomicWrite(path: string, data: Uint8Array | string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export function writePng(path: string, bytes: Uint8Array): void {
  atomicWrite(path, bytes);
}

export function writeJson(path: string, value: unknown): void {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

// ─── Minimal validation (zod stand-in) ──────────────────────────────────────────
export class SpecError extends Error {}

export function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new SpecError(`spec invalid: ${msg}`);
}

export function num(v: unknown, name: string, lo = -Infinity, hi = Infinity): number {
  expect(typeof v === 'number' && Number.isFinite(v), `${name} must be a finite number`);
  const n = v as number;
  expect(n >= lo && n <= hi, `${name} must be in [${lo}, ${hi}] (got ${n})`);
  return n;
}

export function str(v: unknown, name: string): string {
  expect(typeof v === 'string' && v.length > 0, `${name} must be a non-empty string`);
  return v as string;
}

export function oneOf<T extends string>(v: unknown, name: string, allowed: readonly T[]): T {
  expect(allowed.includes(v as T), `${name} must be one of ${allowed.join(' | ')}`);
  return v as T;
}

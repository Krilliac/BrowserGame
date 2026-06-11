/**
 * Client-side global error trap. Installs `window.onerror` + `unhandledrejection` handlers so a
 * stray exception (a bad render frame, a rejected fetch) becomes a visible indicator instead of a
 * silent white screen, and keeps a bounded ring buffer of the most recent errors for a HUD readout.
 *
 * Framework-free (no Pixi): the pure ring buffer (`ErrorLog`) is unit-tested directly without a real
 * `window`; `installErrorTrap` just wires DOM events to it. `Date.now()` is only read at the DOM
 * boundary — the pure path takes an explicit `now` so tests stay deterministic.
 */

/** One captured error. `when` is epoch ms (from `Date.now()` at the DOM boundary). */
export interface Err {
  message: string;
  source: string;
  when: number;
  stack?: string;
}

/** How many recent errors to retain; older ones are dropped (oldest-first). */
const ERROR_CAP = 50;

/**
 * Bounded, pure ring buffer of recent errors with consecutive-duplicate suppression. No DOM, no
 * clock — fully testable. Identical consecutive messages don't push a new entry; instead the
 * existing newest entry's `when` is refreshed so the readout shows "last seen".
 */
export class ErrorLog {
  private readonly cap: number;
  private items: Err[] = [];

  constructor(cap: number = ERROR_CAP) {
    this.cap = Math.max(1, cap);
  }

  /** Record an error. Pass `now` (epoch ms) explicitly so callers/tests control the clock. */
  push(message: string, source: string, now: number, stack?: string): void {
    const last = this.items[this.items.length - 1];
    if (last && last.message === message && last.source === source) {
      // Same error firing repeatedly (e.g. a per-frame throw) — collapse to one, bump the time.
      last.when = now;
      if (stack !== undefined) last.stack = stack;
      return;
    }
    const entry: Err =
      stack !== undefined ? { message, source, when: now, stack } : { message, source, when: now };
    this.items.push(entry);
    if (this.items.length > this.cap) this.items.shift();
  }

  /** Newest-last view of the retained errors. */
  recent(): readonly Err[] {
    return this.items;
  }

  /** The single most recent error, or undefined when empty. */
  latest(): Err | undefined {
    return this.items[this.items.length - 1];
  }

  clear(): void {
    this.items = [];
  }
}

/** Module-level singleton wired by `installErrorTrap`; read by `getRecentErrors`/`clearErrors`. */
const log = new ErrorLog();
let installed = false;

export interface ErrorTrapOptions {
  /** Called (at the DOM boundary) whenever an error is trapped — e.g. to flash a HUD indicator. */
  onError?: (err: Err) => void;
}

/**
 * Install the global handlers. Idempotent: a second call is a no-op (no double-binding), so it's
 * safe to call from bootstrap and from a hot-reload path. Best-effort if `window` is absent.
 */
export function installErrorTrap(opts: ErrorTrapOptions = {}): void {
  if (installed) return;
  if (typeof window === 'undefined') return;
  installed = true;

  const record = (message: string, source: string, stack?: string): void => {
    log.push(message, source, Date.now(), stack);
    const latest = log.latest();
    if (latest && opts.onError) opts.onError(latest);
  };

  window.addEventListener('error', (event: ErrorEvent) => {
    const msg =
      event.message || (event.error instanceof Error ? event.error.message : 'Unknown error');
    const where = event.filename
      ? `${event.filename}:${event.lineno}:${event.colno}`
      : 'window.onerror';
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    record(msg, where, stack);
  });

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    const reason: unknown = event.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    record(msg, 'unhandledrejection', stack);
  });
}

/** The recent-errors ring buffer (newest last). */
export function getRecentErrors(): readonly Err[] {
  return log.recent();
}

/** The single most recent trapped error, or undefined. */
export function getLatestError(): Err | undefined {
  return log.latest();
}

/** Drop all retained errors (e.g. after the user dismisses the indicator). */
export function clearErrors(): void {
  log.clear();
}

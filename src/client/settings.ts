/**
 * Client settings — the single source of truth for player-tunable, CLIENT-SIDE options (audio,
 * camera, visual effects, HUD). Persisted to localStorage so they survive a reload.
 *
 * Because the server is authoritative, NONE of these can affect gameplay state — they only change
 * what this browser renders or plays, which is why they need no server round-trip and are safe to
 * expose freely. The GM-gated entries (debug overlay, extended zoom) live here too, but the
 * settings panel only surfaces them once the server has granted GM+ access. That gate is UX, not
 * security: a client can't grant itself real powers — privileged engine powers stay token-gated
 * server-side (see CLAUDE.md). It just keeps the menu honest for ordinary players.
 *
 * This mirrors the server's `src/server/config.ts`: one file holds every knob, grouped and
 * documented, instead of magic values scattered through the client.
 */

export interface Settings {
  /** Master audio level, 0..1. */
  volume: number;
  /** Silence all audio regardless of volume. */
  muted: boolean;
  /** Camera zoom (>1 = closer). Clamped by the renderer; wider range with extendedZoom. */
  zoom: number;
  /** Draw a small FPS readout on the HUD. */
  showFps: boolean;
  /** Hide the decorative weather + ambient motes (a phone-perf win; lighting/art is kept). */
  reduceEffects: boolean;

  // --- GM+ only (surfaced in the panel when access >= GameMaster) -----------------------
  /** A live debug overlay (entity/renderer counts, area/instance, position). */
  debugOverlay: boolean;
  /** Unlock the camera-zoom range well past the normal limits. */
  extendedZoom: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  volume: 0.8,
  muted: false,
  zoom: 1.15, // matches the renderer's default framing
  showFps: false,
  reduceEffects: false,
  debugOverlay: false,
  extendedZoom: false,
};

/** Access level at/above which GM settings unlock (mirrors server AccessLevel.GameMaster = 2). */
export const ACCESS_GM = 2;

/** Camera-zoom slider bounds, mirroring the renderer's clamp in `setZoom`. */
export const ZOOM_BOUNDS = {
  normal: { min: 0.75, max: 1.6 },
  extended: { min: 0.4, max: 3.0 },
} as const;

const LS_KEY = 'bg.settings';

function load(): Settings {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    // Merge over defaults so adding a field later never breaks an older saved blob.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * The live settings, with persistence + change notification. The panel calls `set`; consumers
 * (audio, renderer, HUD) `subscribe` and re-apply. One store instance lives in main.ts.
 */
export class SettingsStore {
  private readonly values: Settings = load();
  private readonly listeners = new Set<(s: Readonly<Settings>) => void>();

  all(): Readonly<Settings> {
    return this.values;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    this.persist();
    for (const fn of this.listeners) fn(this.values);
  }

  /** Register an apply-on-change callback. Not called immediately — apply the current values once yourself. */
  subscribe(fn: (s: Readonly<Settings>) => void): void {
    this.listeners.add(fn);
  }

  private persist(): void {
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(this.values));
    } catch {
      // Private-mode / disabled storage — settings just won't persist this session.
    }
  }
}

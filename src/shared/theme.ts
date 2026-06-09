/**
 * Environment theme — the *look* of an area, served from the content DB so the world's appearance
 * is fully data-driven and live-editable. Edit the `area_theme` table (via SQL, or the `/settheme`
 * dev command) and every connected client re-skins on the next content broadcast: ground colors,
 * props, mood tint, ambient particles, weather, and lighting. Colors are CSS hex strings so they
 * are trivial to author by hand.
 *
 * This type is the wire contract (shared client/server). The client renderer + atmosphere read it;
 * DEFAULT_THEME fills any gap so an area without a theme row still looks fine. THEME_KEYS is the
 * editable-key registry: it maps a snake_case key (== the area_theme column name) to its AreaTheme
 * field, type, and valid range, and powers validation for the live-edit command.
 */

export type PropKind = 'tree' | 'grave' | 'rock' | 'none';
export type WeatherKind = 'none' | 'rain' | 'snow' | 'fog';

export interface AreaTheme {
  /** Ground fill + speckle colors (the tiled terrain texture). */
  groundBase: string;
  groundSpeck: string;
  /** Scattered prop type and how dense they are (0..1). */
  prop: PropKind;
  propDensity: number;
  /** Base mood tint applied every frame, independent of time of day. */
  atmoColor: string;
  atmoAlpha: number;
  /** Outdoor areas get the day/night cycle; indoor ones (crypts) keep their own gloom. */
  outdoor: boolean;
  /** Drifting ambient motes. */
  particleColor: string;
  particleCount: number;
  /** Vertical drift in px/s (negative rises, positive falls). */
  particleRise: number;
  particleFlicker: boolean;
  /** Weather overlay. */
  weather: WeatherKind;
  weatherIntensity: number;
  fogColor: string;
  /** Baseline ambient light 0..1 (1 = unaffected by night darkening; lower = murkier). */
  lightAmbient: number;
}

export const DEFAULT_THEME: AreaTheme = {
  groundBase: '#1f2a1c',
  groundSpeck: '#27331f',
  prop: 'tree',
  propDensity: 0.08,
  atmoColor: '#4a6a4a',
  atmoAlpha: 0.1,
  outdoor: true,
  particleColor: '#bfff8a',
  particleCount: 40,
  particleRise: -6,
  particleFlicker: true,
  weather: 'none',
  weatherIntensity: 0.5,
  fogColor: '#8a93a0',
  lightAmbient: 1,
};

interface ThemeKeySpec {
  field: keyof AreaTheme;
  type: 'color' | 'number' | 'int' | 'bool' | 'enum';
  min?: number;
  max?: number;
  values?: readonly string[];
}

/** Editable theme keys (key == area_theme column). Used to validate `/settheme` and map to wire. */
export const THEME_KEYS: Record<string, ThemeKeySpec> = {
  ground_base: { field: 'groundBase', type: 'color' },
  ground_speck: { field: 'groundSpeck', type: 'color' },
  prop: { field: 'prop', type: 'enum', values: ['tree', 'grave', 'rock', 'none'] },
  prop_density: { field: 'propDensity', type: 'number', min: 0, max: 1 },
  atmo_color: { field: 'atmoColor', type: 'color' },
  atmo_alpha: { field: 'atmoAlpha', type: 'number', min: 0, max: 1 },
  outdoor: { field: 'outdoor', type: 'bool' },
  particle_color: { field: 'particleColor', type: 'color' },
  particle_count: { field: 'particleCount', type: 'int', min: 0, max: 160 },
  particle_rise: { field: 'particleRise', type: 'number', min: -80, max: 80 },
  particle_flicker: { field: 'particleFlicker', type: 'bool' },
  weather: { field: 'weather', type: 'enum', values: ['none', 'rain', 'snow', 'fog'] },
  weather_intensity: { field: 'weatherIntensity', type: 'number', min: 0, max: 1 },
  fog_color: { field: 'fogColor', type: 'color' },
  light_ambient: { field: 'lightAmbient', type: 'number', min: 0, max: 1 },
};

const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const TRUE_WORDS = ['1', 'true', 'on', 'yes'];
const FALSE_WORDS = ['0', 'false', 'off', 'no'];

/**
 * Validate + coerce a raw string value for a theme key. Returns the typed value (clamped to range)
 * or null if the key is unknown or the value is invalid. The single boundary for untrusted theme
 * edits — both the live command and any future tooling go through here.
 */
export function coerceThemeValue(key: string, raw: string): string | number | boolean | null {
  const spec = THEME_KEYS[key];
  if (!spec) return null;
  switch (spec.type) {
    case 'color':
      return COLOR_RE.test(raw) ? raw : null;
    case 'bool':
      if (TRUE_WORDS.includes(raw.toLowerCase())) return true;
      if (FALSE_WORDS.includes(raw.toLowerCase())) return false;
      return null;
    case 'enum':
      return spec.values!.includes(raw) ? raw : null;
    case 'number':
    case 'int': {
      let n = spec.type === 'int' ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
      if (!Number.isFinite(n)) return null;
      if (spec.min !== undefined) n = Math.max(spec.min, n);
      if (spec.max !== undefined) n = Math.min(spec.max, n);
      return n;
    }
  }
}

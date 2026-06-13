/**
 * Normal-map atlas (RENDER-01): maps each albedo sprite sheet / tileset to its normal-map
 * counterpart, and defines the flat-fallback policy that lets the deferred lighting pass ship
 * incrementally, one sheet at a time.
 *
 * Convention: a sheet's normal map lives beside it as `<name>_n.png` (e.g. `hero_walk_lpc.png` →
 * `hero_walk_lpc_n.png`). When a sheet has no normal map yet, the pass samples a flat
 * `(128,128,255)` texel → tangent-space normal `(0,0,1)` → the sprite shades exactly as it does
 * today. This module is pure data + lookup (no Pixi), so the mapping stays unit-testable.
 *
 * Today the explicit map is empty: no normal art has been authored, so `hasRealNormals()` is false
 * and the renderer keeps the existing additive-halo lighting. Drop a `*_n.png` beside a sheet and add
 * its mapping here (or rely on the `_n` convention) to light that sheet per-pixel — the deferred pass
 * activates the moment at least one real normal map loads.
 */

/**
 * Explicit albedo-src → normal-src overrides. Empty until normal art is authored; entries here win
 * over the `_n.png` convention (use them when a normal map lives at a non-conventional path).
 */
export const NORMAL_OVERRIDES: Record<string, string> = {};

/** Derive the conventional normal-map path for an albedo sheet src (`foo.png` → `foo_n.png`). */
export function conventionalNormalSrc(albedoSrc: string): string {
  const dot = albedoSrc.lastIndexOf('.');
  if (dot < 0) return `${albedoSrc}_n`;
  return `${albedoSrc.slice(0, dot)}_n${albedoSrc.slice(dot)}`;
}

/**
 * The normal-map src to attempt for an albedo sheet: an explicit override if present, else the
 * `_n.png` convention. The loader tries this path; a failed fetch simply leaves the sheet flat.
 */
export function normalSrcFor(albedoSrc: string): string {
  return NORMAL_OVERRIDES[albedoSrc] ?? conventionalNormalSrc(albedoSrc);
}

/**
 * Whether any real normal maps actually loaded. The renderer passes the set of normal srcs that
 * resolved successfully; when it's empty the deferred pass stays inactive and the scene renders
 * exactly as it does today (the "identical to current main" guarantee).
 */
export function hasRealNormals(loadedNormalSrcs: ReadonlySet<string>): boolean {
  return loadedNormalSrcs.size > 0;
}

/**
 * ASSET-TILE — seamless biome ground tilesets + autotile blend metadata. Output matches the engine's
 * `GroundTileset` (ground-tiles.ts), which the renderer bakes via `tiledGroundTexture`. Seamlessness:
 * the base mottle uses WRAPPED-lattice periodic noise (tiles edge-to-edge with no seam), and variant
 * detail (pebbles/cracks/flowers) is kept inside the cell so borders stay pure base — so a 4×4 tiling
 * has continuous edges. The `tiles[]` weight the base heavily; `blend` clusters the detail tiles
 * (RENDER-04) — absent on a single-tile biome → byte-identical to flat.
 */

import { Raster, type RGBA } from '../shared/raster.ts';
import { Rng } from '../shared/rng.ts';
import { hslToRgba, shade } from '../shared/palette.ts';

export interface BiomeSpec {
  name: string;
  tileSize: number;
  /** Base ground HSL. */
  hue: number;
  sat: number;
  light: number;
  /** Detail kind drawn into variant tiles. */
  detail: 'pebble' | 'crack' | 'flower' | 'tuft';
  detailHue: number;
}

/** Wrapped-lattice value noise, periodic over [0,1] (so tiles seam). `lat` = lattice cells. */
function periodic(u: number, v: number, lat: number, lattice: number[]): number {
  const x = u * lat;
  const y = v * lat;
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const at = (i: number, j: number) =>
    lattice[(((j % lat) + lat) % lat) * lat + (((i % lat) + lat) % lat)]!;
  const s = (t: number) => t * t * (3 - 2 * t);
  const tl = at(xi, yi);
  const tr = at(xi + 1, yi);
  const bl = at(xi, yi + 1);
  const br = at(xi + 1, yi + 1);
  const u2 = s(xf);
  const top = tl + (tr - tl) * u2;
  const bot = bl + (br - bl) * u2;
  return top + (bot - top) * s(yf);
}

function makeLattice(lat: number, rng: Rng): number[] {
  const a: number[] = [];
  for (let i = 0; i < lat * lat; i++) a.push(rng.next());
  return a;
}

function drawBaseTile(
  r: Raster,
  ox: number,
  oy: number,
  ts: number,
  spec: BiomeSpec,
  rng: Rng,
): void {
  const lat4 = makeLattice(4, rng);
  const lat8 = makeLattice(8, rng);
  for (let y = 0; y < ts; y++) {
    for (let x = 0; x < ts; x++) {
      const u = x / ts;
      const v = y / ts;
      const n = periodic(u, v, 4, lat4) * 0.6 + periodic(u, v, 8, lat8) * 0.4;
      const l = spec.light + (n - 0.5) * 0.16;
      r.fillRect(ox + x, oy + y, 1, 1, hslToRgba(spec.hue, spec.sat, Math.max(0, Math.min(1, l))));
    }
  }
}

function drawDetail(
  r: Raster,
  ox: number,
  oy: number,
  ts: number,
  spec: BiomeSpec,
  rng: Rng,
): void {
  const cx = ox + ts / 2;
  const cy = oy + ts / 2;
  const col: RGBA = hslToRgba(spec.detailHue, 0.5, 0.45);
  const inner = ts * 0.3; // keep detail away from edges so the tile still seams
  if (spec.detail === 'pebble') {
    for (let i = 0; i < 4; i++)
      r.disc(
        cx + (rng.next() - 0.5) * inner,
        cy + (rng.next() - 0.5) * inner,
        1.5 + rng.next() * 1.5,
        shade(col, -0.1),
      );
  } else if (spec.detail === 'crack') {
    let x = cx - inner * 0.5;
    let y = cy - inner * 0.5;
    for (let i = 0; i < 5; i++) {
      const nx = x + rng.range(2, inner * 0.4);
      const ny = y + rng.range(-inner * 0.3, inner * 0.3);
      r.line(x, y, nx, ny, 0.8, shade(col, -0.3));
      x = nx;
      y = ny;
    }
  } else if (spec.detail === 'flower') {
    const fx = cx + (rng.next() - 0.5) * inner;
    const fy = cy + (rng.next() - 0.5) * inner;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      r.disc(fx + Math.cos(a) * 2, fy + Math.sin(a) * 2, 1.4, col);
    }
    r.disc(fx, fy, 1.2, hslToRgba(50, 0.8, 0.6));
  } else {
    // tuft: a few short blades
    for (let i = 0; i < 4; i++) {
      const bx = cx + (rng.next() - 0.5) * inner;
      const by = cy + (rng.next() - 0.5) * inner;
      r.line(bx, by + 3, bx + (rng.next() - 0.5) * 3, by - 3, 0.7, shade(col, 0.1));
    }
  }
}

export interface BiomeSheet {
  png: Uint8Array;
  manifest: {
    src: string;
    tileSize: number;
    tiles: { col: number; row: number; weight: number }[];
    blend: {
      patch: { col: number; row: number }[];
      scale: number;
      threshold: number;
      margin: number;
    };
  };
}

/** Render a 4×4 biome sheet: tile (0,0) base (heavy weight), the rest base+detail variants. */
export function synthBiome(spec: BiomeSpec, src: string, seed: number): BiomeSheet {
  const ts = spec.tileSize;
  const cols = 4;
  const rows = 4;
  const sheet = new Raster(cols * ts, rows * ts);
  const tiles: { col: number; row: number; weight: number }[] = [];
  const patch: { col: number; row: number }[] = [];
  let idx = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rng = new Rng(seed + idx * 9173 + 1);
      drawBaseTile(sheet, col * ts, row * ts, ts, spec, rng);
      if (idx === 0) {
        tiles.push({ col, row, weight: 60 }); // the dominant base
      } else if (idx < 7) {
        // subtle base variants (re-seeded mottle only) — weighted in as gentle variety
        tiles.push({ col, row, weight: 6 });
      } else {
        // detail tiles → the blend patch set (clustered, RENDER-04)
        drawDetail(sheet, col * ts, row * ts, ts, spec, new Rng(seed + idx * 7331 + 3));
        patch.push({ col, row });
      }
      idx++;
    }
  }
  return {
    png: sheet.toPng(),
    manifest: {
      src,
      tileSize: ts,
      tiles,
      blend: { patch, scale: 5, threshold: 0.6, margin: 0.1 },
    },
  };
}

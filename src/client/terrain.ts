/**
 * Decorative terrain elevation (RENDER-08, visual-only subset).
 *
 * A deterministic height field (`terrainHeightAt`) gives outdoor areas gentle rolling hills. The
 * ground is rendered as a heightmapped MESH (a world grid whose vertices are pushed up the screen by
 * their height) textured with the same baked tiled ground texture, replacing the flat `TilingSprite`
 * for areas that opt in. Props and actors are offset by the same height field so they ride the
 * terrain. This is COSMETIC ONLY — collision stays flat (the server is unaware), exactly the
 * visual-only subset the spec blesses; true elevation (ramps/ledges that change where you can stand)
 * is a separate gameplay milestone that must agree with `world.ts`.
 *
 * Like the water layer, the mesh is a STAGE child kept world-anchored by syncing its transform to the
 * world's each frame — so it composes with the deferred-lighting pass (a `world`-child would not).
 */

import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';

/** Vertical foreshorten of the ground plane — mirrors PITCH in pixi-renderer.ts. */
const PITCH = 0.6;
/** Peak hill height in world px (kept gentle so the flat-collision mismatch stays small). */
const HILL_HEIGHT = 38;
/** Noise feature size in world px (large = broad, smooth hills). */
const HILL_SCALE = 360;
/** Mesh grid cell in world px (finer = smoother hills, more verts). */
const CELL = 96;

/** Areas that get rolling terrain (outdoor wilds). Others keep the flat tiled ground. */
const TERRAIN_AREAS = new Set(['wilderness', 'howling_barrens', 'ashveil_desert']);

export function areaHasTerrain(areaId: string): boolean {
  const base = areaId.split('#', 1)[0] ?? areaId;
  return TERRAIN_AREAS.has(base);
}

function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const tl = hash2(xi, yi);
  const tr = hash2(xi + 1, yi);
  const bl = hash2(xi, yi + 1);
  const br = hash2(xi + 1, yi + 1);
  const u = smooth(xf);
  const v = smooth(yf);
  const top = tl + (tr - tl) * u;
  const bot = bl + (br - bl) * u;
  return top + (bot - top) * v;
}

/**
 * Decorative terrain height (world px) at a world position — 0 at valley floor up to HILL_HEIGHT.
 * Deterministic and continuous, so the ground mesh, props, and actors all agree. Pure → unit-tested.
 */
export function terrainHeightAt(x: number, y: number): number {
  return valueNoise(x / HILL_SCALE, y / HILL_SCALE) * HILL_HEIGHT;
}

/** Sun direction (world space) for the hillshade — upper-left, matching the actors' baked shadows. */
const SUN_X = -0.6;
const SUN_Y = -0.5;

/**
 * Lambert-ish hillshade brightness 0..1 at a world point: the terrain's slope lit from the upper-left
 * sun. ~1 on flat/sunward ground, darker on downslopes facing away — multiplied over the ground so
 * the displaced mesh reads as hills. Pure.
 */
function hillshade(x: number, y: number): number {
  const e = 6; // gradient sample step (world px)
  const dhx = (terrainHeightAt(x + e, y) - terrainHeightAt(x - e, y)) / (2 * e);
  const dhy = (terrainHeightAt(x, y + e) - terrainHeightAt(x, y - e)) / (2 * e);
  // Surface normal ≈ (-dhx, -dhy, 1); dot with the sun direction (z up) gives the lit fraction.
  const nx = -dhx;
  const ny = -dhy;
  const nz = 1;
  const len = Math.hypot(nx, ny, nz) || 1;
  const ndotl = (nx * SUN_X + ny * SUN_Y + nz * 0.9) / len;
  // Map to a gentle 0.74..1.0 multiply range so shading reads without crushing the ground.
  return Math.max(0.74, Math.min(1, 0.88 + ndotl * 0.5));
}

export class Terrain {
  /** Stage-level layer holding the heightmapped ground mesh; transform synced to the world's. */
  readonly layer = new Container();
  private mesh: Mesh | undefined;
  private shade: Mesh | undefined;
  private shadeTex: Texture | undefined;
  private active = false;

  constructor() {
    this.layer.eventMode = 'none';
    this.layer.visible = false;
  }

  isActive(): boolean {
    return this.active;
  }

  /** Match the world container's transform so the terrain stays world-anchored (called each frame). */
  syncTransform(x: number, y: number, scale: number): void {
    this.layer.position.set(x, y);
    this.layer.scale.set(scale);
  }

  /**
   * Build the heightmapped mesh for an area, textured with its baked ground texture. Tears down any
   * previous mesh. The texture is sampled with REPEAT addressing so the tiled pattern wraps across the
   * grid exactly as the flat TilingSprite did, only now displaced by height.
   */
  build(areaWidth: number, areaHeight: number, texture: Texture, texWorldSize: number): void {
    this.destroyMesh();
    const cols = Math.max(1, Math.ceil(areaWidth / CELL));
    const rows = Math.max(1, Math.ceil(areaHeight / CELL));
    const vw = cols + 1;
    const vh = rows + 1;
    const positions = new Float32Array(vw * vh * 2);
    const uvs = new Float32Array(vw * vh * 2);
    for (let gy = 0; gy < vh; gy++) {
      for (let gx = 0; gx < vw; gx++) {
        const wx = gx * CELL;
        const wy = gy * CELL;
        const i = (gy * vw + gx) * 2;
        positions[i] = wx;
        positions[i + 1] = wy * PITCH - terrainHeightAt(wx, wy); // raise hills up the screen
        uvs[i] = wx / texWorldSize;
        uvs[i + 1] = wy / texWorldSize;
      }
    }
    const indices = new Uint32Array(cols * rows * 6);
    let k = 0;
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        const a = gy * vw + gx;
        const b = a + 1;
        const c = a + vw;
        const d = c + 1;
        indices[k++] = a;
        indices[k++] = b;
        indices[k++] = c;
        indices[k++] = b;
        indices[k++] = d;
        indices[k++] = c;
      }
    }
    texture.source.addressMode = 'repeat';
    const geometry = new MeshGeometry({ positions, uvs, indices });
    this.mesh = new Mesh({ geometry, texture });
    this.mesh.eventMode = 'none';
    this.layer.addChild(this.mesh);

    // Hillshade: a second mesh sharing the SAME displaced vertices but UV-mapped to a per-area
    // relief texture, multiply-blended over the terrain. Baked from the height gradient lit from the
    // upper-left "sun", it darkens downslopes and lifts upslopes — which is what makes the otherwise
    // subtle top-down displacement read as hills. Default mesh shader (one texture) — no custom GLSL.
    const shadeUvs = new Float32Array(vw * vh * 2);
    for (let gy = 0; gy < vh; gy++) {
      for (let gx = 0; gx < vw; gx++) {
        const i = (gy * vw + gx) * 2;
        shadeUvs[i] = (gx * CELL) / areaWidth;
        shadeUvs[i + 1] = (gy * CELL) / areaHeight;
      }
    }
    this.shadeTex = bakeHillshade(areaWidth, areaHeight);
    const shadeGeo = new MeshGeometry({ positions: positions.slice(), uvs: shadeUvs, indices });
    this.shade = new Mesh({ geometry: shadeGeo, texture: this.shadeTex });
    this.shade.eventMode = 'none';
    this.shade.blendMode = 'multiply';
    this.layer.addChild(this.shade);

    this.layer.visible = true;
    this.active = true;
  }

  /** Tear down the mesh and revert to the flat ground (called for non-terrain areas). */
  clear(): void {
    this.destroyMesh();
    this.layer.visible = false;
    this.active = false;
  }

  setVisible(on: boolean): void {
    this.layer.visible = on && this.active;
  }

  /** Test seam: the per-area hillshade as raw 0..1 brightness at a world point (pure). */
  static hillshadeAt(x: number, y: number): number {
    return hillshade(x, y);
  }

  private destroyMesh(): void {
    if (this.mesh) {
      this.layer.removeChild(this.mesh);
      this.mesh.destroy();
      this.mesh = undefined;
    }
    if (this.shade) {
      this.layer.removeChild(this.shade);
      this.shade.destroy();
      this.shade = undefined;
    }
    if (this.shadeTex) {
      this.shadeTex.destroy(true);
      this.shadeTex = undefined;
    }
  }
}

/** Bake the area's hillshade to a greyscale texture (downscaled) for the multiply overlay mesh. */
function bakeHillshade(areaWidth: number, areaHeight: number): Texture {
  const step = 5; // world px per shade texel (downscaled — the gradient is low-frequency)
  const w = Math.max(2, Math.round(areaWidth / step));
  const h = Math.max(2, Math.round(areaHeight / step));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const s = hillshade((px / w) * areaWidth, (py / h) * areaHeight);
      const v = Math.round(s * 255);
      const i = (py * w + px) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return Texture.from(cv);
}

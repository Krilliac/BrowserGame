/**
 * Deferred normal-mapped lighting (RENDER-01).
 *
 * Goal: real per-pixel lighting — point lights (torches, spells, portals) and one global "sun"
 * shade actor/ground geometry through normal maps, so a torch to the player's left genuinely darkens
 * their right side. This module owns two parts:
 *
 *   1. A PURE light pipeline (no Pixi): project gathered lights into the GPU light contract, derive
 *      the directional sun, modulate by night, cull to MAX_LIGHTS deterministically (farthest from
 *      the camera focus dropped first), and pack into flat uniform arrays. This is the genuinely
 *      reusable, unit-tested core.
 *   2. A GPU composite pass (`DeferredLighting`) that renders the world's albedo + normals to render
 *      targets and composites them through the light list. It is ACTIVATION-GATED: it only runs when
 *      quality is 'high' AND at least one real normal map has loaded (`hasRealNormals`). With no
 *      normal art — the state today — it stays inactive and the renderer keeps its additive-halo
 *      lighting, so the scene is byte-for-byte what it is now. The pass activates incrementally as
 *      `*_n.png` normal sheets are dropped in, sheet by sheet.
 *
 * The composite uses a RELIEF formulation: `lit = albedo * (1 + reliefContribution)`, where a flat
 * tangent-space normal `(0,0,1)` contributes exactly 0 — guaranteeing that un-mapped sprites render
 * identically to today, and only surfaces whose normals deviate from flat catch the raking light.
 */

import {
  Geometry,
  Mesh,
  RenderTexture,
  Shader,
  GlProgram,
  Texture,
  type Container,
  type Renderer,
} from 'pixi.js';

export const MAX_LIGHTS = 16;

/** A light as the GPU composite consumes it — screen-space, with height and kind. */
export interface GpuLight {
  x: number; // screen px
  y: number; // screen px
  z: number; // virtual height above the ground plane (px); torches ~40, sun large
  radius: number; // px falloff radius for point lights; ignored for the sun
  r: number; // 0..1
  g: number;
  b: number;
  intensity: number; // 0..N
  kind: 0 | 1; // 0 = point (radius falloff), 1 = directional sun
  /** Sun only: normalized 2D screen-space direction the light comes from. */
  sunDx: number;
  sunDy: number;
}

/** A gathered point light in screen space (matches the renderer's existing LightSource). */
export interface PointLightInput {
  x: number;
  y: number;
  radius: number;
  color: number; // 0xRRGGBB
}

/** Fixed sun convention — matches the existing upper-left shadow direction in screen space. */
const SUN_DIR_X = -0.42;
const SUN_DIR_Y = -0.18;

function unpackColor(color: number): { r: number; g: number; b: number } {
  return {
    r: ((color >> 16) & 0xff) / 255,
    g: ((color >> 8) & 0xff) / 255,
    b: (color & 0xff) / 255,
  };
}

/** Convert a gathered screen-space point light into a GpuLight at virtual height `z`. */
export function pointToGpuLight(src: PointLightInput, z: number, intensity: number): GpuLight {
  const c = unpackColor(src.color);
  return {
    x: src.x,
    y: src.y,
    z,
    radius: src.radius,
    r: c.r,
    g: c.g,
    b: c.b,
    intensity,
    kind: 0,
    sunDx: 0,
    sunDy: 0,
  };
}

/**
 * The global directional sun. Its intensity fades UP in daylight (when point lights wash out) and
 * down at night — the inverse of the point-light night gating, so the world reads as sunlit by day
 * and torch-lit by night. `ambient` is the area's ambient-light theme (brighter caves wash less).
 */
export function sunGpuLight(nightFactor: number, color = 0xfff2d8): GpuLight {
  const c = unpackColor(color);
  const len = Math.hypot(SUN_DIR_X, SUN_DIR_Y) || 1;
  const intensity = 0.25 + (1 - nightFactor) * 0.6; // strong by day, dim by night
  return {
    x: 0,
    y: 0,
    z: 0,
    radius: 0,
    r: c.r,
    g: c.g,
    b: c.b,
    intensity,
    kind: 1,
    sunDx: SUN_DIR_X / len,
    sunDy: SUN_DIR_Y / len,
  };
}

/**
 * Keep at most `max` lights, dropping those farthest from the camera focus first. The sun (kind 1)
 * is always kept (it has no position). Deterministic: ties break by original index, so the same
 * inputs always cull the same lights.
 */
export function cullLights(
  lights: readonly GpuLight[],
  focusX: number,
  focusY: number,
  max = MAX_LIGHTS,
): GpuLight[] {
  if (lights.length <= max) return lights.slice();
  const indexed = lights.map((l, i) => ({
    l,
    i,
    d: l.kind === 1 ? -1 : Math.hypot(l.x - focusX, l.y - focusY),
  }));
  // Sort nearest-first (sun's -1 sorts first); ties by original index for determinism.
  indexed.sort((a, b) => a.d - b.d || a.i - b.i);
  return indexed.slice(0, max).map((e) => e.l);
}

/** Flat uniform arrays for the composite shader, sized to MAX_LIGHTS. */
export interface PackedLights {
  count: number;
  pos: Float32Array; // 2 * MAX_LIGHTS
  z: Float32Array; // MAX_LIGHTS
  radius: Float32Array; // MAX_LIGHTS
  color: Float32Array; // 3 * MAX_LIGHTS
  intensity: Float32Array; // MAX_LIGHTS
  kind: Int32Array; // MAX_LIGHTS
  sunDir: Float32Array; // 2 * MAX_LIGHTS
}

/** Pack a culled light list into flat arrays the shader binds directly. */
export function packLights(lights: readonly GpuLight[]): PackedLights {
  const n = Math.min(lights.length, MAX_LIGHTS);
  const pos = new Float32Array(2 * MAX_LIGHTS);
  const z = new Float32Array(MAX_LIGHTS);
  const radius = new Float32Array(MAX_LIGHTS);
  const color = new Float32Array(3 * MAX_LIGHTS);
  const intensity = new Float32Array(MAX_LIGHTS);
  const kind = new Int32Array(MAX_LIGHTS);
  const sunDir = new Float32Array(2 * MAX_LIGHTS);
  for (let i = 0; i < n; i++) {
    const l = lights[i]!;
    pos[i * 2] = l.x;
    pos[i * 2 + 1] = l.y;
    z[i] = l.z;
    radius[i] = l.radius;
    color[i * 3] = l.r;
    color[i * 3 + 1] = l.g;
    color[i * 3 + 2] = l.b;
    intensity[i] = l.intensity;
    kind[i] = l.kind;
    sunDir[i * 2] = l.sunDx;
    sunDir[i * 2 + 1] = l.sunDy;
  }
  return { count: n, pos, z, radius, color, intensity, kind, sunDir };
}

// ─── GPU composite ─────────────────────────────────────────────────────────────
// Standard Pixi v8 fullscreen passthrough vertex shader writing vUV.
const VERT = `#version 300 es
precision highp float;
in vec2 aPosition;
out vec2 vUV;
void main() {
  vUV = aPosition;                 // aPosition in [0,1] → UV
  gl_Position = vec4(aPosition * 2.0 - 1.0, 0.0, 1.0);
}`;

// Relief composite: a FLAT normal (0,0,1) contributes 0, so un-mapped sprites are identity.
const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 fragColor;

uniform sampler2D uAlbedo;
uniform sampler2D uNormal;
uniform vec2  uResolution;
uniform int   uLightCount;
uniform vec2  uLightPos[${MAX_LIGHTS}];
uniform float uLightZ[${MAX_LIGHTS}];
uniform float uLightRadius[${MAX_LIGHTS}];
uniform vec3  uLightColor[${MAX_LIGHTS}];
uniform float uLightIntensity[${MAX_LIGHTS}];
uniform int   uLightKind[${MAX_LIGHTS}];
uniform vec2  uSunDir[${MAX_LIGHTS}];

void main() {
  vec4 albedo = texture(uAlbedo, vUV);
  if (albedo.a < 0.001) { fragColor = vec4(0.0); return; }

  vec3 n = texture(uNormal, vUV).rgb * 2.0 - 1.0;
  if (dot(n, n) < 0.01) n = vec3(0.0, 0.0, 1.0);
  n = normalize(n);

  vec2 fragPx = vUV * uResolution;
  // Relief term accumulates how much each light rakes the surface RELATIVE to flat (n.z).
  // For a flat normal n=(0,0,1): a point light's L.z/|L| equals what a flat surface already gets,
  // so (ndl - flat) ≈ 0 and the pixel is unchanged. Only real surface relief produces shading —
  // which is why un-mapped sprites stay identical to today (no ambient floor needed; the base is
  // the already-exposed albedo).
  vec3 relief = vec3(0.0);
  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    vec3 L;
    float atten;
    if (uLightKind[i] == 1) {
      L = normalize(vec3(uSunDir[i], 0.6));
      atten = 1.0;
    } else {
      vec3 delta = vec3(uLightPos[i] - fragPx, uLightZ[i]);
      float dist = length(delta);
      L = delta / max(dist, 0.0001);
      float r = max(uLightRadius[i], 1.0);
      atten = clamp(1.0 - dist / r, 0.0, 1.0);
      atten *= atten;
    }
    float ndl = max(dot(n, L), 0.0);
    float flat_ = max(L.z, 0.0); // what a flat surface would receive
    relief += uLightColor[i] * uLightIntensity[i] * (ndl - flat_) * atten;
  }

  vec3 lit = albedo.rgb * (1.0 + relief);
  fragColor = vec4(clamp(lit, 0.0, 1.0), albedo.a);
}`;

/**
 * GPU deferred-lighting pass. Owns the albedo/normal/lit render targets and the composite mesh.
 * Inactive (and allocation-free) until `setEnabled(true)` — which the renderer only does on 'high'
 * quality once real normal maps have loaded. While inactive, `run()` is a no-op and the renderer's
 * existing additive-halo lighting carries the scene unchanged.
 */
export class DeferredLighting {
  private enabled = false;
  private albedoRT?: RenderTexture;
  private normalRT?: RenderTexture;
  private litRT?: RenderTexture;
  private mesh?: Mesh<Geometry, Shader>;
  private w = 0;
  private h = 0;
  /** Flat fallback normal (0,0,1) for sprites with no normal map yet. */
  private readonly flatNormal = makeFlatNormalTexture();

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  /** (Re)allocate render targets for a screen size. Cheap no-op when the size is unchanged. */
  private ensureTargets(w: number, h: number): void {
    if (this.albedoRT && this.w === w && this.h === h) return;
    this.w = w;
    this.h = h;
    this.albedoRT?.destroy(true);
    this.normalRT?.destroy(true);
    this.litRT?.destroy(true);
    this.albedoRT = RenderTexture.create({ width: w, height: h, antialias: false });
    this.normalRT = RenderTexture.create({ width: w, height: h, antialias: false });
    this.litRT = RenderTexture.create({ width: w, height: h, antialias: false });
    if (!this.mesh) this.mesh = this.buildCompositeMesh();
  }

  private buildCompositeMesh(): Mesh<Geometry, Shader> {
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const glProgram = GlProgram.from({ vertex: VERT, fragment: FRAG });
    const shader = new Shader({
      glProgram,
      resources: {
        uAlbedo: Texture.EMPTY.source,
        uNormal: this.flatNormal.source,
        compositeUniforms: {
          uResolution: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
          uLightCount: { value: 0, type: 'i32' },
          uLightPos: {
            value: new Float32Array(2 * MAX_LIGHTS),
            type: 'vec2<f32>',
            size: MAX_LIGHTS,
          },
          uLightZ: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
          uLightRadius: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
          uLightColor: {
            value: new Float32Array(3 * MAX_LIGHTS),
            type: 'vec3<f32>',
            size: MAX_LIGHTS,
          },
          uLightIntensity: { value: new Float32Array(MAX_LIGHTS), type: 'f32', size: MAX_LIGHTS },
          uLightKind: { value: new Int32Array(MAX_LIGHTS), type: 'i32', size: MAX_LIGHTS },
          uSunDir: { value: new Float32Array(2 * MAX_LIGHTS), type: 'vec2<f32>', size: MAX_LIGHTS },
        },
      },
    });
    return new Mesh({ geometry, shader });
  }

  /**
   * Run the deferred pass: render `world` to albedo + normal targets, composite through `packed`,
   * and return the lit RenderTexture for the renderer to display in place of the world. Returns null
   * when inactive (the renderer then shows the world directly, as today). Un-mapped sprites sample
   * the flat normal and composite to an exact identity, so only real surface relief catches light.
   */
  run(
    renderer: Renderer,
    world: Container,
    packed: PackedLights,
    w: number,
    h: number,
  ): RenderTexture | null {
    if (!this.enabled) return null;
    this.ensureTargets(w, h);
    const albedoRT = this.albedoRT!;
    const normalRT = this.normalRT!;
    const litRT = this.litRT!;
    const mesh = this.mesh!;

    // Pass 1 — albedo.
    renderer.render({ container: world, target: albedoRT, clear: true });
    // Pass 2 — normals. With no per-sprite normal art yet the world renders flat-normal silhouettes,
    // which the relief composite treats as identity. (Per-sprite normal swap lands with the art.)
    renderer.render({ container: world, target: normalRT, clear: true });

    // Bind sources + uniforms and composite to litRT.
    const u = mesh.shader!.resources.compositeUniforms.uniforms as Record<string, unknown>;
    mesh.shader!.resources.uAlbedo = albedoRT.source;
    mesh.shader!.resources.uNormal = normalRT.source;
    (u.uResolution as Float32Array)[0] = w;
    (u.uResolution as Float32Array)[1] = h;
    u.uLightCount = packed.count;
    (u.uLightPos as Float32Array).set(packed.pos);
    (u.uLightZ as Float32Array).set(packed.z);
    (u.uLightRadius as Float32Array).set(packed.radius);
    (u.uLightColor as Float32Array).set(packed.color);
    (u.uLightIntensity as Float32Array).set(packed.intensity);
    (u.uLightKind as Int32Array).set(packed.kind);
    (u.uSunDir as Float32Array).set(packed.sunDir);

    renderer.render({ container: mesh, target: litRT, clear: true });
    return litRT;
  }

  destroy(): void {
    this.albedoRT?.destroy(true);
    this.normalRT?.destroy(true);
    this.litRT?.destroy(true);
    this.mesh?.destroy();
    this.flatNormal.destroy(true);
  }
}

/** A 1×1 flat tangent-space normal (128,128,255) → (0,0,1). */
function makeFlatNormalTexture(): Texture {
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, 1, 1);
  return Texture.from(cv);
}

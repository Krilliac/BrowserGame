/**
 * A tiny software RGBA canvas with the few primitives the generators need (alpha-over compositing,
 * rects, discs, soft radial gradients, lines, filled polygons) plus PNG export. Zero deps — replaces
 * the browser `<canvas>` the in-engine bakes use, so generation runs headless in Node/CI.
 *
 * Coordinates are pixel-centered; sub-pixel coverage is approximated by alpha at edges where it
 * matters (discs/lines). Determinism: no randomness here — callers pass an Rng.
 */

import { encodePng } from './png.ts';

export type RGBA = [number, number, number, number]; // 0..255

export class Raster {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array; // RGBA, length w*h*4

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 4);
  }

  /** Alpha-over composite a single pixel. */
  blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const sa = a / 255;
    const da = this.data[i + 3]! / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    const mix = (s: number, d: number) => (s * sa + d * da * (1 - sa)) / oa;
    this.data[i] = Math.round(mix(r, this.data[i]!));
    this.data[i + 1] = Math.round(mix(g, this.data[i + 1]!));
    this.data[i + 2] = Math.round(mix(b, this.data[i + 2]!));
    this.data[i + 3] = Math.round(oa * 255);
  }

  fillRect(x: number, y: number, w: number, h: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let py = y0; py < y1; py++)
      for (let px = x0; px < x1; px++) this.blend(px, py, c[0], c[1], c[2], c[3]);
  }

  /** Filled ellipse with a 1px soft edge. */
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGBA): void {
    const x0 = Math.max(0, Math.floor(cx - rx - 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1));
    const x1 = Math.min(this.width, Math.ceil(cx + rx + 1));
    const y1 = Math.min(this.height, Math.ceil(cy + ry + 1));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const dx = (px + 0.5 - cx) / Math.max(0.01, rx);
        const dy = (py + 0.5 - cy) / Math.max(0.01, ry);
        const d = Math.sqrt(dx * dx + dy * dy);
        const cov = Math.max(0, Math.min(1, (1 - d) * Math.min(rx, ry)));
        if (cov > 0) this.blend(px, py, c[0], c[1], c[2], Math.round(c[3] * cov));
      }
    }
  }

  disc(cx: number, cy: number, r: number, c: RGBA): void {
    this.ellipse(cx, cy, r, r, c);
  }

  /** Radial gradient disc: opaque-ish core fading to transparent at `r`. */
  radial(cx: number, cy: number, r: number, c: RGBA, falloff = 1): void {
    const x0 = Math.max(0, Math.floor(cx - r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const x1 = Math.min(this.width, Math.ceil(cx + r));
    const y1 = Math.min(this.height, Math.ceil(cy + r));
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) {
        const d = Math.hypot(px + 0.5 - cx, py + 0.5 - cy) / r;
        if (d >= 1) continue;
        const t = Math.pow(1 - d, falloff);
        this.blend(px, py, c[0], c[1], c[2], Math.round(c[3] * t));
      }
    }
  }

  /** Anti-aliased-ish line of half-width `hw`. */
  line(x0: number, y0: number, x1: number, y1: number, hw: number, c: RGBA): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    const steps = Math.ceil(len);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + dx * t, y0 + dy * t, hw, c);
    }
  }

  /** Filled convex/concave polygon (even-odd scanline fill). */
  polygon(pts: ReadonlyArray<readonly [number, number]>, c: RGBA): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.height - 1, Math.ceil(maxY));
    for (let py = y0; py <= y1; py++) {
      const ys = py + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % pts.length]!;
        if (a[1] <= ys === b[1] <= ys) continue;
        xs.push(a[0] + ((ys - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const sx = Math.max(0, Math.round(xs[k]!));
        const ex = Math.min(this.width - 1, Math.round(xs[k + 1]!));
        for (let px = sx; px <= ex; px++) this.blend(px, py, c[0], c[1], c[2], c[3]);
      }
    }
  }

  /** Composite another raster at (dx,dy) — used to pack frames into a strip. */
  paste(src: Raster, dx: number, dy: number): void {
    for (let y = 0; y < src.height; y++) {
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        this.blend(
          dx + x,
          dy + y,
          src.data[i]!,
          src.data[i + 1]!,
          src.data[i + 2]!,
          src.data[i + 3]!,
        );
      }
    }
  }

  toPng(): Uint8Array {
    return encodePng(this.width, this.height, this.data);
  }
}

import { ABILITIES, MOB_RADIUS, PLAYER_RADIUS, type FxEvent } from '../shared/combat.js';
import type { EntityState } from '../shared/protocol.js';

/** Per-area visual theme — base ground, tile accent, and scattered props. */
interface Biome {
  base: string;
  tile: string;
  accent: string;
  prop: 'tree' | 'grave' | 'rock';
  density: number;
}

const BIOMES: Record<string, Biome> = {
  town: { base: '#2f3b29', tile: '#34412d', accent: '#3d4b34', prop: 'tree', density: 0.08 },
  wilderness: { base: '#1f2a1c', tile: '#243021', accent: '#2b3a26', prop: 'tree', density: 0.16 },
  crypt: { base: '#15151b', tile: '#1b1b23', accent: '#232331', prop: 'grave', density: 0.12 },
};

/** Stable pseudo-random in [0,1) from integer coords — lets props be infinite yet deterministic. */
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return ((h >>> 0) % 1000) / 1000;
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  areaId: string,
  camX: number,
  camY: number,
  w: number,
  h: number,
): void {
  const biome = BIOMES[areaId] ?? BIOMES.wilderness!;
  ctx.fillStyle = biome.base;
  ctx.fillRect(0, 0, w, h);

  // Ground tiles with subtle checker variation.
  const tile = 64;
  const startTX = Math.floor(camX / tile);
  const startTY = Math.floor(camY / tile);
  for (let ty = startTY; ty * tile - camY < h; ty++) {
    for (let tx = startTX; tx * tile - camX < w; tx++) {
      const r = hash2(tx, ty);
      ctx.fillStyle = r < 0.5 ? biome.tile : biome.accent;
      ctx.fillRect(tx * tile - camX, ty * tile - camY, tile, tile);
    }
  }

  // Scattered props on a coarser grid.
  const cell = 128;
  const startPX = Math.floor(camX / cell) - 1;
  const startPY = Math.floor(camY / cell) - 1;
  for (let py = startPY; py * cell - camY < h + cell; py++) {
    for (let px = startPX; px * cell - camX < w + cell; px++) {
      if (hash2(px * 7 + 1, py * 13 + 3) >= biome.density) continue;
      const ox = hash2(px, py * 3) * cell;
      const oy = hash2(px * 5, py) * cell;
      drawProp(ctx, biome.prop, px * cell + ox - camX, py * cell + oy - camY);
    }
  }
}

function drawProp(ctx: CanvasRenderingContext2D, kind: Biome['prop'], x: number, y: number): void {
  ctx.save();
  if (kind === 'tree') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(x, y + 12, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(x - 3, y, 6, 14);
    ctx.fillStyle = '#2f4a2a';
    ctx.beginPath();
    ctx.arc(x, y - 4, 16, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'grave') {
    ctx.fillStyle = '#3a3a48';
    ctx.fillRect(x - 8, y - 14, 16, 20);
    ctx.fillStyle = '#4a4a5c';
    ctx.fillRect(x - 2, y - 20, 4, 12);
    ctx.fillRect(x - 7, y - 16, 14, 4);
  } else {
    ctx.fillStyle = '#3a3d42';
    ctx.beginPath();
    ctx.ellipse(x, y, 14, 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  e: EntityState,
  isSelf: boolean,
  sx: number,
  sy: number,
): void {
  const radius = e.kind === 'mob' ? MOB_RADIUS : PLAYER_RADIUS;

  // Shadow.
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + radius - 2, radius, radius * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();

  // Weapon / facing indicator — a blade pointing where the character faces.
  const fx = Math.cos(e.facing);
  const fy = Math.sin(e.facing);
  ctx.strokeStyle = e.kind === 'mob' ? '#caa' : '#d9c87a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(sx + fx * radius * 0.6, sy + fy * radius * 0.6);
  ctx.lineTo(sx + fx * (radius + 14), sy + fy * (radius + 14));
  ctx.stroke();

  // Body.
  const light = e.kind === 'mob' ? 42 : 55;
  ctx.fillStyle = `hsl(${e.hue} 60% ${light}%)`;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = isSelf ? 3 : 2;
  ctx.strokeStyle = isSelf ? '#c9a24b' : 'rgba(0,0,0,0.5)';
  ctx.stroke();

  // Name + level.
  ctx.fillStyle = e.kind === 'mob' ? '#e7b0b0' : '#e7e3d2';
  ctx.font = '12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`${e.name} ${e.level ? `· L${e.level}` : ''}`.trim(), sx, sy - radius - 14);

  // Health bar.
  if (e.maxHp > 0) {
    const bw = radius * 2.2;
    const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - bw / 2, sy - radius - 10, bw, 4);
    ctx.fillStyle = e.kind === 'mob' ? '#c44' : '#4caf50';
    ctx.fillRect(sx - bw / 2, sy - radius - 10, bw * frac, 4);
  }
}

export function drawProjectile(
  ctx: CanvasRenderingContext2D,
  e: EntityState,
  sx: number,
  sy: number,
): void {
  const ability = e.abilityId ? ABILITIES[e.abilityId] : undefined;
  const color = ability?.color ?? '#ffffff';
  const radius = ability?.radius ?? 6;

  if (e.abilityId === 'arrow') {
    const fx = Math.cos(e.facing);
    const fy = Math.sin(e.facing);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - fx * 10, sy - fy * 10);
    ctx.lineTo(sx + fx * 10, sy + fy * 10);
    ctx.stroke();
    return;
  }

  const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, radius * 2);
  grad.addColorStop(0, color);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sx, sy, radius * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(sx, sy, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A transient effect with the time it was received, for fading. */
export interface TimedFx {
  ev: FxEvent;
  t0: number;
}

const FX_DURATION = 700;

export function drawFx(
  ctx: CanvasRenderingContext2D,
  fx: TimedFx[],
  camX: number,
  camY: number,
  now: number,
): void {
  for (const { ev, t0 } of fx) {
    const age = (now - t0) / FX_DURATION;
    if (age >= 1) continue;
    const sx = ev.x - camX;
    const sy = ev.y - camY;
    const alpha = 1 - age;

    if (ev.kind === 'hit' && ev.value !== undefined) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = ev.abilityId ? (ABILITIES[ev.abilityId]?.color ?? '#fff') : '#ff5555';
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${ev.value}`, sx, sy - 24 - age * 24);
    } else if (ev.kind === 'melee' && ev.facing !== undefined) {
      ctx.globalAlpha = alpha * 0.8;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(sx, sy, 40, ev.facing - 0.7, ev.facing + 0.7);
      ctx.stroke();
    } else if (ev.kind === 'cast') {
      ctx.globalAlpha = alpha * 0.6;
      ctx.strokeStyle = ev.abilityId ? (ABILITIES[ev.abilityId]?.color ?? '#fff') : '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 16 + age * 18, 0, Math.PI * 2);
      ctx.stroke();
    } else if (ev.kind === 'death') {
      ctx.globalAlpha = alpha * 0.7;
      ctx.strokeStyle = '#caa';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, 10 + age * 40, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

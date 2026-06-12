/**
 * The passive Skill Tree window: a Diablo-style talent panel where the player spends earned skill
 * points (1 per node) to permanently allocate passive nodes. Pure Canvas2D rendering matching the
 * shop/stash/artificer HUD style; it owns no state beyond the passed `hud` context and returns its
 * clickable node rects for `main.ts` to route (each click allocates one node, server-validated).
 *
 * Layout is a three-column grid — one column per branch (Offense / Defense / Utility, inferred from
 * the node id prefix) — with rows by tier (tier 0 at the top). Connector lines run from each node up
 * to its `requires` parents. The whole grid is scaled down to fit the viewport when needed, so the
 * panel can never run off-screen on a phone.
 */

import { SKILL_TREE, canAllocate, skillNode } from '../shared/skilltree.js';

export interface SkillTreeButton {
  nodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three branches, in column order. The node id prefix decides which column a node lives in. */
const BRANCHES = [
  { prefix: 'off-', label: 'Offense', accent: '#e0795a' },
  { prefix: 'def-', label: 'Defense', accent: '#5a9ae0' },
  { prefix: 'util-', label: 'Utility', accent: '#7fd08a' },
] as const;

/** The branch column index (0..2) for a node id, or 0 as a defensive fallback for unknown prefixes. */
function branchIndex(nodeId: string): number {
  const i = BRANCHES.findIndex((b) => nodeId.startsWith(b.prefix));
  return i < 0 ? 0 : i;
}

/** The deepest tier present in the tree, used to size the grid's row count. */
function maxTier(): number {
  return SKILL_TREE.reduce((m, n) => Math.max(m, n.tier), 0);
}

// --- Grid geometry, in unscaled "design" pixels (before the fit-to-viewport scale) ---
const NODE_W = 132;
const NODE_H = 52;
const COL_GAP = 28; // horizontal gap between branch columns
const ROW_GAP = 30; // vertical gap between tier rows
const PAD = 16; // panel inner padding
const HEADER_H = 52; // header band (title + points)
const BRANCH_LABEL_H = 22; // branch name row under the header
const FOOTER_H = 22; // caption row at the bottom

/**
 * Compute each node's box (in final viewport pixels) from its branch column and tier row. The grid
 * is laid out at a natural size and then uniformly scaled and centred to fit `viewport`, so callers
 * get boxes already clamped on-screen. Pure and deterministic — the unit-tested layout core.
 */
export function skillNodeLayout(viewport: {
  w: number;
  h: number;
}): Map<string, { x: number; y: number; w: number; h: number }> {
  const rows = maxTier() + 1;

  // Natural (unscaled) content size.
  const gridW = BRANCHES.length * NODE_W + (BRANCHES.length - 1) * COL_GAP;
  const gridH = rows * NODE_H + (rows - 1) * ROW_GAP;
  const contentW = gridW + PAD * 2;
  const contentH = HEADER_H + BRANCH_LABEL_H + gridH + FOOTER_H + PAD * 2;

  // Uniform scale so the whole panel fits within the viewport (never upscales past 1).
  const maxW = viewport.w - 16;
  const maxH = viewport.h - 16;
  const scale = Math.min(1, maxW / contentW, maxH / contentH);

  const panelW = contentW * scale;
  const panelH = contentH * scale;
  const px = viewport.w / 2 - panelW / 2;
  const py = viewport.h / 2 - panelH / 2;

  // Top-left of the grid area, in viewport pixels.
  const gridLeft = px + (PAD + (contentW - PAD * 2 - gridW) / 2) * scale;
  const gridTop = py + (PAD + HEADER_H + BRANCH_LABEL_H) * scale;

  const out = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of SKILL_TREE) {
    const col = branchIndex(node.id);
    const x = gridLeft + col * (NODE_W + COL_GAP) * scale;
    const y = gridTop + node.tier * (NODE_H + ROW_GAP) * scale;
    out.set(node.id, { x, y, w: NODE_W * scale, h: NODE_H * scale });
  }
  return out;
}

/**
 * Draw the Skill Tree panel and return one clickable button per node box. Connector lines link each
 * node to its prerequisites; nodes are coloured green (allocated), gold (allocatable now), or dim
 * (locked / no points). The header shows the remaining point count.
 */
export function drawSkillTree(
  hud: CanvasRenderingContext2D,
  viewport: { w: number; h: number },
  data: { allocated: ReadonlySet<string>; points: number },
): SkillTreeButton[] {
  const buttons: SkillTreeButton[] = [];
  const layout = skillNodeLayout(viewport);

  // Derive the panel frame from the union of node boxes plus padding, so the frame always wraps the
  // (already scaled) grid regardless of viewport.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const box of layout.values()) {
    minX = Math.min(minX, box.x);
    minY = Math.min(minY, box.y);
    maxX = Math.max(maxX, box.x + box.w);
    maxY = Math.max(maxY, box.y + box.h);
  }
  // Scale is the rendered node width over its natural width — used to scale fonts/padding too.
  const scale = layout.size > 0 ? boxScale(layout) : 1;
  const pad = PAD * scale;
  const px = minX - pad;
  const py = minY - (HEADER_H + BRANCH_LABEL_H + PAD) * scale;
  const pw = maxX - minX + pad * 2;
  const ph = maxY - py + (FOOTER_H + PAD) * scale;

  // Panel frame.
  hud.fillStyle = 'rgba(8,9,13,0.92)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  // Header: title + remaining points.
  hud.fillStyle = '#e7d9b0';
  hud.font = `bold ${Math.round(15 * scale)}px system-ui, sans-serif`;
  hud.textAlign = 'left';
  hud.fillText('Skill Tree', px + 14 * scale, py + 26 * scale);
  hud.textAlign = 'right';
  hud.fillStyle = data.points > 0 ? '#f2c14e' : '#9aa3b2';
  hud.font = `bold ${Math.round(13 * scale)}px system-ui, sans-serif`;
  hud.fillText(`${data.points} skill points`, px + pw - 14 * scale, py + 26 * scale);

  // Branch column labels, centred over each column.
  hud.textAlign = 'center';
  hud.font = `bold ${Math.round(11 * scale)}px system-ui, sans-serif`;
  for (let c = 0; c < BRANCHES.length; c++) {
    const branch = BRANCHES[c]!;
    const sample = layout.get(SKILL_TREE.find((n) => branchIndex(n.id) === c)?.id ?? '');
    if (!sample) continue;
    hud.fillStyle = branch.accent;
    hud.fillText(branch.label, sample.x + sample.w / 2, py + (HEADER_H + 14) * scale);
  }

  // Connector lines first, so node boxes draw on top of them.
  for (const node of SKILL_TREE) {
    const childBox = layout.get(node.id);
    if (!childBox) continue;
    const childAllocated = data.allocated.has(node.id);
    for (const req of node.requires) {
      const parentBox = layout.get(req);
      if (!parentBox) continue;
      const bothAllocated = childAllocated && data.allocated.has(req);
      hud.strokeStyle = bothAllocated ? 'rgba(127,208,138,0.7)' : 'rgba(201,162,75,0.22)';
      hud.lineWidth = bothAllocated ? 2 : 1;
      hud.beginPath();
      hud.moveTo(parentBox.x + parentBox.w / 2, parentBox.y + parentBox.h);
      hud.lineTo(childBox.x + childBox.w / 2, childBox.y);
      hud.stroke();
    }
  }

  // Node boxes.
  for (const node of SKILL_TREE) {
    const box = layout.get(node.id);
    if (!box) continue;
    const allocated = data.allocated.has(node.id);
    const open = !allocated && canAllocate(node.id, data.allocated) && data.points > 0;

    buttons.push({ nodeId: node.id, x: box.x, y: box.y, w: box.w, h: box.h });
    drawNode(hud, box, scale, node.name, hintFor(node.id), allocated, open);
  }

  // Caption.
  hud.textAlign = 'center';
  hud.fillStyle = '#8a8f99';
  hud.font = `${Math.round(11 * scale)}px system-ui, sans-serif`;
  hud.fillText('K or Esc to close', px + pw / 2, py + ph - 8 * scale);

  hud.textAlign = 'left';
  return buttons;
}

/** Recover the uniform layout scale from any rendered box (rendered width / natural width). */
function boxScale(layout: Map<string, { x: number; y: number; w: number; h: number }>): number {
  const first = layout.values().next().value;
  return first ? first.w / NODE_W : 1;
}

/** Draw one rounded node box: green if allocated, bright gold if allocatable, dim if locked. */
function drawNode(
  hud: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  scale: number,
  name: string,
  hint: string,
  allocated: boolean,
  open: boolean,
): void {
  const r = 6 * scale;
  roundRect(hud, box.x, box.y, box.w, box.h, r);

  if (allocated) {
    hud.fillStyle = 'rgba(60,120,72,0.9)';
    hud.fill();
    hud.strokeStyle = '#7fd08a';
    hud.lineWidth = 2;
  } else if (open) {
    hud.fillStyle = 'rgba(40,34,16,0.9)';
    hud.fill();
    hud.strokeStyle = '#f2c14e';
    hud.lineWidth = 2;
  } else {
    hud.fillStyle = 'rgba(20,22,28,0.85)';
    hud.fill();
    hud.strokeStyle = 'rgba(201,162,75,0.3)';
    hud.lineWidth = 1;
  }
  hud.stroke();

  const dim = !allocated && !open;
  hud.textAlign = 'center';
  hud.fillStyle = allocated ? '#eaffea' : open ? '#f2c14e' : dim ? '#7d828c' : '#e7d9b0';
  hud.font = `bold ${Math.round(12 * scale)}px system-ui, sans-serif`;
  hud.fillText(fit(hud, name, box.w - 10 * scale), box.x + box.w / 2, box.y + 19 * scale);

  hud.fillStyle = allocated ? '#bfe6c4' : dim ? '#6b707a' : '#9aa3b2';
  hud.font = `${Math.round(10 * scale)}px system-ui, sans-serif`;
  hud.fillText(fit(hud, hint, box.w - 8 * scale), box.x + box.w / 2, box.y + 36 * scale);
}

/** A short one-line effect hint for a node, derived from its data (e.g. "+5 power"). */
function hintFor(nodeId: string): string {
  const node = skillNode(nodeId);
  if (!node) return '';
  const labels: Record<string, (v: number) => string> = {
    power: (v) => `+${v} power`,
    critPct: (v) => `+${v}% crit`,
    maxHpPct: (v) => `+${v}% HP`,
    lifestealPct: (v) => `+${v}% leech`,
    swiftPct: (v) => `+${v}% atk spd`,
    movePct: (v) => `+${v}% move`,
    armorPct: (v) => `+${v}% armor`,
    vigor: (v) => `+${v} regen`,
    manaRegen: (v) => `+${v} mana/s`,
    multishot: (v) => `+${v} shot`,
  };
  const parts: string[] = [];
  for (const [key, value] of Object.entries(node.effects)) {
    if (value === undefined) continue;
    const fmt = labels[key];
    if (fmt) parts.push(fmt(value));
  }
  return parts.join(', ');
}

/** Trace a rounded rectangle path (does not fill or stroke). */
function roundRect(
  hud: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rad = Math.min(r, w / 2, h / 2);
  hud.beginPath();
  hud.moveTo(x + rad, y);
  hud.arcTo(x + w, y, x + w, y + h, rad);
  hud.arcTo(x + w, y + h, x, y + h, rad);
  hud.arcTo(x, y + h, x, y, rad);
  hud.arcTo(x, y, x + w, y, rad);
  hud.closePath();
}

/** Truncate `text` with an ellipsis so it fits `maxW` px at the current font. */
function fit(hud: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (hud.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && hud.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

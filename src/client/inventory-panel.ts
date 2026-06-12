/**
 * The full Inventory window: a centered grid of every unequipped bag gear instance, each tap-to-equip.
 * Where the HUD's small "Gear — tap to equip" list shows only a handful, this lists the whole bag (up
 * to 30) in two columns so it fits without overflow. Pure Canvas2D rendering matching the shop /
 * artificer HUD style; it owns no state beyond the passed `hud` context and returns its clickable
 * button rects for `main.ts` to route (equip / close).
 */

import type { ItemInstance } from '../shared/items.js';
import { RARITY } from '../shared/items.js';
import { drawItemIcon } from './item-icons.js';

export interface InventoryButton {
  action: 'equip' | 'close';
  uid?: number; // for 'equip'
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draw the inventory panel and return its clickable buttons. A centered panel titled
 * "Inventory (N/30)" with a ✕ close button, listing every bag gear instance in a TWO-COLUMN grid of
 * rows (so up to ~30 fit without overflowing): each cell shows the rarity-colored item name (via
 * `nameOf`) and a compact stat line (via `statSegments`, debuff segments in red). Each cell is an
 * [equip] button. Empty state: "Your bag is empty." Footer hint: "Tap an item to equip · sell at the
 * Merchant to clear space · Esc to close". Clamp height to the viewport.
 */
export function drawInventoryPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  data: {
    gear: ItemInstance[];
    nameOf: (inst: ItemInstance) => string;
    statSegments: (inst: ItemInstance) => { text: string; debuff: boolean }[];
  },
): InventoryButton[] {
  const buttons: InventoryButton[] = [];
  const gear = data.gear;

  const pw = 560;
  const cols = 2;
  const rowH = 34;
  const headerH = 56;
  const footerH = 24;
  const px = view.w / 2 - pw / 2;
  const gap = 6; // gutter between the two columns
  const cellW = (pw - 28 - gap) / cols; // 14px side padding each side

  // How many grid rows can we draw before running out of vertical space?
  const maxPh = Math.min(view.h - 16, 640);
  const totalRows = Math.max(1, Math.ceil(gear.length / cols));
  const fitRows = Math.max(1, Math.floor((maxPh - headerH - footerH) / rowH));
  const drawnRows = Math.min(totalRows, fitRows);
  const drawnCells = Math.min(gear.length, drawnRows * cols);
  const hiddenAny = drawnCells < gear.length;

  const panelH = headerH + drawnRows * rowH + footerH;
  const py = view.h / 2 - panelH / 2;

  // Panel frame.
  hud.fillStyle = 'rgba(8,9,13,0.94)';
  hud.fillRect(px, py, pw, panelH);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, panelH);

  // Header.
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(`Inventory (${gear.length}/30)`, px + 14, py + 24);

  // Close button (top-right ✕).
  const closeRect: InventoryButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Tap to equip your gear', px + 14, py + 44);

  // Empty state.
  if (gear.length === 0) {
    hud.fillStyle = '#6b707a';
    hud.font = 'italic 12px system-ui, sans-serif';
    hud.textAlign = 'center';
    hud.fillText('Your bag is empty.', px + pw / 2, py + headerH + rowH / 2 + 4);
  }

  // Grid of tappable item cells, row-major (left cell then right cell, top to bottom).
  const gridTop = py + headerH;
  for (let i = 0; i < drawnCells; i++) {
    const inst = gear[i]!;
    const col = i % cols;
    const gridRow = Math.floor(i / cols);
    const cx = px + 14 + col * (cellW + gap);
    const cy = gridTop + gridRow * rowH;
    buttons.push({ action: 'equip', uid: inst.uid, x: cx, y: cy, w: cellW, h: rowH - 4 });

    // Cell background.
    hud.fillStyle = 'rgba(255,255,255,0.05)';
    hud.fillRect(cx, cy, cellW, rowH - 4);
    hud.strokeStyle = 'rgba(201,162,75,0.25)';
    hud.lineWidth = 1;
    hud.strokeRect(cx, cy, cellW, rowH - 4);

    // Pixel-art item icon on the left edge; when the sheets haven't loaded yet the text simply
    // keeps its original position (the name + colors remain the fallback identity).
    const iconSize = rowH - 10;
    const hasIcon = drawItemIcon(hud, inst.baseId, cx + 3, cy + 3, iconSize);
    const textX = hasIcon ? cx + 3 + iconSize + 6 : cx + 6;

    // Line 1: rarity-colored name.
    hud.textAlign = 'left';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillStyle = RARITY[inst.rarity]?.color ?? '#cccccc';
    hud.fillText(fit(hud, data.nameOf(inst), cellW - (textX - cx) - 6), textX, cy + 13);

    // Line 2: stat segments left-to-right (debuffs red), clipped to the cell width.
    hud.font = '10px system-ui, sans-serif';
    let sx = textX;
    for (const seg of data.statSegments(inst)) {
      const w = hud.measureText(seg.text).width;
      if (sx - cx + w > cellW - 6) {
        hud.fillStyle = '#6b707a';
        hud.fillText('…', sx, cy + 25);
        break;
      }
      hud.fillStyle = seg.debuff ? '#ff6b6b' : '#9fb0c0';
      hud.fillText(seg.text, sx, cy + 25);
      sx += w + 7;
    }
  }

  // Footer hint (and an overflow note if somehow more gear exists than fits — shouldn't at 30).
  const footerY = py + panelH - 9;
  hud.textAlign = 'left';
  if (hiddenAny) {
    hud.fillStyle = '#e06a6a';
    hud.font = 'italic 11px system-ui, sans-serif';
    hud.fillText(`+${gear.length - drawnCells} more not shown`, px + 14, footerY);
  } else {
    hud.fillStyle = '#6b707a';
    hud.font = '11px system-ui, sans-serif';
    hud.fillText(
      'Tap an item to equip · sell at the Merchant to clear space · Esc to close',
      px + 14,
      footerY,
    );
  }

  hud.textAlign = 'left';
  return buttons;
}

/** Truncate `text` with an ellipsis so it fits `maxW` px at the current font. */
function fit(hud: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (hud.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && hud.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

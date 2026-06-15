/**
 * The Vault (bank stash) window: a banker NPC that stores gear beyond the player's bag. Two
 * columns — the bag (tap an item to deposit) and the stash (tap to withdraw). Pure Canvas2D
 * rendering matching the shop/artificer HUD style; it owns no state beyond the passed `hud`
 * context and returns its clickable button rects for `main.ts` to route. Height clamps to the
 * viewport; overflow rows collapse into a "+N more" note so the panel can never run off-screen.
 */

import type { ItemInstance } from '../shared/items.js';
import { RARITY } from '../shared/items.js';
import { drawItemIcon } from './item-icons.js';

export interface StashButton {
  action: 'deposit' | 'withdraw' | 'close' | 'expand';
  uid?: number; // deposit/withdraw: the gear instance uid
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draw the Vault panel and return its clickable buttons. A centered two-column panel: the left
 * column is the bag (deposit), the right is the stash (withdraw). Each side caps its visible rows
 * to fit the viewport and shows a "+N more" note for the remainder.
 */
export function drawStashPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  data: {
    bag: ItemInstance[];
    stash: ItemInstance[];
    cap: number;
    bagCap: number;
    /** Gold for the next stash expansion, or 0 when fully expanded (hides the Expand button). */
    expandCost: number;
    nameOf: (inst: ItemInstance) => string;
  },
): StashButton[] {
  const buttons: StashButton[] = [];

  const pw = Math.min(560, view.w - 16);
  const colW = (pw - 24) / 2; // two columns with an 8px gutter inside 8px side padding
  const rowH = 30;
  const headerH = 58;
  const sectionH = 22;
  const footerH = 26; // holds the Expand-stash button

  // Clamp total height to the viewport, capping how many rows each column draws.
  const maxPh = Math.min(view.h - 16, 640);
  const fixed = headerH + footerH + sectionH;
  const rowsThatFit = Math.max(1, Math.floor((maxPh - fixed) / rowH));
  const bagOverflow = data.bag.length > rowsThatFit;
  const stashOverflow = data.stash.length > rowsThatFit;
  const shownBag = Math.min(data.bag.length, bagOverflow ? rowsThatFit - 1 : rowsThatFit);
  const shownStash = Math.min(data.stash.length, stashOverflow ? rowsThatFit - 1 : rowsThatFit);
  // The taller column drives the panel height; empty columns still show one placeholder line.
  const bagLines = Math.max(1, shownBag + (bagOverflow ? 1 : 0));
  const stashLines = Math.max(1, shownStash + (stashOverflow ? 1 : 0));
  const bodyRows = Math.max(bagLines, stashLines);
  const panelH = fixed + bodyRows * rowH;

  const px = view.w / 2 - pw / 2;
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
  hud.fillText('Vault', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = data.stash.length >= data.cap ? '#e06a6a' : '#9aa3b2';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${data.stash.length} / ${data.cap} stored`, px + pw - 32, py + 24);

  // Close button (top-right ✕).
  const closeRect: StashButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Tap bag gear to store · tap stored gear to take · Esc to close', px + 14, py + 44);

  // Column headers.
  const leftX = px + 8;
  const rightX = px + 8 + colW + 8;
  const bodyY = py + headerH;
  hud.fillStyle = '#c9a24b';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.fillText(`Bag (${data.bag.length}/${data.bagCap})`, leftX + 6, bodyY + 15);
  hud.fillText(`Vault (${data.stash.length}/${data.cap})`, rightX + 6, bodyY + 15);

  const rowsTop = bodyY + sectionH;
  const stashFull = data.stash.length >= data.cap;
  const bagFull = data.bag.length >= data.bagCap;

  drawColumn(hud, leftX, rowsTop, colW, rowH, {
    items: data.bag,
    shown: shownBag,
    overflow: bagOverflow,
    enabled: !stashFull, // can't deposit into a full vault
    emptyText: 'Bag is empty',
    fullText: 'Vault is full',
    action: 'deposit',
    nameOf: data.nameOf,
    buttons,
  });
  drawColumn(hud, rightX, rowsTop, colW, rowH, {
    items: data.stash,
    shown: shownStash,
    overflow: stashOverflow,
    enabled: !bagFull, // can't withdraw into a full bag
    emptyText: 'Vault is empty',
    fullText: 'Bag is full',
    action: 'withdraw',
    nameOf: data.nameOf,
    buttons,
  });

  // Expand-stash button in the footer band — only while the stash can still grow (cost > 0).
  if (data.expandCost > 0) {
    const bw = Math.min(180, pw - 28);
    const bh = 18;
    const bx = px + pw / 2 - bw / 2;
    const by = py + panelH - footerH + 4;
    buttons.push({ action: 'expand', x: bx, y: by, w: bw, h: bh });
    hud.fillStyle = 'rgba(201,162,75,0.18)';
    hud.fillRect(bx, by, bw, bh);
    hud.strokeStyle = '#c9a24b';
    hud.lineWidth = 1;
    hud.strokeRect(bx, by, bw, bh);
    hud.fillStyle = '#e7d9b0';
    hud.font = 'bold 11px system-ui, sans-serif';
    hud.textAlign = 'center';
    hud.fillText(`Expand +10 slots · ${data.expandCost}g`, bx + bw / 2, by + 13);
  }

  hud.textAlign = 'left';
  return buttons;
}

/** Render one column of tappable item rows (+ empty/overflow placeholders) into `buttons`. */
function drawColumn(
  hud: CanvasRenderingContext2D,
  cx: number,
  top: number,
  colW: number,
  rowH: number,
  col: {
    items: ItemInstance[];
    shown: number;
    overflow: boolean;
    enabled: boolean;
    emptyText: string;
    fullText: string;
    action: 'deposit' | 'withdraw';
    nameOf: (inst: ItemInstance) => string;
    buttons: StashButton[];
  },
): void {
  if (col.items.length === 0) {
    drawEmpty(hud, cx, top, colW, rowH, col.emptyText);
    return;
  }
  let y = top;
  for (let i = 0; i < col.shown; i++) {
    const inst = col.items[i]!;
    if (col.enabled) {
      col.buttons.push({ action: col.action, uid: inst.uid, x: cx, y, w: colW, h: rowH - 4 });
    }
    drawRow(hud, cx, y, colW, rowH, col.enabled);

    // Pixel-art item icon on the left edge (dimmed with the row when not tappable); falls back
    // to the original text-only row until the sheets load.
    const iconSize = rowH - 10;
    hud.globalAlpha = col.enabled ? 1 : 0.5;
    const hasIcon = drawItemIcon(hud, inst.baseId, cx + 3, y + 3, iconSize);
    hud.globalAlpha = 1;
    const textX = hasIcon ? cx + 3 + iconSize + 5 : cx + 8;

    hud.textAlign = 'left';
    hud.fillStyle = col.enabled ? RARITY[inst.rarity].color : '#7d828c';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(fit(hud, col.nameOf(inst), colW - (textX - cx) - 8), textX, y + 17);
    y += rowH;
  }
  if (col.overflow) {
    drawEmpty(hud, cx, y, colW, rowH, `+${col.items.length - col.shown} more`);
  } else if (!col.enabled) {
    // Nothing tappable this side right now — tell the player why.
    drawEmpty(hud, cx, y, colW, rowH, col.fullText);
  }
}

/** A standard tappable row background (cream when enabled, dim when not). */
function drawRow(
  hud: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  rowH: number,
  enabled: boolean,
): void {
  hud.globalAlpha = enabled ? 1 : 0.5;
  hud.fillStyle = enabled ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
  hud.fillRect(x, y, w, rowH - 4);
  hud.strokeStyle = 'rgba(201,162,75,0.25)';
  hud.lineWidth = 1;
  hud.strokeRect(x, y, w, rowH - 4);
  hud.globalAlpha = 1;
}

/** A greyed italic placeholder row for empty columns / overflow notes. */
function drawEmpty(
  hud: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  rowH: number,
  text: string,
): void {
  hud.textAlign = 'left';
  hud.fillStyle = '#6b707a';
  hud.font = 'italic 11px system-ui, sans-serif';
  hud.fillText(fit(hud, text, w - 12), x + 8, y + (rowH - 4) / 2 + 4);
}

/** Truncate `text` with an ellipsis so it fits `maxW` px at the current font. */
function fit(hud: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (hud.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && hud.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

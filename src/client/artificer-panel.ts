/**
 * The Artificer window: a crafting NPC that rerolls a bag item's affixes (gold + a rune shard) or
 * pops a gem out of an equipped item (gold) back into the bag. Pure Canvas2D rendering matching the
 * shop/gambler HUD style; it owns no state beyond the passed `hud` context and returns its clickable
 * button rects for `main.ts` to route.
 */

import type { ItemInstance } from '../shared/items.js';
import { affixLabel, isDebuff, RARITY } from '../shared/items.js';
import { EQUIP_SLOTS, SLOT_LABELS } from '../shared/equipment.js';

export interface ArtificerButton {
  action: 'reroll' | 'unsocket' | 'close';
  uid?: number; // reroll: the bag instance uid
  slot?: string; // unsocket: the equipped doll slot
  index?: number; // unsocket: the socket index within that item
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One resolved "pop a gem out" target: which equipped item, which socket, which gem. */
interface GemRow {
  slot: string;
  index: number;
  gemId: string;
  itemName: string;
}

/**
 * Draw the Artificer panel and return its clickable buttons. A centered panel with a header
 * (title, gold, ✕ close) and two sections — reroll bag gear that has affixes, and unsocket gems from
 * equipped gear. Height clamps to the viewport; overflow rows are dropped with a "+N more" note.
 */
export function drawArtificerPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  data: {
    gear: ItemInstance[];
    equipment: Record<string, ItemInstance | null>;
    gold: number;
    rerollCost: number;
    unsocketCost: number;
    nameOf: (inst: ItemInstance) => string;
    gemName: (gemId: string) => string;
    gemColor: (gemId: string) => string;
  },
): ArtificerButton[] {
  const buttons: ArtificerButton[] = [];
  const canReroll = data.gold >= data.rerollCost;
  const canUnsocket = data.gold >= data.unsocketCost;

  const rerollItems = data.gear.filter((g) => g.affixes.length > 0);
  const gemRows: GemRow[] = [];
  for (const slot of EQUIP_SLOTS) {
    const inst = data.equipment[slot];
    if (!inst?.sockets) continue;
    inst.sockets.forEach((gemId, index) => {
      if (gemId) gemRows.push({ slot, index, gemId, itemName: data.nameOf(inst) });
    });
  }

  const pw = 420;
  const rowH = 34;
  const headerH = 58;
  const sectionH = 22;
  const footerH = 14;
  const px = view.w / 2 - pw / 2;

  // Clamp total height to the viewport, capping how many rows of each section we draw.
  const maxPh = Math.min(view.h - 16, 620);
  const fixed = headerH + footerH + sectionH * 2;
  let rerollCap = rerollItems.length || 1;
  let gemCap = gemRows.length || 1;
  const heightFor = (r: number, g: number): number => fixed + (r + g) * rowH;
  while (heightFor(rerollCap, gemCap) > maxPh && rerollCap + gemCap > 2) {
    if (rerollCap >= gemCap && rerollCap > 1) rerollCap--;
    else if (gemCap > 1) gemCap--;
    else rerollCap = Math.max(1, rerollCap - 1);
  }
  const shownReroll = Math.min(rerollItems.length, rerollCap);
  const shownGems = Math.min(gemRows.length, gemCap);
  // Empty sections still draw a one-line placeholder; overflow sections draw a "+N more" line.
  const rerollLines =
    rerollItems.length === 0 ? 1 : shownReroll + (shownReroll < rerollItems.length ? 1 : 0);
  const gemLines = gemRows.length === 0 ? 1 : shownGems + (shownGems < gemRows.length ? 1 : 0);
  const panelH = fixed + (rerollLines + gemLines) * rowH;
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
  hud.fillText('Artificer', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${data.gold} gold`, px + pw - 32, py + 24);

  // Close button (top-right ✕).
  const closeRect: ArtificerButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Reforge your gear · Esc to close', px + 14, py + 44);

  let y = py + headerH;

  // --- Section: reroll affixes ---
  hud.fillStyle = '#c9a24b';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.fillText(`Reroll affixes (${data.rerollCost}g + 1 shard)`, px + 14, y + 15);
  y += sectionH;

  if (rerollItems.length === 0) {
    drawEmpty(hud, px, y, rowH, 'No enchantable gear');
    y += rowH;
  } else {
    for (let i = 0; i < shownReroll; i++) {
      const inst = rerollItems[i]!;
      buttons.push({ action: 'reroll', uid: inst.uid, x: px + 8, y, w: pw - 16, h: rowH - 4 });
      drawRow(hud, px, y, pw, rowH, canReroll);
      hud.textAlign = 'left';
      hud.fillStyle = canReroll ? RARITY[inst.rarity].color : '#7d828c';
      hud.font = 'bold 12px system-ui, sans-serif';
      hud.fillText(fit(hud, data.nameOf(inst), pw - 110), px + 16, y + 13);
      // Affix summary line.
      drawAffixLine(hud, inst, px + 16, y + 26, pw - 110, canReroll);
      hud.textAlign = 'right';
      hud.fillStyle = canReroll ? '#f2c14e' : '#a05050';
      hud.font = '12px system-ui, sans-serif';
      hud.fillText(`${data.rerollCost}g`, px + pw - 16, y + 18);
      y += rowH;
    }
    if (shownReroll < rerollItems.length) {
      drawEmpty(hud, px, y, rowH, `+${rerollItems.length - shownReroll} more not shown`);
      y += rowH;
    }
  }

  // --- Section: remove gems ---
  hud.fillStyle = '#c9a24b';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(`Remove gems (${data.unsocketCost}g)`, px + 14, y + 15);
  y += sectionH;

  if (gemRows.length === 0) {
    drawEmpty(hud, px, y, rowH, 'No socketed gems');
    y += rowH;
  } else {
    for (let i = 0; i < shownGems; i++) {
      const row = gemRows[i]!;
      buttons.push({
        action: 'unsocket',
        slot: row.slot,
        index: row.index,
        x: px + 8,
        y,
        w: pw - 16,
        h: rowH - 4,
      });
      drawRow(hud, px, y, pw, rowH, canUnsocket);
      hud.textAlign = 'left';
      hud.fillStyle = canUnsocket ? '#e7d9b0' : '#7d828c';
      hud.font = 'bold 12px system-ui, sans-serif';
      const label = `${SLOT_LABELS[row.slot as keyof typeof SLOT_LABELS] ?? row.slot}: ${row.itemName}`;
      hud.fillText(fit(hud, label, pw - 130), px + 16, y + 13);
      // Gem dot + name.
      hud.globalAlpha = canUnsocket ? 1 : 0.5;
      hud.fillStyle = data.gemColor(row.gemId);
      hud.beginPath();
      hud.arc(px + 20, y + 23, 4, 0, Math.PI * 2);
      hud.fill();
      hud.globalAlpha = 1;
      hud.fillStyle = canUnsocket ? '#9aa3b2' : '#7d828c';
      hud.font = '11px system-ui, sans-serif';
      hud.fillText(fit(hud, data.gemName(row.gemId), pw - 140), px + 30, y + 26);
      hud.textAlign = 'right';
      hud.fillStyle = canUnsocket ? '#f2c14e' : '#a05050';
      hud.font = '12px system-ui, sans-serif';
      hud.fillText(`${data.unsocketCost}g`, px + pw - 16, y + 18);
      y += rowH;
    }
    if (shownGems < gemRows.length) {
      drawEmpty(hud, px, y, rowH, `+${gemRows.length - shownGems} more not shown`);
      y += rowH;
    }
  }

  hud.textAlign = 'left';
  return buttons;
}

/** A standard tappable row background (cream when affordable, dim when broke). */
function drawRow(
  hud: CanvasRenderingContext2D,
  px: number,
  y: number,
  pw: number,
  rowH: number,
  afford: boolean,
): void {
  hud.globalAlpha = afford ? 1 : 0.5;
  hud.fillStyle = afford ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
  hud.fillRect(px + 8, y, pw - 16, rowH - 4);
  hud.strokeStyle = 'rgba(201,162,75,0.25)';
  hud.lineWidth = 1;
  hud.strokeRect(px + 8, y, pw - 16, rowH - 4);
  hud.globalAlpha = 1;
}

/** A greyed italic placeholder row for empty sections / overflow notes. */
function drawEmpty(
  hud: CanvasRenderingContext2D,
  px: number,
  y: number,
  rowH: number,
  text: string,
): void {
  hud.textAlign = 'left';
  hud.fillStyle = '#6b707a';
  hud.font = 'italic 11px system-ui, sans-serif';
  hud.fillText(text, px + 16, y + (rowH - 4) / 2 + 4);
}

/** Render an item's affixes inline (debuffs in red), truncated to fit the row width. */
function drawAffixLine(
  hud: CanvasRenderingContext2D,
  inst: ItemInstance,
  x: number,
  y: number,
  maxW: number,
  afford: boolean,
): void {
  hud.font = '10px system-ui, sans-serif';
  hud.textAlign = 'left';
  let cx = x;
  for (let i = 0; i < inst.affixes.length; i++) {
    const a = inst.affixes[i]!;
    const text = (i > 0 ? '  ' : '') + affixLabel(a);
    const w = hud.measureText(text).width;
    if (cx - x + w > maxW) {
      hud.fillStyle = '#6b707a';
      hud.fillText('…', cx, y);
      break;
    }
    hud.fillStyle = !afford ? '#7d828c' : isDebuff(a) ? '#e06a6a' : '#8fb98f';
    hud.fillText(text, cx, y);
    cx += w;
  }
}

/** Truncate `text` with an ellipsis so it fits `maxW` px at the current font. */
function fit(hud: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (hud.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && hud.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

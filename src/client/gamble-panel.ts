/**
 * The gambler window: spend gold for a random item rolled to a chosen slot — could be junk, could
 * be rare. Pure Canvas2D rendering matching the shop/character HUD style; it owns no state beyond
 * the passed `hud` context and returns its clickable button rects for `main.ts` to route.
 */

export interface GambleButton {
  action: 'gamble' | 'close';
  /** For action 'gamble', the ItemSlot to gamble (e.g. 'mainhand', 'chest', 'ring'). */
  slot?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The gamblable item slots in a stable order, with their friendly labels. */
const SLOTS: { slot: string; label: string }[] = [
  { slot: 'head', label: 'Head' },
  { slot: 'neck', label: 'Neck' },
  { slot: 'shoulders', label: 'Shoulders' },
  { slot: 'chest', label: 'Chest' },
  { slot: 'hands', label: 'Hands' },
  { slot: 'waist', label: 'Waist' },
  { slot: 'legs', label: 'Legs' },
  { slot: 'feet', label: 'Feet' },
  { slot: 'mainhand', label: 'Weapon' },
  { slot: 'offhand', label: 'Off-hand' },
  { slot: 'ring', label: 'Ring' },
  { slot: 'trinket', label: 'Trinket' },
];

/**
 * Draw the gambling panel and return its clickable buttons. Shows the per-pull `cost` and the
 * player's `gold` in the header, a ✕ close button, and one tappable row per gamblable item slot
 * labeled with its friendly name and the cost. Rows the player can't afford are dimmed.
 */
export function drawGamblePanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  cost: number,
  gold: number,
): GambleButton[] {
  const buttons: GambleButton[] = [];
  const afford = gold >= cost;

  const pw = 300;
  const rowH = 30;
  const headerH = 58;
  const footerH = 38;
  const ph = headerH + SLOTS.length * rowH + footerH;
  const px = view.w / 2 - pw / 2;
  const py = view.h / 2 - ph / 2;

  hud.fillStyle = 'rgba(8,9,13,0.94)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Gambler', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${gold} gold`, px + pw - 14, py + 24);

  // Close button (top-right ✕).
  const closeRect: GambleButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(`Tap a slot to gamble · ${cost}g per pull · Esc to close`, px + 14, py + 44);

  SLOTS.forEach(({ slot, label }, i) => {
    const ry = py + headerH + i * rowH;
    buttons.push({ action: 'gamble', slot, x: px + 8, y: ry, w: pw - 16, h: rowH - 4 });
    hud.globalAlpha = afford ? 1 : 0.45;
    hud.fillStyle = afford ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
    hud.fillRect(px + 8, ry, pw - 16, rowH - 4);
    hud.strokeStyle = 'rgba(201,162,75,0.25)';
    hud.lineWidth = 1;
    hud.strokeRect(px + 8, ry, pw - 16, rowH - 4);
    hud.textAlign = 'left';
    hud.fillStyle = afford ? '#e7d9b0' : '#7d828c';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(label, px + 16, ry + 17);
    hud.textAlign = 'right';
    hud.fillStyle = afford ? '#f2c14e' : '#a05050';
    hud.font = '12px system-ui, sans-serif';
    hud.fillText(`${cost}g`, px + pw - 16, ry + 17);
    hud.globalAlpha = 1;
  });

  hud.textAlign = 'center';
  hud.fillStyle = '#8a8f99';
  hud.font = 'italic 10px system-ui, sans-serif';
  hud.fillText(
    'Gamble gold for a random item — could be junk, could be rare.',
    px + pw / 2,
    py + ph - 14,
  );
  hud.textAlign = 'left';

  return buttons;
}

/**
 * The Riftkeeper window: choose a difficulty tier and open a fresh, private endgame rift.
 * Higher tiers pack stronger, denser, more champion-heavy monsters — and cost more gold.
 * Pure Canvas2D rendering matching the gambler/recruiter HUD style; returns its clickable
 * button rects for `main.ts` to route.
 */

export interface RiftButton {
  action: 'open' | 'close';
  /** For action 'open', the rift tier to open. */
  tier?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A short danger word per tier band so the list reads as a ladder, not a spreadsheet. */
function dangerLabel(tier: number): string {
  if (tier <= 2) return 'Unstable';
  if (tier <= 4) return 'Volatile';
  if (tier <= 6) return 'Raging';
  if (tier <= 8) return 'Cataclysmic';
  return 'Apocalyptic';
}

/**
 * Draw the rift panel and return its clickable buttons. One tappable row per unlocked tier
 * showing the danger word, the monster scaling, and the fee; rows the player can't afford are
 * dimmed. A new tier unlocks every few levels (the server enforces the cap).
 */
export function drawRiftPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  rift: { maxTier: number; costBase: number },
  gold: number,
): RiftButton[] {
  const buttons: RiftButton[] = [];

  const pw = 320;
  const rowH = 34;
  const headerH = 58;
  const footerH = 38;
  const ph = headerH + rift.maxTier * rowH + footerH;
  const px = view.w / 2 - pw / 2;
  const py = view.h / 2 - ph / 2;

  hud.fillStyle = 'rgba(10,7,16,0.94)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#9a6bd0';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e0d2f0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('The Shattered Rift', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${gold} gold`, px + pw - 14, py + 24);

  // Close button (top-right ✕).
  const closeRect: RiftButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Choose a tier — a fresh rift opens for you alone · Esc to close', px + 14, py + 44);

  for (let tier = 1; tier <= rift.maxTier; tier++) {
    const cost = tier * rift.costBase;
    const afford = gold >= cost;
    const ry = py + headerH + (tier - 1) * rowH;
    buttons.push({ action: 'open', tier, x: px + 8, y: ry, w: pw - 16, h: rowH - 4 });
    hud.globalAlpha = afford ? 1 : 0.45;
    hud.fillStyle = afford ? 'rgba(154,107,208,0.10)' : 'rgba(0,0,0,0.2)';
    hud.fillRect(px + 8, ry, pw - 16, rowH - 4);
    hud.strokeStyle = 'rgba(154,107,208,0.3)';
    hud.lineWidth = 1;
    hud.strokeRect(px + 8, ry, pw - 16, rowH - 4);
    hud.textAlign = 'left';
    hud.fillStyle = afford ? '#e0d2f0' : '#7d828c';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(`Tier ${tier} — ${dangerLabel(tier)}`, px + 16, ry + 13);
    hud.fillStyle = '#8a8f99';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(`+${tier * 2} monster levels · denser packs · more champions`, px + 16, ry + 25);
    hud.textAlign = 'right';
    hud.fillStyle = afford ? '#f2c14e' : '#a05050';
    hud.font = '12px system-ui, sans-serif';
    hud.fillText(`${cost}g`, px + pw - 16, ry + 18);
    hud.globalAlpha = 1;
  }

  hud.textAlign = 'center';
  hud.fillStyle = '#8a8f99';
  hud.font = 'italic 10px system-ui, sans-serif';
  hud.fillText(
    'Higher tiers unlock as you level. Exit through the rift portal.',
    px + pw / 2,
    py + ph - 14,
  );
  hud.textAlign = 'left';

  return buttons;
}

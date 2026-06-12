/**
 * The recruiter window: hire a mercenary companion who follows you and fights at your side.
 * Pure Canvas2D rendering matching the gambler/shop HUD style; it owns no state beyond the
 * passed `hud` context and returns its clickable button rects for `main.ts` to route.
 */

export interface HireButton {
  action: 'hire' | 'close';
  /** For action 'hire', the mercenary type to hire (e.g. 'guard', 'marksman'). */
  type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Flavor lines per mercenary type so the choice reads as more than a stat row. */
const FLAVOR: Record<string, string> = {
  guard: 'A steady sword that holds the line beside you.',
  marksman: 'Picks off your foes from a careful distance.',
};

/**
 * Draw the hire panel and return its clickable buttons. One tappable row per offer with its
 * name, flavor, and cost; rows the player can't afford are dimmed. The fee is paid again to
 * replace a fallen (or swapped) companion.
 */
export function drawHirePanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  offers: { type: string; name: string; cost: number }[],
  gold: number,
): HireButton[] {
  const buttons: HireButton[] = [];

  const pw = 320;
  const rowH = 46;
  const headerH = 58;
  const footerH = 38;
  const ph = headerH + offers.length * rowH + footerH;
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
  hud.fillText('Recruiter', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${gold} gold`, px + pw - 14, py + 24);

  // Close button (top-right ✕).
  const closeRect: HireButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Tap to hire · replaces your current companion · Esc to close', px + 14, py + 44);

  offers.forEach((offer, i) => {
    const afford = gold >= offer.cost;
    const ry = py + headerH + i * rowH;
    buttons.push({ action: 'hire', type: offer.type, x: px + 8, y: ry, w: pw - 16, h: rowH - 6 });
    hud.globalAlpha = afford ? 1 : 0.45;
    hud.fillStyle = afford ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
    hud.fillRect(px + 8, ry, pw - 16, rowH - 6);
    hud.strokeStyle = 'rgba(201,162,75,0.25)';
    hud.lineWidth = 1;
    hud.strokeRect(px + 8, ry, pw - 16, rowH - 6);
    hud.textAlign = 'left';
    hud.fillStyle = afford ? '#e7d9b0' : '#7d828c';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(offer.name, px + 16, ry + 16);
    hud.fillStyle = '#8a8f99';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(FLAVOR[offer.type] ?? 'A capable sellsword.', px + 16, ry + 31);
    hud.textAlign = 'right';
    hud.fillStyle = afford ? '#f2c14e' : '#a05050';
    hud.font = '12px system-ui, sans-serif';
    hud.fillText(`${offer.cost}g`, px + pw - 16, ry + 16);
    hud.globalAlpha = 1;
  });

  hud.textAlign = 'center';
  hud.fillStyle = '#8a8f99';
  hud.font = 'italic 10px system-ui, sans-serif';
  hud.fillText('They fight beside you — and stay dead until re-hired.', px + pw / 2, py + ph - 14);
  hud.textAlign = 'left';

  return buttons;
}

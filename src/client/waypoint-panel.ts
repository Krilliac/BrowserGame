/**
 * Waypoint / fast-travel map. Self-contained Canvas2D renderer matching the HUD style of the
 * shop and quest panels (dark panel, gold border, cream text). Returns the clickable button
 * rects so the caller can hit-test taps — no global or DOM state beyond the passed `hud`.
 */

export interface WaypointButton {
  action: 'travel' | 'close';
  /** For action 'travel', the destination area id. */
  areaId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Draw the waypoint panel and return its clickable buttons. Lists every DISCOVERED area as a
 * tappable row showing its name; the player's CURRENT area is marked ("● Here", highlighted,
 * and NOT a travel target). A ✕ close button top-right. Title "Waypoints". Footer hint:
 * "Fast-travel to any place you've visited." If `areas` is empty show
 * "No waypoints discovered yet."
 */
export function drawWaypointPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  areas: { id: string; name: string }[],
  currentAreaId: string,
): WaypointButton[] {
  const buttons: WaypointButton[] = [];

  const pw = 300;
  const rowH = 30;
  const headerH = 56;
  const footerH = 34;
  const rowCount = Math.max(1, areas.length);

  // Height scales to the row count but is clamped to fit the viewport.
  const wanted = headerH + rowCount * rowH + footerH;
  const ph = Math.min(view.h - 32, wanted);
  const px = view.w / 2 - pw / 2;
  const py = view.h / 2 - ph / 2;

  hud.fillStyle = 'rgba(8,9,13,0.93)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  // Title.
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Waypoints', px + 14, py + 24);

  // Close button (top-right ✕).
  const closeRect: WaypointButton = { action: 'close', x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  buttons.push(closeRect);
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', closeRect.x + 10, closeRect.y + 15);

  if (areas.length === 0) {
    hud.textAlign = 'center';
    hud.fillStyle = '#8a8f99';
    hud.font = 'italic 12px system-ui, sans-serif';
    hud.fillText('No waypoints discovered yet.', px + pw / 2, py + headerH + 8);
    return buttons;
  }

  // How many rows actually fit inside the clamped panel.
  const maxRows = Math.max(1, Math.floor((ph - headerH - footerH) / rowH));
  const visible = areas.slice(0, maxRows);

  visible.forEach((area, i) => {
    const ry = py + headerH + i * rowH;
    const isHere = area.id === currentAreaId;

    hud.fillStyle = isHere ? 'rgba(201,162,75,0.12)' : 'rgba(255,255,255,0.05)';
    hud.fillRect(px + 8, ry, pw - 16, rowH - 4);
    hud.strokeStyle = 'rgba(201,162,75,0.25)';
    hud.lineWidth = 1;
    hud.strokeRect(px + 8, ry, pw - 16, rowH - 4);

    hud.textAlign = 'left';
    hud.fillStyle = isHere ? '#f2c14e' : '#d7dbe3';
    hud.font = isHere ? 'bold 12px system-ui, sans-serif' : '12px system-ui, sans-serif';
    hud.fillText(fitText(hud, area.name, pw - 70), px + 16, ry + 17);

    if (isHere) {
      hud.textAlign = 'right';
      hud.fillStyle = '#f2c14e';
      hud.font = 'bold 11px system-ui, sans-serif';
      hud.fillText('● Here', px + pw - 16, ry + 17);
      // Current area is rendered but is not a travel target — no button pushed.
    } else {
      buttons.push({
        action: 'travel',
        areaId: area.id,
        x: px + 8,
        y: ry,
        w: pw - 16,
        h: rowH - 4,
      });
    }
  });

  // Footer hint.
  hud.textAlign = 'center';
  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.fillText("Fast-travel to any place you've visited.", px + pw / 2, py + ph - 12);

  return buttons;
}

/** Truncate `text` with an ellipsis so it fits within `maxWidth` at the current `hud.font`. */
function fitText(hud: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (hud.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && hud.measureText(s + '…').width > maxWidth) {
    s = s.slice(0, -1);
  }
  return s + '…';
}

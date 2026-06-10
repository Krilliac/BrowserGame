import type { FriendInfo } from '../shared/protocol.js';

/** A clickable per-friend action button the caller hit-tests and acts on. */
export interface SocialButton {
  action: 'remove' | 'whisper';
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const HINT = '/friend <name> to add · /w <name> <msg> to whisper';

/** Trim a string with an ellipsis so it fits within `maxWidth` px in the current font. */
function fit(hud: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (hud.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && hud.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/**
 * Draw the friends panel and return its clickable buttons (caller hit-tests + acts).
 * Layout: a titled panel listing each friend — name, an online/offline dot (green/grey),
 * and when online their level + area id. Each row has a small [W] whisper button and an [x]
 * remove button (returned as SocialButton rects). Online friends sort above offline; dim offline.
 * Show a footer hint: "/friend <name> to add · /w <name> <msg> to whisper".
 * When the list is empty, show a friendly "No friends yet" + the hint.
 */
export function drawSocialPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  friends: FriendInfo[],
): SocialButton[] {
  const buttons: SocialButton[] = [];

  // Online first, then offline; alphabetical within each group.
  const sorted = [...friends].sort((a, b) => {
    if (a.online !== b.online) return a.online ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const pw = 320;
  const rowH = 34;
  const headerH = 44;
  const footerH = 34;
  const bodyRows = Math.max(1, sorted.length);
  const ph = headerH + bodyRows * rowH + footerH;
  // Left-of-center so it dodges the top-right minimap and bottom-center hotbar.
  const px = Math.round(view.w / 2 - pw / 2 - 220);
  const py = Math.round(view.h / 2 - ph / 2);

  hud.fillStyle = 'rgba(8,9,13,0.93)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  // Header.
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Friends', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  const onlineCount = sorted.filter((f) => f.online).length;
  hud.fillText(`${onlineCount}/${sorted.length} online · O or Esc`, px + pw - 14, py + 24);

  if (sorted.length === 0) {
    hud.textAlign = 'center';
    hud.fillStyle = '#9aa3b2';
    hud.font = 'italic 13px system-ui, sans-serif';
    hud.fillText('No friends yet', px + pw / 2, py + headerH + 16);
    hud.fillStyle = '#7d828c';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(fit(hud, HINT, pw - 24), px + pw / 2, py + headerH + 36);
    return buttons;
  }

  const btnW = 22;
  const btnGap = 6;
  const actionsW = btnW * 2 + btnGap; // [W] [x]

  sorted.forEach((f, i) => {
    const ry = py + headerH + i * rowH;
    const dim = !f.online;

    // Online/offline dot.
    hud.beginPath();
    hud.fillStyle = f.online ? '#6bbf59' : '#566';
    hud.arc(px + 18, ry + 14, 5, 0, Math.PI * 2);
    hud.fill();

    // Name.
    hud.textAlign = 'left';
    hud.fillStyle = dim ? '#7d828c' : '#d7dbe3';
    hud.font = 'bold 13px system-ui, sans-serif';
    const nameMax = pw - 40 - actionsW - 110;
    hud.fillText(fit(hud, f.name, nameMax), px + 32, ry + 12);

    // Status line: level + area when online, else "Offline".
    hud.fillStyle = dim ? '#5f636d' : '#9aa3b2';
    hud.font = '10px system-ui, sans-serif';
    const status = f.online ? `Lv ${f.level} · ${f.areaId}` : 'Offline';
    hud.fillText(fit(hud, status, pw - 40 - actionsW), px + 32, ry + 25);

    // Action buttons on the right: whisper [W] then remove [x].
    const bx0 = px + pw - 14 - actionsW;
    const by = ry + 2;
    const bh = rowH - 8;

    // Whisper button.
    const wRect: SocialButton = { action: 'whisper', name: f.name, x: bx0, y: by, w: btnW, h: bh };
    buttons.push(wRect);
    hud.fillStyle = f.online ? 'rgba(54,80,128,0.55)' : 'rgba(40,46,60,0.4)';
    hud.fillRect(wRect.x, wRect.y, wRect.w, wRect.h);
    hud.strokeStyle = 'rgba(201,162,75,0.4)';
    hud.lineWidth = 1;
    hud.strokeRect(wRect.x, wRect.y, wRect.w, wRect.h);
    hud.fillStyle = dim ? '#9aa3b2' : '#e7d9b0';
    hud.font = 'bold 11px system-ui, sans-serif';
    hud.textAlign = 'center';
    hud.fillText('W', wRect.x + wRect.w / 2, wRect.y + bh / 2 + 4);

    // Remove button.
    const xRect: SocialButton = {
      action: 'remove',
      name: f.name,
      x: bx0 + btnW + btnGap,
      y: by,
      w: btnW,
      h: bh,
    };
    buttons.push(xRect);
    hud.fillStyle = 'rgba(120,60,60,0.45)';
    hud.fillRect(xRect.x, xRect.y, xRect.w, xRect.h);
    hud.strokeStyle = 'rgba(201,162,75,0.4)';
    hud.lineWidth = 1;
    hud.strokeRect(xRect.x, xRect.y, xRect.w, xRect.h);
    hud.fillStyle = '#d7a0a0';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText('✕', xRect.x + xRect.w / 2, xRect.y + bh / 2 + 4);

    // Row separator.
    if (i < sorted.length - 1) {
      hud.strokeStyle = 'rgba(255,255,255,0.06)';
      hud.lineWidth = 1;
      hud.beginPath();
      hud.moveTo(px + 10, ry + rowH - 2);
      hud.lineTo(px + pw - 10, ry + rowH - 2);
      hud.stroke();
    }
  });

  // Footer hint.
  hud.textAlign = 'center';
  hud.fillStyle = '#7d828c';
  hud.font = '10px system-ui, sans-serif';
  hud.fillText(fit(hud, HINT, pw - 24), px + pw / 2, py + ph - 12);

  return buttons;
}

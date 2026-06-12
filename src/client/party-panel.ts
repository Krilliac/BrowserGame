import type { PartyMember } from '../shared/protocol.js';

export interface PartyButton {
  action: 'invite-nearest' | 'accept' | 'decline' | 'leave';
  x: number;
  y: number;
  w: number;
  h: number;
}

const GOLD = '#c9a24b';
const PANEL_BG = 'rgba(8,9,13,0.93)';

/** Inline HP bar matching main.ts's drawBar look (green fill on a dark track). */
function hpBar(
  hud: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
): void {
  hud.fillStyle = 'rgba(0,0,0,0.6)';
  hud.fillRect(x, y, w, h);
  hud.fillStyle = '#8ac34a';
  hud.fillRect(x, y, w * Math.max(0, Math.min(1, frac)), h);
  hud.strokeStyle = 'rgba(201,162,75,0.4)';
  hud.lineWidth = 1;
  hud.strokeRect(x, y, w, h);
}

/** A filled+stroked button consistent with the quest/shop panel buttons. */
function button(
  hud: CanvasRenderingContext2D,
  rect: { x: number; y: number; w: number; h: number },
  label: string,
  bg: string,
): void {
  hud.fillStyle = bg;
  hud.fillRect(rect.x, rect.y, rect.w, rect.h);
  hud.strokeStyle = 'rgba(201,162,75,0.6)';
  hud.lineWidth = 1;
  hud.strokeRect(rect.x, rect.y, rect.w, rect.h);
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 4);
}

/**
 * Draw the party panel and return its clickable buttons (the caller hit-tests + acts).
 * Layout: a compact card on the left side, below the top HUD. Header reads "Party",
 * then either a status line + invite/accept buttons, or a member roster with HP bars
 * and a [Leave party] button along the bottom.
 */
export function drawPartyPanel(
  hud: CanvasRenderingContext2D,
  view: { w: number; h: number },
  party: { members: PartyMember[]; inviteFrom?: string },
  selfId: number,
): PartyButton[] {
  const buttons: PartyButton[] = [];
  const pw = 240;
  const px = 16;
  const headerH = 30;
  const rowH = 38;
  const footerH = party.members.length > 0 ? 36 : 0;

  // Body height depends on which of the three states we render.
  let bodyRows = party.members.length;
  if (party.members.length === 0) bodyRows = party.inviteFrom ? 2 : 1;
  const ph = headerH + bodyRows * rowH + footerH + 10;

  // Sit below the top HUD, but clamp so a large roster never spills off-screen.
  const py = Math.max(16, Math.min(90, view.h - ph - 16));

  hud.fillStyle = PANEL_BG;
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = GOLD;
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Party', px + 14, py + 22);

  // State 1: a pending invite to respond to.
  if (party.inviteFrom) {
    hud.fillStyle = '#d7dbe3';
    hud.font = '12px system-ui, sans-serif';
    hud.fillText(`${party.inviteFrom} invited you`, px + 14, py + headerH + 18);
    const by = py + headerH + 28;
    const bw = (pw - 14 * 3) / 2;
    const accept = { action: 'accept' as const, x: px + 14, y: by, w: bw, h: 24 };
    const decline = { action: 'decline' as const, x: px + 14 + bw + 14, y: by, w: bw, h: 24 };
    button(hud, accept, 'Accept', 'rgba(60,90,60,0.6)');
    button(hud, decline, 'Decline', 'rgba(120,60,60,0.5)');
    buttons.push(accept, decline);
    return buttons;
  }

  // State 2: not in a party — offer to invite the nearest player.
  if (party.members.length === 0) {
    hud.fillStyle = '#8a8f99';
    hud.font = 'italic 12px system-ui, sans-serif';
    hud.fillText('Not in a party', px + 14, py + headerH + 18);
    const rect = {
      action: 'invite-nearest' as const,
      x: px + 14,
      y: py + headerH + 26,
      w: pw - 28,
      h: 24,
    };
    button(hud, rect, 'Invite nearest', 'rgba(60,80,110,0.6)');
    buttons.push(rect);
    return buttons;
  }

  // State 3: roster.
  party.members.forEach((m, i) => {
    const ry = py + headerH + i * rowH;
    hud.globalAlpha = m.online ? 1 : 0.45;

    hud.textAlign = 'left';
    hud.fillStyle = m.id === selfId ? '#f2c14e' : '#d7dbe3';
    hud.font = 'bold 12px system-ui, sans-serif';
    const star = m.leader ? '★ ' : '';
    hud.fillText(`${star}${m.name}`, px + 14, ry + 14);

    hud.textAlign = 'right';
    hud.fillStyle = '#8a8f99';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(`Lv ${m.level} · ${m.areaId}`, px + pw - 14, ry + 14);

    const frac = m.maxHp > 0 ? m.hp / m.maxHp : 0;
    hpBar(hud, px + 14, ry + 20, pw - 28, 10, frac);
    hud.fillStyle = '#fff';
    hud.font = '9px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText(`${Math.max(0, Math.round(m.hp))}/${m.maxHp}`, px + 18, ry + 29);

    hud.globalAlpha = 1;
  });

  const leave = {
    action: 'leave' as const,
    x: px + 14,
    y: py + ph - 30,
    w: pw - 28,
    h: 24,
  };
  button(hud, leave, 'Leave party', 'rgba(120,60,60,0.5)');
  buttons.push(leave);

  return buttons;
}

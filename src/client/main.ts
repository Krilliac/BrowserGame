import { Input } from './input.js';
import { INTERP_DELAY_MS } from './interp.js';
import { Net } from './net.js';
import { areaOf } from '../shared/areas.js';
import { ABILITIES, ABILITY_ORDER, type AbilityId } from '../shared/combat.js';
import { drawCharacter, drawFx, drawItem, drawProjectile, drawWorld } from './draw.js';
import type { EntityState } from '../shared/protocol.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusEl = document.getElementById('status')!;
const popEl = document.getElementById('pop')!;
const chatLogEl = document.getElementById('chat-log')!;
const chatInputEl = document.getElementById('chat-input') as HTMLInputElement;

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

const name =
  window.localStorage.getItem('bg.name') ??
  (() => {
    const n = `Hero${Math.floor(Math.random() * 1000)}`;
    window.localStorage.setItem('bg.name', n);
    return n;
  })();

const net = new Net(name);
net.connect();

const input = new Input();
input.attach(canvas);
setInterval(() => net.sendInput(input.sample()), 1000 / 30);

// --- Combat input ---------------------------------------------------------------------
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let hasMouse = false;
let selected: AbilityId = 'slash';
const cooldownEnd: Record<string, number> = {};
const slotRects: { ability: AbilityId; x: number; y: number; w: number; h: number }[] = [];

let entities: EntityState[] = [];
let self: EntityState | undefined;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    hasMouse = true;
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInputEl) return;
  const ability = ABILITY_ORDER.find((id) => ABILITIES[id].key === e.key);
  if (ability) {
    selected = ability;
    castAbility(ability);
  }
});

// Desktop: left-click casts the selected ability toward the cursor.
window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    selected = slot.ability;
    castAbility(slot.ability);
  } else if (e.target === canvas) {
    castAbility(selected);
  }
});

// Touch: tapping an ability slot casts it (aimed at the nearest monster).
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    selected = slot.ability;
    castAbility(slot.ability);
  }
});

function castAbility(abilityId: AbilityId): void {
  if (net.you.dead || !self) return;
  const ability = ABILITIES[abilityId];
  if ((cooldownEnd[abilityId] ?? 0) > performance.now()) return;
  if (net.you.mana < ability.manaCost) return;

  const aim = computeAim();
  net.sendCast(abilityId, aim.dx, aim.dy);
  cooldownEnd[abilityId] = performance.now() + ability.cooldownMs;
}

function computeAim(): { dx: number; dy: number } {
  if (!self) return { dx: 1, dy: 0 };
  if (hasMouse) return { dx: mouseX - canvas.width / 2, dy: mouseY - canvas.height / 2 };
  const mob = nearestMob();
  if (mob) return { dx: mob.x - self.x, dy: mob.y - self.y };
  return { dx: Math.cos(self.facing), dy: Math.sin(self.facing) };
}

function nearestMob(): EntityState | undefined {
  if (!self) return undefined;
  let best: EntityState | undefined;
  let bestDist = Infinity;
  for (const e of entities) {
    if (e.kind !== 'mob') continue;
    const d = Math.hypot(e.x - self.x, e.y - self.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

// --- Chat input wiring ----------------------------------------------------------------
window.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && document.activeElement !== chatInputEl) {
    input.clearKeys();
    chatInputEl.focus();
    e.preventDefault();
  }
});
chatInputEl.addEventListener('focus', () => input.clearKeys());
chatInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = chatInputEl.value;
    if (text.trim().length > 0) net.sendChat(text);
    chatInputEl.value = '';
    chatInputEl.blur();
    e.preventDefault();
  } else if (e.key === 'Escape') {
    chatInputEl.value = '';
    chatInputEl.blur();
  }
});

let renderedChatLen = 0;
function syncChatLog(): void {
  if (net.chat.length === renderedChatLen) return;
  chatLogEl.replaceChildren();
  for (const line of net.chat) {
    const div = document.createElement('div');
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = `${line.from}: `;
    div.append(who, document.createTextNode(line.text));
    chatLogEl.append(div);
  }
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
  renderedChatLen = net.chat.length;
}

// --- Render loop ----------------------------------------------------------------------
function render(): void {
  const { width: w, height: h } = canvas;
  const now = performance.now();

  entities = net.snapshots.sample(now - INTERP_DELAY_MS);
  self = entities.find((e) => e.id === net.selfId);
  const camX = (self ? self.x : 0) - w / 2;
  const camY = (self ? self.y : 0) - h / 2;

  drawWorld(ctx, net.areaId, camX, camY, w, h);
  drawPortals(camX, camY);

  for (const e of entities) {
    if (e.kind === 'item') drawItem(ctx, e, e.x - camX, e.y - camY, now);
  }
  for (const e of entities) {
    if (e.kind === 'player' || e.kind === 'mob') {
      drawCharacter(ctx, e, e.id === net.selfId, e.x - camX, e.y - camY);
    }
  }
  for (const e of entities) {
    if (e.kind === 'projectile') drawProjectile(ctx, e, e.x - camX, e.y - camY);
  }
  drawFx(ctx, net.fx, camX, camY, now);
  drawHud(w, h);

  const area = areaOf(net.areaId);
  statusEl.textContent = net.connected ? `online as ${name}` : 'reconnecting…';
  popEl.textContent = `${area?.name ?? net.areaId} · players: ${entities.filter((e) => e.kind === 'player').length}`;
  syncChatLog();
  requestAnimationFrame(render);
}

function drawPortals(camX: number, camY: number): void {
  const area = areaOf(net.areaId);
  if (!area) return;
  for (const portal of area.portals) {
    const sx = portal.rect.x - camX;
    const sy = portal.rect.y - camY;
    ctx.fillStyle = 'rgba(201,162,75,0.18)';
    ctx.strokeStyle = 'rgba(201,162,75,0.8)';
    ctx.lineWidth = 2;
    ctx.fillRect(sx, sy, portal.rect.w, portal.rect.h);
    ctx.strokeRect(sx, sy, portal.rect.w, portal.rect.h);
    ctx.fillStyle = '#e7d9b0';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(portal.label, sx + portal.rect.w / 2, sy - 6);
  }
}

function drawHud(w: number, h: number): void {
  const slot = 48;
  const gap = 10;
  const count = ABILITY_ORDER.length;
  const panelW = count * slot + (count - 1) * gap;
  const panelX = w / 2 - panelW / 2;
  const slotsY = h - 60;
  const now = performance.now();

  // Level + gold line.
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#e7d9b0';
  ctx.fillText(`Lv ${net.you.level}`, panelX, h - 98);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f2c14e';
  ctx.fillText(`${net.you.gold} gold`, panelX + panelW, h - 98);
  ctx.textAlign = 'left';

  // Resource + XP bars above the hotbar.
  drawBar(panelX, h - 92, panelW, 9, net.you.hp / net.you.maxHp, '#b33', `HP ${net.you.hp}`);
  drawBar(panelX, h - 81, panelW, 7, net.you.mana / net.you.maxMana, '#36c', `MP ${net.you.mana}`);
  drawBar(
    panelX,
    h - 72,
    panelW,
    4,
    net.you.xpNext > 0 ? net.you.xpInto / net.you.xpNext : 0,
    '#8ac34a',
    '',
  );

  slotRects.length = 0;
  ABILITY_ORDER.forEach((id, i) => {
    const x = panelX + i * (slot + gap);
    const ability = ABILITIES[id];
    slotRects.push({ ability: id, x, y: slotsY, w: slot, h: slot });

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, slotsY, slot, slot);
    ctx.fillStyle = ability.color;
    ctx.globalAlpha = net.you.mana < ability.manaCost ? 0.3 : 0.85;
    ctx.fillRect(x + 4, slotsY + 4, slot - 8, slot - 8);
    ctx.globalAlpha = 1;

    // Cooldown sweep (client-predicted).
    const remaining = (cooldownEnd[id] ?? 0) - now;
    if (remaining > 0) {
      const frac = Math.min(1, remaining / ability.cooldownMs);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x, slotsY + slot * (1 - frac), slot, slot * frac);
    }

    ctx.strokeStyle = selected === id ? '#c9a24b' : 'rgba(255,255,255,0.25)';
    ctx.lineWidth = selected === id ? 3 : 1;
    ctx.strokeRect(x, slotsY, slot, slot);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(ability.key, x + 4, slotsY + 14);
    ctx.textAlign = 'center';
    ctx.font = '10px system-ui, sans-serif';
    ctx.fillText(ability.name, x + slot / 2, slotsY + slot - 5);
  });

  input.hudRect = { x: panelX - 6, y: h - 108, w: panelW + 12, h: 104 };

  if (net.you.dead) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e7d9b0';
    ctx.font = 'bold 32px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You died — respawning…', w / 2, h / 2);
  }
}

function drawBar(
  x: number,
  y: number,
  width: number,
  height: number,
  frac: number,
  color: string,
  label: string,
): void {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = color;
  ctx.fillRect(x, y, width * Math.max(0, Math.min(1, frac)), height);
  ctx.fillStyle = '#fff';
  ctx.font = '9px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 4, y + height - 1);
}

function inRect(
  px: number,
  py: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

requestAnimationFrame(render);

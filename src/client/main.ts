import { Application } from 'pixi.js';
import { isPinnedToBottom } from './chat.js';
import { affixLabel, instanceName, RARITY, type ItemInstance } from '../shared/items.js';
import { Input } from './input.js';
import { INTERP_DELAY_MS } from './interp.js';
import { Net } from './net.js';
import { PixiRenderer } from './pixi-renderer.js';
import { Sound } from './sound.js';
import { Predictor } from './predictor.js';
import type { AbilityId } from '../shared/combat.js';
import type { EntityState } from '../shared/protocol.js';

const gameCanvas = document.getElementById('game') as HTMLCanvasElement;
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement;
const hud = hudCanvas.getContext('2d')!;
const statusEl = document.getElementById('status')!;
const popEl = document.getElementById('pop')!;
const chatEl = document.getElementById('chat')!;
const chatLogEl = document.getElementById('chat-log')!;
const chatInputEl = document.getElementById('chat-input') as HTMLInputElement;

function resizeHud(): void {
  hudCanvas.width = window.innerWidth;
  hudCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeHud);
resizeHud();

// --- PixiJS app + renderer (tilted top-down 2.5D) -------------------------------------
const app = new Application();
await app.init({
  canvas: gameCanvas,
  resizeTo: window,
  antialias: true,
  background: '#0e0f13',
  preference: 'webgl',
});
const name =
  window.localStorage.getItem('bg.name') ??
  (() => {
    const n = `Hero${Math.floor(Math.random() * 1000)}`;
    window.localStorage.setItem('bg.name', n);
    return n;
  })();

// Net is created first so the renderer can read game content from its store (filled by the
// server's `content` packet — the client mirrors the SQLite DB).
const net = new Net(name);
const renderer = new PixiRenderer(app, net.content);
await renderer.loadAssets();
net.connect();

const sound = new Sound();
sound.load();
const unlockAudio = (): void => sound.unlock();
window.addEventListener('pointerdown', unlockAudio, { once: true });
window.addEventListener('keydown', unlockAudio, { once: true });

const input = new Input();
input.attach(gameCanvas);

// Reserve right-click for the game: suppress the browser's native context menu (copy image,
// etc.) everywhere except editable fields, so right-click paste still works in the chat box.
window.addEventListener('contextmenu', (e) => {
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
  e.preventDefault();
});

// --- Client-side prediction (local player feels instant; server stays authoritative) --
const predictor = new Predictor();
const STEP_DT = 1 / 30;
let lastAreaId = '';
let lastAuthRev = 0;
setInterval(() => {
  const sample = input.sample();
  if (net.areaId !== lastAreaId) {
    predictor.reset();
    lastAreaId = net.areaId;
  }
  if (net.authRev !== lastAuthRev) {
    predictor.reconcile(net.you.ackSeq, net.you.x, net.you.y, STEP_DT);
    lastAuthRev = net.authRev;
  }
  const area = net.content.area(net.areaId);
  if (area) predictor.setBounds(area.width, area.height);
  const seq = predictor.ready ? predictor.step(sample, STEP_DT) : 0;
  net.sendInput(sample, seq);
}, 1000 * STEP_DT);

// --- Combat input ---------------------------------------------------------------------
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let hasMouse = false;
let selected: AbilityId = 'slash';
const cooldownEnd: Record<string, number> = {};
const slotRects: { ability: AbilityId; x: number; y: number; w: number; h: number }[] = [];
const bagRects: {
  uid: number;
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [];

let entities: EntityState[] = [];
let self: EntityState | undefined;

// Area title card — a brief "now entering" banner shown when the area changes (pairs with the
// renderer's fade-from-black to sell crossing into a new place).
const BANNER_MS = 2200;
let bannerArea = '';
let bannerName = '';
let bannerUntil = 0;
let lastContentRev = 0;

window.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    hasMouse = true;
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

window.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInputEl) return;
  const ability = net.content.abilityOrder().find((id) => net.content.ability(id)?.key === e.key);
  if (ability) {
    selected = ability;
    castAbility(ability);
  } else if (e.key.toLowerCase() === 'e') {
    net.sendInteract(); // server validates NPC proximity
  }
});

function nearbyNpc(): EntityState | undefined {
  if (!self) return undefined;
  return entities.find((e) => e.kind === 'npc' && Math.hypot(e.x - self!.x, e.y - self!.y) < 70);
}

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const bag = bagRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (bag) {
    net.sendEquip(bag.uid);
    return;
  }
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    selected = slot.ability;
    castAbility(slot.ability);
  } else if (e.target === gameCanvas) {
    castAbility(selected);
  }
});

// Touch tap-vs-drag: a drag drives the move joystick (input.ts); a quick stationary tap on the
// world casts the selected ability toward the tapped point. HUD/bag/slot taps are handled here.
const TAP_MAX_MOVE = 18; // px of travel still counted as a tap, not a drag
const TAP_MAX_MS = 260;
let touchStart: { x: number; y: number; t: number } | null = null;

gameCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  const bag = bagRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (bag) {
    net.sendEquip(bag.uid);
    return;
  }
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    selected = slot.ability;
    castAbility(slot.ability);
    return;
  }
  // A world touch: remember it so pointerup can tell a tap (attack) from a drag (move).
  touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});

gameCanvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' || !touchStart) return;
  const moved = Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y);
  const heldMs = performance.now() - touchStart.t;
  touchStart = null;
  if (moved <= TAP_MAX_MOVE && heldMs <= TAP_MAX_MS) {
    // Aim from the player (always screen-center, camera follows) toward the tapped point.
    castAbility(selected, {
      dx: e.clientX - window.innerWidth / 2,
      dy: e.clientY - window.innerHeight / 2,
    });
  }
});

function castAbility(abilityId: AbilityId, aimOverride?: { dx: number; dy: number }): void {
  if (net.you.dead || !self) return;
  const ability = net.content.ability(abilityId);
  if (!ability) return;
  if ((cooldownEnd[abilityId] ?? 0) > performance.now()) return;
  if (net.you.mana < ability.manaCost) return;
  const aim = aimOverride ?? computeAim();
  net.sendCast(abilityId, aim.dx, aim.dy);
  cooldownEnd[abilityId] = performance.now() + ability.cooldownMs;
}

function computeAim(): { dx: number; dy: number } {
  if (!self) return { dx: 1, dy: 0 };
  if (hasMouse) return { dx: mouseX - window.innerWidth / 2, dy: mouseY - window.innerHeight / 2 };
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
// Focusing chat marks it active: the log becomes interactive (scrollbar + wheel) on any device,
// and the wheel listener below routes scrolling to it.
chatInputEl.addEventListener('focus', () => {
  input.clearKeys();
  chatEl.classList.add('chat-active');
});
chatInputEl.addEventListener('blur', () => chatEl.classList.remove('chat-active'));

// While chat is focused, the mouse wheel scrolls the log even if the cursor is over the game.
// preventDefault stops the page/game from also reacting (needs a non-passive listener).
window.addEventListener(
  'wheel',
  (e) => {
    if (document.activeElement !== chatInputEl) return;
    chatLogEl.scrollTop += e.deltaY;
    e.preventDefault();
  },
  { passive: false },
);

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
  // Follow the newest message only if the reader is already at the bottom; if they've scrolled
  // up to read history, leave them there. Check before re-rendering blows the scroll position away.
  const pinned = isPinnedToBottom(
    chatLogEl.scrollTop,
    chatLogEl.scrollHeight,
    chatLogEl.clientHeight,
  );
  chatLogEl.replaceChildren();
  for (const line of net.chat) {
    const div = document.createElement('div');
    const who = document.createElement('span');
    who.className = 'chat-who';
    who.textContent = `${line.from}: `;
    div.append(who, document.createTextNode(line.text));
    chatLogEl.append(div);
  }
  if (pinned) chatLogEl.scrollTop = chatLogEl.scrollHeight;
  renderedChatLen = net.chat.length;
}

// --- Frame loop: drive the Pixi scene + the HUD overlay -------------------------------
app.ticker.add(() => {
  const now = performance.now();
  entities = net.snapshots.sample(now - INTERP_DELAY_MS);
  self = entities.find((e) => e.id === net.selfId);
  let camX = self ? self.x : 0;
  let camY = self ? self.y : 0;

  // Render the local player from the prediction (instant), others from interpolation (smooth).
  if (self && predictor.ready) {
    const predicted = { ...self, x: predictor.x, y: predictor.y };
    entities = entities.map((e) => (e.id === net.selfId ? predicted : e));
    self = predicted;
    camX = predictor.x;
    camY = predictor.y;
  }

  if (net.areaId && net.areaId !== bannerArea) {
    const a = net.content.area(net.areaId);
    if (a) {
      bannerArea = net.areaId;
      bannerName = a.name;
      bannerUntil = now + BANNER_MS;
    }
  }

  // A new content packet (live theme edit or hot reload) — re-skin the current area in place.
  if (net.contentRev !== lastContentRev) {
    renderer.invalidateArea();
    lastContentRev = net.contentRev;
  }

  renderer.update({
    areaId: net.areaId,
    entities,
    selfId: net.selfId,
    fx: net.fx,
    camX,
    camY,
    corruption: net.you.corruption,
  });
  sound.setArea(net.areaId);
  sound.fromFx(net.fx);
  drawHud();

  const area = net.content.area(net.areaId);
  statusEl.textContent = net.connected ? `online as ${name}` : 'reconnecting…';
  popEl.textContent = `${area?.name ?? net.areaId} · players: ${entities.filter((e) => e.kind === 'player').length}`;
  syncChatLog();
});

function drawHud(): void {
  const w = hudCanvas.width;
  const h = hudCanvas.height;
  hud.clearRect(0, 0, w, h);

  const slot = 48;
  const gap = 10;
  const order = net.content.abilityOrder();
  const count = order.length;
  const panelW = count * slot + (count - 1) * gap;
  const panelX = w / 2 - panelW / 2;
  const slotsY = h - 60;
  const now = performance.now();

  hud.font = 'bold 12px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillStyle = '#e7d9b0';
  hud.fillText(`Lv ${net.you.level}`, panelX, h - 98);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.fillText(`${net.you.gold} gold`, panelX + panelW, h - 98);
  hud.textAlign = 'left';

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
  order.forEach((id, i) => {
    const ability = net.content.ability(id);
    if (!ability) return;
    const x = panelX + i * (slot + gap);
    slotRects.push({ ability: id, x, y: slotsY, w: slot, h: slot });

    hud.fillStyle = 'rgba(0,0,0,0.55)';
    hud.fillRect(x, slotsY, slot, slot);
    hud.globalAlpha = net.you.mana < ability.manaCost ? 0.3 : 0.85;
    hud.fillStyle = ability.color;
    hud.fillRect(x + 4, slotsY + 4, slot - 8, slot - 8);
    hud.globalAlpha = 1;

    const remaining = (cooldownEnd[id] ?? 0) - now;
    if (remaining > 0) {
      const frac = Math.min(1, remaining / ability.cooldownMs);
      hud.fillStyle = 'rgba(0,0,0,0.6)';
      hud.fillRect(x, slotsY + slot * (1 - frac), slot, slot * frac);
    }

    hud.strokeStyle = selected === id ? '#c9a24b' : 'rgba(255,255,255,0.25)';
    hud.lineWidth = selected === id ? 3 : 1;
    hud.strokeRect(x, slotsY, slot, slot);

    hud.fillStyle = '#fff';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText(ability.key, x + 4, slotsY + 14);
    hud.textAlign = 'center';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(ability.name, x + slot / 2, slotsY + slot - 5);
  });

  input.hudRect = { x: panelX - 6, y: h - 108, w: panelW + 12, h: 104 };

  drawMinimap(w);
  drawInventory(w);
  drawJoystick();

  const npc = nearbyNpc();
  if (npc && !net.you.dead) {
    const action = npc.npcKind === 'questgiver' ? 'talk to' : 'sell loot to';
    const text = `Press E — ${action} ${npc.name}`;
    hud.font = '14px system-ui, sans-serif';
    hud.textAlign = 'center';
    const tw = hud.measureText(text).width;
    hud.fillStyle = 'rgba(0,0,0,0.6)';
    hud.fillRect(w / 2 - tw / 2 - 12, h - 152, tw + 24, 26);
    hud.fillStyle = '#e7d9b0';
    hud.fillText(text, w / 2, h - 134);
  }

  drawAreaBanner(w, h);

  if (net.you.dead) {
    hud.fillStyle = 'rgba(0,0,0,0.55)';
    hud.fillRect(0, 0, w, h);
    hud.fillStyle = '#e7d9b0';
    hud.font = 'bold 32px system-ui, sans-serif';
    hud.textAlign = 'center';
    const secs = Math.max(0, net.you.respawnIn / 1000).toFixed(1);
    hud.fillText(`You died — respawning in ${secs}s`, w / 2, h / 2);
  }
}

function drawAreaBanner(w: number, h: number): void {
  const now = performance.now();
  const left = bannerUntil - now;
  if (left <= 0 || !bannerName) return;
  // Ease in over the first 400ms, hold, ease out over the last 700ms.
  const elapsed = BANNER_MS - left;
  const alpha = Math.min(1, Math.min(elapsed / 400, left / 700));
  const y = h * 0.22;

  hud.save();
  hud.globalAlpha = alpha;
  hud.textAlign = 'center';
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 34px system-ui, sans-serif';
  hud.fillText(bannerName, w / 2, y);
  const tw = hud.measureText(bannerName).width;
  hud.strokeStyle = 'rgba(201,162,75,0.8)';
  hud.lineWidth = 1.5;
  hud.beginPath();
  hud.moveTo(w / 2 - tw / 2 - 10, y + 10);
  hud.lineTo(w / 2 + tw / 2 + 10, y + 10);
  hud.stroke();
  hud.restore();
}

function prettyItem(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Rarity-prefixed display name for a gear instance (e.g. "Rare Iron Sword"). */
function instLabel(inst: ItemInstance): string {
  return instanceName(inst, net.content.item(inst.baseId)?.name ?? prettyItem(inst.baseId));
}

/** Short stat line for a gear instance: base stat then any rolled affixes. */
function instStat(inst: ItemInstance): string {
  const parts: string[] = [];
  if (inst.power > 0) parts.push(`+${inst.power} pow`);
  if (inst.hp > 0) parts.push(`+${inst.hp} hp`);
  for (const a of inst.affixes) parts.push(affixLabel(a));
  return parts.join(' · ');
}

const MINIMAP_SIZE = 160;

/** Draw the touch move-joystick where the player is dragging (input.ts computes the geometry). */
function drawJoystick(): void {
  const j = input.joystick;
  if (!j.active) return;
  hud.save();
  hud.lineWidth = 2;
  hud.strokeStyle = 'rgba(201,162,75,0.55)';
  hud.beginPath();
  hud.arc(j.baseX, j.baseY, 60, 0, Math.PI * 2);
  hud.stroke();
  hud.fillStyle = 'rgba(201,162,75,0.45)';
  hud.beginPath();
  hud.arc(j.knobX, j.knobY, 22, 0, Math.PI * 2);
  hud.fill();
  hud.restore();
}

function drawMinimap(w: number): void {
  const size = MINIMAP_SIZE;
  const cx = w - size / 2 - 8;
  const cy = 44 + size / 2;
  const radius = size / 2;
  const worldR = 900; // world units shown from edge to edge-ish
  const scale = (radius - 6) / worldR;

  const plot = (dx: number, dy: number, color: string, r: number, square: boolean): void => {
    const dist = Math.hypot(dx, dy);
    let mx = cx + dx * scale;
    let my = cy + dy * scale;
    if (dist > worldR) {
      const a = Math.atan2(dy, dx);
      mx = cx + Math.cos(a) * (radius - 6);
      my = cy + Math.sin(a) * (radius - 6);
    }
    hud.fillStyle = color;
    if (square) {
      hud.fillRect(mx - r, my - r, r * 2, r * 2);
    } else {
      hud.beginPath();
      hud.arc(mx, my, r, 0, Math.PI * 2);
      hud.fill();
    }
  };

  hud.save();
  hud.beginPath();
  hud.arc(cx, cy, radius, 0, Math.PI * 2);
  hud.closePath();
  hud.fillStyle = 'rgba(0,0,0,0.55)';
  hud.fill();
  hud.clip();

  if (self) {
    const area = net.content.area(net.areaId);
    if (area) {
      for (const p of area.portals) {
        plot(
          p.rect.x + p.rect.w / 2 - self.x,
          p.rect.y + p.rect.h / 2 - self.y,
          '#e7d9b0',
          4,
          true,
        );
      }
    }
    for (const e of entities) {
      if (e.id === net.selfId) continue;
      const color =
        e.kind === 'mob'
          ? '#e05555'
          : e.kind === 'player'
            ? '#5fa8e0'
            : e.kind === 'item'
              ? '#f2c14e'
              : '';
      if (color) plot(e.x - self.x, e.y - self.y, color, 3, false);
    }
    hud.fillStyle = '#c9a24b';
    hud.beginPath();
    hud.arc(cx, cy, 3.5, 0, Math.PI * 2);
    hud.fill();
  }
  hud.restore();

  hud.strokeStyle = 'rgba(201,162,75,0.7)';
  hud.lineWidth = 2;
  hud.beginPath();
  hud.arc(cx, cy, radius, 0, Math.PI * 2);
  hud.stroke();
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('N', cx, cy - radius + 12);
}

function drawInventory(w: number): void {
  const pw = 156;
  const px = w - pw - 8;
  let py = 44 + MINIMAP_SIZE + 8;

  // Equipped panel (always shown): weapon, armor (rarity-colored), and total power.
  const eqH = 54;
  hud.fillStyle = 'rgba(0,0,0,0.5)';
  hud.fillRect(px, py, pw, eqH);
  hud.strokeStyle = 'rgba(201,162,75,0.6)';
  hud.lineWidth = 1;
  hud.strokeRect(px, py, pw, eqH);
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Equipped', px + 8, py + 15);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.fillText(
    `+${net.you.power} pow · ${Math.round(net.you.critChance * 100)}% crit`,
    px + pw - 8,
    py + 15,
  );
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  const drawSlot = (label: string, inst: ItemInstance | null, ty: number): void => {
    hud.fillStyle = inst ? RARITY[inst.rarity].color : '#8a8f99';
    hud.fillText(`${label}: ${inst ? instLabel(inst) : '—'}`, px + 8, ty);
  };
  drawSlot('Wpn', net.you.weapon, py + 32);
  drawSlot('Arm', net.you.armor, py + 47);
  py += eqH + 6;

  // Gear panel: unequipped instances, rarity-colored and clickable to equip.
  bagRects.length = 0;
  const gear = net.you.gear;
  if (gear.length > 0) {
    const gh = 24 + gear.length * 16;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(px, py, pw, gh);
    hud.strokeStyle = 'rgba(201,162,75,0.6)';
    hud.strokeRect(px, py, pw, gh);
    hud.fillStyle = '#e7d9b0';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText('Gear — tap to equip', px + 8, py + 16);
    hud.font = '11px system-ui, sans-serif';
    gear.forEach((inst, i) => {
      const ry = py + 24 + i * 16;
      bagRects.push({ uid: inst.uid, x: px, y: ry, w: pw, h: 16 });
      hud.fillStyle = RARITY[inst.rarity].color;
      hud.textAlign = 'left';
      hud.fillText(instLabel(inst), px + 8, ry + 12);
      hud.fillStyle = '#cfd6df';
      hud.textAlign = 'right';
      hud.fillText(instStat(inst), px + pw - 8, ry + 12);
    });
    py += gh + 6;
  }

  // Materials panel: stackable loot sold to the vendor (not equippable).
  const items = Object.entries(net.you.loot).filter(([, n]) => n > 0);
  if (items.length === 0) return;
  const ph = 24 + items.length * 16;
  hud.fillStyle = 'rgba(0,0,0,0.5)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = 'rgba(201,162,75,0.6)';
  hud.strokeRect(px, py, pw, ph);
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Bag', px + 8, py + 16);
  hud.font = '12px system-ui, sans-serif';
  items.forEach(([id, n], i) => {
    const ry = py + 24 + i * 16;
    hud.fillStyle = '#d7dbe3';
    hud.textAlign = 'left';
    hud.fillText(prettyItem(id), px + 8, ry + 12);
    hud.fillStyle = '#f2c14e';
    hud.textAlign = 'right';
    hud.fillText(`${n}`, px + pw - 8, ry + 12);
  });
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
  hud.fillStyle = 'rgba(0,0,0,0.6)';
  hud.fillRect(x, y, width, height);
  hud.fillStyle = color;
  hud.fillRect(x, y, width * Math.max(0, Math.min(1, frac)), height);
  hud.fillStyle = '#fff';
  hud.font = '9px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(label, x + 4, y + height - 1);
}

function inRect(
  px: number,
  py: number,
  r: { x: number; y: number; w: number; h: number },
): boolean {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

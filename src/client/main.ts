import { Application } from 'pixi.js';
import { isPinnedToBottom } from './chat.js';
import {
  affixLabel,
  instanceName,
  isDebuff,
  RARITY,
  type Affix,
  type ItemInstance,
  type Rarity,
} from '../shared/items.js';
import { SLOT_LABELS } from '../shared/equipment.js';
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
// Spellbook entries in the Bag (tap to read/learn) and shop rows (tap to buy) + the sell/close buttons.
const learnRects: { itemId: string; x: number; y: number; w: number; h: number }[] = [];
const shopRects: { itemId: string; x: number; y: number; w: number; h: number }[] = [];
let shopSellRect: { x: number; y: number; w: number; h: number } | null = null;
let shopCloseRect: { x: number; y: number; w: number; h: number } | null = null;
let shopPanelRect: { x: number; y: number; w: number; h: number } | null = null;
// Character panel (paper doll): open with C; each slot box is a click target to unequip.
let charOpen = false;
const charSlotRects: { slot: string; x: number; y: number; w: number; h: number }[] = [];
let charPanelRect: { x: number; y: number; w: number; h: number } | null = null;

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
  if (e.key === 'Escape' && net.shop) {
    net.shop = null; // close the shop
    return;
  }
  const ability = net.content.abilityOrder().find((id) => net.content.ability(id)?.key === e.key);
  if (ability) {
    selected = ability;
    castAbility(ability);
  } else if (e.key.toLowerCase() === 'e') {
    net.sendInteract(); // server validates NPC proximity
  } else if (e.key.toLowerCase() === 'c') {
    charOpen = !charOpen; // toggle the character/equipment panel
  }
});

function nearbyNpc(): EntityState | undefined {
  if (!self) return undefined;
  return entities.find((e) => e.kind === 'npc' && Math.hypot(e.x - self!.x, e.y - self!.y) < 70);
}

window.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  // An open shop captures clicks (buy / sell / close) and never falls through to a cast.
  if (net.shop && handleShopClick(e.clientX, e.clientY)) return;
  // Clicks on the open character panel unequip a slot and never fall through to a cast.
  if (charOpen && charPanelRect && inRect(e.clientX, e.clientY, charPanelRect)) {
    const cs = charSlotRects.find((c) => inRect(e.clientX, e.clientY, c));
    if (cs) net.sendUnequip(cs.slot);
    return;
  }
  const book = learnRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (book) {
    net.sendLearn(book.itemId);
    return;
  }
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

/** Route a click inside the open shop panel. Returns true if it was consumed. */
function handleShopClick(x: number, y: number): boolean {
  if (shopCloseRect && inRect(x, y, shopCloseRect)) {
    net.shop = null;
    return true;
  }
  if (shopSellRect && inRect(x, y, shopSellRect)) {
    net.sendSell();
    return true;
  }
  const row = shopRects.find((s) => inRect(x, y, s));
  if (row) {
    net.sendBuy(row.itemId);
    return true;
  }
  // Clicks anywhere inside the panel are swallowed so they don't cast through it.
  return shopPanelRect ? inRect(x, y, shopPanelRect) : false;
}

// Touch tap-vs-drag: a drag drives the move joystick (input.ts); a quick stationary tap on the
// world casts the selected ability toward the tapped point. HUD/bag/slot taps are handled here.
const TAP_MAX_MOVE = 18; // px of travel still counted as a tap, not a drag
const TAP_MAX_MS = 260;
let touchStart: { x: number; y: number; t: number } | null = null;

gameCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (net.shop && handleShopClick(e.clientX, e.clientY)) return;
  if (charOpen && charPanelRect && inRect(e.clientX, e.clientY, charPanelRect)) {
    const cs = charSlotRects.find((c) => inRect(e.clientX, e.clientY, c));
    if (cs) net.sendUnequip(cs.slot);
    return;
  }
  const book = learnRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (book) {
    net.sendLearn(book.itemId);
    return;
  }
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
  // You can only cast spells you have learned (from a spellbook) — mirrors the server's gate.
  if (!(abilityId in net.you.known)) return;
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
// Wrapped so a single transient render error can never freeze the whole client (it logs, throttled,
// and the next frame keeps going) — a render hiccup should degrade gracefully, not brick the game.
let lastFrameError = 0;
app.ticker.add(() => {
  try {
    frame();
  } catch (err) {
    if (performance.now() - lastFrameError > 2000) {
      lastFrameError = performance.now();
      console.error('[frame] render error (continuing):', err);
    }
  }
});

function frame(): void {
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
  if (charOpen) drawCharacterPanel();
  if (net.shop) drawShopPanel();
  else {
    shopPanelRect = null;
    shopSellRect = null;
    shopCloseRect = null;
    shopRects.length = 0;
  }
  if (!net.connected) drawReconnect();

  const area = net.content.area(net.areaId);
  statusEl.textContent = net.connected ? `online as ${name}` : 'reconnecting…';
  popEl.textContent = `${area?.name ?? net.areaId} · players: ${entities.filter((e) => e.kind === 'player').length}`;
  syncChatLog();
}

/** Trim text with an ellipsis to fit a max pixel width (font must be set before calling). */
function fitText(text: string, maxW: number): string {
  if (hud.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && hud.measureText(t + '…').width > maxW) t = t.slice(0, -1);
  return t + '…';
}

/** Draw one equipment slot box (and register it as an unequip click target). */
function drawCharSlot(slot: string, bx: number, by: number, bw: number, bh: number): void {
  const inst = net.you.equipment[slot] ?? null;
  hud.fillStyle = 'rgba(0,0,0,0.45)';
  hud.fillRect(bx, by, bw, bh);
  hud.lineWidth = inst ? 2 : 1;
  hud.strokeStyle = inst ? rarityColor(inst.rarity) : 'rgba(201,162,75,0.3)';
  hud.strokeRect(bx, by, bw, bh);
  hud.textAlign = 'left';
  hud.fillStyle = '#7d828c';
  hud.font = '9px system-ui, sans-serif';
  hud.fillText(SLOT_LABELS[slot as keyof typeof SLOT_LABELS].toUpperCase(), bx + 6, by + 11);
  if (inst) {
    hud.fillStyle = rarityColor(inst.rarity);
    hud.font = 'bold 11px system-ui, sans-serif';
    hud.fillText(fitText(instLabel(inst), bw - 12), bx + 6, by + 25);
    hud.fillStyle = '#9fb0c0';
    hud.font = '9px system-ui, sans-serif';
    const stats = instStatSegments(inst)
      .map((s) => s.text)
      .join('  ');
    hud.fillText(fitText(stats, bw - 12), bx + 6, by + 37);
  } else {
    hud.fillStyle = '#565b64';
    hud.font = 'italic 10px system-ui, sans-serif';
    hud.fillText('empty', bx + 6, by + 27);
  }
  charSlotRects.push({ slot, x: bx, y: by, w: bw, h: bh });
}

/** The Diablo-style character / equipment panel (toggled with C). Tap a slot to unequip. */
function drawCharacterPanel(): void {
  charSlotRects.length = 0;
  const pw = 384;
  const ph = 430;
  const px = 20;
  const py = 56;
  charPanelRect = { x: px, y: py, w: pw, h: ph };

  hud.fillStyle = 'rgba(8,9,13,0.92)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Character', px + 14, py + 22);
  hud.textAlign = 'right';
  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.fillText('C to close · tap a slot to remove', px + pw - 14, py + 22);

  // Totals.
  hud.textAlign = 'left';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillStyle = '#f2c14e';
  hud.fillText(
    `Power ${net.you.power}    Crit ${Math.round(net.you.critChance * 100)}%    Max HP ${net.you.maxHp}`,
    px + 14,
    py + 42,
  );

  // Two columns of slot boxes + main hand spanning the bottom.
  const left: string[] = ['head', 'shoulders', 'chest', 'hands', 'legs', 'feet'];
  const right: string[] = ['neck', 'waist', 'ring1', 'ring2', 'trinket', 'offhand'];
  const bw = (pw - 14 * 2 - 12) / 2;
  const bh = 44;
  const gap = 7;
  const sy = py + 54;
  left.forEach((s, i) => drawCharSlot(s, px + 14, sy + i * (bh + gap), bw, bh));
  right.forEach((s, i) => drawCharSlot(s, px + 14 + bw + 12, sy + i * (bh + gap), bw, bh));
  const lastY = sy + 6 * (bh + gap);
  drawCharSlot('mainhand', px + 14, lastY, pw - 28, bh);
}

/** The vendor shop window (opened by E on a vendor). Tap a row to buy; a button sells the bag. */
function drawShopPanel(): void {
  const shop = net.shop;
  if (!shop) return;
  shopRects.length = 0;
  const pw = 320;
  const rowH = 30;
  const headerH = 58;
  const footerH = 40;
  const ph = headerH + shop.stock.length * rowH + footerH;
  const px = hudCanvas.width / 2 - pw / 2;
  const py = hudCanvas.height / 2 - ph / 2;
  shopPanelRect = { x: px, y: py, w: pw, h: ph };

  hud.fillStyle = 'rgba(8,9,13,0.94)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(shop.vendor, px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.fillText(`${net.you.gold} gold`, px + pw - 14, py + 24);

  // Close button (top-right X).
  shopCloseRect = { x: px + pw - 26, y: py + 6, w: 20, h: 20 };
  hud.fillStyle = '#9aa3b2';
  hud.font = 'bold 14px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('✕', shopCloseRect.x + 10, shopCloseRect.y + 15);

  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Tap an item to buy · Esc to close', px + 14, py + 44);

  shop.stock.forEach((entry, i) => {
    const ry = py + headerH + i * rowH;
    const def = net.content.item(entry.itemId);
    const afford = net.you.gold >= entry.price;
    shopRects.push({ itemId: entry.itemId, x: px + 8, y: ry, w: pw - 16, h: rowH - 4 });
    hud.fillStyle = afford ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.2)';
    hud.fillRect(px + 8, ry, pw - 16, rowH - 4);
    hud.strokeStyle = 'rgba(201,162,75,0.25)';
    hud.lineWidth = 1;
    hud.strokeRect(px + 8, ry, pw - 16, rowH - 4);
    hud.textAlign = 'left';
    hud.fillStyle = def?.color ?? '#d7dbe3';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.fillText(fitText(def?.name ?? prettyItem(entry.itemId), pw - 90), px + 16, ry + 17);
    hud.textAlign = 'right';
    hud.fillStyle = afford ? '#f2c14e' : '#a05050';
    hud.font = '12px system-ui, sans-serif';
    hud.fillText(`${entry.price}g`, px + pw - 16, ry + 17);
  });

  // Sell-all button along the bottom (the old E-to-sell behavior, now explicit).
  shopSellRect = { x: px + 14, y: py + ph - 32, w: pw - 28, h: 24 };
  hud.fillStyle = 'rgba(120,60,60,0.5)';
  hud.fillRect(shopSellRect.x, shopSellRect.y, shopSellRect.w, shopSellRect.h);
  hud.strokeStyle = 'rgba(201,162,75,0.5)';
  hud.strokeRect(shopSellRect.x, shopSellRect.y, shopSellRect.w, shopSellRect.h);
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillText('Sell all loot & spare gear', px + pw / 2, shopSellRect.y + 16);
}

/** Dim the scene and show an animated "Reconnecting…" overlay while the socket is down. */
function drawReconnect(): void {
  const w = hudCanvas.width;
  const h = hudCanvas.height;
  hud.fillStyle = 'rgba(0,0,0,0.55)';
  hud.fillRect(0, 0, w, h);
  hud.textAlign = 'center';
  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 22px system-ui, sans-serif';
  const dots = '.'.repeat(1 + (Math.floor(performance.now() / 400) % 3));
  hud.fillText(`Reconnecting${dots}`, w / 2, h / 2 - 4);
  hud.font = '13px system-ui, sans-serif';
  hud.fillStyle = '#9aa3b2';
  hud.fillText('Lost connection to the server — retrying every second', w / 2, h / 2 + 22);
}

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
    const rank = net.you.known[id]; // undefined = not yet learned
    const learned = rank !== undefined;
    // Only learned spells are click-to-cast targets; locked slots show how to get them.
    if (learned) slotRects.push({ ability: id, x, y: slotsY, w: slot, h: slot });

    hud.fillStyle = 'rgba(0,0,0,0.55)';
    hud.fillRect(x, slotsY, slot, slot);
    hud.globalAlpha = !learned ? 0.18 : net.you.mana < ability.manaCost ? 0.3 : 0.85;
    hud.fillStyle = ability.color;
    hud.fillRect(x + 4, slotsY + 4, slot - 8, slot - 8);
    hud.globalAlpha = 1;

    if (learned) {
      const remaining = (cooldownEnd[id] ?? 0) - now;
      if (remaining > 0) {
        const frac = Math.min(1, remaining / ability.cooldownMs);
        hud.fillStyle = 'rgba(0,0,0,0.6)';
        hud.fillRect(x, slotsY + slot * (1 - frac), slot, slot * frac);
      }
    }

    hud.strokeStyle = selected === id && learned ? '#c9a24b' : 'rgba(255,255,255,0.25)';
    hud.lineWidth = selected === id && learned ? 3 : 1;
    hud.strokeRect(x, slotsY, slot, slot);

    if (learned) {
      hud.fillStyle = '#fff';
      hud.font = 'bold 12px system-ui, sans-serif';
      hud.textAlign = 'left';
      hud.fillText(ability.key, x + 4, slotsY + 14);
      // Rank pips for a ranked-up spell (the Diablo 1 duplicate-tome reward).
      if (rank > 1) {
        hud.fillStyle = '#f2c14e';
        hud.font = 'bold 10px system-ui, sans-serif';
        hud.textAlign = 'right';
        hud.fillText(`R${rank}`, x + slot - 4, slotsY + 14);
      }
      hud.textAlign = 'center';
      hud.font = '10px system-ui, sans-serif';
      hud.fillStyle = '#fff';
      hud.fillText(ability.name, x + slot / 2, slotsY + slot - 5);
    } else {
      // Locked: a padlock glyph + the spell name dimmed, so the slot reads as "find this book".
      hud.fillStyle = '#9aa3b2';
      hud.font = 'bold 16px system-ui, sans-serif';
      hud.textAlign = 'center';
      hud.fillText('🔒', x + slot / 2, slotsY + slot / 2 + 2);
      hud.font = '10px system-ui, sans-serif';
      hud.fillStyle = '#6b7280';
      hud.fillText(ability.name, x + slot / 2, slotsY + slot - 5);
    }
  });

  input.hudRect = { x: panelX - 6, y: h - 108, w: panelW + 12, h: 104 };

  drawMinimap(w);
  drawInventory(w);
  drawJoystick();

  const npc = nearbyNpc();
  if (npc && !net.you.dead && !net.shop) {
    const action = npc.npcKind === 'questgiver' ? 'talk to' : 'shop with';
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

/** Rarity color, never throwing on an unknown rarity (e.g. an older client missing a new tier). */
function rarityColor(rarity: string): string {
  return RARITY[rarity as Rarity]?.color ?? '#cccccc';
}

/** Rarity-prefixed display name for a gear instance (e.g. "Rare Iron Sword"). */
function instLabel(inst: ItemInstance): string {
  return instanceName(inst, net.content.item(inst.baseId)?.name ?? prettyItem(inst.baseId));
}

/** Stat segments for a gear instance: base stat(s) then affixes, flagging debuffs for red text. */
function instStatSegments(inst: ItemInstance): { text: string; debuff: boolean }[] {
  const segs: { text: string; debuff: boolean }[] = [];
  if (inst.power > 0) segs.push({ text: `+${inst.power} pow`, debuff: false });
  if (inst.hp > 0) segs.push({ text: `+${inst.hp} hp`, debuff: false });
  for (const a of inst.affixes) segs.push({ text: affixLabel(a as Affix), debuff: isDebuff(a) });
  return segs;
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

  // Compact stat panel (always shown): totals + a hint to open the full character screen.
  const eqH = 38;
  hud.fillStyle = 'rgba(0,0,0,0.5)';
  hud.fillRect(px, py, pw, eqH);
  hud.strokeStyle = 'rgba(201,162,75,0.6)';
  hud.lineWidth = 1;
  hud.strokeRect(px, py, pw, eqH);
  hud.fillStyle = '#f2c14e';
  hud.font = 'bold 12px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText(
    `+${net.you.power} pow · ${Math.round(net.you.critChance * 100)}% crit`,
    px + 8,
    py + 15,
  );
  hud.fillStyle = '#9aa3b2';
  hud.font = '10px system-ui, sans-serif';
  hud.fillText('Press C — character & equipment', px + 8, py + 30);
  py += eqH + 6;

  // Gear panel: unequipped instances, two lines each (name, then stats) so long affix lists never
  // overlap the name. Rarity-colored, clickable to equip; debuff affixes shown in red.
  bagRects.length = 0;
  const gear = net.you.gear;
  if (gear.length > 0) {
    const rowH = 28;
    const gh = 22 + gear.length * rowH;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(px, py, pw, gh);
    hud.strokeStyle = 'rgba(201,162,75,0.6)';
    hud.strokeRect(px, py, pw, gh);
    hud.fillStyle = '#e7d9b0';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText('Gear — tap to equip', px + 8, py + 15);
    gear.forEach((inst, i) => {
      const ry = py + 22 + i * rowH;
      bagRects.push({ uid: inst.uid, x: px, y: ry, w: pw, h: rowH });
      // Line 1: the item name, in its rarity color.
      hud.font = 'bold 11px system-ui, sans-serif';
      hud.fillStyle = rarityColor(inst.rarity);
      hud.textAlign = 'left';
      hud.fillText(instLabel(inst), px + 8, ry + 11);
      // Line 2: stat segments laid out left-to-right (debuffs in red), no overlap with the name.
      hud.font = '10px system-ui, sans-serif';
      let sx = px + 8;
      for (const seg of instStatSegments(inst)) {
        hud.fillStyle = seg.debuff ? '#ff6b6b' : '#9fb0c0';
        hud.fillText(seg.text, sx, ry + 23);
        sx += hud.measureText(seg.text).width + 7;
      }
    });
    py += gh + 6;
  }

  // Spellbooks panel: tomes in the bag, tappable to read (learn the spell or rank it up).
  learnRects.length = 0;
  const held = Object.entries(net.you.loot).filter(([, n]) => n > 0);
  const books = held.filter(([id]) => net.content.item(id)?.kind === 'spellbook');
  if (books.length > 0) {
    const bh = 24 + books.length * 18;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(px, py, pw, bh);
    hud.strokeStyle = 'rgba(124,252,124,0.5)';
    hud.strokeRect(px, py, pw, bh);
    hud.fillStyle = '#bfe8bf';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText('Spellbooks — tap to read', px + 8, py + 16);
    books.forEach(([id, n], i) => {
      const ry = py + 22 + i * 18;
      learnRects.push({ itemId: id, x: px, y: ry, w: pw, h: 18 });
      const teaches = net.content.item(id)?.teaches;
      const known = teaches && teaches in net.you.known;
      hud.font = '11px system-ui, sans-serif';
      hud.fillStyle = known ? '#8a8f99' : '#d7dbe3'; // dim a book whose spell you already know
      hud.textAlign = 'left';
      hud.fillText(fitText(prettyItem(id) + (n > 1 ? ` ×${n}` : ''), pw - 16), px + 8, ry + 13);
    });
    py += bh + 6;
  }

  // Materials panel: stackable loot sold to the vendor (not equippable, not a spellbook).
  const items = held.filter(([id]) => net.content.item(id)?.kind !== 'spellbook');
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

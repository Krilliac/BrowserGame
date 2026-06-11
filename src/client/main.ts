import { Application } from 'pixi.js';
import { isPinnedToBottom } from './chat.js';
import {
  affixLabel,
  instanceTitle,
  isDebuff,
  RARITY,
  type Affix,
  type ItemInstance,
  type Rarity,
} from '../shared/items.js';
import { SLOT_LABELS } from '../shared/equipment.js';
import { drawPartyPanel, type PartyButton } from './party-panel.js';
import { drawSocialPanel, type SocialButton } from './social-panel.js';
import { drawGamblePanel, type GambleButton } from './gamble-panel.js';
import { drawWaypointPanel, type WaypointButton } from './waypoint-panel.js';
import { drawArtificerPanel, type ArtificerButton } from './artificer-panel.js';
import { drawInventoryPanel, type InventoryButton } from './inventory-panel.js';
import { INTERP_DELAY_MS } from './interp.js';
import { Net } from './net.js';
import { PixiRenderer } from './pixi-renderer.js';
import { Sound } from './sound.js';
import { Predictor } from './predictor.js';
import { MOB_RADIUS, type AbilityId } from '../shared/combat.js';
import type { EntityState, InputState } from '../shared/protocol.js';

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
  const sample = moveSample();
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

  // Auto-attack the selected target with your primary attack when it's in range. A melee primary
  // (the default Slash) swings up close; a ranged/spell primary fires from its own, longer range —
  // so picking a ranged spell makes you attack from a distance instead of walking into melee.
  const tgt = targetMob();
  if (tgt && self) {
    const ability = net.content.ability(autoAttackAbility());
    if (ability && Math.hypot(tgt.x - self.x, tgt.y - self.y) <= ability.range) {
      castAbility(ability.id as AbilityId);
    }
  }
}, 1000 * STEP_DT);

// --- Combat input ---------------------------------------------------------------------
let mouseX = window.innerWidth / 2;
let mouseY = window.innerHeight / 2;
let selected: AbilityId = 'slash';
const cooldownEnd: Record<string, number> = {};

// --- Click-to-move + targeting --------------------------------------------------------
// Left-click the ground to walk there; left-click a mob to select it (chase + auto-attack).
// Movement is synthesized client-side into the same 8-direction InputState the server already
// understands, so no protocol/server change is needed — prediction & reconciliation are untouched.
let moveTarget: { x: number; y: number } | null = null;
let targetId: number | null = null;
const PICK_RADIUS = 26; // world px of slop around a mob when picking a click target
const MOVE_STOP_RADIUS = 8; // stop this close to a ground move-target (avoids 8-dir jitter)

// --- Scrolling 6-slot hotbar ----------------------------------------------------------
// The bar is a sliding window over your known spells: keys 1-6 cast the spells currently shown.
// Scroll the wheel over the bar to rotate ALL spells through it at once (so you can line up your
// rotation in the 1-6 positions). Scrolling is locked for COMBAT_LOCK_MS after any damage dealt
// or taken, so you can't re-plan mid-fight.
const HOTBAR_SIZE = 6;
let hotbarOffset = 0; // rotation of the known-spell window across the 6 slots
const COMBAT_LOCK_MS = 4000;
let lastCombatT = -Infinity; // performance.now() of the last damage dealt/taken
let lastKnownHp = 0; // tracks net.you.hp to detect "took damage" (enters combat)
// Whole-bar bounds, refreshed each draw, so the wheel handler knows when the cursor is over it.
let hotbarRect: { x: number; y: number; w: number; h: number } | null = null;

const slotRects: {
  slot: number;
  ability: AbilityId | null;
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [];
const bagRects: {
  uid: number;
  x: number;
  y: number;
  w: number;
  h: number;
}[] = [];
// Spellbook entries in the Bag (tap to read/learn) and shop rows (tap to buy) + the sell/close buttons.
const learnRects: { itemId: string; x: number; y: number; w: number; h: number }[] = [];
// Gem entries in the Bag (tap to socket into equipped gear).
const socketRects: { itemId: string; x: number; y: number; w: number; h: number }[] = [];
const shopRects: { itemId: string; x: number; y: number; w: number; h: number }[] = [];
let shopSellRect: { x: number; y: number; w: number; h: number } | null = null;
let shopCloseRect: { x: number; y: number; w: number; h: number } | null = null;
let shopPanelRect: { x: number; y: number; w: number; h: number } | null = null;
// Character panel (paper doll): open with C; each slot box is a click target to unequip.
let charOpen = false;
const charSlotRects: { slot: string; x: number; y: number; w: number; h: number }[] = [];
let charPanelRect: { x: number; y: number; w: number; h: number } | null = null;

// Quest log panel: open with L; available quests have an "Accept" click target.
let questOpen = false;
const questAcceptRects: { id: string; x: number; y: number; w: number; h: number }[] = [];
let questPanelRect: { x: number; y: number; w: number; h: number } | null = null;

// Party panel (P) and friends panel (F): the renderer modules return their own clickable buttons.
let partyOpen = false;
let socialOpen = false;
let partyButtons: PartyButton[] = [];
let socialButtons: SocialButton[] = [];
let gambleButtons: GambleButton[] = [];
// Waypoint / fast-travel panel: open with M.
let waypointOpen = false;
let waypointButtons: WaypointButton[] = [];
let artificerButtons: ArtificerButton[] = [];
// Inventory panel (I): the full bag of unequipped gear (up to 30), tap to equip.
let inventoryOpen = false;
let inventoryButtons: InventoryButton[] = [];

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
    mouseX = e.clientX;
    mouseY = e.clientY;
  }
});

// Scroll the wheel over the hotbar to rotate every spell through it at once (out of combat only).
window.addEventListener(
  'wheel',
  (e) => {
    if (!hotbarRect || !inRect(mouseX, mouseY, hotbarRect)) return;
    e.preventDefault();
    scrollHotbar(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);

window.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInputEl) return;
  if (e.key === 'Escape' && net.shop) {
    net.shop = null; // close the shop
    return;
  }
  if (e.key === 'Escape' && net.gamble) {
    net.gamble = null;
    return;
  }
  if (e.key === 'Escape' && net.artificer) {
    net.artificer = null;
    return;
  }
  if (e.key === 'Escape' && questOpen) {
    questOpen = false;
    return;
  }
  if (e.key === 'Escape' && (partyOpen || socialOpen || waypointOpen || inventoryOpen)) {
    partyOpen = false;
    socialOpen = false;
    waypointOpen = false;
    inventoryOpen = false;
    return;
  }
  const slotIdx = '123456'.indexOf(e.key);
  if (slotIdx >= 0) {
    const ab = displayedAbility(slotIdx);
    if (ab) {
      selected = ab;
      castAbility(ab);
    }
  } else if (e.key.toLowerCase() === 'e') {
    net.sendInteract(); // server validates NPC proximity
  } else if (e.key.toLowerCase() === 'c') {
    charOpen = !charOpen; // toggle the character/equipment panel
  } else if (e.key.toLowerCase() === 'l') {
    questOpen = !questOpen; // toggle the quest log
  } else if (e.key.toLowerCase() === 'p') {
    partyOpen = !partyOpen; // toggle the party panel
  } else if (e.key.toLowerCase() === 'f') {
    socialOpen = !socialOpen; // toggle the friends panel
  } else if (e.key.toLowerCase() === 'm') {
    waypointOpen = !waypointOpen; // toggle the waypoint / fast-travel map
  } else if (e.key.toLowerCase() === 'i') {
    inventoryOpen = !inventoryOpen; // toggle the full inventory
  } else if (e.key === '=' || e.key === '+') {
    renderer.adjustZoom(0.1); // zoom the camera in (RS/Diablo-style)
  } else if (e.key === '-' || e.key === '_') {
    renderer.adjustZoom(-0.1); // zoom the camera out
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
  if (net.gamble && handleGambleClick(e.clientX, e.clientY)) return;
  if (net.artificer && handleArtificerClick(e.clientX, e.clientY)) return;
  if (inventoryOpen && handleInventoryClick(e.clientX, e.clientY)) return;
  // The quest log captures clicks (accept buttons / panel body) and never falls through to a cast.
  if (questOpen && handleQuestClick(e.clientX, e.clientY)) return;
  if (partyOpen && handlePartyClick(e.clientX, e.clientY)) return;
  if (socialOpen && handleSocialClick(e.clientX, e.clientY)) return;
  if (waypointOpen && handleWaypointClick(e.clientX, e.clientY)) return;
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
  const gem = socketRects.find((g) => inRect(e.clientX, e.clientY, g));
  if (gem) {
    net.sendSocketGem(gem.itemId);
    return;
  }
  const bag = bagRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (bag) {
    net.sendEquip(bag.uid);
    return;
  }
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    if (slot.ability) {
      selected = slot.ability;
      castAbility(slot.ability);
    }
  } else if (e.target === gameCanvas) {
    worldClick(e.clientX, e.clientY);
  }
});

/** The nearest other player entity to the local player (for "invite nearest"), or undefined. */
function nearestPlayer(): EntityState | undefined {
  if (!self) return undefined;
  let best: EntityState | undefined;
  let bestDist = Infinity;
  for (const e of entities) {
    if (e.kind !== 'player' || e.id === net.selfId) continue;
    const d = Math.hypot(e.x - self.x, e.y - self.y);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/** Route a click inside the open party panel. Returns true if it was consumed. */
function handlePartyClick(x: number, y: number): boolean {
  const btn = partyButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'invite-nearest') {
    const target = nearestPlayer();
    if (target) net.sendPartyInvite(target.name);
  } else if (btn.action === 'accept') {
    net.sendPartyAccept();
  } else if (btn.action === 'decline') {
    net.sendPartyDecline();
  } else if (btn.action === 'leave') {
    net.sendPartyLeave();
  }
  return true;
}

/** Route a click inside the open friends panel. Returns true if it was consumed. */
function handleSocialClick(x: number, y: number): boolean {
  const btn = socialButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'remove') {
    net.sendFriendRemove(btn.name);
  } else if (btn.action === 'whisper') {
    // Prefill the chat box with a whisper command for the player to finish typing.
    chatInputEl.value = `/w ${btn.name} `;
    chatInputEl.focus();
  }
  return true;
}

/** Route a click inside the open quest log. Returns true if it was consumed. */
function handleQuestClick(x: number, y: number): boolean {
  const accept = questAcceptRects.find((r) => inRect(x, y, r));
  if (accept) {
    net.sendAcceptQuest(accept.id);
    return true;
  }
  return questPanelRect ? inRect(x, y, questPanelRect) : false;
}

/** Route a click inside the open waypoint panel. Returns true if it was consumed. */
function handleWaypointClick(x: number, y: number): boolean {
  const btn = waypointButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'close') waypointOpen = false;
  else if (btn.action === 'travel' && btn.areaId) {
    net.sendWaypoint(btn.areaId);
    waypointOpen = false;
  }
  return true;
}

/** Route a click inside the open inventory panel. Returns true if it was consumed. */
function handleInventoryClick(x: number, y: number): boolean {
  const btn = inventoryButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'close') inventoryOpen = false;
  else if (btn.action === 'equip' && btn.uid !== undefined) net.sendEquip(btn.uid);
  return true;
}

/** Route a click inside the open Artificer panel. Returns true if it was consumed. */
function handleArtificerClick(x: number, y: number): boolean {
  const btn = artificerButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'close') net.artificer = null;
  else if (btn.action === 'reroll' && btn.uid !== undefined) net.sendEnchant(btn.uid);
  else if (btn.action === 'combine') net.sendCombineGems();
  else if (btn.action === 'unsocket' && btn.slot && btn.index !== undefined) {
    net.sendUnsocketGem(btn.slot, btn.index);
  }
  return true;
}

/** Route a click inside the open gambling panel. Returns true if it was consumed. */
function handleGambleClick(x: number, y: number): boolean {
  const btn = gambleButtons.find((b) => inRect(x, y, b));
  if (!btn) return false;
  if (btn.action === 'close') net.gamble = null;
  else if (btn.action === 'gamble' && btn.slot) net.sendGamble(btn.slot);
  return true;
}

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

// Touch: a quick stationary tap on the world walks there (or selects a tapped mob), mirroring a
// desktop left-click. HUD/bag/slot taps are handled here; a tap on a hotbar slot casts that spell.
const TAP_MAX_MOVE = 18; // px of travel still counted as a tap, not a drag
const TAP_MAX_MS = 260;
let touchStart: { x: number; y: number; t: number } | null = null;

gameCanvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse') return;
  if (net.shop && handleShopClick(e.clientX, e.clientY)) return;
  if (net.gamble && handleGambleClick(e.clientX, e.clientY)) return;
  if (net.artificer && handleArtificerClick(e.clientX, e.clientY)) return;
  if (inventoryOpen && handleInventoryClick(e.clientX, e.clientY)) return;
  if (questOpen && handleQuestClick(e.clientX, e.clientY)) return;
  if (partyOpen && handlePartyClick(e.clientX, e.clientY)) return;
  if (socialOpen && handleSocialClick(e.clientX, e.clientY)) return;
  if (waypointOpen && handleWaypointClick(e.clientX, e.clientY)) return;
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
  const gem = socketRects.find((g) => inRect(e.clientX, e.clientY, g));
  if (gem) {
    net.sendSocketGem(gem.itemId);
    return;
  }
  const bag = bagRects.find((b) => inRect(e.clientX, e.clientY, b));
  if (bag) {
    net.sendEquip(bag.uid);
    return;
  }
  const slot = slotRects.find((s) => inRect(e.clientX, e.clientY, s));
  if (slot) {
    if (slot.ability) {
      selected = slot.ability;
      castAbility(slot.ability);
    }
    return;
  }
  // A world touch: remember it so pointerup can tell a tap (move/select) from a drag.
  touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});

gameCanvas.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse' || !touchStart) return;
  const moved = Math.hypot(e.clientX - touchStart.x, e.clientY - touchStart.y);
  const heldMs = performance.now() - touchStart.t;
  touchStart = null;
  if (moved <= TAP_MAX_MOVE && heldMs <= TAP_MAX_MS) {
    worldClick(e.clientX, e.clientY);
  }
});

/**
 * Intercept social slash-commands typed in chat and turn them into typed protocol messages.
 * Returns true if the text was a social command (so it isn't also sent as public chat).
 *   /invite <name> · /party leave (or /pleave) · /friend <name> · /unfriend <name> · /w|/whisper <name> <msg>
 */
function handleSocialCommand(text: string): boolean {
  const m = /^\/(\w+)\s*(.*)$/.exec(text);
  if (!m) return false;
  const cmd = m[1]!.toLowerCase();
  const rest = m[2]!.trim();
  switch (cmd) {
    case 'invite':
      if (rest) net.sendPartyInvite(rest);
      return true;
    case 'pleave':
      net.sendPartyLeave();
      return true;
    case 'party':
      if (rest.toLowerCase() === 'leave') net.sendPartyLeave();
      return true;
    case 'friend':
    case 'addfriend':
      if (rest) net.sendFriendAdd(rest);
      return true;
    case 'unfriend':
    case 'removefriend':
      if (rest) net.sendFriendRemove(rest);
      return true;
    case 'w':
    case 'whisper':
    case 'tell': {
      const sp = rest.indexOf(' ');
      if (sp > 0) net.sendWhisper(rest.slice(0, sp), rest.slice(sp + 1));
      return true;
    }
    default:
      return false; // not a social command — let it through as normal chat/other commands
  }
}

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
  // Casting an offensive ability counts as "in combat" (locks hotbar remapping). Heals don't.
  if (ability.kind !== 'heal') lastCombatT = performance.now();
}

/**
 * The ability used to auto-attack the selected target: your `selected` damaging spell if you know it
 * (so a ranged/projectile pick is fired from range), otherwise the free basic Slash. Heals/buffs are
 * never an auto-attack, so selecting one leaves Slash as the fallback.
 */
function autoAttackAbility(): AbilityId {
  if (selected in net.you.known) {
    const a = net.content.ability(selected);
    if (a && a.kind !== 'heal') return selected;
  }
  return 'slash';
}

// Spells auto-aim at the selected target (no manual aiming): the chosen mob, else the nearest
// mob, else straight ahead. Returns a direction vector from the player.
function computeAim(): { dx: number; dy: number } {
  if (!self) return { dx: 1, dy: 0 };
  const t = targetMob() ?? nearestMob();
  if (t) return { dx: t.x - self.x, dy: t.y - self.y };
  return { dx: Math.cos(self.facing), dy: Math.sin(self.facing) };
}

/** The currently selected mob entity, or undefined (clears a stale target id as a side effect). */
function targetMob(): EntityState | undefined {
  if (targetId === null) return undefined;
  const m = entities.find((e) => e.id === targetId && e.kind === 'mob');
  if (!m) {
    targetId = null;
    return undefined;
  }
  return m;
}

/** Pick the mob nearest a world-space point, within a generous slop radius, or undefined. */
function pickMob(wx: number, wy: number): EntityState | undefined {
  let best: EntityState | undefined;
  let bestD = PICK_RADIUS + MOB_RADIUS;
  for (const e of entities) {
    if (e.kind !== 'mob') continue;
    const d = Math.hypot(e.x - wx, e.y - wy);
    if (d < bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/** A left-click / tap on the world: select a mob under the cursor, else walk to the point. */
function worldClick(screenX: number, screenY: number): void {
  if (net.you.dead) return;
  const w = renderer.screenToWorld(screenX, screenY);
  const mob = pickMob(w.x, w.y);
  if (mob) {
    targetId = mob.id; // select + chase (moveSample steers toward it, auto-attack engages)
    moveTarget = null; // drop any pending ground move so we don't walk off when the mob dies
  } else {
    targetId = null;
    moveTarget = { x: w.x, y: w.y };
  }
}

const DIR_THRESHOLD = Math.cos((Math.PI * 3) / 8); // cos(67.5°): clean 8-way sectors

/** Quantize a heading (radians) into the boolean 8-direction InputState the server understands. */
function dirToInput(angle: number): InputState {
  const cx = Math.cos(angle);
  const cy = Math.sin(angle);
  return {
    right: cx > DIR_THRESHOLD,
    left: cx < -DIR_THRESHOLD,
    down: cy > DIR_THRESHOLD,
    up: cy < -DIR_THRESHOLD,
  };
}

/**
 * Synthesize this tick's movement from the click-to-move target: chase the selected mob (stopping
 * just inside melee reach) or walk toward a ground point (stopping on arrival). Idle otherwise.
 */
function moveSample(): InputState {
  const idle: InputState = { up: false, down: false, left: false, right: false };
  if (net.you.dead) {
    moveTarget = null;
    return idle;
  }
  const px = predictor.ready ? predictor.x : net.you.x;
  const py = predictor.ready ? predictor.y : net.you.y;
  const mob = targetMob();
  let tx: number;
  let ty: number;
  let stop: number;
  if (mob) {
    tx = mob.x;
    ty = mob.y;
    // Stop just inside the primary attack's range: melee closes to the target, ranged/spell holds
    // back and fires from a distance rather than walking into melee.
    stop = (net.content.ability(autoAttackAbility())?.range ?? 78) * 0.8;
  } else if (moveTarget) {
    tx = moveTarget.x;
    ty = moveTarget.y;
    stop = MOVE_STOP_RADIUS;
  } else {
    return idle;
  }
  const dx = tx - px;
  const dy = ty - py;
  if (Math.hypot(dx, dy) <= stop) {
    if (!mob) moveTarget = null; // arrived at a ground point — stop walking
    return idle;
  }
  return dirToInput(Math.atan2(dy, dx));
}

// --- Hotbar helpers -------------------------------------------------------------------
/** Scrolling the hotbar is locked for a few seconds after dealing or taking damage. */
function inCombat(): boolean {
  return performance.now() - lastCombatT < COMBAT_LOCK_MS;
}

/** Learned ability ids, in canonical order. */
function knownAbilityIds(): AbilityId[] {
  return net.content.abilityOrder().filter((id) => id in net.you.known);
}

/**
 * The spell shown in hotbar slot `i` — a sliding window over the known spells, rotated by
 * `hotbarOffset`. Slots past the number of known spells are empty (null).
 */
function displayedAbility(i: number): AbilityId | null {
  const known = knownAbilityIds();
  const n = known.length;
  if (n === 0 || i >= n) return null;
  return known[(((hotbarOffset + i) % n) + n) % n] ?? null;
}

/** Rotate the whole bar by one (every slot shifts together). Locked in combat. */
function scrollHotbar(dir: number): void {
  if (inCombat()) return; // can't re-plan your rotation mid-fight
  const n = knownAbilityIds().length;
  if (n <= 1) return; // nothing to rotate
  hotbarOffset = (((hotbarOffset + dir) % n) + n) % n;
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
    chatInputEl.focus();
    e.preventDefault();
  }
});
// Focusing chat marks it active: the log becomes interactive (scrollbar + wheel) on any device,
// and the wheel listener below routes scrolling to it.
chatInputEl.addEventListener('focus', () => {
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
    if (text.trim().length > 0 && !handleSocialCommand(text.trim())) net.sendChat(text);
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
    // Tint the line by channel so whispers/party/system read at a glance.
    div.style.color =
      line.channel === 'whisper'
        ? '#d6a8ff'
        : line.channel === 'party'
          ? '#7fc4ff'
          : line.channel === 'system'
            ? '#e7c869'
            : '';
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

  // Taking damage (hp dropped) enters combat, which locks hotbar remapping for a few seconds.
  if (lastKnownHp > 0 && net.you.hp < lastKnownHp) lastCombatT = now;
  lastKnownHp = net.you.hp;

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
  if (questOpen) drawQuestPanel();
  else {
    questPanelRect = null;
    questAcceptRects.length = 0;
  }
  if (partyOpen) {
    partyButtons = drawPartyPanel(
      hud,
      { w: hudCanvas.width, h: hudCanvas.height },
      net.party,
      net.selfId,
    );
  } else {
    partyButtons = [];
  }
  if (socialOpen) {
    socialButtons = drawSocialPanel(hud, { w: hudCanvas.width, h: hudCanvas.height }, net.friends);
  } else {
    socialButtons = [];
  }
  if (waypointOpen) {
    const areas = net.you.discovered.map((aid) => ({
      id: aid,
      name: net.content.area(aid)?.name ?? aid,
    }));
    waypointButtons = drawWaypointPanel(
      hud,
      { w: hudCanvas.width, h: hudCanvas.height },
      areas,
      net.areaId,
    );
  } else {
    waypointButtons = [];
  }
  if (inventoryOpen) {
    inventoryButtons = drawInventoryPanel(
      hud,
      { w: hudCanvas.width, h: hudCanvas.height },
      { gear: net.you.gear, nameOf: instLabel, statSegments: instStatSegments },
    );
  } else {
    inventoryButtons = [];
  }
  if (net.artificer) {
    artificerButtons = drawArtificerPanel(
      hud,
      { w: hudCanvas.width, h: hudCanvas.height },
      {
        gear: net.you.gear,
        equipment: net.you.equipment,
        gold: net.you.gold,
        rerollCost: net.artificer.rerollCost,
        unsocketCost: net.artificer.unsocketCost,
        nameOf: instLabel,
        gemName: (id) => net.content.item(id)?.name ?? prettyItem(id),
        gemColor: (id) => net.content.item(id)?.color ?? '#d6a8ff',
      },
    );
  } else {
    artificerButtons = [];
  }
  if (net.gamble) {
    gambleButtons = drawGamblePanel(
      hud,
      { w: hudCanvas.width, h: hudCanvas.height },
      net.gamble.cost,
      net.you.gold,
    );
  } else {
    gambleButtons = [];
  }
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
    // Socket pips along the right edge: filled diamond (gem color) or hollow (empty socket).
    const sockets = inst.sockets ?? [];
    sockets.forEach((gemId, i) => {
      const sx = bx + bw - 12 - i * 13;
      const sy = by + 12;
      hud.font = '11px system-ui, sans-serif';
      hud.textAlign = 'center';
      if (gemId) {
        hud.fillStyle = net.content.item(gemId)?.color ?? '#d6a8ff';
        hud.fillText('◆', sx, sy);
      } else {
        hud.fillStyle = 'rgba(214,168,255,0.45)';
        hud.fillText('◇', sx, sy);
      }
    });
    hud.textAlign = 'left';
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

/** The quest log (toggle with L). Active quests show progress bars; available ones an Accept button. */
function drawQuestPanel(): void {
  questAcceptRects.length = 0;
  const quests = net.you.quests ?? [];
  // Order: active first, then available, then done — the player's eye goes to live objectives.
  const rank = (s: string): number => (s === 'active' ? 0 : s === 'available' ? 1 : 2);
  const sorted = [...quests].sort((a, b) => rank(a.status) - rank(b.status));

  const pw = 420;
  const rowH = 58;
  const headerH = 44;
  const ph = Math.min(hudCanvas.height - 80, headerH + Math.max(1, sorted.length) * rowH + 12);
  const px = hudCanvas.width / 2 - pw / 2;
  const py = 56;
  questPanelRect = { x: px, y: py, w: pw, h: ph };

  hud.fillStyle = 'rgba(8,9,13,0.93)';
  hud.fillRect(px, py, pw, ph);
  hud.strokeStyle = '#c9a24b';
  hud.lineWidth = 2;
  hud.strokeRect(px, py, pw, ph);

  hud.fillStyle = '#e7d9b0';
  hud.font = 'bold 15px system-ui, sans-serif';
  hud.textAlign = 'left';
  hud.fillText('Quest Log', px + 14, py + 24);
  hud.textAlign = 'right';
  hud.fillStyle = '#8a8f99';
  hud.font = '11px system-ui, sans-serif';
  hud.fillText('L or Esc to close', px + pw - 14, py + 24);

  if (sorted.length === 0) {
    hud.textAlign = 'center';
    hud.fillStyle = '#8a8f99';
    hud.font = 'italic 12px system-ui, sans-serif';
    hud.fillText(
      'No quests yet — talk to a quest-giver (the gold ! markers).',
      px + pw / 2,
      py + 74,
    );
    return;
  }

  const statusColor: Record<string, string> = {
    active: '#f2c14e',
    available: '#9fb0c0',
    done: '#6b9a5a',
  };
  sorted.forEach((q, i) => {
    const ry = py + headerH + i * rowH;
    hud.textAlign = 'left';
    hud.fillStyle = statusColor[q.status] ?? '#d7dbe3';
    hud.font = 'bold 13px system-ui, sans-serif';
    const tag = q.status === 'done' ? '✓ ' : q.status === 'active' ? '▸ ' : '· ';
    hud.fillText(fitText(tag + q.name, pw - 120), px + 14, ry + 14);

    hud.fillStyle = '#9aa3b2';
    hud.font = '10px system-ui, sans-serif';
    const desc =
      q.kind === 'collect' && q.status === 'active'
        ? `${q.description}  (turn in at a quest-giver)`
        : q.description;
    hud.fillText(fitText(desc, pw - 28), px + 14, ry + 30);

    // Reward line.
    const rewardItemName = q.rewardItem
      ? (net.content.item(q.rewardItem)?.name ?? q.rewardItem)
      : '';
    const reward = `+${q.rewardGold}g +${q.rewardXp}xp${rewardItemName ? ` · ${rewardItemName}` : ''}`;
    hud.fillStyle = '#7d828c';
    hud.font = '10px system-ui, sans-serif';
    hud.fillText(fitText(reward, pw - 120), px + 14, ry + 44);

    if (q.status === 'active') {
      // Progress bar on the right.
      const bw = 90;
      const bx = px + pw - bw - 14;
      const frac = q.targetCount > 0 ? Math.min(1, q.progress / q.targetCount) : 0;
      hud.fillStyle = 'rgba(0,0,0,0.5)';
      hud.fillRect(bx, ry + 18, bw, 12);
      hud.fillStyle = '#8ac34a';
      hud.fillRect(bx, ry + 18, bw * frac, 12);
      hud.strokeStyle = 'rgba(201,162,75,0.5)';
      hud.lineWidth = 1;
      hud.strokeRect(bx, ry + 18, bw, 12);
      hud.fillStyle = '#fff';
      hud.font = '9px system-ui, sans-serif';
      hud.textAlign = 'center';
      hud.fillText(`${q.progress}/${q.targetCount}`, bx + bw / 2, ry + 27);
    } else if (q.status === 'available') {
      // Accept button.
      const bw = 78;
      const bx = px + pw - bw - 14;
      const rect = { id: q.id, x: bx, y: ry + 14, w: bw, h: 22 };
      questAcceptRects.push(rect);
      hud.fillStyle = 'rgba(60,90,60,0.6)';
      hud.fillRect(rect.x, rect.y, rect.w, rect.h);
      hud.strokeStyle = 'rgba(201,162,75,0.6)';
      hud.lineWidth = 1;
      hud.strokeRect(rect.x, rect.y, rect.w, rect.h);
      hud.fillStyle = '#e7d9b0';
      hud.font = 'bold 11px system-ui, sans-serif';
      hud.textAlign = 'center';
      hud.fillText('Accept', rect.x + rect.w / 2, rect.y + 15);
    }

    if (i < sorted.length - 1) {
      hud.strokeStyle = 'rgba(255,255,255,0.06)';
      hud.lineWidth = 1;
      hud.beginPath();
      hud.moveTo(px + 10, ry + rowH - 4);
      hud.lineTo(px + pw - 10, ry + rowH - 4);
      hud.stroke();
    }
  });
}

/** The vendor shop window (opened by E on a vendor). Tap a row to buy; a button sells the bag. */
function drawShopPanel(): void {
  const shop = net.shop;
  if (!shop || !Array.isArray(shop.stock)) return;
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

  const slot = 52;
  const gap = 10;
  const count = HOTBAR_SIZE;
  const panelW = count * slot + (count - 1) * gap;
  const panelX = w / 2 - panelW / 2;
  const slotsY = h - 64;
  const now = performance.now();
  const locked = inCombat();

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
  for (let i = 0; i < count; i++) {
    const id = displayedAbility(i);
    const x = panelX + i * (slot + gap);
    // Each slot casts on click; scrolling anywhere over the bar rotates the whole window.
    slotRects.push({ slot: i, ability: id, x, y: slotsY, w: slot, h: slot });
    const ability = id ? net.content.ability(id) : undefined;

    hud.fillStyle = 'rgba(0,0,0,0.55)';
    hud.fillRect(x, slotsY, slot, slot);

    if (ability && id) {
      const rank = net.you.known[id] ?? 1;
      hud.globalAlpha = net.you.mana < ability.manaCost ? 0.3 : 0.9;
      hud.fillStyle = ability.color;
      hud.fillRect(x + 4, slotsY + 4, slot - 8, slot - 8);
      hud.globalAlpha = 1;

      const remaining = (cooldownEnd[id] ?? 0) - now;
      if (remaining > 0) {
        const frac = Math.min(1, remaining / ability.cooldownMs);
        hud.fillStyle = 'rgba(0,0,0,0.6)';
        hud.fillRect(x, slotsY + slot * (1 - frac), slot, slot * frac);
      }

      hud.fillStyle = '#fff';
      hud.font = 'bold 12px system-ui, sans-serif';
      hud.textAlign = 'left';
      hud.fillText(String(i + 1), x + 4, slotsY + 14);
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
      hud.fillText(fitText(ability.name, slot - 6), x + slot / 2, slotsY + slot - 6);
    } else {
      // Empty slot: dim key number, no spell learned yet for this position.
      hud.fillStyle = '#6b7280';
      hud.font = 'bold 12px system-ui, sans-serif';
      hud.textAlign = 'left';
      hud.fillText(String(i + 1), x + 4, slotsY + 14);
    }

    hud.strokeStyle = id && selected === id ? '#c9a24b' : 'rgba(255,255,255,0.25)';
    hud.lineWidth = id && selected === id ? 3 : 1;
    hud.strokeRect(x, slotsY, slot, slot);
  }

  hotbarRect = { x: panelX, y: slotsY, w: panelW, h: slot };

  // Active self-buff pips, read from the local player's status flags (8=might, 16=haste, 32=regen).
  drawBuffPips(panelX + panelW, slotsY - 10);

  // Scroll hint / combat lock. Only invite scrolling when there's more than one spell to rotate.
  const canScroll = knownAbilityIds().length > 1;
  hud.font = '10px system-ui, sans-serif';
  hud.textAlign = 'center';
  hud.fillStyle = locked ? 'rgba(220,90,90,0.9)' : 'rgba(201,162,75,0.7)';
  hud.fillText(
    locked
      ? '⚔ In combat — hotbar locked'
      : canScroll
        ? '↕ scroll over the bar to rotate your spells'
        : 'find spellbooks to fill your bar',
    w / 2,
    slotsY + slot + 13,
  );

  drawMinimap(w);
  drawInventory(w);

  const npc = nearbyNpc();
  if (npc && !net.you.dead && !net.shop && !net.gamble && !net.artificer) {
    const action =
      npc.npcKind === 'questgiver'
        ? 'talk to'
        : npc.npcKind === 'healer'
          ? 'rest at'
          : npc.npcKind === 'gambler'
            ? 'gamble with'
            : npc.npcKind === 'artificer'
              ? 'enchant at'
              : 'shop with';
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
  return instanceTitle(inst, net.content.item(inst.baseId)?.name ?? prettyItem(inst.baseId));
}

/** Stat segments for a gear instance: base stat(s) then affixes, flagging debuffs for red text. */
function instStatSegments(inst: ItemInstance): { text: string; debuff: boolean }[] {
  const segs: { text: string; debuff: boolean }[] = [];
  if (inst.power > 0) segs.push({ text: `+${inst.power} pow`, debuff: false });
  if (inst.hp > 0) segs.push({ text: `+${inst.hp} hp`, debuff: false });
  for (const a of inst.affixes) segs.push({ text: affixLabel(a as Affix), debuff: isDebuff(a) });
  return segs;
}

/**
 * Status chips for the local player, right-aligned to `rightX`: enemy debuffs (slow/burn/weaken,
 * red label) and active self-buffs (might/haste/regen, white label), read from the status flags.
 */
function drawBuffPips(rightX: number, y: number): void {
  const flags = self?.flags ?? 0;
  const defs = [
    { bit: 1, label: 'Slowed', color: '#88bbff', bad: true },
    { bit: 2, label: 'Burning', color: '#ff8a4d', bad: true },
    { bit: 4, label: 'Weakened', color: '#c08adf', bad: true },
    { bit: 8, label: 'Might', color: '#ffb347', bad: false },
    { bit: 16, label: 'Haste', color: '#7cf0ff', bad: false },
    { bit: 32, label: 'Regen', color: '#9be8a0', bad: false },
  ];
  const active = defs.filter((d) => (flags & d.bit) !== 0);
  if (active.length === 0) return;
  hud.font = 'bold 11px system-ui, sans-serif';
  hud.textBaseline = 'middle';
  let x = rightX;
  for (let i = active.length - 1; i >= 0; i--) {
    const d = active[i]!;
    const chipW = hud.measureText(d.label).width + 22;
    x -= chipW;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(x, y - 9, chipW, 18);
    hud.fillStyle = d.color;
    hud.beginPath();
    hud.arc(x + 9, y, 4, 0, Math.PI * 2);
    hud.fill();
    hud.fillStyle = d.bad ? '#e88' : '#fff';
    hud.textAlign = 'left';
    hud.fillText(d.label, x + 16, y);
    x -= 6; // gap between chips
  }
  hud.textBaseline = 'alphabetic';
}

const MINIMAP_SIZE = 160;

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
  const pw = 236; // wide enough for Diablo-style names like "Savage Iron Sword of the Boar"
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
  hud.fillText('C char·I bag·L quests·P party·F friends·M map', px + 8, py + 30);
  py += eqH + 6;

  // Gear panel: only the NEWEST few unequipped pieces, so a full bag never shoves the rest of the
  // HUD off-screen. The whole bag (up to 30) lives in the inventory panel (I). Two lines each.
  bagRects.length = 0;
  const HUD_GEAR_SHOWN = 5;
  const total = net.you.gear.length;
  const gear = net.you.gear.slice(-HUD_GEAR_SHOWN); // newest at the end of the array
  if (gear.length > 0) {
    const rowH = 28;
    const gh = 24 + gear.length * rowH;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(px, py, pw, gh);
    hud.strokeStyle = 'rgba(201,162,75,0.6)';
    hud.strokeRect(px, py, pw, gh);
    hud.fillStyle = '#e7d9b0';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    const title =
      total > HUD_GEAR_SHOWN
        ? `Gear · +${total - HUD_GEAR_SHOWN} in bag (I)`
        : 'Gear — tap to equip';
    hud.fillText(title, px + 8, py + 15);
    gear.forEach((inst, i) => {
      const ry = py + 22 + i * rowH;
      bagRects.push({ uid: inst.uid, x: px, y: ry, w: pw, h: rowH });
      // Line 1: the item name, in its rarity color — truncated so long named items never overflow.
      hud.font = 'bold 11px system-ui, sans-serif';
      hud.fillStyle = rarityColor(inst.rarity);
      hud.textAlign = 'left';
      hud.fillText(fitText(instLabel(inst), pw - 14), px + 8, ry + 11);
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

  // Gems panel: socketable gems in the bag, tappable to slot into the first open equipped socket.
  socketRects.length = 0;
  const gems = held.filter(([id]) => net.content.item(id)?.kind === 'gem');
  if (gems.length > 0) {
    const gh2 = 24 + gems.length * 18;
    hud.fillStyle = 'rgba(0,0,0,0.5)';
    hud.fillRect(px, py, pw, gh2);
    hud.strokeStyle = 'rgba(180,136,255,0.5)';
    hud.strokeRect(px, py, pw, gh2);
    hud.fillStyle = '#d6a8ff';
    hud.font = 'bold 12px system-ui, sans-serif';
    hud.textAlign = 'left';
    hud.fillText('Gems — tap to socket', px + 8, py + 16);
    gems.forEach(([id, n], i) => {
      const ry = py + 22 + i * 18;
      socketRects.push({ itemId: id, x: px, y: ry, w: pw, h: 18 });
      hud.font = '11px system-ui, sans-serif';
      hud.fillStyle = net.content.item(id)?.color ?? '#d7dbe3';
      hud.textAlign = 'left';
      hud.fillText(
        fitText((net.content.item(id)?.name ?? prettyItem(id)) + (n > 1 ? ` ×${n}` : ''), pw - 16),
        px + 8,
        ry + 13,
      );
    });
    py += gh2 + 6;
  }

  // Materials panel: stackable loot sold to the vendor (not equippable, spellbook, or gem).
  const items = held.filter(([id]) => {
    const kind = net.content.item(id)?.kind;
    return kind !== 'spellbook' && kind !== 'gem';
  });
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

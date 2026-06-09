import { Input } from './input.js';
import { INTERP_DELAY_MS } from './interp.js';
import { Net } from './net.js';
import { areaOf } from '../shared/areas.js';

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

// Send input at a steady cadence rather than every frame — the server is authoritative.
setInterval(() => net.sendInput(input.sample()), 1000 / 30);

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
  ctx.fillStyle = '#0e0f13';
  ctx.fillRect(0, 0, w, h);

  const entities = net.snapshots.sample(performance.now() - INTERP_DELAY_MS);
  const self = entities.find((e) => e.id === net.selfId);
  const camX = self ? self.x - w / 2 : 0;
  const camY = self ? self.y - h / 2 : 0;

  drawGrid(camX, camY, w, h);
  drawPortals(camX, camY);

  for (const e of entities) {
    const sx = e.x - camX;
    const sy = e.y - camY;
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${e.hue} 60% 55%)`;
    ctx.fill();
    if (e.id === net.selfId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#c9a24b';
      ctx.stroke();
    }
    ctx.fillStyle = '#d7dbe3';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.name, sx, sy - 20);
  }

  drawJoystick();

  const area = areaOf(net.areaId);
  statusEl.textContent = net.connected ? `online as ${name}` : 'reconnecting…';
  popEl.textContent = `${area?.name ?? net.areaId} · players: ${entities.length}`;
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

function drawGrid(camX: number, camY: number, w: number, h: number): void {
  const step = 64;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  const startX = -((camX % step) + step) % step;
  const startY = -((camY % step) + step) % step;
  for (let x = startX; x < w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = startY; y < h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function drawJoystick(): void {
  const j = input.joystick;
  if (!j.active) return;
  ctx.beginPath();
  ctx.arc(j.baseX, j.baseY, 60, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(201,162,75,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(j.knobX, j.knobY, 26, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(201,162,75,0.4)';
  ctx.fill();
}

requestAnimationFrame(render);

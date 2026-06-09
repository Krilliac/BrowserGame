import { Input } from './input.js';
import { Net } from './net.js';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const statusEl = document.getElementById('status')!;
const popEl = document.getElementById('pop')!;

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
input.attach();

// Send input at a steady cadence rather than every frame — the server is authoritative.
setInterval(() => net.sendInput(input.sample()), 1000 / 30);

function render(): void {
  const { width: w, height: h } = canvas;
  ctx.fillStyle = '#0e0f13';
  ctx.fillRect(0, 0, w, h);

  const self = net.state.entities.find((e) => e.id === net.state.selfId);
  const camX = self ? self.x - w / 2 : 0;
  const camY = self ? self.y - h / 2 : 0;

  drawGrid(camX, camY, w, h);

  for (const e of net.state.entities) {
    const sx = e.x - camX;
    const sy = e.y - camY;
    ctx.beginPath();
    ctx.arc(sx, sy, 14, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${e.hue} 60% 55%)`;
    ctx.fill();
    if (e.id === net.state.selfId) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#c9a24b';
      ctx.stroke();
    }
    ctx.fillStyle = '#d7dbe3';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(e.name, sx, sy - 20);
  }

  statusEl.textContent = net.state.connected ? `online as ${name}` : 'reconnecting…';
  popEl.textContent = `players: ${net.state.entities.length}`;
  requestAnimationFrame(render);
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

requestAnimationFrame(render);

import { SnapshotBuffer } from './interp.js';
import type { TimedFx } from './draw.js';
import { decodeServer, encode, type InputState, type ServerMessage } from '../shared/protocol.js';
import type { AbilityId } from '../shared/combat.js';

export interface ChatLine {
  from: string;
  text: string;
}

export interface SelfStats {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dead: boolean;
  level: number;
  xp: number;
  xpInto: number;
  xpNext: number;
  gold: number;
}

const MAX_CHAT_LINES = 50;
const MAX_FX = 150;

/**
 * Thin WebSocket client. Connects to the same origin's /ws (Vite proxies this to the
 * game server in dev; the prod server hosts both on one port). One url to open — works
 * the same on a laptop or a phone.
 */
export class Net {
  private ws: WebSocket | null = null;
  readonly snapshots = new SnapshotBuffer();
  readonly chat: ChatLine[] = [];
  readonly fx: TimedFx[] = [];
  you: SelfStats = {
    hp: 100,
    maxHp: 100,
    mana: 100,
    maxMana: 100,
    dead: false,
    level: 1,
    xp: 0,
    xpInto: 0,
    xpNext: 100,
    gold: 0,
  };
  selfId = 0;
  connected = false;
  tickRate = 20;
  areaId = 'town';
  instanceId = '';

  constructor(private readonly name: string) {}

  connect(): void {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      ws.send(encode({ t: 'join', name: this.name }));
    });

    ws.addEventListener('message', (ev) => {
      const msg = decodeServer(String(ev.data));
      if (msg) this.handle(msg);
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      // Naive auto-reconnect — good enough for a dev foundation.
      setTimeout(() => this.connect(), 1000);
    });
  }

  sendInput(input: InputState): void {
    this.send({ t: 'input', input });
  }

  sendChat(text: string): void {
    this.send({ t: 'chat', text });
  }

  sendCast(ability: AbilityId, dx: number, dy: number): void {
    this.send({ t: 'cast', ability, dx, dy });
  }

  private send(msg: Parameters<typeof encode>[0]): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(msg));
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.selfId = msg.id;
        this.tickRate = msg.tickRate;
        this.areaId = msg.areaId;
        this.instanceId = msg.instanceId;
        break;
      case 'snapshot': {
        const now = performance.now();
        this.snapshots.push(msg.entities, now);
        for (const ev of msg.fx) this.fx.push({ ev, t0: now });
        if (this.fx.length > MAX_FX) this.fx.splice(0, this.fx.length - MAX_FX);
        break;
      }
      case 'you':
        this.you = {
          hp: msg.hp,
          maxHp: msg.maxHp,
          mana: msg.mana,
          maxMana: msg.maxMana,
          dead: msg.dead,
          level: msg.level,
          xp: msg.xp,
          xpInto: msg.xpInto,
          xpNext: msg.xpNext,
          gold: msg.gold,
        };
        break;
      case 'area_changed':
        this.areaId = msg.areaId;
        this.instanceId = msg.instanceId;
        this.snapshots.clear(); // forget the old area's entities immediately
        this.fx.length = 0;
        break;
      case 'chat':
        this.chat.push({ from: msg.from, text: msg.text });
        if (this.chat.length > MAX_CHAT_LINES) this.chat.shift();
        break;
      case 'admin_result':
        console.log('[admin]', msg.ok, msg.message);
        break;
    }
  }
}

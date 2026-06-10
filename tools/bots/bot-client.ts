/**
 * Headless bot client for functional + stress testing the BrowserGame server.
 *
 * Speaks the real wire protocol (src/shared/protocol.ts) over `ws`. The server's heartbeat
 * pings are answered automatically — the `ws` library replies to protocol-level pings with
 * pongs out of the box, so bots are never evicted as ghosts while their socket is healthy.
 *
 * Every inbound message is decoded defensively: a weird packet increments a counter and is
 * dropped; it must never crash the harness.
 */

import WebSocket from 'ws';
import {
  encode,
  decodeServer,
  type ClientMessage,
  type EntityState,
  type InputState,
} from '../../src/shared/protocol.js';
import type { AreaDef } from '../../src/shared/areas.js';
import type { AbilityId } from '../../src/shared/combat.js';
import type { ItemInstance } from '../../src/shared/items.js';

/** Counters + samples the stress harness aggregates. Sample arrays are drained each window. */
export interface BotMetrics {
  msgsIn: number;
  msgsOut: number;
  bytesIn: number;
  bytesOut: number;
  snapshots: number;
  decodeErrors: number;
  /** Closes we did not ask for (the harness treats these as failures). */
  unexpectedDisconnects: number;
  /** Successful re-welcomes after an unexpected close. */
  reconnects: number;
  /** Milliseconds between consecutive snapshots (jitter source). Drained by the harness. */
  gapSamplesMs: number[];
  /** Raw byte size of each snapshot frame. Drained by the harness. */
  snapshotBytes: number[];
}

/** The personal 'you' stats the bot cares about (subset of the wire message). */
export interface YouState {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dead: boolean;
  level: number;
  gold: number;
  x: number;
  y: number;
  loot: Record<string, number>;
  gear: ItemInstance[];
}

export interface BotOptions {
  /** ws://host:port — the /ws path is appended automatically if missing. */
  url: string;
  name: string;
  /** Auto-reconnect (presenting the save token) after an unexpected close. */
  reconnect?: boolean;
  maxReconnects?: number;
  connectTimeoutMs?: number;
}

export class BotClient {
  readonly metrics: BotMetrics = {
    msgsIn: 0,
    msgsOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    snapshots: 0,
    decodeErrors: 0,
    unexpectedDisconnects: 0,
    reconnects: 0,
    gapSamplesMs: [],
    snapshotBytes: [],
  };

  selfId = 0;
  tickRate = 0;
  areaId = '';
  /** Latest area-of-interest snapshot (entities near this bot). */
  entities: readonly EntityState[] = [];
  you: YouState | null = null;
  /** Area definitions from the server's content packet, by id. */
  readonly areas = new Map<string, AreaDef>();

  private ws: WebSocket | null = null;
  private token: string | undefined;
  private seq = 0;
  private closedByUs = false;
  private joined = false;
  private reconnectAttempts = 0;
  private lastSnapshotAt = 0;
  private readonly wsUrl: string;

  constructor(private readonly opts: BotOptions) {
    this.wsUrl = opts.url.endsWith('/ws') ? opts.url : `${opts.url.replace(/\/$/, '')}/ws`;
  }

  /** True once connected and welcomed into the world. */
  get connected(): boolean {
    return this.joined && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /** Connect, join, and resolve on the server's welcome (or reject on timeout/error). */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.opts.connectTimeoutMs ?? 8000;
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      this.closedByUs = false;
      this.joined = false;
      this.lastSnapshotAt = 0;

      const timer = setTimeout(() => {
        reject(new Error(`connect timeout after ${timeoutMs}ms`));
        ws.terminate();
      }, timeoutMs);

      ws.on('open', () => {
        const join: ClientMessage = this.token
          ? { t: 'join', name: this.opts.name, token: this.token }
          : { t: 'join', name: this.opts.name };
        this.sendRaw(join);
      });
      ws.on('message', (raw) => {
        const welcomed = this.handleMessage(raw);
        if (welcomed) {
          clearTimeout(timer);
          resolve();
        }
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on('close', () => this.handleClose());
    });
  }

  /** Send a movement intent (the seq is managed internally for the server's ack). */
  sendInput(input: InputState): void {
    this.sendRaw({ t: 'input', input, seq: ++this.seq });
  }

  cast(ability: AbilityId, dx: number, dy: number): void {
    this.sendRaw({ t: 'cast', ability, dx, dy });
  }

  interact(): void {
    this.sendRaw({ t: 'interact' });
  }

  equip(uid: number): void {
    this.sendRaw({ t: 'equip', uid });
  }

  /** Cleanly close the socket — never counted as an unexpected disconnect. */
  close(): void {
    this.closedByUs = true;
    this.joined = false;
    this.ws?.close();
  }

  private sendRaw(msg: ClientMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const payload = encode(msg);
    this.ws.send(payload);
    this.metrics.msgsOut++;
    this.metrics.bytesOut += payload.length;
  }

  /** Decode + apply one server frame. Returns true on the welcome that completes a join. */
  private handleMessage(raw: WebSocket.RawData): boolean {
    let text: string;
    try {
      text = raw.toString();
    } catch {
      this.metrics.decodeErrors++;
      return false;
    }
    this.metrics.msgsIn++;
    this.metrics.bytesIn += text.length;

    const msg = decodeServer(text);
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') {
      this.metrics.decodeErrors++;
      return false;
    }

    try {
      switch (msg.t) {
        case 'content':
          if (Array.isArray(msg.areas)) {
            for (const area of msg.areas) {
              if (area && typeof area.id === 'string') this.areas.set(area.id, area);
            }
          }
          return false;
        case 'welcome': {
          this.selfId = typeof msg.id === 'number' ? msg.id : 0;
          this.tickRate = typeof msg.tickRate === 'number' ? msg.tickRate : 0;
          this.areaId = typeof msg.areaId === 'string' ? msg.areaId : '';
          this.token = typeof msg.token === 'string' ? msg.token : undefined;
          const isReconnect = this.joined === false && this.reconnectAttempts > 0;
          this.joined = true;
          if (isReconnect) {
            this.metrics.reconnects++;
            this.reconnectAttempts = 0;
          }
          return true;
        }
        case 'snapshot': {
          if (Array.isArray(msg.entities)) this.entities = msg.entities;
          this.metrics.snapshots++;
          this.metrics.snapshotBytes.push(text.length);
          const now = Date.now();
          if (this.lastSnapshotAt > 0) this.metrics.gapSamplesMs.push(now - this.lastSnapshotAt);
          this.lastSnapshotAt = now;
          return false;
        }
        case 'you':
          this.you = {
            hp: num(msg.hp),
            maxHp: num(msg.maxHp),
            mana: num(msg.mana),
            maxMana: num(msg.maxMana),
            dead: msg.dead === true,
            level: num(msg.level),
            gold: num(msg.gold),
            x: num(msg.x),
            y: num(msg.y),
            loot: msg.loot && typeof msg.loot === 'object' ? msg.loot : {},
            gear: Array.isArray(msg.gear) ? msg.gear : [],
          };
          return false;
        case 'area_changed':
          if (typeof msg.areaId === 'string') this.areaId = msg.areaId;
          this.entities = []; // stale: they belong to the previous instance
          this.lastSnapshotAt = 0; // don't count the transfer pause as snapshot jitter
          return false;
        case 'chat':
        case 'admin_result':
          return false;
        default:
          // Unknown-but-parseable type: forward-compat, not an error worth crashing over.
          return false;
      }
    } catch {
      this.metrics.decodeErrors++;
      return false;
    }
  }

  private handleClose(): void {
    const wasJoined = this.joined;
    this.joined = false;
    if (this.closedByUs) return;
    if (wasJoined) this.metrics.unexpectedDisconnects++;
    if (!this.opts.reconnect) return;
    if (this.reconnectAttempts >= (this.opts.maxReconnects ?? 10)) return;
    this.reconnectAttempts++;
    const delay = 500 + Math.random() * 1000;
    setTimeout(() => {
      if (this.closedByUs) return;
      this.connect().catch(() => {
        /* a failed attempt re-enters via 'close' until maxReconnects */
      });
    }, delay);
  }
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

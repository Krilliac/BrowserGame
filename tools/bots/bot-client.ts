/**
 * Headless bot client for functional + stress testing the BrowserGame server.
 *
 * Speaks the real wire protocol (src/shared/protocol.ts) over `ws`. The server's heartbeat
 * pings are answered automatically — the `ws` library replies to protocol-level pings with
 * pongs out of the box, so bots are never evicted as ghosts while their socket is healthy.
 *
 * Every inbound message is decoded defensively: a weird packet increments a counter and is
 * dropped; it must never crash the harness. State the brain consumes lives in `world`
 * (world-state.ts) and is updated through the same `applyServerMessage` path that offline
 * replay (replay.ts) uses, so recorded sessions reproduce live behavior exactly.
 */

import { createWriteStream, type WriteStream } from 'node:fs';
import WebSocket from 'ws';
import {
  encode,
  decodeServer,
  PROTOCOL_VERSION,
  type ClientMessage,
  type ServerMessage,
  type EntityState,
  type InputState,
} from '../../src/shared/protocol.js';
import type { AreaDef } from '../../src/shared/areas.js';
import type { AbilityId } from '../../src/shared/combat.js';
import {
  applyServerMessage,
  emptyWorldState,
  type BotWorldState,
  type YouState,
} from './world-state.js';

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

export interface BotOptions {
  /** ws://host:port — the /ws path is appended automatically if missing. */
  url: string;
  name: string;
  /** Auto-reconnect (presenting the save token) after an unexpected close. */
  reconnect?: boolean;
  maxReconnects?: number;
  connectTimeoutMs?: number;
  /**
   * Record mode: append every brain-consumed server message (content/welcome/snapshot/
   * you/area_changed) as a JSONL line `{t_ms, msg}` to this file, for offline replay
   * via replay.ts. t_ms is milliseconds since the first recorded message.
   */
  recordPath?: string;
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

  /** Brain-consumable state, updated via applyServerMessage (shared with replay.ts). */
  readonly world: BotWorldState = emptyWorldState();

  get selfId(): number {
    return this.world.selfId;
  }
  get tickRate(): number {
    return this.world.tickRate;
  }
  get areaId(): string {
    return this.world.areaId;
  }
  /** Latest area-of-interest snapshot (entities near this bot). */
  get entities(): readonly EntityState[] {
    return this.world.entities;
  }
  get you(): YouState | null {
    return this.world.you;
  }
  /** Area definitions from the server's content packet, by id. */
  get areas(): Map<string, AreaDef> {
    return this.world.areas;
  }

  private ws: WebSocket | null = null;
  private token: string | undefined;
  private seq = 0;
  private closedByUs = false;
  private joined = false;
  private reconnectAttempts = 0;
  private lastSnapshotAt = 0;
  private readonly wsUrl: string;
  /** Single append stream for record mode; Node buffers writes — no sync I/O per message. */
  private recorder: WriteStream | null = null;
  private recordStartedAt = 0;

  constructor(private readonly opts: BotOptions) {
    this.wsUrl = opts.url.endsWith('/ws') ? opts.url : `${opts.url.replace(/\/$/, '')}/ws`;
    if (opts.recordPath) this.recorder = createWriteStream(opts.recordPath, { flags: 'a' });
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
        // `v` is the protocol version gate — joins without it get refresh_required + close 1008.
        const join: ClientMessage = this.token
          ? { t: 'join', name: this.opts.name, token: this.token, v: PROTOCOL_VERSION }
          : { t: 'join', name: this.opts.name, v: PROTOCOL_VERSION };
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
    this.recorder?.end();
    this.recorder = null;
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
      const kind = applyServerMessage(this.world, msg);
      if (this.recorder && kind !== 'other') this.record(msg);

      // Transport-side bookkeeping (token, join state, cadence metrics) stays here —
      // it is real-socket-only and means nothing to an offline replay.
      switch (kind) {
        case 'welcome': {
          if (msg.t === 'welcome') {
            this.token = typeof msg.token === 'string' ? msg.token : undefined;
          }
          const isReconnect = this.joined === false && this.reconnectAttempts > 0;
          this.joined = true;
          if (isReconnect) {
            this.metrics.reconnects++;
            this.reconnectAttempts = 0;
          }
          return true;
        }
        case 'snapshot': {
          this.metrics.snapshots++;
          this.metrics.snapshotBytes.push(text.length);
          const now = Date.now();
          if (this.lastSnapshotAt > 0) this.metrics.gapSamplesMs.push(now - this.lastSnapshotAt);
          this.lastSnapshotAt = now;
          return false;
        }
        case 'area_changed':
          this.lastSnapshotAt = 0; // don't count the transfer pause as snapshot jitter
          return false;
        default:
          return false;
      }
    } catch {
      this.metrics.decodeErrors++;
      return false;
    }
  }

  private record(msg: ServerMessage): void {
    if (!this.recorder) return;
    const now = Date.now();
    if (this.recordStartedAt === 0) this.recordStartedAt = now;
    this.recorder.write(`${JSON.stringify({ t_ms: now - this.recordStartedAt, msg })}\n`);
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

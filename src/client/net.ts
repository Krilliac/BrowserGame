import {
  decodeServer,
  encode,
  type EntityState,
  type InputState,
  type ServerMessage,
} from '../shared/protocol.js';

export interface NetState {
  selfId: number;
  entities: EntityState[];
  connected: boolean;
}

/**
 * Thin WebSocket client. Connects to the same origin's /ws (Vite proxies this to the
 * game server in dev; the prod server hosts both on one port). One url to open — works
 * the same on a laptop or a phone.
 */
export class Net {
  private ws: WebSocket | null = null;
  readonly state: NetState = { selfId: 0, entities: [], connected: false };

  constructor(private readonly name: string) {}

  connect(): void {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.state.connected = true;
      ws.send(encode({ t: 'join', name: this.name }));
    });

    ws.addEventListener('message', (ev) => {
      const msg = decodeServer(String(ev.data));
      if (msg) this.handle(msg);
    });

    ws.addEventListener('close', () => {
      this.state.connected = false;
      // Naive auto-reconnect — good enough for a dev foundation.
      setTimeout(() => this.connect(), 1000);
    });
  }

  sendInput(input: InputState): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode({ t: 'input', input }));
    }
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.state.selfId = msg.id;
        break;
      case 'snapshot':
        this.state.entities = msg.entities;
        break;
      case 'admin_result':
        console.log('[admin]', msg.ok, msg.message);
        break;
    }
  }
}

/**
 * Wire protocol shared by client and server.
 *
 * Design note (carried from SparkEngine's Networking architecture): the server is
 * AUTHORITATIVE. Clients send *intent* (inputs), never state. The server simulates
 * and broadcasts snapshots. This is the foundation of both fairness and anti-cheat —
 * a malicious client can lie about its input but cannot teleport, because it never
 * gets to assert its own position.
 */

/** Simulation tick rate in Hz. Overridable via the TICK_RATE env var on the server. */
export const DEFAULT_TICK_RATE = 20;

/** Per-entity movement speed in world units per second. Server-enforced. */
export const PLAYER_SPEED = 180;

/** World bounds in pixels. The authoritative server clamps every entity to this box. */
export const WORLD_WIDTH = 2000;
export const WORLD_HEIGHT = 2000;

/** A single networked entity's replicated state. */
export interface EntityState {
  id: number;
  x: number;
  y: number;
  /** Display name. */
  name: string;
  /** Cosmetic hue 0..360 so players are visually distinguishable. */
  hue: number;
}

/** Directional intent for one frame, normalized to -1..1 on each axis. */
export interface InputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** Messages the client sends to the server. */
export type ClientMessage =
  | { t: 'join'; name: string }
  | { t: 'input'; input: InputState }
  /** Privileged "in-game engine" command — gated server-side by an admin token. */
  | { t: 'admin'; token: string; command: string };

/** Messages the server sends to clients. */
export type ServerMessage =
  | { t: 'welcome'; id: number; tickRate: number; world: { w: number; h: number } }
  | { t: 'snapshot'; tick: number; entities: EntityState[] }
  | { t: 'admin_result'; ok: boolean; message: string };

export function encode(msg: ClientMessage | ServerMessage): string {
  return JSON.stringify(msg);
}

export function decodeClient(raw: string): ClientMessage | null {
  return safeParse<ClientMessage>(raw);
}

export function decodeServer(raw: string): ServerMessage | null {
  return safeParse<ServerMessage>(raw);
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

import { describe, expect, it } from 'vitest';
import {
  decodeClient,
  decodeServer,
  encode,
  type ClientMessage,
  type ServerMessage,
} from './protocol.js';

/**
 * The wire contract: `encode` is a faithful JSON round-trip, and the decoders NEVER throw on
 * malformed input — they return `null` so a hostile or truncated frame costs one dropped message,
 * not a crashed connection. (Structural validation/clamping is the server's job downstream; the
 * decoder's sole job is "parse or null".)
 */
const clientSamples: ClientMessage[] = [
  { t: 'join', name: 'Ada', token: 'tok', v: 1 },
  { t: 'input', input: { up: true, down: false, left: false, right: true }, seq: 42 },
  { t: 'cast', ability: 'fireball', dx: 0.6, dy: -0.8 },
  { t: 'chat', text: 'hello world' },
  { t: 'interact' },
  { t: 'equip', uid: 1234 },
  { t: 'use_potion', kind: 'health' },
  { t: 'open_rift', tier: 3 },
  { t: 'whisper', to: 'Bob', text: 'hi' },
];

const serverSamples: ServerMessage[] = [
  { t: 'refresh_required' },
  { t: 'access', level: 2 },
  { t: 'area_changed', areaId: 'wilderness', instanceId: 'wilderness#1' },
  { t: 'chat', from: 'Bob', text: 'yo', channel: 'party' },
  { t: 'admin_result', ok: true, message: 'done' },
  { t: 'shop', vendor: 'Merchant', stock: [{ itemId: 'iron_sword', price: 50 }] },
];

describe('encode / decode round-trip', () => {
  it('round-trips every representative client message exactly', () => {
    for (const msg of clientSamples) {
      const wire = encode(msg);
      expect(typeof wire).toBe('string');
      expect(decodeClient(wire)).toEqual(msg);
    }
  });

  it('round-trips every representative server message exactly', () => {
    for (const msg of serverSamples) {
      expect(decodeServer(encode(msg))).toEqual(msg);
    }
  });
});

describe('decoders never throw on bad input', () => {
  const garbage = ['', '   ', 'not json', '{', '{"t":', '[1,2', '}{', 'undefined', '{"t":"x" '];

  it('return null (not throw) for malformed JSON — client side', () => {
    for (const g of garbage) {
      expect(() => decodeClient(g)).not.toThrow();
      expect(decodeClient(g)).toBeNull();
    }
  });

  it('return null (not throw) for malformed JSON — server side', () => {
    for (const g of garbage) {
      expect(() => decodeServer(g)).not.toThrow();
      expect(decodeServer(g)).toBeNull();
    }
  });

  it('parse well-formed JSON even when it is not a known message (validation is downstream)', () => {
    // The decoder is a pure parse: any valid JSON comes back as-is; the server validates the shape.
    expect(decodeClient('{"t":"bogus","x":1}')).toEqual({ t: 'bogus', x: 1 });
    expect(decodeClient('123')).toBe(123);
    expect(decodeClient('null')).toBeNull();
  });
});

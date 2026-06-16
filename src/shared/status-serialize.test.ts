import { describe, expect, it } from 'vitest';
import { decodeServer, encode, PROTOCOL_VERSION, type ServerMessage } from './protocol.js';
import { STATUS_BITS } from './status-bits.js';

/**
 * Serialization round-trip tests for the slice-3 ailment / CC status bits.
 *
 * Verifies that:
 *   1. PROTOCOL_VERSION is 2 (slice 3 wire bump).
 *   2. A snapshot `EntityState.flags` value built from the new STATUS_BITS high-bit entries
 *      (stun | poison | shock) survives JSON encode → decodeServer intact — i.e. JavaScript
 *      JSON does not silently corrupt them.
 */
describe('status-bits serialization round-trip (slice 3)', () => {
  it('PROTOCOL_VERSION is 2', () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });

  it('flags combining stun | poison | shock survive encode/decodeServer intact', () => {
    const flags = STATUS_BITS.stun | STATUS_BITS.poison | STATUS_BITS.shock;
    // 128 | 2048 | 1024 = 3200 — well within the safe integer range but above the legacy 64-bit set.
    expect(flags).toBe(3200);

    const entity = {
      id: 1,
      x: 100,
      y: 200,
      name: 'TestMob',
      hue: 0,
      kind: 'mob' as const,
      facing: 0,
      hp: 50,
      maxHp: 100,
      level: 1,
      flags,
    };

    const msg: ServerMessage = {
      t: 'snapshot',
      tick: 42,
      entities: [entity],
      fx: [],
    };

    const wire = encode(msg);
    expect(typeof wire).toBe('string');

    const decoded = decodeServer(wire);
    expect(decoded).not.toBeNull();
    expect(decoded!.t).toBe('snapshot');

    const snap = decoded as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(snap.entities).toHaveLength(1);

    const roundTripped = snap.entities[0]!;
    expect(roundTripped.flags).toBe(flags);
  });

  it('flags combining all three vulnerability bits (shock | brittle | curse) survive round-trip', () => {
    const flags = STATUS_BITS.shock | STATUS_BITS.brittle | STATUS_BITS.curse;
    // 1024 | 32768 | 262144 = 295936 — tests that high bits are not truncated by JSON.
    expect(flags).toBeGreaterThan(64);

    const entity = {
      id: 2,
      x: 0,
      y: 0,
      name: 'Shocked',
      hue: 0,
      kind: 'mob' as const,
      facing: 0,
      hp: 100,
      maxHp: 100,
      level: 1,
      flags,
    };

    const msg: ServerMessage = { t: 'snapshot', tick: 1, entities: [entity], fx: [] };
    const decoded = decodeServer(encode(msg)) as Extract<ServerMessage, { t: 'snapshot' }>;

    expect(decoded.entities[0]!.flags).toBe(flags);
  });

  it('flags with every slice-3 ailment bit set survive round-trip', () => {
    // All ailment + CC bits OR'd together.
    const flags =
      STATUS_BITS.stun |
      STATUS_BITS.freeze |
      STATUS_BITS.silence |
      STATUS_BITS.shock |
      STATUS_BITS.poison |
      STATUS_BITS.bleed |
      STATUS_BITS.ignite |
      STATUS_BITS.chill |
      STATUS_BITS.brittle |
      STATUS_BITS.maim |
      STATUS_BITS.sap |
      STATUS_BITS.curse;

    const msg: ServerMessage = {
      t: 'snapshot',
      tick: 99,
      entities: [
        {
          id: 3,
          x: 0,
          y: 0,
          name: 'AllAilments',
          hue: 0,
          kind: 'mob' as const,
          facing: 0,
          hp: 1,
          maxHp: 1,
          level: 1,
          flags,
        },
      ],
      fx: [],
    };

    const decoded = decodeServer(encode(msg)) as Extract<ServerMessage, { t: 'snapshot' }>;
    expect(decoded.entities[0]!.flags).toBe(flags);
  });
});

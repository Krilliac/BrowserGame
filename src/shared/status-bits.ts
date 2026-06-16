/**
 * Single source of truth for status -> wire bit. The server builds EntityState.flags from these and
 * the client reads them back, so they never drift. Bits 1-64 are the legacy set (do not renumber).
 */
export const STATUS_BITS = {
  slow: 1,
  burn: 2,
  weaken: 4,
  might: 8,
  haste: 16,
  regen: 32,
  enrage: 64, // mob-only: might|haste
  stun: 128,
  freeze: 256,
  silence: 512,
  shock: 1024,
  poison: 2048,
  bleed: 4096,
  ignite: 8192,
  chill: 16384,
  brittle: 32768,
  maim: 65536,
  sap: 131072,
  curse: 262144,
} as const;
export type StatusBitName = keyof typeof STATUS_BITS;

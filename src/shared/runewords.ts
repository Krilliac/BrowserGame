/**
 * Runewords — the Diablo-II "socket runes in the right order" system, shared by client and server.
 *
 * Gear can roll gem {@link ItemInstance.sockets sockets}. Players slot **runes** (a special kind of
 * socketable, here just identified by id) into those sockets. When a specific sequence of runes
 * fills the sockets *in order, starting at the first socket*, it activates a named **runeword** that
 * grants extra {@link Affix} bonuses on top of the item's own stats — the classic "the whole is
 * greater than the parts" loot chase.
 *
 * This module is pure data + detection only: it declares the runes and runewords and answers
 * "given these sockets, which runeword (if any) is active, and what does it grant?". It deliberately
 * does NOT touch inventory, equipping, or stat application — those are the server's job. Runeword
 * bonuses reuse the same buff {@link AffixStat}s as normal affixes (no debuff stats).
 */

import type { Affix } from './items.js';

/** A socketable rune — the atom players slot into gear sockets to build a runeword. */
export interface RuneDef {
  id: string;
  name: string;
}

/**
 * The rune pool. Evocative one-syllable names, ids prefixed `rune_`. The orchestrator seeds matching
 * socketable item rows in the content DB keyed by these ids; this list is the canonical source.
 */
export const RUNES: RuneDef[] = [
  { id: 'rune_el', name: 'El' },
  { id: 'rune_tir', name: 'Tir' },
  { id: 'rune_ort', name: 'Ort' },
  { id: 'rune_thul', name: 'Thul' },
  { id: 'rune_nef', name: 'Nef' },
  { id: 'rune_sol', name: 'Sol' },
  { id: 'rune_dol', name: 'Dol' },
  { id: 'rune_ral', name: 'Ral' },
  { id: 'rune_vex', name: 'Vex' },
  { id: 'rune_zod', name: 'Zod' },
];

/**
 * A runeword: its `runes` must be socketed **in order**, starting at the first socket. The length of
 * `runes` is the number of sockets it occupies. `bonuses` are the affixes it grants when active.
 */
export interface RunewordDef {
  id: string;
  name: string;
  runes: string[];
  bonuses: Affix[];
  flavor?: string;
}

/**
 * The runeword recipes. Bonuses sit around epic/legendary magnitude so completing a runeword feels
 * like minting a top-tier item. Note "Vigor" is a deliberate prefix of "Vigil" to exercise the
 * longest-match preference in {@link detectRuneword}.
 */
export const RUNEWORDS: RunewordDef[] = [
  {
    id: 'rw_vigor',
    name: 'Vigor',
    runes: ['rune_el', 'rune_tir'],
    bonuses: [
      { stat: 'move', value: 15 },
      { stat: 'vigor', value: 11 },
    ],
    flavor: 'The road quickens beneath restless feet.',
  },
  {
    id: 'rw_vigil',
    name: 'Vigil',
    runes: ['rune_el', 'rune_tir', 'rune_sol'],
    bonuses: [
      { stat: 'move', value: 17 },
      { stat: 'vigor', value: 13 },
      { stat: 'armor', value: 12 },
    ],
    flavor: 'Ever-watchful, ever-moving, never broken.',
  },
  {
    id: 'rw_bulwark',
    name: 'Bulwark',
    runes: ['rune_ort', 'rune_thul'],
    bonuses: [
      { stat: 'armor', value: 13 },
      { stat: 'hp', value: 60 },
    ],
    flavor: 'A wall of will between you and the dark.',
  },
  {
    id: 'rw_wrath',
    name: 'Wrath',
    runes: ['rune_sol', 'rune_dol', 'rune_ral'],
    bonuses: [
      { stat: 'power', value: 18 },
      { stat: 'crit', value: 14 },
      { stat: 'multishot', value: 2 },
    ],
    flavor: 'Fury given shape, splitting the air.',
  },
  {
    id: 'rw_leech',
    name: 'Leech',
    runes: ['rune_nef', 'rune_vex'],
    bonuses: [
      { stat: 'lifesteal', value: 9 },
      { stat: 'power', value: 12 },
    ],
    flavor: 'Every wound you give feeds the next.',
  },
  {
    id: 'rw_tempest',
    name: 'Tempest',
    runes: ['rune_zod', 'rune_ort'],
    bonuses: [
      { stat: 'swift', value: 15 },
      { stat: 'move', value: 13 },
    ],
    flavor: 'Strike like the squall, gone before the thunder.',
  },
  {
    id: 'rw_doom',
    name: 'Doom',
    runes: ['rune_vex', 'rune_zod', 'rune_thul'],
    bonuses: [
      { stat: 'power', value: 20 },
      { stat: 'crit', value: 16 },
      { stat: 'hp', value: 50 },
    ],
    flavor: 'The end, spoken in three syllables.',
  },
];

/** Look up a rune by id. */
export function rune(id: string): RuneDef | undefined {
  return RUNES.find((r) => r.id === id);
}

/** True if the runeword's rune sequence exactly fills the start of `sockets`, in order. */
function matchesAtStart(def: RunewordDef, sockets: readonly (string | null)[]): boolean {
  if (def.runes.length > sockets.length) return false;
  for (let i = 0; i < def.runes.length; i++) {
    if (sockets[i] !== def.runes[i]) return false;
  }
  return true;
}

/**
 * Detect the active runeword for a set of sockets. A runeword matches when its `runes` appear as a
 * contiguous run at the **start** of the sockets (`sockets[0..n-1]` exactly equal the runeword's
 * runes, in order) — extra runes/empties after the sequence are fine, but the sequence itself must
 * be exact and in order. When several runewords match, the longest (most runes) wins. Returns null
 * if none match.
 */
export function detectRuneword(sockets: readonly (string | null)[]): RunewordDef | null {
  let best: RunewordDef | null = null;
  for (const def of RUNEWORDS) {
    if (!matchesAtStart(def, sockets)) continue;
    if (best === null || def.runes.length > best.runes.length) best = def;
  }
  return best;
}

/** The bonuses of the active runeword for these sockets, or `[]` if none is active. */
export function runewordBonuses(sockets: readonly (string | null)[]): Affix[] {
  return detectRuneword(sockets)?.bonuses ?? [];
}

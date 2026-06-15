/**
 * Authored catalogue of UNIQUE (named legendary) items — the seed data for the `uniques` table.
 * This is the "world-DB content" for legendaries: edit/add rows here (or directly in the DB) to
 * change the chase. content.ts loads them at runtime; nothing reads this array during the game.
 *
 * Each entry builds on a real `items` base id (for slot + base power/hp) and carries 2-4 fixed,
 * build-defining affixes kept inside the agreed magnitude bands: power 12-22, crit 10-20,
 * multishot 2, lifesteal 6-10, move 12-18, vigor 8-15, hp 40-70, swift 10-18, armor 8-14.
 */

import type { UniqueDef } from '../../shared/uniques.js';

export const UNIQUES: UniqueDef[] = [
  {
    id: 'stormcallers_reach',
    name: "Stormcaller's Reach",
    baseId: 'doomspike_partisan',
    affixes: [
      { stat: 'multishot', value: 2 },
      { stat: 'power', value: 18 },
      { stat: 'crit', value: 12 },
    ],
    flavor: 'Each strike splits into the storm it was forged from.',
  },
  {
    id: 'widowmaker',
    name: 'Widowmaker',
    baseId: 'serpentine_dagger',
    affixes: [
      { stat: 'crit', value: 20 },
      { stat: 'lifesteal', value: 9 },
      { stat: 'swift', value: 14 },
    ],
    flavor: 'It drinks deepest from those who never saw it coming.',
  },
  {
    id: 'sunderking',
    name: 'Sunderking',
    baseId: 'mithril_warhammer',
    affixes: [
      { stat: 'power', value: 22 },
      { stat: 'armor', value: 10 },
      { stat: 'hp', value: 55 },
    ],
    flavor: 'The crown was a hammer long before it was a throne.',
  },
  {
    id: 'frostfang',
    name: 'Frostfang',
    baseId: 'frostforged_glaive',
    affixes: [
      { stat: 'power', value: 17 },
      { stat: 'swift', value: 16 },
      { stat: 'crit', value: 14 },
    ],
    flavor: 'Cold enough to still a heartbeat between two strikes.',
  },
  {
    id: 'oathkeeper',
    name: 'Oathkeeper',
    baseId: 'bulwark_of_the_pale_moon',
    affixes: [
      { stat: 'armor', value: 14 },
      { stat: 'hp', value: 70 },
      { stat: 'vigor', value: 12 },
    ],
    flavor: 'It has never broken a vow, nor a siege.',
  },
  {
    id: 'crown_of_the_vigilant',
    name: 'Crown of the Vigilant',
    baseId: 'runed_crown_of_vigil',
    affixes: [
      { stat: 'hp', value: 60 },
      { stat: 'vigor', value: 14 },
      { stat: 'armor', value: 9 },
    ],
    flavor: 'The watch never ends, and neither does its wearer.',
  },
  {
    id: 'aegis_of_the_dawnward',
    name: 'Aegis of the Dawnward',
    baseId: 'runed_aegis_plate',
    affixes: [
      { stat: 'hp', value: 68 },
      { stat: 'armor', value: 13 },
      { stat: 'vigor', value: 10 },
    ],
    flavor: 'Worn by the first to meet the dark, and the last to fall.',
  },
  {
    id: 'gravewalkers_grasp',
    name: "Gravewalker's Grasp",
    baseId: 'stormbound_grasp',
    affixes: [
      { stat: 'lifesteal', value: 10 },
      { stat: 'power', value: 14 },
      { stat: 'crit', value: 11 },
    ],
    flavor: 'What it takes from the living, it gives back to its bearer.',
  },
  {
    id: 'windstride',
    name: 'Windstride',
    baseId: 'emberstride_boots',
    affixes: [
      { stat: 'move', value: 18 },
      { stat: 'swift', value: 12 },
      { stat: 'hp', value: 45 },
    ],
    flavor: 'The ground forgets you the moment you leave it.',
  },
  {
    id: 'heart_of_the_wyrm',
    name: 'Heart of the Wyrm',
    baseId: 'wyrmscale_pendant',
    affixes: [
      { stat: 'lifesteal', value: 8 },
      { stat: 'power', value: 12 },
      { stat: 'vigor', value: 11 },
    ],
    flavor: 'It still beats, slow and patient, against your chest.',
  },
  {
    id: 'bloodbinder',
    name: 'Bloodbinder',
    baseId: 'obsidian_signet',
    affixes: [
      { stat: 'crit', value: 16 },
      { stat: 'lifesteal', value: 9 },
    ],
    flavor: 'A pact signed in red, paid in red, repaid in red.',
  },
  {
    id: 'eye_of_the_huntress',
    name: 'Eye of the Huntress',
    baseId: 'hunters_charm',
    affixes: [
      { stat: 'multishot', value: 2 },
      { stat: 'crit', value: 13 },
      { stat: 'move', value: 12 },
    ],
    flavor: 'It sees three paths where the prey sees one.',
  },

  // --- Frontier & dead-lands legendaries: fills the shoulders / waist / legs slots and
  // deepens the off-hand / neck / ring / trinket chase, themed to the later acts. ---
  {
    id: 'mantle_of_the_pale_king',
    name: 'Mantle of the Pale King',
    baseId: 'frostforged_pauldrons',
    affixes: [
      { stat: 'hp', value: 62 },
      { stat: 'armor', value: 12 },
      { stat: 'vigor', value: 10 },
    ],
    flavor: 'The cold he ruled with never left the cloth.',
  },
  {
    id: 'cinch_of_the_unmade',
    name: 'Cinch of the Unmade',
    baseId: 'runed_belt_of_wards',
    affixes: [
      { stat: 'hp', value: 58 },
      { stat: 'vigor', value: 13 },
      { stat: 'armor', value: 9 },
    ],
    flavor: 'It holds together what the world is busy forgetting.',
  },
  {
    id: 'tread_of_the_last_watch',
    name: 'Tread of the Last Watch',
    baseId: 'warden_greaves',
    affixes: [
      { stat: 'move', value: 16 },
      { stat: 'hp', value: 52 },
      { stat: 'armor', value: 10 },
    ],
    flavor: 'They walked the wall until there was no more wall to walk.',
  },
  {
    id: 'bond_of_the_hunt',
    name: 'Bond of the Hunt',
    baseId: 'band_of_the_wolf',
    affixes: [
      { stat: 'crit', value: 14 },
      { stat: 'move', value: 14 },
      { stat: 'swift', value: 12 },
    ],
    flavor: 'The pack runs as one, and so does its bearer.',
  },
  {
    id: 'emberglass_heart',
    name: 'Emberglass Heart',
    baseId: 'emberglass_orb',
    affixes: [
      { stat: 'power', value: 16 },
      { stat: 'crit', value: 13 },
      { stat: 'vigor', value: 9 },
    ],
    flavor: 'A forge-coal that never learned how to go out.',
  },
  {
    id: 'choker_of_the_sleepless',
    name: 'Choker of the Sleepless',
    baseId: 'amulet_of_the_vigil',
    affixes: [
      { stat: 'hp', value: 64 },
      { stat: 'vigor', value: 14 },
      { stat: 'lifesteal', value: 7 },
    ],
    flavor: 'Worn by those who could not afford to close their eyes.',
  },
  {
    id: 'ashen_effigy',
    name: 'Ashen Effigy',
    baseId: 'talisman_of_ash',
    affixes: [
      { stat: 'power', value: 14 },
      { stat: 'lifesteal', value: 8 },
      { stat: 'crit', value: 12 },
    ],
    flavor: 'Whatever it was carved to honor, only the ash remembers.',
  },
  {
    id: 'moonsilver_edge',
    name: 'Moonsilver Edge',
    baseId: 'moonsilver_saber',
    affixes: [
      { stat: 'crit', value: 18 },
      { stat: 'swift', value: 16 },
      { stat: 'lifesteal', value: 8 },
    ],
    flavor: 'It cuts the way moonlight does — before you know it has.',
  },

  // --- A second high-tier weapon/shield/head/neck quartet, built on the mithril & bloodstone bases
  // so the late-game chase has a few more grails to hunt. ---
  {
    id: 'mournblade',
    name: 'Mournblade',
    baseId: 'mithril_blade',
    affixes: [
      { stat: 'power', value: 21 },
      { stat: 'crit', value: 18 },
      { stat: 'lifesteal', value: 8 },
    ],
    flavor: 'Forged from a grief that never cooled — it cuts to be felt.',
  },
  {
    id: 'bastion_of_first_light',
    name: 'Bastion of the First Light',
    baseId: 'tower_shield',
    affixes: [
      { stat: 'armor', value: 14 },
      { stat: 'hp', value: 68 },
      { stat: 'vigor', value: 12 },
    ],
    flavor: 'Behind it a hundred stood; behind it a hundred lived.',
  },
  {
    id: 'helm_of_the_riven_crown',
    name: 'Helm of the Riven Crown',
    baseId: 'mithril_visage',
    affixes: [
      { stat: 'hp', value: 66 },
      { stat: 'armor', value: 12 },
      { stat: 'vigor', value: 11 },
    ],
    flavor: 'It remembers every blow it ever turned, and forgets no enemy.',
  },
  {
    id: 'sanguine_vow',
    name: 'The Sanguine Vow',
    baseId: 'bloodstone_amulet',
    affixes: [
      { stat: 'lifesteal', value: 10 },
      { stat: 'power', value: 15 },
      { stat: 'crit', value: 13 },
    ],
    flavor: 'Every wound you give pays a tithe back to your own pulse.',
  },
];

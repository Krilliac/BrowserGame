/**
 * Long-climb spell expansion: tome items + Merchant shelf rows for the abilities added in
 * `shared/combat.ts` for the lengthened progression. Mirrors the SPELLBOOKS / MERCHANT_STOCK
 * pattern in seed.ts; consumed by seed.ts via {@link ensureSpellTomeContent}.
 *
 * The ability rows themselves need no wiring — seed.ts's ensureSpellbookContent() inserts any
 * missing ability from ABILITY_ORDER. Likewise dropSpellbook() in world.ts rolls uniformly over
 * every `kind:'spellbook'` item, so registering a tome item alone puts it in the drop pool.
 * Acquisition spread: cheap early tomes sit on the Merchant's shelf; the novas and the two
 * biggest nukes are deliberately *not* stocked — drop-only chase books (bosses roll books at
 * 30% vs 0.4% per ordinary kill, so they are the realistic source); Wyrmfire Lance is the one
 * stocked late nuke, priced as a serious gold sink. Prices follow the seed.ts rule of thumb:
 * sell values ≈ 40% of the shelf price.
 */
import type { Database } from 'better-sqlite3';
import type { AbilityId } from '../../shared/combat.js';

/** One tome per new ability (same shape as seed.ts SPELLBOOKS). Drop-only tomes still get a
 *  sell value — a duplicate of a mastered spell is vendor fodder. */
export const NEW_SPELLBOOKS: Record<
  string,
  { name: string; color: string; teaches: AbilityId; sell: number }
> = {
  tome_razor_wind: {
    name: 'Tome of the Razor Wind',
    color: '#bfe8d8',
    teaches: 'razor_wind',
    sell: 70,
  },
  tome_bone_chakram: {
    name: 'Tome of the Bone Chakram',
    color: '#efe6cd',
    teaches: 'bone_chakram',
    sell: 105,
  },
  tome_mire_mortar: {
    name: 'Tome of the Mire Mortar',
    color: '#8a6b42',
    teaches: 'mire_mortar',
    sell: 135,
  },
  tome_galeburst: {
    name: 'Tome of the Galeburst',
    color: '#9fe0c8',
    teaches: 'galeburst',
    sell: 220,
  },
  tome_earthshatter: {
    name: 'Tome of Earthshatter',
    color: '#b97f3e',
    teaches: 'earthshatter',
    sell: 300,
  },
  tome_divine_mending: {
    name: 'Tome of Divine Mending',
    color: '#fff2c8',
    teaches: 'divine_mending',
    sell: 280,
  },
  tome_battle_trance: {
    name: 'Tome of the Battle Trance',
    color: '#ff7088',
    teaches: 'battle_trance',
    sell: 360,
  },
  tome_wyrmfire_lance: {
    name: 'Tome of Wyrmfire',
    color: '#ff3d3d',
    teaches: 'wyrmfire_lance',
    sell: 1040,
  },
  tome_starfall: { name: 'Tome of Starfall', color: '#e8d8ff', teaches: 'starfall', sell: 600 },
  tome_maelstrom_orb: {
    name: 'Tome of the Maelstrom',
    color: '#4fd8c9',
    teaches: 'maelstrom_orb',
    sell: 650,
  },
};

/** The Merchant's shelf additions, in rough level order. The novas, Starfall, and the Maelstrom
 *  are intentionally absent: drop-only chase books, like tome_slash / tome_fireball. */
export const NEW_MERCHANT_STOCK: { item: string; price: number }[] = [
  { item: 'tome_razor_wind', price: 180 },
  { item: 'tome_bone_chakram', price: 260 },
  { item: 'tome_mire_mortar', price: 340 },
  { item: 'tome_divine_mending', price: 700 },
  { item: 'tome_battle_trance', price: 900 },
  { item: 'tome_wyrmfire_lance', price: 2600 }, // the deterministic late-game gold sink
];

/** Shelf sort_order offset so the new rows sort after every original MERCHANT_STOCK line. */
const STOCK_SORT_BASE = 100;

/**
 * Upsert the new tome items and Merchant shelf lines. Idempotent (INSERT OR IGNORE on the item
 * PK; the shelf insert is guarded per (Merchant, item)) so it is safe on every boot — the same
 * existing-DB upgrade contract as seed.ts's ensureSpellbookContent(). Items go first:
 * vendor_stock.item_id is a foreign key and the DB runs with foreign_keys = ON.
 */
export function ensureSpellTomeContent(db: Database): void {
  const insItem = db.prepare(
    'INSERT OR IGNORE INTO items (id,name,kind,slot,power,hp,color,sell_value,teaches) VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const [id, b] of Object.entries(NEW_SPELLBOOKS)) {
    insItem.run(id, b.name, 'spellbook', null, null, null, b.color, b.sell, b.teaches);
  }

  const stockHas = db.prepare(
    "SELECT 1 FROM vendor_stock WHERE area_id = 'town' AND npc_name = 'Merchant' AND item_id = ?",
  );
  const stockIns = db.prepare(
    'INSERT INTO vendor_stock (area_id,npc_name,item_id,price,sort_order) VALUES (?,?,?,?,?)',
  );
  NEW_MERCHANT_STOCK.forEach((s, i) => {
    if (!stockHas.get(s.item))
      stockIns.run('town', 'Merchant', s.item, s.price, STOCK_SORT_BASE + i);
  });
}

# Design: Spellbook Acquisition & Vendor Shop

> Spec for the "spells are loot" redesign: abilities stop being free, and instead drop from
> mobs, come from quests, and are bought from vendors as **spellbooks**. Companion shop
> redesign so vendors *sell* as well as buy. Numbers tuned against current gold income
> (wolves drop 3–12g; the wolf-cull quest pays 50g).
>
> Status: implemented on `claude/game-feel-and-loot`. Research grounding: see
> `wiki/research/` ARPG research synthesis (PoE quest-reward gems, D2 tomes/vendor stock,
> RuneScape spellbooks).

## Why

The committed identity is **"loot = your build"** (class-less; items define your kit).
Six abilities free at spawn contradicts that: nothing you find can redefine how you play
if you already own everything. Making abilities *acquired* turns every spellbook drop into
a build moment and gives gold a real sink.

## The spellbook item

- New item kind: `spellbook` (alongside `equip` / `loot` / `currency`).
- New `items` column: `teaches` — the `AbilityId` the book grants (null for non-books).
- One book per learnable ability, id pattern `tome_<ability>`: e.g. `tome_fireball`,
  `tome_frost`, `tome_heal`, `tome_lightning`.
- Books are **stackable loot-map items** (no rolled instance) — a duplicate of a known
  spell is vendor fodder, like PoE duplicate gems. Sell values are meaningful
  (≈40% of vendor price) so a dupe still feels like a drop.

## Starter loadout

- New players know **slash** (free melee, zero mana — the "you always have a button" floor)
  and **fireball** (the caster fantasy from minute one). Everything else is found/bought.
- **Legacy saves grandfather in**: a save with no `known` field migrates to *all six*
  abilities — nobody loses a button they had yesterday.

## Acquisition paths (three, per ARPG convention)

1. **Quest rewards (the guaranteed early path — PoE model).** `quests` gains a nullable
   `reward_item` column. The existing `wolf_cull` quest now also awards `tome_heal` —
   a fresh player has a 3-ability kit inside the first 15 minutes.
2. **Drops (the excitement path).** An independent per-kill book roll (see Drop
   mechanics): 0.4% normal / 3% elite / 30% boss — rare-tier dopamine, never the main
   grind, and elites/bosses are the place to hunt books.
3. **Vendor (the deterministic sink).** The Merchant stocks a fixed spellbook shelf at
   save-up prices (see economy below).

## Learning & spell ranks (the Diablo 1 duplicate rule)

- New client message `{ t: 'learn', itemId }`. Server validates: player holds ≥1 of the
  item, it is a spellbook, the ability exists. Consume one book →
  - **Unknown spell:** learn it at rank 1 ("You learn Frostbolt!").
  - **Known spell below rank 5:** +1 rank, each rank **+12% effect** (damage / healing)
    — a duplicate book is never dead loot
    ([D1 spellbooks](https://diablo2.diablowiki.net/D1_Spellbooks)).
  - **Rank 5 (mastered):** no-op notify; the book stays in the bag as vendor fodder.
- `tome_slash` and `tome_fireball` exist but are **drop-only** (never on the vendor
  shelf) — they are how you rank the two starter spells (the PoE "Empower" chase role).
- `cast` is gated on known spells, and rank scales the effect server-side. A hostile
  client cannot cast what it never learned.
- `you` message gains `known: Record<AbilityId, number>` (spell → rank). Client hotbar
  renders unlearned slots locked (dimmed, no key hint) and shows rank pips; bag taps on a
  spellbook send `learn`.

## Drop mechanics

Books roll on an **independent table** (not the gear/material tables), per kill:
normal **0.4%**, elite **3%**, boss **30%** — targeting 1–2 books per play-hour
(PoE2 uncut-gem model). The book picked is uniform over all tomes; quest rewards are
the only fixed-spell source.

## Player state & persistence

- `Player.known: Map<AbilityId, number>` (rank); in `PlayerSave` as `known: [string, number][]`.
- Save migration: `known` absent → all current abilities at rank 1 (grandfather rule above).
- Unknown ability ids in a save (content edited later) are dropped on import.

## Vendor shop redesign

**Problem:** today `interact` (E) instantly sells the entire bag. With buying added, that
is a destructive mis-tap. **Fix:** E on a vendor now *opens a shop*; selling is explicit.

- New `vendor_stock` table: `npc_id → item_id, price, sort_order`. Seeded for the town
  Merchant: the spellbook shelf + a small gear rack.
- On interact with a vendor the server sends `{ t: 'shop', vendor, stock: [{itemId, name,
  price, kind}] }`. Client opens a shop panel (tap-to-buy, sell-bag button, Esc closes).
- New client messages:
  - `{ t: 'buy', itemId }` — server re-validates vendor proximity, stock membership, and
    gold. Gear purchases roll a **common-rarity instance** (vendor gear is a floor, not a
    jackpot — drops stay the excitement path). Spellbooks/materials go to the loot map.
  - `{ t: 'sell' }` — the old sell-everything behavior, now explicit.
- All shop actions revalidate proximity server-side (`INTERACT_RANGE`); the panel being
  open on a client grants nothing.

## Economy (tuned to measured income)

Income reference: wolf kill ≈ 13g EV all-in (gold + pelt); research formula: a tier-1 book
≈ 25× per-kill EV ≈ 30–45 min of farming; quest-progression spells at half price.

| Item | Vendor price | Sell value | Notes |
|---|---|---|---|
| `tome_heal` | 150g | 60g | The quest-adjacent defensive spell, half price |
| `tome_arrow` | 300g | 120g | Tier-1 |
| `tome_frost` | 300g | 120g | Tier-1 control caster unlock |
| `tome_lightning` | 700g | 280g | Tier-2 save-up prestige buy |
| `tome_slash` / `tome_fireball` | — (drop-only) | 100g | Rank-up chase books for the starters |
| Gear rack (common roll) | ≈ 25 × item level | — | Gap-filler, not a jackpot |

Also retuned: `wolf_cull` reward 50g → **150g** (quest gold should be 10–20× area
per-kill EV), and it now awards `tome_heal` (the guaranteed ~15-minute third spell).

Drop-path books are *free* but rare; the vendor is the deterministic fallback — both paths
stay alive (PoE/D2 precedent). Future (researched, deferred): rotating 3-book stock with a
4-minute D2-style refresh, sealed-tome gambling at 40% price, slot-targeted gear gambler.

## Out of scope (deliberately)

- Gambling vendor (loved gold sink; future — needs its own UI treatment).
- Per-vendor restocking/rotation; ability *ranks*; rune/reagent costs (RuneScape model).
- New abilities beyond the existing six — this slice converts acquisition; the next
  content slice adds areas/mobs and can mint new tomes cheaply afterwards.

## Test plan

- World tests: cast-gating (unknown ability rejected), learn (consume/dupe/unknown-item),
  buy (gold check, proximity check, stock check, gear rolls common), sell stays correct,
  save round-trip with and without `known` (grandfather path).
- Bot harness: a `shopper` behavior buys a tome and learns it under load.

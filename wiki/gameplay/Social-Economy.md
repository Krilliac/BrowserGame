# Social & Economy — Guilds, Mail & Auction House

> Persistent player-to-player systems that span instances: form a **guild**, send **mail** (gold +
> items, even to offline players), and trade on the **auction house**. All three are
> server-authoritative, DB-persisted, and loss-safe.

## Guilds

Persistent player societies with a roster, three ranks, and a dedicated chat channel. A player is in
at most one guild; a guild always has exactly one leader; the last member out disbands it.

Ranks gate the actions: **officers and the leader** invite and kick members; **only the leader**
sets ranks. When the leader leaves, the highest-ranked other member (an officer first, else the next
member) is promoted to leader.

### Commands

- `/guild create <name>` — found a guild (name 3–24 chars). Roster cap is `MAX_GUILD_SIZE` (**30**).
- `/guild invite <player>` — invite an online player (officer+).
- `/guild accept` / `/guild decline` — answer a pending invite.
- `/guild leave` — leave (may promote a new leader or disband).
- `/guild kick <player>` — remove a member (officer+; the leader can't be kicked).
- `/guild promote <player>` / `/guild demote <player>` — set officer/member (leader only).
- `/guild` or `/guild roster` — show the roster with live online/area presence.
- `/g <message>` — guild chat (green channel).

#### Guild bank

A shared per-guild vault for gold and items — a reason to bank loot together.

- `/guild bank` — list the vault: its gold and each stored item with a withdraw id.
- `/guild deposit gold <amount>` / `/guild deposit item <item-uid>` — add to the vault (**any member**).
- `/guild withdraw gold <amount>` / `/guild withdraw item <bank-id>` — take from the vault
  (**officers + the leader only** — anti-grief; members can fill it but not drain it).
- Deposits and withdrawals post a line in guild chat (transparency).
- Capped at `MAX_BANK_ITEMS` (**100**) items. Item custody reuses the loss-safe mail primitives —
  a full bank or a full bag hands the item straight back, nothing is destroyed. Withdrawals are
  server-scoped to the caller's guild (you can't pull another guild's item by guessing an id).
  Disbanding a guild clears its bank.

### Key files & data

- `src/server/guild.ts` — the pure, unit-tested `GuildRegistry` over an injected `GuildStore`,
  dealing in opaque persistent owner tokens + display names (mirrors `party.ts` / `social.ts`).
- `src/server/guild-bank.ts` — the unit-tested bank store + rank policy (`canWithdraw`), backed by
  the `guild_bank` / `guild_bank_items` tables.
- `guilds` + `guild_members` tables (new, no migration). Persistence + chat fan-out are wired
  host-level through `CommandContext` hooks in `src/server/index.ts` (no client panel needed) — the
  bank hooks combine the registry's rank with the `World` gold/item custody and the bank store.

## Mail

Deferred player-to-player delivery of gold plus an optional gear item. Mail waits in the recipient's
inbox even while they are offline. Recipients resolve by online presence first, else the most-recent
save by that name. Inbox cap is `MAX_MAIL` (**30**).

Loss-safe: the attachment is pulled from the sender's live bag and refunded if a later check fails;
a recipient with a full bag refuses item delivery (the mail is kept); collected items get a fresh
uid to avoid id collisions.

### Commands

- `/mail` — read your mailbox.
- `/mail send <player> <gold> [itemUid]` — send gold and an optional bag item.
- `/mail take <id>` — collect one piece of mail.
- `/mail takeall` — collect everything.

### Key files & data

- `src/server/player-store.ts` — `mail` table primitives (`sendMail`, `loadMail`, `getMail`,
  `mailCount`, `deleteMail`).
- `src/server/index.ts` — the `/mail` handler (bag/refund logic, recipient resolution).

The auction house delivers seller proceeds and returned items through this same mail channel.

## Auction house

A persistent player-to-player buyout market with a built-in gold sink. Listing escrows a bag item;
a buyer pays gold and receives the item; proceeds are mailed to the (possibly offline) seller minus a
**5%** house cut (`AUCTION_CUT`) that acts as a gold sink. Cancelling mails the item back. Per-seller
listing cap is `MAX_AUCTIONS_PER_SELLER` (**10**).

Loss-safe: the item leaves the seller's live bag into escrow at listing time; a buyer with a full bag
is refunded and the sale aborts.

### Commands

- `/ah` — browse listings.
- `/ah list <itemUid> <price>` — escrow a bag item for sale (`/ah sell` is an alias).
- `/ah buy <id>` — purchase (gold out, item in).
- `/ah mine` — your active listings.
- `/ah cancel <id>` — cancel a listing (item mailed back).

### Key files & data

- `src/server/player-store.ts` — `auctions` table primitives + `AUCTION_CUT`, `auctionPayout`,
  `createAuction`, `loadAuctions`, `getAuction`, `auctionsBySeller`, `deleteAuction`.
- `src/server/index.ts` — the `/ah` handler (escrow, payout via mail, refunds).

## See also

- [Chat Commands & Access Levels](../architecture/Commands-And-Access.md)
- [Content Database (SQLite)](../architecture/Content-Database.md)

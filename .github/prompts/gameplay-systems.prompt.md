# Prompt: Gameplay systems

Use when adding a gameplay system (inventory, crafting, party, chat, guild, combat, loot…).

Reference blueprint: SparkEngine's `GameModules/SparkGameMMO/` enumerates the systems an MMO of
this kind needs — Inventory + loot tables, Crafting, Trading, Guild, Party, Chat, Reputation,
Achievements, Dungeon, WorldBoss, Character, Account, Persistence. Treat it as a *design* checklist
to reimplement cleanly in TypeScript, not code to copy.

Rules for this repo:

1. **Server-authoritative.** The system's truth lives on the server. The client renders and
   requests; it never asserts outcomes (no client-decided loot, gold, or trades).
2. **Pure core, thin transport.** Put the logic in a framework-free, unit-tested module (mirror
   `src/server/world.ts` + `world.test.ts`). Wire it to the protocol separately.
3. **Extend the protocol deliberately.** Add message variants to `src/shared/protocol.ts` and
   decode them defensively.
4. **Validate everything.** Clamp quantities, check ownership, reject spoofed ids.
5. **One source of truth.** Don't create a second inventory/registry if one exists.

Deliver: the module + its tests + a protocol update + a short `wiki/` page + a `CHANGELOG.md` entry.

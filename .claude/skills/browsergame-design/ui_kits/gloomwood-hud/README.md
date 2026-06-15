# Gloomwood HUD — UI kit

A high-fidelity, interactive recreation of BrowserGame's in-game screen: the 2.5D
world viewport, the player resource orbs, the action bar (potion belt + spell
hotbar), minimap, chat, the XP strip, and the **Inventory** and **Merchant**
windows. It composes the design-system primitives — it does **not** re-implement
them.

## Files
- `index.html` — the app. Owns demo state (player vitals, gold, belt, cooldowns,
  open panel) and all interaction. **Open this** to see the kit.
- `Scene.jsx` → `window.GloomScene` — the world layer: procedural-shape entities
  (matching the game's current renderer), scattered pixel-art decor, an edge
  vignette + corruption pall, a torch-lit player, monster Nameplates, a loot
  beacon, and a portal.
- `Hud.jsx` → `window.GloomHud` — the chrome: topbar, minimap, OrbGauges, the
  belt + AbilitySlot hotbar, XP ResourceBar, chat, and the I/M menu buttons.
- `InventoryView.jsx` → `window.GloomInventory` — character doll + bag grid of
  IconSlots with a live ItemTooltip on hover.
- `MerchantView.jsx` → `window.GloomMerchant` — vendor stock grid + tooltip +
  Buy button (vendor rolls are always common, per `items.ts`).

## Interactions
- **I** / ▣ button — toggle Inventory · **M** / ◈ button — toggle Merchant · **Esc** — close
- **1–4** or click — cast (drains mana, runs a radial cooldown) · **Q / E** — drink health / mana potion
- Hover any inventory or merchant item — its ItemTooltip appears · Buy — deducts gold

## Components used
`OrbGauge`, `AbilitySlot`, `ResourceBar`, `Nameplate`, `IconSlot`, `Panel`,
`Button`, `ItemTooltip`, `RarityName`, `Badge` — all from
`window.BrowserGameARPGDesignSystem_aa965c`.

## Fidelity notes
- Player/monsters are drawn as **procedural shape tokens** because the live game
  currently renders entities procedurally (sprite atlases are deferred — see the
  repo's `wiki/research/rendering-and-assets.md`). Swap in sprite sheets when the
  art pipeline lands.
- The ground is rendered with CSS gradients tinted to the Gloomwood biome
  (`groundBase #1f2a1c`), not a tiled sheet, so the mood reads cleanly at any size.

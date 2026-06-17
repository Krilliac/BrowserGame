# Item / Gem Inspect Tooltip — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Hover an item/gem → a read-only stats tooltip; click/tap an item/gem → a pinned inspect popup showing ALL stats + context action buttons (Equip/Unequip/Salvage/Sell/Unsocket). Works on desktop (hover+click) and phone (tap). Matches the HUD's obsidian/gold style.

**Design (approved):**
- **Hover** (pointer-with-hover): show a read-only tooltip near the cursor over any item/gem slot.
- **Click/tap**: open a *pinned* inspect popup (same content) with action buttons; click elsewhere dismisses. This replaces instant-equip-on-click; **shift-click and double-click remain fast-equip / fast-salvage** so power users keep instant actions.
- Covered surfaces: HUD bag strip (`bagRects`), full Inventory panel (`inventoryButtons`), character/equipment slots (`charSlotRects`), Vault/Stash (`stash-panel` buttons), HUD gem strip (`socketRects`).
- Content: rarity-colored title (`instanceTitle`), type/slot line, base `+pow/+hp`, every affix (pretty-printed, debuffs red), set-bonus tag, sockets (filled = gem name+effect in gem color / empty = ◇), sell value, spellbook "Teaches: X". For a GEM: name (gem color) + its socket effect (`+N <stat>`, `mult`/homing note).
- Architecture: a PURE `src/client/item-tooltip.ts` builds a render model (`TooltipModel { title, titleColor, lines: {text,color,debuff?}[], actions: {label,action,uid}[] }`) from an `ItemInstance` (or a gem id) + resolver callbacks — unit-tested. A thin Canvas2D `drawTooltip(hud, model, x, y, view)` renders it (untested, mirrors the portal-waymark floating-box pattern). Click wiring + action buttons in `main.ts` via the existing `HitRegions`.

**Tech Stack:** TS strict, Canvas2D HUD, Vitest. Gate: `NODE_OPTIONS=--use-system-ca npm run check`. Trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Branch `loop/autonomous-20260614`. Push at the end.

---

## Task 1: Pretty-print the new stats in `affixLabel` (+ tests)

**Files:** `src/shared/items.ts`, `src/shared/items.test.ts`

- [ ] **Step 1 (test first):** In `items.test.ts`, add cases asserting `affixLabel` for the Slice-2/4 stats: `affixLabel({stat:'chain',value:1})` → `'+1 chain'`; `fork`→`'+1 fork'`; `pierce`→`'+1 pierce'`; `spellaoe` value 12 → `'+12% area'`; `firedmg` 8 → `'+8% fire damage'`; `colddmg`→`'+8% cold damage'`; `lightningdmg`→`'+8% lightning damage'`; `poisondmg`→`'+8% poison damage'`; `physdmg`→`'+8% physical damage'`; `penetration` 5 → `'+5% penetration'`; `ailmentdur` 10 → `'+10% ailment duration'`; `ailmentmag` 8 → `'+8% ailment effect'`. Run → fail (current default gives `'+N stat'`).
- [ ] **Step 2:** Extend the `affixLabel` switch (`items.ts:329`) with arms for those stats producing the strings above (percent stats use `%`; chain/pierce/fork are integer counts). Keep existing arms. Run → pass. `npm run check` → green.
- [ ] **Step 3:** Commit: `feat(items): pretty-print element/penetration/ailment/behavior affix labels`

---

## Task 2: Pure `item-tooltip.ts` render-model builder (+ tests)

**Files:** create `src/client/item-tooltip.ts`, `src/client/item-tooltip.test.ts`

- [ ] **Step 1 (design the model + resolvers):** Define:
```ts
export interface TooltipLine { text: string; color: string; debuff?: boolean; }
export interface TooltipAction { label: string; action: 'equip' | 'unequip' | 'salvage' | 'sell' | 'unsocket'; uid?: number; index?: number; }
export interface TooltipModel { title: string; titleColor: string; lines: TooltipLine[]; actions: TooltipAction[]; }
export interface ItemResolvers {
  itemInfo: (id: string) => { name: string; kind: string; slot: string | null; sellValue: number; teaches: string | null } | undefined;
  gemName: (id: string) => string;
  gemColor: (id: string) => string;
  gemEffect: (id: string) => string | undefined; // e.g. "+10 power", "+1 chain", "−20% spell dmg"
  abilityName: (id: string) => string | undefined; // for spellbook "Teaches:"
  rarityColor: (rarity: string) => string;
  slotLabel: (slot: string) => string;
}
```
- [ ] **Step 2 (failing tests):** In `item-tooltip.test.ts`, test `buildItemTooltip(inst, resolvers, ctx)` and `buildGemTooltip(gemId, resolvers)`:
  - a magic sword with `power:10, hp:0, affixes:[{stat:'power',value:5},{stat:'firedmg',value:8}], sockets:['ruby_t1',null]` → title is the instanceTitle in the rarity color; lines include "+10 pow", "+5 power", "+8% fire damage", a socket line for the ruby (its effect, in ruby color) and an empty socket; a "Type: Sword (mainhand)"-style line; "Sell: N".
  - a corrupted item with a `frail` affix → that line marked `debuff:true`.
  - a spellbook item (kind 'spellbook', teaches 'fireball') → a "Teaches: Fireball" line.
  - `buildGemTooltip('overcharge_t3', ...)` → title = gem name in gem color; a line with the gem effect (e.g. "+3 chain") and the mult note.
  - actions: for `ctx={where:'bag'}` → `[{equip},{salvage}]`; `ctx={where:'equipped'}` → `[{unequip}]`; `ctx={where:'vault'}` → `[{...}]` per what the vault supports; gem → `[]` (or unsocket if `ctx.socketIndex` given). Keep actions data-only (the renderer turns them into buttons; main.ts routes them to existing net calls).
- [ ] **Step 3:** Implement `item-tooltip.ts` (pure; reuse `instanceTitle`, `affixLabel`, `isDebuff`, `RARITY`, `ITEM_SETS` from items.ts; `SLOT_LABELS` from equipment.ts — all importable). Build lines in order: type/slot, base pow/hp, affixes, set tag, sockets, sell, teaches. `buildGemTooltip` uses gemName/gemColor/gemEffect. Compute `actions` from `ctx`.
- [ ] **Step 4:** Run tests → pass. `npm run check` → green. Commit: `feat(client): pure item/gem tooltip render-model builder + tests`

---

## Task 3: Canvas2D tooltip renderer + hover wiring

**Files:** `src/client/item-tooltip.ts` (add `drawTooltip`), `src/client/main.ts`

- [ ] **Step 1:** Add `drawTooltip(hud: CanvasRenderingContext2D, model: TooltipModel, x: number, y: number, view: {w:number;h:number}): {x:number;y:number;w:number;h:number}` to `item-tooltip.ts` — measures lines, draws the obsidian box (`rgba(8,9,13,0.96)` fill, `#c9a24b` 2px stroke, rounded), title in `model.titleColor` bold, each line in its color (debuff red), clamped to the viewport (reuse `clampPanelRect` from `ui-guard.ts`). Returns the final rect (for hit-testing action buttons in Task 4). Do NOT draw action buttons here yet (Task 4 draws them as part of the pinned popup); for the HOVER tooltip, actions are omitted.
- [ ] **Step 2:** In `main.ts`, track hover: each frame after the slot-rect arrays are populated (bagRects/charSlotRects/socketRects + the panel buttons), if not currently showing a pinned popup, find the slot under `mouseX/mouseY`; if found, build its `TooltipModel` (read-only, no actions) and `drawTooltip` it near the cursor at the end of `drawHud()`. Resolve the `ItemInstance` from `net.you.gear`/loot by uid, or the gem id from the slot. Provide the resolver callbacks (itemInfo via `net.content.item`, gemEffect via the shared `GEMS` catalog + `affixLabel`, abilityName via `net.content.ability`, rarityColor via `RARITY`, slotLabel via `SLOT_LABELS`).
- [ ] **Step 3:** `npm run check` → green. Manual: hovering a bag item shows its tooltip. Commit: `feat(hud): hover tooltip for items/gems`

---

## Task 4: Click → pinned inspect popup with action buttons

**Files:** `src/client/main.ts`

- [ ] **Step 1:** Add state `pinnedInspect: { kind: 'item'; uid: number } | { kind: 'gem'; id: string; socketIndex?: number } | null` + its screen anchor. On a plain (non-shift, non-double) left-click/tap of any item/gem slot, set `pinnedInspect` to that item instead of immediately equipping. Keep **shift-click = salvage** and add **double-click = equip** (fast path) on bag/inventory items. (Read the existing bag/inventory/char/stash click handlers and gate the plain-click branch to open the popup; preserve shift/right-click semantics.)
- [ ] **Step 2:** Each frame, when `pinnedInspect` is set, build the `TooltipModel` WITH actions (ctx from where the item lives), `drawTooltip` it pinned at the anchor, then draw each `model.actions[]` as a button row below the box and register each as a `hitRegions.add({...,onClick})` that routes to the existing net call: equip→`net.sendEquip(uid)`, salvage→`net.sendSalvage(uid)`, sell→the merchant sell call if a merchant is open, unequip→equip call on an equipped slot (or the existing unequip path), unsocket→the existing unsocket flow (Artificer). After an action fires, clear `pinnedInspect`.
- [ ] **Step 3:** Dismiss: a click/tap outside the popup rect (and not on a button) clears `pinnedInspect`; Esc clears it. Ensure the popup is drawn last (on top of panels) and its hit regions are registered after others so they win.
- [ ] **Step 4:** `npm run check` → green. Manual: click a bag item → popup with stats + Equip/Salvage; click Equip → equips + closes; click away → closes; shift-click still salvages; double-click still equips. Commit: `feat(hud): click-to-open item/gem inspect popup with action buttons`

---

## Task 5: Verify + changelog + push

- [ ] **Step 1:** `NODE_OPTIONS=--use-system-ca npm run check` → fully green. Confirm dev server (`/tmp/devserver3.log`) booted clean.
- [ ] **Step 2:** CHANGELOG `### Added`: item/gem inspect — hover tooltip + click/tap popup with all stats (base, affixes, sockets/gems, set, sell, spellbook teaches) and action buttons; pretty-printed the element/penetration/ailment/behavior affixes; fast-equip preserved (double/shift-click).
- [ ] **Step 3:** Commit `docs: changelog for item inspect tooltip` and `git push origin loop/autonomous-20260614`.

---

## Self-review notes
- Pure model builder (Task 2) carries the logic + tests; the Canvas draw + click wiring are thin and manual-verified (HUD is untested by nature). affixLabel pretty-print (Task 1) is unit-tested.
- Non-breaking: shift-click (salvage) + double-click (equip) preserve fast actions; only the plain single-click changes from instant-equip to inspect-popup (the requested behavior). Hover adds no behavior change.
- Mobile: tap = open popup (no hover needed); action buttons are tap targets.
- No protocol/server change — read-only display of existing client data + routing to existing net calls.

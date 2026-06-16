/**
 * Pure render-model builder for item and gem tooltips.
 *
 * Everything here is framework-free and DOM-free — the output is a plain data model that the
 * HUD renderer (or any other consumer) can draw however it likes. Keeping this pure makes it
 * unit-testable without a canvas environment.
 */

import type { ItemInstance } from '../shared/items.js';
import { affixLabel, instanceTitle, isDebuff, RARITY } from '../shared/items.js';
import { ITEM_SETS } from '../shared/item-sets.js';
import { SLOT_LABELS } from '../shared/equipment.js';

// ---------------------------------------------------------------------------
// Public model types
// ---------------------------------------------------------------------------

/** One rendered line in a tooltip — a text string, its display color, and an optional debuff flag. */
export interface TooltipLine {
  text: string;
  color: string;
  debuff?: boolean;
}

/** One interactive button at the bottom of a tooltip. */
export interface TooltipAction {
  label: string;
  action: 'equip' | 'unequip' | 'salvage' | 'sell' | 'unsocket';
  uid?: number;
  /** Socket index, used for unsocket actions. */
  index?: number;
}

/** The full data model for rendering a tooltip. */
export interface TooltipModel {
  title: string;
  titleColor: string;
  lines: TooltipLine[];
  actions: TooltipAction[];
}

// ---------------------------------------------------------------------------
// Resolver callbacks — injected so callers can supply whatever lookup tables
// they have available (network content, test stubs, etc.).
// ---------------------------------------------------------------------------

export interface TooltipResolvers {
  /** Resolve a base item id to its metadata. Returns undefined if unknown. */
  itemInfo: (
    id: string,
  ) =>
    | { name: string; kind: string; slot: string | null; sellValue: number; teaches: string | null }
    | undefined;
  /** Resolve a spell id to its display name (for spellbook "Teaches:" lines). */
  abilityName: (id: string) => string | undefined;
  /** Display name for a gem id. */
  gemName: (id: string) => string;
  /** UI color hex for a gem id. */
  gemColor: (id: string) => string;
  /** Human-readable socket effect for a gem (e.g. "+10 power"). */
  gemEffect: (id: string) => string | undefined;
}

/**
 * Which context the item is being viewed in — determines which actions are shown.
 *
 * - `'bag'`      → Equip + Salvage
 * - `'equipped'` → Unequip
 * - `'vault'`    → Equip (withdraw-style — same action, vault caller interprets it)
 * - `'gem-strip'`/`'none'` → No item actions (gem-strip context is handled by the caller)
 */
export type InspectContext = 'bag' | 'equipped' | 'vault' | 'gem-strip' | 'none';

// ---------------------------------------------------------------------------
// Colour constants
// ---------------------------------------------------------------------------

const COLOR_STAT = '#9fb0c0';
const COLOR_DEBUFF = '#ff6b6b';
const COLOR_SET = '#9be09b';
const COLOR_SOCKET_EMPTY = '#666e7a';
const COLOR_FALLBACK_TITLE = '#c9c9c9';

// ---------------------------------------------------------------------------
// Public builder — item tooltip
// ---------------------------------------------------------------------------

/**
 * Build a {@link TooltipModel} for a concrete gear instance.
 *
 * Lines are emitted in this order:
 *   1. Type/slot line  (kind + SLOT_LABELS[slot])
 *   2. Base stats      (+N pow, +N hp)
 *   3. Affixes         (via affixLabel; debuffs colored red)
 *   4. Set-bonus tag   (◆ SetName in green, when the item belongs to a set)
 *   5. Sockets         (filled gem name+effect, or "◇ empty socket")
 *   6. Sell value
 *   7. Spellbook "Teaches:" line
 *
 * Actions depend on `ctx` (see {@link InspectContext}).
 */
export function buildItemTooltip(
  inst: ItemInstance,
  baseName: string,
  resolvers: TooltipResolvers,
  ctx: InspectContext,
): TooltipModel {
  const info = resolvers.itemInfo(inst.baseId);
  const lines: TooltipLine[] = [];

  // 1. Type / slot line
  if (info) {
    const kindLabel = info.kind === 'equip' ? 'Equipment' : info.kind;
    const slotLabel =
      info.slot !== null ? (SLOT_LABELS[info.slot as keyof typeof SLOT_LABELS] ?? info.slot) : null;
    const typeText = slotLabel ? `${kindLabel} · ${slotLabel}` : kindLabel;
    lines.push({ text: typeText, color: COLOR_STAT });
  }

  // 2. Base stats
  if (inst.power > 0) {
    lines.push({ text: `+${inst.power} pow`, color: COLOR_STAT });
  }
  if (inst.hp > 0) {
    lines.push({ text: `+${inst.hp} hp`, color: COLOR_STAT });
  }

  // 3. Affixes
  for (const a of inst.affixes) {
    const debuff = isDebuff(a);
    lines.push({
      text: affixLabel(a),
      color: debuff ? COLOR_DEBUFF : COLOR_STAT,
      debuff,
    });
  }

  // 4. Set-bonus tag
  const set = ITEM_SETS.find((s) => s.pieces.includes(inst.baseId));
  if (set) {
    lines.push({ text: `◆ ${set.name}`, color: COLOR_SET });
  }

  // 5. Sockets
  const sockets = inst.sockets ?? [];
  for (const gemId of sockets) {
    if (gemId !== null) {
      const name = resolvers.gemName(gemId);
      const effect = resolvers.gemEffect(gemId);
      const gemColor = resolvers.gemColor(gemId);
      const text = effect ? `${name}: ${effect}` : name;
      lines.push({ text, color: gemColor });
    } else {
      lines.push({ text: '◇ empty socket', color: COLOR_SOCKET_EMPTY });
    }
  }

  // 6. Sell value
  const sellValue = info?.sellValue ?? 0;
  if (sellValue > 0) {
    lines.push({ text: `Sell: ${sellValue}`, color: COLOR_STAT });
  }

  // 7. Spellbook — "Teaches:" line
  if (info?.kind === 'spellbook' && info.teaches) {
    const abilityDisplayName = resolvers.abilityName(info.teaches) ?? info.teaches;
    lines.push({ text: `Teaches: ${abilityDisplayName}`, color: COLOR_STAT });
  }

  // Actions by context
  const actions: TooltipAction[] = buildItemActions(inst.uid, ctx);

  return {
    title: instanceTitle(inst, baseName),
    titleColor: RARITY[inst.rarity]?.color ?? COLOR_FALLBACK_TITLE,
    lines,
    actions,
  };
}

// ---------------------------------------------------------------------------
// Public builder — gem tooltip
// ---------------------------------------------------------------------------

/**
 * Build a {@link TooltipModel} for a gem (shown when hovering a socketed gem or a gem in a bag).
 * Actions are always empty — unsocket is handled by the caller's context.
 */
export function buildGemTooltip(gemId: string, resolvers: TooltipResolvers): TooltipModel {
  const name = resolvers.gemName(gemId);
  const color = resolvers.gemColor(gemId);
  const effect = resolvers.gemEffect(gemId);

  const lines: TooltipLine[] = [];
  lines.push({ text: effect ?? 'Gem', color: COLOR_STAT });

  return {
    title: name,
    titleColor: color,
    lines,
    actions: [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildItemActions(uid: number, ctx: InspectContext): TooltipAction[] {
  switch (ctx) {
    case 'bag':
      return [
        { label: 'Equip', action: 'equip', uid },
        { label: 'Salvage', action: 'salvage', uid },
      ];
    case 'equipped':
      return [{ label: 'Unequip', action: 'unequip', uid }];
    case 'vault':
      return [{ label: 'Equip', action: 'equip', uid }];
    case 'gem-strip':
    case 'none':
      return [];
  }
}

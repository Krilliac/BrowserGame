**ItemTooltip** — the loot inspection card; the single most important surface in the game. Use on hover/long-press of any item.

```jsx
<ItemTooltip
  name="Savage Doomscar of the Boar"
  rarity="legendary"
  itemType="Two-Handed Sword"
  baseStats={[{ label: 'Damage', value: '41' }, { label: '+Max HP', value: '+24' }]}
  affixes={[{ text: '+6% crit' }, { text: '+1 projectile' }, { text: '−30 hp', debuff: true }]}
  sockets={['assets/icons/rune-vex.png', null]}
  flavor="It remembers every throat it has opened."
  requiredLevel={28}
  value={1240}
/>
```

Title is centered in the rarity color (auto-glow for epic+). Buffs render steel-blue, debuffs blood-red. Pass `sockets` as gem-icon URLs or `null` for empties. Pre-format affix `text` yourself (the game's `affixLabel` does this). For corrupted gear use `rarity="corrupted"` and add the debuff affix.

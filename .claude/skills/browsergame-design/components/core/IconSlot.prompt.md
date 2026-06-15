**IconSlot** — the atomic recessed cell for inventory, vault, belt and hotbar. Pass `rarity` to get the colored frame + glow ring.

```jsx
<IconSlot src="assets/icons/gem-ruby.png" rarity="epic" count={3} />
<IconSlot src="assets/icons/rune-vex.png" rarity="legendary" hotkey="Q" />
<IconSlot empty />            // dim recessed empty cell
<IconSlot selected rarity="unique" src={icon} />
```

`rarity`: `common · magic · rare · epic · legendary · corrupted · unique` (null = neutral). `size` defaults 52 (hotbar); use 44 for belt, 56 for inventory. Provide `children` instead of `src` for a non-image slot.

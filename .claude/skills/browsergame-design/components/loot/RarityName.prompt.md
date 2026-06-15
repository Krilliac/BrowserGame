**RarityName** — paints an item title in its loot-tier color; use anywhere an item is named inline (chat drops, loot toasts, bag rows).

```jsx
<RarityName rarity="legendary">Merciless Doomscar of the Colossus</RarityName>
<RarityName rarity="magic" size="sm">Jagged Iron Dagger</RarityName>
```

`rarity`: common · magic · rare · epic · legendary · corrupted · unique. Higher tiers auto-glow. Also exports `RARITY_COLOR` map.

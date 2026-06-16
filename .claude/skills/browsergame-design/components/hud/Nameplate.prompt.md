**Nameplate** — the floating name + health bar above a monster; pin it above the sprite in the world layer.

```jsx
<Nameplate name="Rot Ghoul" level={6} hp={62} maxHp={80} />
<Nameplate name="Maggath" tier="boss" level={12} hp={1800} maxHp={2400} />
<Nameplate name="Tusk Runner" tier="elite" hp={120} maxHp={140} />
```

`tier`: `normal` (white) · `elite` (blue) · `champion` (gold) · `boss` (corrupted red, wider bar). Composes ResourceBar for the health track.

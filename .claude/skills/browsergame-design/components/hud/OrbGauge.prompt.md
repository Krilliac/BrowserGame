**OrbGauge** — the iconic liquid health/mana globe that anchors the HUD's bottom corners.

```jsx
<OrbGauge type="health" value={420} max={560} />
<OrbGauge type="mana" value={88} max={120} size={92} />
```

`type` picks the palette (health red / mana blue). The fill rises to `value/max`. Place health bottom-left, mana bottom-right.

**ResourceBar** — flat gold-framed gauge; the bar alternative to OrbGauge. Use for the XP strip, party/nameplate health, and cast/boss bars.

```jsx
<ResourceBar kind="xp" value={3200} max={5000} label="Level 14" showValue />
<ResourceBar kind="health" value={38} max={120} height={8} />
```

`kind`: `health · mana · xp · essence`. Thin (`height={6–8}`) for nameplates; default 16 for the player frame.

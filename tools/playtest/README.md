# Playtest tooling

Offline + headless instruments for judging *feel* and *balance* — complements the load/chaos
bots in `../bots/`.

| File | What it does |
|------|--------------|
| `pacing.ts` | Offline Act-1 pacing simulator over the pure `World` (no network/render). A scripted "competent player" fights level-band by level-band; prints a balance report — per-level time, kills, deaths, gold, potions, town trips, TTK probes, and wall/cliff verdicts against the 2.5–6h Act-1-exit target. |
| `session.mjs` | Headless Playwright playthrough of the **built** client: walks/fights, toggles F9, screenshots key moments, and reports page errors. Catches client-side runtime breakage the pure sim can't see. |
| `inspector-check.mjs` | Confirms the F9 dev inspector mounts against the running **dev** server (it's tree-shaken out of prod builds). |

## Usage

```bash
# Balance report (reproducible; tune off the per-level times + TTK)
npx tsx tools/playtest/pacing.ts --seed 1 [--levelCap 20] [--verbose]

# Headless playthrough of the prod build (needs `npm run build` first)
node tools/playtest/session.mjs [outDir]

# Inspector smoke check (needs `npm run dev` running on :5173)
node tools/playtest/inspector-check.mjs [http://localhost:5173/]
```

`pacing.ts` is the balance instrument. Its player is *optimal* (no missed casts, minimap-omniscient
between packs), so its absolute times run ~1.5–2× faster than a human — read the **shape** (which
levels are walls/cliffs, where TTK collapses), not the raw clock. The TTK probe gives a clean
level-appropriate character, so a one-shot result there means player power has outscaled mob HP at
that level — the lever is `LEVEL_HP_SCALE` / `MOB_HP_TUNING` in `world.ts` or the `(ability.damage
+ power)` damage formula.

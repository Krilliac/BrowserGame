# Contributing

Thanks for working on BrowserGame. This project values **simplicity, readability, and a green
check** over cleverness.

## Setup

```bash
npm install
npm run dev      # game server + client together
```

Requires Node 20+ (see `.nvmrc` — Node 22 is the pinned dev version).

## The loop

1. Read [`CLAUDE.md`](CLAUDE.md) and the relevant [`wiki/`](wiki/_Sidebar.md) pages.
2. Make the smallest change that solves the problem (see the anti-bloat checklist in `CLAUDE.md`).
3. Add/adjust a test — pure logic lives in testable modules (e.g. `src/server/world.ts`).
4. Run the full gate:

   ```bash
   npm run check     # typecheck + lint + format:check + test
   npm run lint:fix && npm run format   # auto-fix style
   ```

5. Update docs: a `wiki/` page and/or a `CHANGELOG.md` entry if behavior changed.

## Conventions

- **TypeScript strict**, ESM, explicit `.js` import extensions on relative imports.
- **Server-authoritative**: clients send intent, never state. Validate at the boundary.
- **Commits**: present-tense, imperative subject ("Add area streaming"), explain *why* in the body.
- **Branches**: feature branches; keep PRs focused and reviewable.

## Definition of done

The checklist in [`CLAUDE.md`](CLAUDE.md) → "Definition of done" is the bar. CI enforces the
mechanical parts (`.github/workflows/ci.yml`); you own the judgment parts.

# Dev Environment

> The tools and standards that keep the codebase consistent and the loop fast.

## Stack

- **TypeScript** (strict) — `tsconfig.json` enables `strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and friends.
- **Vite** — client dev server + bundler (`vite.config.ts`).
- **tsx** — runs/watches the server in dev without a separate build step.
- **Vitest** — fast unit tests (`*.test.ts`).
- **ESLint** (flat config) + **Prettier** — linting and formatting.
- **EditorConfig** — editor-level consistency.

## Everyday commands

| Command | Purpose |
|---|---|
| `npm run dev` | Server + client together, hot reload |
| `npm run check` | Full gate: typecheck + lint + format:check + test |
| `npm run lint:fix` / `npm run format` | Auto-fix |
| `npm test` / `npm run test:watch` | Tests |
| `npm run build` / `npm start` | Production build + run |

## Conventions

- ESM with explicit `.js` extensions on relative imports (Node server requirement; Vite/Vitest
  resolve them too).
- Pure logic in testable modules; I/O at the edges.
- See [`CLAUDE.md`](../../CLAUDE.md) for the full standards and anti-bloat doctrine.

## See also

- [Automation & CI](Automation.md)

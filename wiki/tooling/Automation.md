# Automation & CI

> The automation rigor borrowed from SparkEngine and DuetOS, sized for a TypeScript project.

## GitHub Actions

| Workflow | File | What it does |
|---|---|---|
| CI | `.github/workflows/ci.yml` | On every push/PR: typecheck, lint, format check, test, build |
| CodeQL | `.github/workflows/codeql.yml` | Security analysis on push/PR + weekly schedule |

CI uses `concurrency` to cancel superseded runs and `npm ci` against the lockfile for
reproducibility.

## Dependency hygiene

- **Dependabot** (`.github/dependabot.yml`) opens weekly PRs for npm and GitHub Actions updates,
  grouped into dev vs. production.

## Agent / AI automation

- **`CLAUDE.md`** + **`AGENTS.md`** define how AI assistants bootstrap in this repo.
- **`.github/copilot-instructions.md`** points AI tools at the same standards.
- **`.github/prompts/`** holds task-specific prompts (gameplay systems, netcode).
- **`.claude/` SessionStart hook** prepares cloud/web sessions (install + health check) so you can
  develop from a phone with lint/tests ready.

## Local equivalent of CI

```bash
npm run check
```

Run this before pushing; it mirrors the CI gate.

## See also

- [Dev Environment](Dev-Environment.md)

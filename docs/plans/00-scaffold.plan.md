---
name: Phase 0 — Scaffold
overview: Bun monorepo workspace, strict TypeScript, Biome, CLI stub, and CI so later phases have a place to land code.
todos:
  - id: workspace-layout
    content: Create Bun workspace with packages/core, store-sqlite, store-postgres, mcp, server, cli, web and root configs
    status: pending
  - id: tooling
    content: Add Biome, TypeScript strict project references, zod/ulid/MCP SDK deps, bun test harness
    status: pending
  - id: cli-skeleton
    content: Implement packages/cli entry with --help, serve, migrate stubs and unknown-command errors
    status: pending
  - id: build-script
    content: Add scripts/build-binaries.ts for host compile; document full OS matrix for phase 9
    status: pending
  - id: ci
    content: GitHub Actions workflow for lint, typecheck, and bun test on push/PR
    status: pending
isProject: true
---

# Phase 0 — Scaffold

## Goal

Stand up the **agent-todo** monorepo so every later package has a home. After this phase: `bun install`, `bun test`, typecheck, and Biome all pass; the CLI prints help for `serve` and `migrate`; CI runs on every PR.

**Runnable outcome:** a developer clones the repo, runs `bun install && bun test`, and can invoke `bun run --filter @agent-todo/cli start -- --help` (or the documented root script) and see command names.

## Prerequisites

- Empty or near-empty git repo containing [project_doc.md](../../project_doc.md).
- Bun installed locally (CI installs Bun too).

## Out of scope

- SQLite schema, Store, services, MCP tools (phases 1–3).
- Real `serve --mcp` behaviour beyond a stub that exits with “not implemented” or prints usage.
- Cross-OS release matrix signing (phase 9); this phase only compiles for the host in CI.
- Hono, Postgres driver, Vite, OpenTelemetry.

## Locked decisions

- Bun workspace + `bun test` + `bun build --compile`. **Not** pnpm / Node 22 CI.
- Kysely + `bun:sqlite` later — do **not** add Drizzle or `better-sqlite3`.
- Package layout matches project_doc §8 under `packages/*`.
- Root package name: `agent-todo`. Scoped package names: `@agent-todo/core`, `@agent-todo/store-sqlite`, `@agent-todo/store-postgres`, `@agent-todo/mcp`, `@agent-todo/server`, `@agent-todo/cli`, `@agent-todo/web`.

## File tree to create

```text
agent-todo/
├─ package.json                 # workspaces: ["packages/*"]
├─ bunfig.toml                  # test / preload if needed
├─ tsconfig.json                # solution-style references
├─ biome.json
├─ .gitignore
├─ README.md                    # minimal: what this is + link to project_doc + how to run help
├─ .github/workflows/ci.yml
├─ scripts/build-binaries.ts
├─ migrations/                  # empty dirs with .gitkeep
│  ├─ sqlite/.gitkeep
│  └─ postgres/.gitkeep
├─ test/.gitkeep
└─ packages/
   ├─ core/package.json         # deps: zod, ulid; exports src/index.ts (empty re-exports ok)
   ├─ store-sqlite/package.json
   ├─ store-postgres/package.json
   ├─ mcp/package.json          # dep: @modelcontextprotocol/sdk
   ├─ server/package.json
   ├─ cli/package.json          # bin entry; depends on sibling packages as needed
   │  └─ src/index.ts           # CLI skeleton
   └─ web/package.json          # placeholder; no Vite yet
```

Each package: `tsconfig.json` with `"strict": true`, `"composite": true` where useful, and an `src/index.ts` that exports a placeholder (e.g. `export const PACKAGE = "…"`) so typecheck has something to compile.

## Implementation

### 1. Root workspace

- `package.json` with `"workspaces": ["packages/*"]`, scripts:
  - `"test": "bun test"`
  - `"lint": "biome check ."`
  - `"format": "biome check --write ."`
  - `"typecheck": "tsc -b"`
  - `"build:bin": "bun run scripts/build-binaries.ts"`
  - `"cli": "bun run packages/cli/src/index.ts"`
- Biome: recommended rules; ignore `dist`, `node_modules`, compiled binaries.
- `.gitignore`: `node_modules`, `dist`, `*.db`, `.agent-todo/todo.db`, binaries, `.DS_Store`, coverage.

### 2. Dependencies (phase 0 only)

Install at the packages that need them:

| Package | Dependencies |
| --- | --- |
| `@agent-todo/core` | `zod`, `ulid` |
| `@agent-todo/mcp` | `@modelcontextprotocol/sdk` (peer or direct); may re-export nothing yet |
| `@agent-todo/cli` | workspace deps on `core` (and later others); CLI parsing: use Bun’s argv or a tiny local parser — **avoid** heavy frameworks |

Do **not** install Kysely, Hono, `postgres`, Vite, or OTel yet.

### 3. CLI skeleton (`packages/cli/src/index.ts`)

Parse `process.argv`:

| Invocation | Behaviour |
| --- | --- |
| `agent-todo` / `--help` / `-h` / `help` | Print usage listing at least: `serve`, `migrate`, and a short note that more commands arrive in later phases |
| `serve` | Accept optional `--mcp`; for now print `serve: not implemented (phase 3)` and exit `0` or `1` consistently — prefer exit `0` with message so `--help` paths stay clean; document choice in README |
| `migrate` | Print `migrate: not implemented (phase 1)` |
| Unknown command | Exit non-zero: `unknown command: <name>` |

Version flag `--version` / `-V` may print `0.0.0-dev`.

### 4. `scripts/build-binaries.ts`

- Use `Bun.build({ compile: true, … })` (or `bun build --compile`) targeting `packages/cli` entry.
- Output under `dist/bin/agent-todo-<os>-<arch>` for the **current** host only.
- Comment or README note: full matrix `linux/mac/windows × x64/arm64` is completed in phase 9.

### 5. CI (`.github/workflows/ci.yml`)

- Trigger: push and pull_request to main (and default branch).
- Setup Bun (official action).
- Steps: `bun install`, `bun run lint`, `bun run typecheck`, `bun test`.
- Optional: `bun run build:bin` on one OS to prove compile works.
- **Do not** use Node 22 as the test runtime.

### 6. Smoke test

Add `packages/cli/src/index.test.ts` (or `test/cli-help.test.ts`) that spawns the CLI with `--help` and asserts stdout contains `serve` and `migrate`.

## Tests

- CLI help smoke test (above).
- At least one trivial unit test in `@agent-todo/core` (e.g. `expect(true).toBe(true)` or export presence) so `bun test` is non-empty.
- CI must be green on a clean PR.

## Done when

- [ ] `bun install` succeeds.
- [ ] `bun run lint`, `bun run typecheck`, and `bun test` pass locally and in GitHub Actions.
- [ ] `bun run cli -- --help` (or documented equivalent) prints `serve` and `migrate`.
- [ ] All seven packages exist under `packages/` with strict TS configs.
- [ ] `scripts/build-binaries.ts` produces a host binary under `dist/` (or documented path).
- [ ] README points to `project_doc.md` and `docs/plans/README.md`.

Stop here. Do not start phase 1.

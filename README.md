# agent-todo

TypeScript MCP server for AI agents to create, claim, update and comment on tasks.
See [project_doc.md](./project_doc.md) for the full design and
[docs/plans/README.md](./docs/plans/README.md) for phase plans.

**Docs:** [Quick start](./docs/quick-start.md) · [Self-hosting](./docs/self-hosting.md) ·
[Tool reference](./docs/tool-reference.md) · [Agent conventions](./docs/agent-conventions.md) ·
[Dogfood checklist](./docs/dogfood.md)

## Requirements

- [Bun](https://bun.sh) 1.2+

## Setup

```bash
bun install
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun test` | Run tests |
| `bun run lint` | Biome check |
| `bun run typecheck` | `tsc -b` across packages |
| `bun run cli -- --help` | Print CLI usage (`serve`, `migrate`, …) |
| `bun run build:bin` | Compile a host binary under `dist/bin/` |

## Local MCP (phase 3)

Seed a dev project (creates `.agent-todo/` + SQLite + sample task):

```bash
bun run scripts/seed-dev.ts
```

Run the stdio MCP server from the repo root:

```bash
bun run cli -- serve --mcp
```

**Claude Code** — add to user or project MCP config:

```json
{
  "mcpServers": {
    "agent-todo": {
      "command": "bun",
      "args": ["run", "packages/cli/src/index.ts", "serve", "--mcp"],
      "cwd": "/absolute/path/to/agent-todo"
    }
  }
}
```

**Cursor** — `~/.cursor/mcp.json` (or project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "agent-todo": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/agent-todo/packages/cli/src/index.ts", "serve", "--mcp"]
    }
  }
}
```

Set `AGENT_TODO_AGENT` to your agent name for claims/audit. Tests can point at a DB with `AGENT_TODO_DB=/path/to/todo.db`.

## CLI

```bash
bun run cli -- --help
bun run cli -- migrate
```

Unknown commands exit **1**.

## Cloud self-host (phase 7)

Postgres-backed team mode: HTTP MCP, REST board, push/pull, RLS tenancy. No signup or billing.

```bash
# Stack: Postgres 16 + PgBouncer + agent-todo server
export AGENT_TODO_BOOTSTRAP_SECRET=change-me
docker compose -f deploy/docker-compose.yml up --build
```

Client workflow:

```bash
AGENT_TODO_BOOTSTRAP_SECRET=change-me bun run cli -- init --remote http://localhost:8080 --project acme/web --yes
bun run cli -- push --remote http://localhost:8080
# mode=remote → serve --mcp proxies to cloud with keychain token
```

See [deploy/README.md](./deploy/README.md). CI runs Postgres conformance via Testcontainers when Docker is available.

## Packages

Monorepo under `packages/`: `@agent-todo/core`, `store-sqlite`, `store-postgres`, `mcp`, `server`, `cli`, `web`.

## Binary builds

`bun run build:bin` compiles for the **current host** (`dist/bin/agent-todo-<os>-<arch>`).
`bun run build:bin:all` builds the full linux/mac/windows × x64/arm64 matrix (where Bun cross-compile supports it).
Release tags run [.github/workflows/release.yml](./.github/workflows/release.yml) (binaries, `SHA256SUMS`, SBOM, GHCR image).

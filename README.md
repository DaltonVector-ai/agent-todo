# agent-todo

TypeScript MCP server for AI agents to create, claim, update and comment on tasks.
See [project_doc.md](./project_doc.md) for the full design and
[docs/plans/README.md](./docs/plans/README.md) for phase plans.

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

## Packages

Monorepo under `packages/`: `@agent-todo/core`, `store-sqlite`, `store-postgres`, `mcp`, `server`, `cli`, `web`.

## Binary builds

`bun run build:bin` compiles for the **current host** only (`dist/bin/agent-todo-<os>-<arch>`).
The full linux/mac/windows × x64/arm64 matrix lands in phase 9.

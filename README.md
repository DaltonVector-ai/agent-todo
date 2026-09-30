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

## CLI (phase 0 stubs)

```bash
bun run cli -- --help
bun run cli -- serve --mcp    # prints: serve: not implemented (phase 3)  (exit 0)
bun run cli -- migrate        # prints: migrate: not implemented (phase 1) (exit 0)
```

Stub commands exit **0** with a not-implemented message so help and scripting stay clean.
Unknown commands exit **1**.

## Packages

Monorepo under `packages/`: `@agent-todo/core`, `store-sqlite`, `store-postgres`, `mcp`, `server`, `cli`, `web`.

## Binary builds

`bun run build:bin` compiles for the **current host** only (`dist/bin/agent-todo-<os>-<arch>`).
The full linux/mac/windows × x64/arm64 matrix lands in phase 9.

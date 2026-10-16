# agent-todo

TypeScript MCP server for AI agents to create, claim, update, and comment on tasks. Local work goes through one loopback machine daemon.

**Docs:** [Quick start](./docs/quick-start.md) · [Tool reference](./docs/tool-reference.md) ·
[Agent conventions](./docs/agent-conventions.md) · [Self-hosting](./docs/self-hosting.md)

## Requirements

- [Bun](https://bun.sh) 1.4 or newer

## Setup

```bash
bun install
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run test -- --timeout 60000` | Run the suite CI runs (package sources and integration tests) |
| `bun run lint` | Biome check |
| `bun run typecheck` | `tsc -b` across packages |
| `bun run cli -- --help` | Print CLI usage |
| `bun run build:bin` | Compile a host binary under `dist/bin/` |
| `bun run build:bin:all` | Build the full linux/mac/windows matrix |

## Machine daemon

```bash
agent-todo install
agent-todo init
agent-todo serve --mcp
```

From this checkout, prefix those with `bun run cli --`.

`install` starts the loopback daemon, wires detected agents, and registers login autostart. `init` registers the current directory and writes the project code and the default group id into `AGENTS.md`. `serve --mcp` forwards stdio to that daemon. The daemon listens on loopback with no token and stays up with no idle shutdown.

The marked block in `AGENTS.md` tells agents which id to send: use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.

Set `AGENT_TODO_AGENT` to the actor name used for claims and audit entries. `AGENT_TODO_DB` overrides the machine database path so a test can point at its own SQLite file.

## CLI

```bash
bun run cli -- --help
```

`--help` lists `install`, `uninstall`, `init`, `uninit`, `doctor`, `upgrade`, `daemon`, `serve`, `migrate`, `import`, and `export`. Unknown commands exit **1**.

## Packages

| Package | Role |
| --- | --- |
| `@agent-todo/cli` | CLI and machine-daemon commands |
| `@agent-todo/server` | HTTP server and machine daemon |
| `@agent-todo/mcp` | MCP tools |
| `@agent-todo/core` | Domain types and services |
| `@agent-todo/store-sqlite` | Machine database |
| `@agent-todo/web` | Read-only board |
| `agent-todo` (`packages/npm-wrapper`) | npm binary wrapper |

## Binary builds

`bun run build:bin` compiles for the current host (`dist/bin/agent-todo-<os>-<arch>`).
`bun run build:bin:all` builds the linux and macOS x64 and arm64 binaries and the Windows x64 binary.
Release tags run [.github/workflows/release.yml](./.github/workflows/release.yml) (binaries, `SHA256SUMS`, SBOM, GHCR image).
`upgrade` prints this repository's latest release URL, [releases/latest](https://github.com/DaltonVector-ai/agent-todo/releases/latest). `AGENT_TODO_RELEASE_BASE_URL` overrides that URL.

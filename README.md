# agent-todo

TypeScript MCP server for AI agents to create, claim, update, and comment on tasks. Local work goes through one loopback machine daemon.

**Docs:** [Quick start](./docs/quick-start.md) · [Tool reference](./docs/tool-reference.md) ·
[Agent conventions](./docs/agent-conventions.md) · [Self-hosting](./docs/self-hosting.md)

## Get started

Download a release binary from [GitHub Releases](https://github.com/DaltonVector-ai/agent-todo/releases/latest), put it on your `PATH` as `agent-todo`, then run `agent-todo install` and `agent-todo init` in your repo.

| Platform | Release asset | Install as |
| --- | --- | --- |
| macOS (Apple silicon) | `agent-todo-darwin-arm64` | `agent-todo` |
| macOS (Intel) | `agent-todo-darwin-x64` | `agent-todo` |
| Linux x64 | `agent-todo-linux-x64` | `agent-todo` |
| Linux arm64 | `agent-todo-linux-arm64` | `agent-todo` |
| Windows x64 | `agent-todo-windows-x64.exe` | `agent-todo.exe` |

Or use the install scripts (they pick the asset name for your OS/arch, download from `releases/latest/download`, and install into `~/.local/bin`):

```bash
curl -fsSL https://raw.githubusercontent.com/DaltonVector-ai/agent-todo/main/scripts/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/DaltonVector-ai/agent-todo/main/scripts/install.ps1 | iex
```

Set `AGENT_TODO_RELEASE_BASE_URL` to override the download base (default: `https://github.com/DaltonVector-ai/agent-todo/releases/latest/download`).

```bash
agent-todo install
agent-todo init
agent-todo serve --mcp
```

The marked block in `AGENTS.md` tells agents which id to send: use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.

Set `AGENT_TODO_AGENT` to the actor name used for claims and audit entries. `AGENT_TODO_DB` overrides the machine database path so a test can point at its own SQLite file.

## Development

Requires [Bun](https://bun.sh) 1.4 or newer.

```bash
bun install
```

From this checkout, prefix CLI commands with `bun run cli --` (for example `bun run cli -- install`).

### Scripts

| Command | What it does |
| --- | --- |
| `bun run test -- --timeout 60000` | Run the suite CI runs (package sources and integration tests) |
| `bun run lint` | Biome check |
| `bun run typecheck` | `tsc -b` across packages |
| `bun run cli -- --help` | Print CLI usage |
| `bun run build:bin` | Compile a host binary under `dist/bin/` |
| `bun run build:bin:all` | Build the full linux/mac/windows matrix |

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

`bun run build:bin` compiles for the current host (`dist/bin/agent-todo-<os>-<arch>[.exe]`).
`bun run build:bin:all` builds the linux and macOS x64 and arm64 binaries and the Windows x64 binary.
Release tags run [.github/workflows/release.yml](./.github/workflows/release.yml) (binaries, `SHA256SUMS`, SBOM, GHCR image).
`upgrade` prints this repository's latest release URL, [releases/latest](https://github.com/DaltonVector-ai/agent-todo/releases/latest). `AGENT_TODO_RELEASE_BASE_URL` overrides that URL.

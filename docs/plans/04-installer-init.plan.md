---
name: Phase 4 — Installer and project init
overview: Machine install, per-project init, agent integrations, and project discovery — codegraph-style zero-config setup.
todos:
  - id: install-scripts
    content: install.sh, install.ps1, Homebrew formula skeleton, npm wrapper, upgrade stub
    status: pending
  - id: agent-integrations
    content: Per-agent modules for detect/write MCP/uninstall; install uninstall doctor
    status: pending
  - id: init-uninit
    content: init/uninit layout, config.toml, first group, CLAUDE/AGENTS stub, .mcp.json
    status: pending
  - id: discovery
    content: Walk-up discovery, git worktree common dir, AGENT_TODO_PROJECT override
    status: pending
  - id: doctor
    content: doctor checks PATH, agent wiring, project config, DB integrity
    status: pending
  - id: e2e-install-tests
    content: Tests that install/uninstall round-trip configs and worktrees share one board
    status: pending
isProject: true
---

# Phase 4 — Installer and project init

## Goal

Deliver **codegraph-style setup**: `agent-todo install` once per machine, `agent-todo init` once per project, then every agent sees the same tasks with no hand-written MCP config.

**Runnable outcome:** after install+init, Cursor and Claude Code (and other detected agents) can list tasks from the project; two git worktrees share one `.agent-todo`; uninstall restores agent configs byte-identical.

## Prerequisites

- Phase 3: `serve --mcp` works for local mode.
- Phase 2: `ContextService.importMarkdown` / GroupService available for first-group import.
- Spec: §2b setup, §8 config keys, §10.2 MCP entry shape.

## Out of scope

- `init --remote` device login and keychain — **reject with clear error** until phase 7 (`not available until cloud`).
- Plan/admin MCP tools and full `context_export` flavors — phase 5 (init may write a short stub via template string matching `flavor=stub` semantics).
- Daemon mode — phase 6.
- Publishing real GitHub release binaries — phase 9; install scripts may download from a documented URL placeholder.

## Locked decisions

- Global MCP entry is always:

```json
{ "command": "agent-todo", "args": ["serve", "--mcp"] }
```

- Project `.mcp.json` uses the same command for teammates who skipped install.
- `todo.db` is gitignored; `config.toml` is committed.
- Numeric order: this phase before phase 5.

## File tree

```text
scripts/install.sh
scripts/install.ps1
deploy/homebrew/agent-todo.rb          # formula skeleton
packages/npm-wrapper/                  # or root package bin that fetches binary
packages/cli/src/
  commands/install.ts
  commands/uninstall.ts
  commands/init.ts
  commands/uninit.ts
  commands/doctor.ts
  commands/upgrade.ts
  discover.ts                          # replace/extend phase 3 minimal discovery
  integrations/
    types.ts                           # detect, install, uninstall, doctor
    claude-code.ts
    cursor.ts
    codex.ts
    gemini.ts
    vscode.ts
    opencode.ts
    index.ts
test/e2e-install/
  install-roundtrip.test.ts
  worktree-share.test.ts
```

## Implementation

### 1. Distribution stubs

- `install.sh` / `install.ps1`: detect OS/arch, download binary from `RELEASE_BASE_URL` (env or constant), place on PATH (`~/.local/bin` or similar), then optionally run `agent-todo install`.
- Homebrew formula skeleton pointing at GitHub releases (checksums TBD phase 9).
- npm wrapper package: `npx agent-todo` downloads matching binary.
- `agent-todo upgrade`: re-fetch binary / print instructions if not yet wired.

### 2. Agent integrations

Each module implements:

1. `detect(): boolean` — agent installed / config path exists.
2. `install(): void` — write user-level MCP entry; auto-allow read-only `core` tools where the agent supports permission lists.
3. `uninstall(): void` — remove only what we added; leave unrelated servers.
4. `doctor(): Check[]` — wiring ok?

Targets:

| Agent | Config locus (typical) |
| --- | --- |
| Claude Code | `claude mcp add --scope user` or documented config file |
| Cursor | `~/.cursor/mcp.json` |
| Codex CLI | `~/.codex/config.toml` |
| Gemini CLI | documented path |
| VS Code Copilot | MCP settings path |
| opencode | documented path |

`install` / `uninstall` iterate all modules; print what changed.

**Uninstall invariant:** after uninstall, each managed config file is byte-identical to the pre-install snapshot (tests store fixtures).

### 3. `init` / `uninit` (§2b)

`init` (flags: `--yes`, `--remote` → error until phase 7):

1. Create `.agent-todo/config.toml` (version 1, `mode = "local"`, `default_group`, `toolsets = ["core","plan"]`, `[limits]`).
2. Create `todo.db` via migrate; gitignore `todo.db` and backups (ensure/append `.gitignore`).
3. Create first group from repo name (derive key); import existing `CLAUDE.md` / `AGENTS.md` into sections via ContextService when files exist.
4. Rewrite those files with marker-delimited stub:

```markdown
<!-- agent-todo:start -->
…stub pointing at group + context_get / task_next…
<!-- agent-todo:end -->
```

5. If Cursor present: add `.cursor/rules/agent-todo.mdc`.
6. Write project-scoped `.mcp.json` with the global entry shape.
7. `--yes` skips prompts.

`uninit`: remove wiring we added (markers, `.mcp.json` entry, rules file option); **leave** DB/data unless user confirms wipe (default leave data).

### 4. Project discovery

Replace phase 3 discovery:

1. If `AGENT_TODO_PROJECT` set → use that path to `.agent-todo`.
2. Else walk up from cwd for `.agent-todo/config.toml`.
3. Inside git worktree: `git rev-parse --git-common-dir` → resolve main checkout’s `.agent-todo` so parallel worktrees share one board.
4. Fail clearly if none found.

`serve --mcp` must use this discovery.

### 5. `doctor`

Checks:

- Binary on PATH / runnable.
- Each agent integration status.
- Project config parse + mode.
- DB integrity (`PRAGMA integrity_check` or open+simple query).

Exit non-zero if any hard failure.

## Tests

- Install then uninstall restores fixture configs byte-identical (per agent file that can be temp-dir mocked).
- `init` creates layout; second `init` is safe or refused cleanly.
- Worktree test: two temp dirs sharing git common dir → same DB path from discovery.
- `init --remote` exits with not-available message.

## Done when

- [ ] `install` + `init` produce a working local project; `serve --mcp` discovers it.
- [ ] Detected agents receive the standard MCP entry; uninstall restores configs.
- [ ] Two worktrees share one board via discovery.
- [ ] `doctor` reports actionable status.
- [ ] `init --remote` errors until cloud phase.
- [ ] e2e-install tests green in CI (mocked agent paths).

Stop here. Do not start phase 5.

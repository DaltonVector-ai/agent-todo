---
name: Phase 6 — Daemon mode and web board
overview: Local shared daemon with stdio proxy, Unix socket/named pipe, and embedded read-only live board.
todos:
  - id: daemon-process
    content: agent-todo daemon owns SQLite and serves MCP+REST on socket and localhost
    status: pending
  - id: stdio-proxy
    content: serve --mcp mode=daemon auto-starts daemon, proxies calls, idle exit 30 min
    status: pending
  - id: rest-sse
    content: Minimal REST + SSE for board live updates
    status: pending
  - id: web-board
    content: Vite+React read-only board embedded in binary; status columns, drawer, context
    status: pending
  - id: concurrency-hammer
    content: Test 30 agents 10 min — no SQLITE_BUSY, no duplicate claims; board lag ≤ 1s
    status: pending
isProject: true
---

# Phase 6 — Daemon mode and web board

## Goal

Support **many parallel local agents** on one SQLite file via a single owning daemon, plus a **read-only** embedded web board with live updates.

**Runnable outcome:** set `mode = "daemon"` in config; agents still use `agent-todo serve --mcp`; board at localhost reflects changes within 1s; hammer test passes.

## Prerequisites

- Phases 4–5 complete (discovery, full MCP toolsets).
- Spec: §2b daemon mode, §7 local limits, §8 `packages/server` + `packages/web`, §9 phase 6.

## Out of scope

- Postgres / OAuth / multi-tenant cloud — phase 7.
- Board editing UI (mutations stay MCP/CLI).
- Redis, replicas, k6 cloud load — phase 8.
- Signing binaries — phase 9.

## Locked decisions

- Bind HTTP to `127.0.0.1` by default; validate `Origin` for browser clients.
- Daemon tokens from `AGENT_TODO_TOKENS` (`name:token,…`) optional for localhost; document.
- Idle exit after **30 minutes** with no connections.
- Editing stays MCP/CLI; board is view + triage navigation only.
- Add **Hono** in `packages/server` this phase; add **Vite + React** in `packages/web`.

## File tree

```text
packages/server/src/
  createApp.ts           # Hono: health, MCP HTTP (optional local), REST, SSE, static board
  sse.ts
  auth/localTokens.ts
packages/cli/src/commands/
  daemon.ts
  serve.ts               # extend router for mode=daemon
packages/cli/src/daemon/
  paths.ts               # per-project socket path / Windows pipe name
  supervise.ts           # auto-start, pid file, idle timer
  proxy.ts               # stdio ↔ daemon MCP
packages/web/
  package.json           # vite react
  src/App.tsx            # columns by status
  src/TaskDrawer.tsx
  src/ContextView.tsx
  src/sse.ts
scripts/embed-web.ts     # build SPA → embed as assets in server/cli binary
test/concurrency/
  daemon-hammer.test.ts
```

## Implementation

### 1. Daemon process

`agent-todo daemon`:

1. Discover project (same as serve).
2. Open SqliteStore exclusively (document that local multi-process direct mode should not run alongside).
3. Listen on:
   - Per-project Unix domain socket under `.agent-todo/` (e.g. `daemon.sock`); on Windows use named pipe.
   - `http://127.0.0.1:<port>` (port in config or ephemeral written to `.agent-todo/daemon.json`).
4. Serve:
   - MCP over Streamable HTTP (or socket protocol compatible with proxy).
   - REST read APIs used by the board (groups, tasks, comments, context TOC/sections).
   - SSE endpoint for change notifications (poll events table or emit on write hook).
   - Static board assets.
5. Run claim sweeper on an interval (e.g. 60s) calling `WorkService.sweepExpiredClaims`.
6. Exit after 30 min idle; clean pid/socket files.

### 2. Router in `serve --mcp`

When `config.mode === "daemon"`:

1. If daemon not running → spawn `agent-todo daemon` (detached), wait until socket/HTTP ready.
2. Proxy all MCP traffic to the daemon (stdio shim).
3. Agent configs unchanged.

When `mode === "local"`: keep phase 3 direct SqliteStore behaviour.

When `mode === "remote"`: error until phase 7.

### 3. Live updates

- On each successful write in the daemon process, bump/notify SSE subscribers with `{rev, group?}`.
- Board subscribes and refetches lightweight board payload.
- Target: reflect changes within **1 second**.

### 4. Web board (read-only)

Columns by status (`todo` … `deployed` / `reopen`). Click task → drawer with brief fields + comment summaries (fetch full on expand). Context sections view per group (TOC then section body). No edit forms.

Embed built assets into the binary via `bun` embedding or a generated `assets.ts`. `daemon` / `serve` HTTP serves them at `/`.

### 5. Security (local HTTP)

- Default bind `127.0.0.1`.
- Optional bearer tokens from `AGENT_TODO_TOKENS`.
- Origin checks for browser.

## Tests

1. Unit/integration: auto-start daemon from serve; proxy `task_list`.
2. **Hammer:** 30 concurrent clients calling `task_next` / updates for a shortened CI duration (e.g. 30–60s) plus a longer manual/nightly 10 min profile; assert no `SQLITE_BUSY` surfaced to clients, no duplicate claims.
3. Board SSE: write via MCP → board fetch sees update within 1s (test with EventSource or fetch polling SSE).

## Done when

- [ ] `mode = "daemon"` works with unchanged agent MCP entry.
- [ ] Idle exit and clean restart work.
- [ ] Board loads, shows columns, drawer, context; live ≤ 1s.
- [ ] Concurrency hammer passes (no busy errors, no double claims).
- [ ] Local mode still works without daemon.

Stop here. Do not start phase 7.

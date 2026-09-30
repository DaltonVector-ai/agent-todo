---
name: Phase 3 — Core MCP over stdio
overview: Shaper plus the ten core MCP tools on stdio — first usable local MVP for worker agents.
todos:
  - id: shaper
    content: Implement Shaper views, fields, empty omission, cursors, token budget, text/JSON, tiny write acks
    status: pending
  - id: mcp-server
    content: mcp/server.ts with toolset filtering and zod→MCP schemas
    status: pending
  - id: core-tools
    content: Register the 10 core tools wired to services with error mapping
    status: pending
  - id: stdio-serve
    content: Wire serve --mcp local mode with minimal config discovery
    status: pending
  - id: budget-tests
    content: Assert core schemas ≤ 1.8k tokens and 20-line task_list ≤ 600 tokens
    status: pending
  - id: mcp-integration
    content: In-memory Client↔McpServer tests for happy paths and error codes
    status: pending
isProject: true
---

# Phase 3 — Core MCP over stdio (MVP)

## Goal

Make agent-todo **usable by a worker agent** over stdio MCP with only the `core` toolset. Context minimisation is first-class via `Shaper`.

**Runnable outcome:** with a seeded SQLite project, an MCP client can `task_next` → work → `comment_add` → `task_status` to `verifying` without reading repo files for task context. Automated: in-memory MCP suite + token budget tests.

## Prerequisites

- Phase 2 services green.
- Spec: §4 (Shaper), §5.1 (core tools), §5.4 (errors), §10.1 (MCP integration + budget).

## Out of scope

- `plan` / `admin` tools, resources, prompts — phase 5.
- Full `install` / `init` — phase 4 (this phase may document a **manual** seed script or test helper to create `.agent-todo/` + DB for local trials).
- Daemon / HTTP / remote proxy — phases 6–7.
- Full project discovery (worktrees) — phase 4; here a **minimal** config reader is enough.

## Locked decisions

- Default response format: **compact text**; `format: "json"` also fills MCP `structuredContent` when applicable.
- Tool descriptions: one sentence; param descriptions ≤ 10 words; shared enums once — target `core` schema ≤ 1.8k tokens.
- If no `.agent-todo/config.toml` found: exit with clear error telling user to run `agent-todo init` (phase 4), plus mention that tests can seed a DB path via env for now (`AGENT_TODO_DB` or similar).

## File tree

```text
packages/core/src/shaper/
  Shaper.ts
  views.ts
  cursors.ts
  renderText.ts
  renderJson.ts
packages/mcp/src/
  server.ts              # create McpServer, register toolsets
  toolsets/core.ts
  errors.ts              # ServiceError → "CODE: message · hint"
  schemas.ts             # zod input schemas (minimal descriptions)
  index.ts
packages/cli/src/
  commands/serve.ts      # --mcp stdio
  discover.ts            # minimal: walk up for config.toml; open SqliteStore
test/mcp/
  core-tools.test.ts
test/budgets/
  core-schema.test.ts
  task-list-line.test.ts
README.md                # add: manual seed + claude mcp add instructions
```

## Implementation

### 1. Shaper (§4 mechanisms needed by core)

Implement for every read path:

| # | Mechanism | Notes |
| --- | --- | --- |
| 1 | Detail levels | `view: id \| line \| brief \| full`; lists default `line`, gets default `brief` |
| 2 | Field projection | `fields: string[]` |
| 3 | No empty fields | Omit null, `[]`, `""`, defaults |
| 4 | Pagination | Opaque cursor; `limit` default 20 max 100; `next` or absent |
| 5 | Token budget | `max_tokens` default from config or 2000; truncate with `…[+N tok, use view=full]` |
| 6 | Comment digest | Never inline bodies on task brief; `{n, pinned, last}` |
| 9 | Deltas | Responses carry `rev` where relevant |
| 10 | Work bundle | Assembled by WorkService; Shaper renders it |
| 11 | Tiny write acks | Mutations return `{id, v, status?}` (+ warnings); `echo: true` opt-in |

Also: text renderer for `task_list` line format from §4 example; JSON renderer.

### 2. Error mapping (§5.4)

MCP tool result with `isError: true` and one line:

`CODE: message · hint`

Codes: `NOT_FOUND`, `VALIDATION`, `VERSION_CONFLICT`, `INVALID_TRANSITION`, `CLAIMED`, `DEPS_UNMET`, `BUDGET`. Hints name the next call, e.g. `hint: task_get AUTH-12 fields=[v]`.

### 3. Core tools (§5.1)

Register exactly these ten, wiring to services + Shaper:

| Tool | Service |
| --- | --- |
| `task_next` | WorkService.next |
| `task_get` | TaskService + optional includes |
| `task_list` | TaskService.list |
| `task_create` | TaskService.create |
| `task_update` | TaskService.update |
| `task_status` | TaskService.status |
| `comment_add` | CommentService.add |
| `comment_list` | CommentService.list |
| `context_get` | ContextService |
| `changes_since` | changesSince |

Common optional args: `agent`, and on reads `view`, `fields`, `max_tokens`, `format`; lists also `limit`, `cursor`.

Toolset filter: env `AGENT_TODO_TOOLSETS` or config `toolsets` — this phase only needs to load `core` (ignore unknown sets).

### 4. `serve --mcp`

- Discover project: walk up from cwd for `.agent-todo/config.toml` (minimal TOML parse for `mode`, `limits`, `default_group`, `toolsets`).
- `mode` must be `local` for now; other modes → error “daemon/remote in later phases”.
- Open SqliteStore at `.agent-todo/todo.db` (create parent if missing only when an explicit seed/migrate path is used — prefer requiring DB exists).
- Start MCP stdio transport with `@modelcontextprotocol/sdk`.
- Actor from `AGENT_TODO_AGENT` or tool `agent` arg.

### 5. Dev seeding (no full init yet)

Provide either:

- `bun run scripts/seed-dev.ts` that creates `.agent-todo/`, migrates, creates group + open task, or
- test helpers only + README steps for Claude Code:

```json
{ "mcpServers": { "agent-todo": { "command": "bun", "args": ["run", "packages/cli/src/index.ts", "serve", "--mcp"] } } }
```

(Adjust to match actual binary path.)

## Tests

1. **MCP integration** (`test/mcp`): real Client ↔ McpServer over in-memory transport; happy path for each core tool; one test per error code.
2. **Budget:** serialize core tool schemas → `estimate` ≤ 1800 tokens.
3. **Budget:** seed 20 tasks → `task_list` line view ≤ 600 tokens.
4. Manual done-when note: Claude Code open→verifying scenario (document in README; not blocking CI).

## Done when

- [ ] All 10 core tools registered and covered by MCP integration tests.
- [ ] `core` tool schemas ≤ 1.8k tokens (CI).
- [ ] `task_list` of 20 tasks in `line` view ≤ 600 tokens (CI).
- [ ] `serve --mcp` runs against a seeded local project over stdio.
- [ ] README includes Claude Code / Cursor MCP entry for local Bun path.
- [ ] Error lines match `CODE: message · hint`.

Stop here. Do not start phase 4.

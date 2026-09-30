---
name: Phase 5 — Planning, context, compaction
overview: Plan and admin MCP toolsets, context import/export, compaction, resources, prompts, and CLI import/export.
todos:
  - id: plan-tools
    content: Register plan tools group_*, context_*, comment_compact, task_claim/release/move
    status: pending
  - id: admin-tools
    content: Register admin tools task_archive, group_archive, history
    status: pending
  - id: compaction-flag
    content: needs_compaction on task_get and compaction hints
    status: pending
  - id: resources-prompts
    content: MCP resources §5.5 and prompts §5.6 including optional context_generate
    status: pending
  - id: cli-import-export
    content: CLI import CLAUDE.md and export flavor agents_md/claude_md/stub/plain
    status: pending
  - id: budget-done
    content: Tests for TOC ≤ 150 tok after 3k import and brief ≤ 500 after compaction
    status: pending
isProject: true
---

# Phase 5 — Planning, context, compaction

## Goal

Complete the MCP surface for **planners and admins**: group/context authoring, compaction, resources, prompts, and CLI import/export. Worker agents can keep using `core` only.

**Runnable outcome:** import a ~3k-token CLAUDE.md → TOC ≤ 150 tokens; compact a 30-comment task → `brief` ≤ 500 tokens without losing pinned/decision content.

## Prerequisites

- Phase 3 core MCP + Shaper.
- Phase 4 init (run in order before this phase). Init already calls ContextService; this phase exposes full MCP/CLI and export flavors.
- Spec: §5.2–§5.6, §6, §4 #7–8.

## Out of scope

- Daemon and web board — phase 6.
- Cloud / sampling against a hosted LLM beyond MCP client sampling — optional `context_generate` only when client advertises sampling.
- Changing core tool behaviour except adding `needs_compaction` / hints on `task_get`.

## Locked decisions

- Toolsets: `core` | `plan` | `admin` (admin implies ability to load with ceiling). Config `toolsets` array filters registration.
- `context_export` flavors: `claude_md` | `agents_md` | `plain` | `stub`.
- Pinned and `decision` comments never compacted by default (`keep_pinned` default true).
- Superseded comments kept; default reads hide them unless `include_compacted`.

## File tree

```text
packages/mcp/src/toolsets/
  plan.ts
  admin.ts
packages/mcp/src/
  resources.ts
  prompts.ts
  sampling/context_generate.ts   # optional
packages/cli/src/commands/
  import.ts
  export.ts
test/budgets/
  context-toc.test.ts
  compaction-brief.test.ts
test/mcp/
  plan-admin.test.ts
  resources-prompts.test.ts
```

## Implementation

### 1. Plan tools (§5.2)

| Tool | Wire to |
| --- | --- |
| `group_create` | GroupService.create (+ optional context_markdown import) |
| `group_update` | GroupService.update |
| `group_list` | GroupService.list → line render |
| `group_get` | GroupService.get + context TOC |
| `context_update` | ContextService.applyOps |
| `context_import` | importMarkdown merge \| replace |
| `context_export` | render markdown by flavor |
| `comment_compact` | CommentService.compact |
| `task_claim` / `task_release` | WorkService |
| `task_move` | TaskService.move |

### 2. Admin tools (§5.3)

| Tool | Wire to |
| --- | --- |
| `task_archive` | TaskService.archive (`hard` only if `ALLOW_HARD_DELETE=1`) |
| `group_archive` | GroupService.archive |
| `history` | events for task or group id |

### 3. Compaction UX

- Compute `needs_compaction` when live comments > 15 or comment tokens > 3000 (configurable).
- `task_get` includes flag + hint to run `compact` prompt / `comment_compact`.
- After compact, default `comment_list` / brief digest omit superseded bodies.

### 4. Resources (§5.5)

- `todo://groups`
- `todo://group/{key}/context` and `…/context/{slug}`
- `todo://task/{id}`
- `todo://group/{key}/board`

Use Shaper briefs/lines; keep payloads small.

### 5. Prompts (§5.6)

- `start_work(group)`
- `write_group_context(group)`
- `handoff(task)`
- `compact(task)`

Ship agent conventions from §10.2 inside `start_work`.

### 6. Optional `context_generate`

If client capabilities include sampling, register tool that requests a draft then applies via `context_update`. If not advertised, omit tool or return a clear error.

### 7. CLI

```bash
agent-todo import CLAUDE.md --group AUTH
agent-todo export AUTH --flavor agents_md
```

Reuse ContextService; honor `--yes` where needed.

### 8. Schema budget

Re-measure: full schema ≤ 5k tokens; `core` still ≤ 1.8k. Update budget tests; fail if growth > 10% without baseline bump (full suite in phase 9 — add baselines now).

## Tests

1. Import fixture ~3k-token markdown → TOC token estimate ≤ 150.
2. Task with 30 comments → compact → `task_get` brief ≤ 500 tokens; pinned + decision still visible.
3. MCP tests for each plan/admin tool happy path + key errors.
4. Resources readable via MCP client; prompts listable.

## Done when

- [ ] All plan and admin tools registered and tested.
- [ ] Resources and prompts available.
- [ ] CLI import/export works.
- [ ] TOC and compaction token done-whens enforced in CI.
- [ ] `core`-only toolset still excludes plan/admin tools.

Stop here. Do not start phase 6.

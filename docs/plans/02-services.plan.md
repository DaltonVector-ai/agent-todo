---
name: Phase 2 — Services
overview: Business rules over Store — groups, tasks, comments, context, work/claims, events — with lifecycle and concurrency integration tests.
todos:
  - id: group-service
    content: GroupService create/update/list/get/archive with default sections from §6
    status: pending
  - id: task-service
    content: TaskService batch create, optimistic update, status, move, archive, list/search pagination
    status: pending
  - id: comment-service
    content: CommentService add/list/compact with auto-summary and decision hint
    status: pending
  - id: context-service
    content: ContextService TOC, section ops, for_task selection within budget
    status: pending
  - id: work-service
    content: WorkService next/claim/release/extend, work bundle, expired-claim sweeper function
    status: pending
  - id: events
    content: Every write appends events with field diffs; changesSince(rev)
    status: pending
  - id: service-tests
    content: Full lifecycle + reopen loop; parallel next never returns same task
    status: pending
isProject: true
---

# Phase 2 — Services

## Goal

Implement all **business rules** on top of `Store` so MCP (phase 3) is a thin adapter. No MCP in this phase.

**Runnable outcome:** integration tests drive a task `todo → … → deployed` (and a `reopen` loop) through services only; two parallel `WorkService.next` calls never return the same task.

## Prerequisites

- Phase 1 complete: SqliteStore, domain status/ids, tokens, conformance green.
- Spec: §3 entities, §3.3 status side effects, §4 #10 work bundle shape (assemble here; render later), §6 default sections, §7 claims/versioning.

## Out of scope

- MCP tool registration, Shaper text/JSON rendering — phase 3.
- Installer/init — phase 4.
- Scheduling the claim sweeper on a timer — phases 6/8 (export a callable `sweepExpiredClaims()` now).

## Locked decisions

- Respect `terminal_status` when validating `verified → deploying`.
- Blocker = comment kind + status; no blocked status.
- Tiny write acks and views belong to Shaper (phase 3); services return rich domain objects / structured results.
- Default comment compaction thresholds: > 15 live comments or > 3,000 comment tokens → set `needs_compaction` (flag on read path or computed).

## File tree

```text
packages/core/src/services/
  GroupService.ts
  TaskService.ts
  CommentService.ts
  ContextService.ts
  WorkService.ts
  errors.ts              # typed errors → map to MCP codes in phase 3
  index.ts
packages/core/src/services/*.test.ts
# or test/services/*.test.ts
```

## Implementation

### Shared rules

- **Every write** = one `store.tx`: mutate row(s), update counters (`comment_count`, `task_seq`), insert `events` with field diff, commit.
- **Optimistic versioning:** updates take expected `v`; mismatch → `VERSION_CONFLICT` carrying current `v` and changed fields.
- **Actor:** pass `actor: string` into mutating methods (default `"anonymous"`).
- Typed errors with codes from §5.4: `NOT_FOUND`, `VALIDATION`, `VERSION_CONFLICT`, `INVALID_TRANSITION`, `CLAIMED`, `DEPS_UNMET`, `BUDGET` (if a service-level hard cap is hit).

### GroupService

| Method | Behaviour |
| --- | --- |
| `create` | Key from caller or `deriveKeyFromName`; create default context sections from §6 (overview, commands, conventions, architecture, testing, deploy, gotchas, decisions) with correct `always_include` / `applies_to`; set defaults arrays; event `create` |
| `update` | Versioned; name, summary, defaults, `terminal_status` |
| `list` / `get` | Include open/total counts on get; summary fields |
| `archive` | Soft archive |

### TaskService

| Method | Behaviour |
| --- | --- |
| `create` (batch 1–50) | Inherit group `default_model` / skills / mcps when omitted; allocate IDs in tx; validate title ≤ 120 |
| `update` | `v` required; `set`, append_description, add/remove for list fields; claim check unless force |
| `status` | Use domain transition table + side effects (claim create/release; reopen requires comment); deps gate for → `open` |
| `move` | Change group; **keep task id** (`AUTH-12` stays) |
| `archive` | Soft delete; hard delete only if env `ALLOW_HARD_DELETE=1` (can stub hard path) |
| `list` / `search` | Filters: group, status[], tags, assignee, q (FTS); sort priority \| updated; opaque cursor; limit default 20 max 100 |

Size guards: description over ~4k tokens → accept with warning in result.

### CommentService

| Method | Behaviour |
| --- | --- |
| `add` | Allocate `TASK#N`; auto `summary` ≤ 160 from author or first line; kinds from §3.2; bump `comment_count`; if kind `decision`, include hint string for context_update |
| `list` | since id, kinds, ids, include_compacted; oldest→newest |
| `compact` | Write `summary` kind comment; set `compacted_into` on superseded; keep pinned by default; never compact `decision` by default |

### ContextService

| Method | Behaviour |
| --- | --- |
| `toc` | Slugs + titles + token costs + always_include |
| `getSections` | By slugs |
| `applyOps` | upsert \| append \| replace_text \| delete \| move; versioned sections |
| `forTask` | `always_include` + `applies_to` ∩ task tags; cap tokens (default 1500); overflow listed by slug+cost not body |
| `importMarkdown` | Split on `##`, slugify; flag sections > 800 tokens (used by init in phase 4 and MCP in phase 5) |

### WorkService

| Method | Behaviour |
| --- | --- |
| `next` | Filters group/tags/model/skills; select + claim in one IMMEDIATE tx (`claimNext`); default ttl 60 min; status → `inprogress`; return **work bundle**: task full, pinned + last 3 comment summaries, context via `forTask` |
| `claim` / `release` / `extend` | Per §7; owner writes extend lease |
| `sweepExpiredClaims` | Expired `inprogress` → `open` + system comment `claim expired (agent-x)`; no timer yet |

### changesSince

`changesSince(rev, { group?, entities? })` → compact event list + new `rev` (project/global as local single-project DB).

## Tests

1. **Lifecycle:** create group → create tasks → status through happy path to `deployed`; separate path with `reopen` requiring verification/blocker comment.
2. **Deps gate:** cannot open task while dependency unmet; can after dependency verified/deployed.
3. **Version conflict:** stale `v` fails with changed fields.
4. **Parallel next:** two concurrent `next` on two open tasks / or many open tasks — never same id; when one task, one winner one `null`.
5. **Compaction:** superseded hidden from default list; pinned/decision retained.
6. **Events:** each mutation increases rev; `changesSince` returns expected actions.

## Done when

- [ ] Integration tests run full lifecycle including reopen through services only.
- [ ] Two parallel `next` calls never return the same task.
- [ ] All services export from `@agent-todo/core`.
- [ ] `bun test` / lint / typecheck green.

Stop here. Do not start phase 3.

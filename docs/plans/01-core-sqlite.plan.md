---
name: Phase 1 — Core and SQLite store
overview: Domain IDs and status machine, Store interface, SqliteStore with migrations/FTS, token helpers, and a store conformance suite.
todos:
  - id: sqlite-migration
    content: Write migrations/sqlite/0001_init.sql from §3.4 plus terminal_status and FTS5 sync triggers
    status: pending
  - id: migration-runner
    content: Implement migration runner invoked on store open / migrate CLI
    status: pending
  - id: store-interface
    content: Define Store interface (repos, tx, claimNext, search, events) in packages/core
    status: pending
  - id: sqlite-store
    content: Implement SqliteStore with WAL, BEGIN IMMEDIATE, busy_timeout 5s
    status: pending
  - id: domain-ids-status
    content: Implement domain/ids.ts and domain/status.ts with full transition and guard tests
    status: pending
  - id: token-util
    content: Implement util/tokens.ts estimate and truncate
    status: pending
  - id: conformance
    content: Conformance suite against Store; 1000 concurrent KEY-N allocation test
    status: pending
isProject: true
---

# Phase 1 — Core and SQLite store

## Goal

Deliver the **data layer and domain** that every service and adapter will share: typed IDs, status transitions, token estimates, a dialect-agnostic `Store` interface, and a working `SqliteStore` with migration `0001` and FTS5.

**Runnable outcome:** `agent-todo migrate` (or open-store) creates `.agent-todo/todo.db` (or a test temp DB); conformance tests pass against SqliteStore; status and ID unit tests cover the full machines.

## Prerequisites

- Phase 0 **Done when** complete (workspace, CI, CLI stub).
- Spec sections: [project_doc.md](../../project_doc.md) §3 (model), §3.4 (SQL), §3.3 (status), §7 (tx / claims primitives).

## Out of scope

- Service layer (`GroupService`, etc.) — phase 2.
- MCP tools and Shaper — phase 3.
- Postgres adapter — phase 7 (but the conformance suite must be written against the interface so Postgres can plug in later).
- Daemon, board, cloud.

## Locked decisions

- Add `groups.terminal_status TEXT NOT NULL DEFAULT 'deployed' CHECK (terminal_status IN ('verified','deployed'))` even though §3.4 omits it.
- No `blocked` status in the CHECK constraint.
- Kysely + `bun:sqlite` only.
- Internal PKs are ULIDs; agents never see them — only human keys (`AUTH`, `AUTH-12`, `AUTH-12#3`, `AUTH/testing`).

## File tree to create or change

```text
migrations/sqlite/0001_init.sql
packages/core/src/
  domain/ids.ts
  domain/status.ts
  util/tokens.ts
  store/types.ts          # entity types
  store/Store.ts          # interface
  index.ts                # public exports
packages/store-sqlite/src/
  client.ts               # open DB, pragmas, tx(fn) with BEGIN IMMEDIATE
  migrate.ts
  SqliteStore.ts
  repos/*.ts              # optional split by entity
  index.ts
packages/cli/src/index.ts # wire `migrate` to runner (path arg or default)
test/conformance/
  store.conformance.test.ts
packages/core/src/domain/*.test.ts
packages/core/src/util/tokens.test.ts
```

## Implementation

### 1. Schema `migrations/sqlite/0001_init.sql`

Implement project_doc §3.4 verbatim, then add:

- `terminal_status` on `groups` as above.
- FTS5 virtual tables `tasks_fts` / `comments_fts` and **triggers** that keep them in sync on insert/update/delete of `tasks` / `comments`.
- Indexes as specified (`tasks_group_status`, `tasks_claim`, `comments_task`, `events_group_rev`).

Pragmas at connection time (in client, not only migration): `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`.

### 2. Migration runner

- Track applied migrations (e.g. `_migrations(id TEXT PRIMARY KEY, applied_at TEXT)`).
- Apply pending SQL files in order on store open and via CLI `migrate`.
- Idempotent: second open does nothing.

### 3. Domain: IDs (`domain/ids.ts`)

| Function | Contract |
| --- | --- |
| `isGroupKey(s)` | 2–8 uppercase letters/digits, starts with letter |
| `deriveKeyFromName(name)` | Uppercase alnum slug; truncate/pad to valid key; collide → caller retries with suffix |
| `parseTaskId(s)` | `{ key, n }` for `KEY-N` |
| `formatTaskId(key, n)` | `KEY-N` |
| `formatCommentId(taskId, seq)` | `TASKID#N` |
| `formatSectionId(key, slug)` | `KEY/slug` |
| `allocateTaskId(tx, groupPk)` | Read `task_seq`, increment in **same** transaction, return `KEY-(seq+1)`; never reuse |

### 4. Domain: status (`domain/status.ts`)

Allowed transitions from §3.3:

- `todo` → `open`
- `open` → `inprogress`, `todo`
- `reopen` → `inprogress`, `todo`
- `inprogress` → `verifying`, `open`, `todo`
- `verifying` → `verified`, `reopen`
- `verified` → `deploying`, `reopen` (and if `terminal_status === 'verified'`, `deploying` only with `force`)
- `deploying` → `deployed`, `reopen`
- `deployed` → `reopen`

Guards (pure functions returning error codes; services enforce later):

- Entering `inprogress` requires claim context.
- Leaving `inprogress` for `open`/`todo`/`verifying` releases claim (document for phase 2).
- Entering `reopen` requires a comment kind `blocker` or `verification`.
- Moving to `open` blocked if any `depends_on` is not `verified`/`deployed` when deps gate is on (`DEPS_UNMET`).
- Anything else needs `force: true` + `reason`.

### 5. Tokens (`util/tokens.ts`)

- `estimate(text: string): number` — fast heuristic (e.g. ~4 chars/token or word-based); document that it is an estimate.
- `truncate(text, budget): { text, truncated, omittedTokens }` — cut on paragraph then line boundaries; append marker like `…[+N tok, use view=full]` when truncated.

### 6. Store interface

Shape (names may vary; behaviour must match):

```ts
interface Store {
  tx<T>(fn: (s: Store) => Promise<T> | T): Promise<T>; // SQLite: BEGIN IMMEDIATE
  groups: GroupRepo;
  tasks: TaskRepo;
  comments: CommentRepo;
  sections: SectionRepo;
  events: EventRepo;
  claimNext(filter: ClaimFilter): Promise<TaskRow | null>;
  search(q: SearchQuery): Promise<SearchHit[]>;
  // close(): Promise<void>
}
```

Repos must support create/get/update/list/archive as needed by phase 2, even if some methods are thin CRUD for now. `claimNext` must select highest-priority eligible `open`/`reopen` with deps met and claim atomically inside the caller’s tx or its own IMMEDIATE tx.

Events: append-only with monotonic `rev` (SQLite autoincrement). Diff JSON `{ field: [old, new] }`.

### 7. SqliteStore

- Open file path; create parent dirs.
- Run migrations.
- Implement all interface methods with Kysely over `bun:sqlite` (or Kysely dialect compatible with Bun).
- JSON array columns stored as TEXT; parse/serialize at boundary.
- One writer semantics: short transactions.

### 8. CLI

Wire `migrate` to open a path (flag `--db` or default under cwd `.agent-todo/todo.db`) and apply migrations; print success.

## Tests

| Suite | Assert |
| --- | --- |
| `status.test.ts` | Every allowed transition succeeds; every forbidden fails; force path; terminal_status gate |
| `ids.test.ts` | Regex, derive, format/parse; allocate sequential IDs with no gaps in one tx |
| `tokens.test.ts` | estimate > 0; truncate respects budget and boundary behaviour |
| `store.conformance.test.ts` | Against SqliteStore: create group/task/comment/section; FTS search smoke; event rev increases; claimNext exclusive |
| Concurrency | 1,000 concurrent `KEY-N` allocations across 4 workers on one DB → no duplicates, no gaps |

## Done when

- [ ] `0001_init.sql` applied cleanly twice (idempotent).
- [ ] Unit tests cover every allowed and forbidden status transition (including `terminal_status`).
- [ ] 1,000 concurrent allocations across 4 workers: no duplicate or gap IDs.
- [ ] Conformance suite green on SqliteStore.
- [ ] `bun test`, lint, typecheck still pass in CI.

Stop here. Do not start phase 2.

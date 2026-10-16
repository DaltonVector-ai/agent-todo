# Agent Todo MCP — Implementation Plan

Sep 30, 2026 · @Saleeq

> **Note:** The product today is an open SQLite machine daemon only. Sections below that describe Postgres, cloud sync, or multi-tenant hosting are historical planning text, not the shipped surface.

## 1. Overview

Build **agent-todo**: a TypeScript MCP server backed by SQLite that lets AI agents create, claim, update and comment on tasks organised into groups, where each group carries a sectioned context document that replaces CLAUDE.md / AGENTS.md. Every read tool is designed to return the smallest useful payload by default, so agents spend tokens on work, not on bookkeeping.

**Deployment principle: one binary, one open daemon.** agent-todo ships as a self-contained binary (no Node, Docker or database to install). A user runs `agent-todo install` once to start or connect to the machine daemon and wire every detected agent, then `agent-todo init` once per project. After that, every agent opened in that project (Claude Code, Cursor, Codex, Gemini CLI, subagents) sees the same tasks through MCP on loopback (or a shared URL after `install --url`).

**Goals**

- Task groups and tasks with short, stable, globally unique IDs (`AUTH`, `AUTH-12`).
- Task fields: title, description, status (8 states), preferred model, skills, MCPs — plus priority, tags, dependencies and assignee.
- Full CRUD for groups and tasks over MCP, with validated status transitions.
- Threaded comments per task, typed (note, question, decision, handoff, verification, blocker), fetched on demand.
- A per-group context document, split into sections, that agents load selectively instead of a monolithic CLAUDE.md.
- Context minimisation as a first-class feature: detail levels, field projection, token budgets, deltas, comment compaction, one-call work bundles.
- Safe multi-agent use: claims with leases, optimistic versioning, an event log.
- Zero-dependency setup: `install` once per machine, `init` once per project, like codegraph.
- Machine-wide SQLite store with per-project registration and a read-only web board.

**Non-goals for v1**

- A rich web UI (a read-only board ships in phase 5; editing stays in MCP/CLI).
- Our own identity provider or billing. Cloud mode uses OIDC from an existing provider and API tokens.
- Running agents. The server stores intent (preferred model, skills, MCPs); the orchestrator or agent decides what to do with it.

## 2. Tech stack and architecture

One codebase compiles to one binary that runs in three modes: `serve --mcp` (stdio, per agent), `daemon` (local shared server) and `server` (cloud, stateless, behind a load balancer). All business rules live in services over a `Store` interface with a SQLite adapter (local) and a Postgres adapter (cloud), so behaviour is identical in both.

| Concern | Choice | Why |
| --- | --- | --- |
| Language / runtime | TypeScript 5 on Bun, compiled with `bun build --compile` | Single self-contained binary per OS/arch; no Node or native modules to install |
| Distribution | GitHub release binaries, `curl \| sh` / PowerShell installer, Homebrew tap, npm wrapper (`npx agent-todo`) that downloads the right binary | Same install paths codegraph uses; `agent-todo upgrade` updates in place |
| MCP | `@modelcontextprotocol/sdk` — stdio + Streamable HTTP | stdio for local agents, HTTP for daemon and cloud |
| Query layer | Kysely (typed SQL builder) with per-dialect migrations | Dialect-agnostic queries; SQLite and Postgres from one repo layer |
| Local store | SQLite via `bun:sqlite`, WAL, FTS5 | Embedded in the binary; one file per project |
| Cloud store | Postgres 16 (managed: RDS, Cloud SQL, Neon, Supabase) via `postgres` driver + PgBouncer | Row locks with `SKIP LOCKED`, `tsvector` search, replicas, partitioning |
| Change fan-out | Postgres `LISTEN/NOTIFY` (v1); Redis Streams optional at higher scale | Pushes updates to connected agents and the board without polling |
| Validation | `zod` | Same schemas feed MCP input schemas, REST and service checks |
| HTTP | Hono | Runs in the binary for daemon/cloud; REST + web board |
| Web board | Static SPA (Vite + React) embedded in the binary | Humans view and triage; no separate deploy |
| Auth (cloud) | OAuth 2.1 per the MCP authorization spec, OIDC login for humans, scoped API tokens for headless agents | Works with Claude Code, Cursor and CI agents |
| Observability | OpenTelemetry traces + Prometheus `/metrics`, structured JSON logs | Needed to operate at scale |
| Packaging (cloud) | Distroless container image, Helm chart, Terraform examples (AWS ECS/RDS, GCP Cloud Run/Cloud SQL), `fly.toml` | Deploy anywhere containers run |
| Tests | Vitest-compatible `bun test`, Testcontainers for Postgres, k6 for load | Both adapters run the same suite |

**Layers (top to bottom)**

1. **Entry / transports** — CLI (`install`, `init`, `serve`, `daemon`, `server`, `migrate`, `import`, `export`, `push`), stdio MCP, Streamable HTTP MCP, REST, web board.
2. **Connection router** — in `serve --mcp`, reads `.agent-todo/config.toml` and either opens the local store directly or proxies every MCP call to the configured daemon or cloud URL. This is why agent configs never change between local and cloud.
3. **MCP adapter** — registers tools/resources/prompts, maps zod input → service call → shaped output. No business logic.
4. **Services** — `GroupService`, `TaskService`, `CommentService`, `ContextService`, `WorkService`, `Shaper`, `StateMachine`, `AuthzService` (project/token scopes).
5. **Store interface** — repositories per entity plus `tx()`, `claimNext()`, `search()`, `events()`; implemented by `SqliteStore` and `PostgresStore`.
6. **Storage** — `.agent-todo/todo.db` locally; Postgres cluster in cloud.

## 2b. Setup and run modes

Setup is two commands, and agents never need project-specific MCP config: the global entry `agent-todo serve --mcp` finds the project from the working directory, the way git finds `.git`.

### Install — once per machine

```bash
curl -fsSL https://<your-domain>/install.sh | sh     # or: brew install agent-todo / npx agent-todo
agent-todo install                                   # detect agents and wire them up
```

`install` detects installed agents and writes a user-level MCP entry `{"command": "agent-todo", "args": ["serve", "--mcp"]}` for each: Claude Code (`claude mcp add --scope user`), Cursor (`~/.cursor/mcp.json`), Codex CLI (`~/.codex/config.toml`), Gemini CLI, VS Code Copilot, opencode. It also auto-allows the read-only `core` tools where the agent supports permission lists. `agent-todo uninstall` removes all of it; `agent-todo doctor` checks each agent's wiring.

### Init — once per project

```bash
cd my-project
agent-todo init                          # local mode
agent-todo init --remote https://todo.acme.dev --project acme/web   # cloud mode
```

`init` does, in one pass:

1. Creates `.agent-todo/` with `config.toml`, and in local mode `todo.db` (git-ignored).
2. Creates the first group from the repo name and imports an existing `CLAUDE.md` / `AGENTS.md` into its context sections (§6).
3. Rewrites those files to the short stub inside marker comments (`<!-- agent-todo:start -->…<!-- agent-todo:end -->`), and adds `.cursor/rules/agent-todo.mdc` if Cursor is present.
4. Writes a project-scoped `.mcp.json` so teammates who cloned the repo but skipped `install` still get the server.
5. In remote mode, runs the OAuth device login, creates or links the cloud project, and stores the token in the OS keychain — never in the repo.

`--yes` makes it non-interactive for CI. `agent-todo uninit` reverses it and leaves the data.

**Project discovery.** `serve --mcp` walks up from the working directory to the nearest `.agent-todo/config.toml`. Inside a git worktree it resolves to the main checkout via `git rev-parse --git-common-dir`, so parallel agents in separate worktrees share one board. `AGENT_TODO_PROJECT` overrides discovery.

### Run modes

| Mode | Storage | How agents connect | Use when |
| --- | --- | --- | --- |
| `local` | SQLite file in `.agent-todo/` | Each agent's stdio process opens the file directly (WAL) | One developer, a handful of agents |
| `daemon` | Same SQLite file, one owning process | stdio shim proxies to a per-project daemon on a Unix socket; auto-started on first call, exits after 30 min idle | Many parallel agents on one machine, live web board at `localhost` |
| `remote` | Cloud Postgres | stdio shim proxies over HTTPS; or agents use a native HTTP MCP entry | Teams, CI, agents on several machines |

&#91;embedded content: run modes · one MCP entry, three backends\]

Agent configs are the same in all three modes; switching modes is a one-line change in the project's config file.

```toml
# .agent-todo/config.toml (committed)
version = 1
mode = "remote"                       # local | daemon | remote
project = "acme/web"
default_group = "WEB"
toolsets = ["core", "plan"]

[remote]
url = "https://todo.acme.dev"

[limits]
default_max_tokens = 2000
bundle_context_tokens = 1500
```

**Moving between modes.** `agent-todo push --remote <url>` uploads a local project to the cloud, preserving every ID, comment and event, then flips `mode`. `agent-todo pull` exports a cloud project back to a local file. `agent-todo export --format jsonl` gives a portable backup in any mode.

## 3. Data model

### 3.1 IDs

IDs are short human keys because agents repeat them constantly; every extra character is paid for on every call.

| Entity | Format | Example | Rule |
| --- | --- | --- | --- |
| Group | `KEY`, 2–8 uppercase letters/digits, starts with a letter | `AUTH` | Given by caller or derived from name; unique; immutable once created |
| Task | `KEY-N` | `AUTH-12` | `N` = group's `task_seq + 1`, incremented in the same transaction; never reused, even after delete |
| Comment | `TASKID#N` | `AUTH-12#3` | Per-task sequence |
| Context section | `KEY/slug` | `AUTH/testing` | Slug unique within group |
| Internal PK | ULID | `01J9…` | Used for joins only; never shown to agents |

Moving a task to another group keeps its ID (`AUTH-12` stays `AUTH-12`) so references in comments and commits never break; the `group` field changes.

### 3.2 Entities

**Group**: `key`, `name`, `summary` (≤ 280 chars, the one line agents see in lists), context sections (see §6), defaults (`default_model`, `default_skills[]`, `default_mcps[]`) inherited by new tasks, `archived`, `version`.

**Task**: `id`, `group`, `title` (≤ 120 chars), `description` (markdown), `status`, `priority` (0 = urgent … 3 = low, default 2), `preferred_model?`, `skills[]?`, `mcps[]?`, `tags[]`, `depends_on[]`, `parent?` (subtasks), `assignee?`, `claim` (`owner`, `expires_at`), `acceptance` (optional checklist of done-criteria), `comment_count`, `version`, timestamps, `archived`.

**Comment**: `id`, `task`, `author` (agent or human name), `kind` (`note` · `question` · `decision` · `handoff` · `verification` · `blocker` · `summary`), `body`, `summary` (≤ 160 chars; given by author or first line auto-cut), `pinned`, `compacted_into?`, `reply_to?`, `created_at`.

**Event**: global monotonic `rev`, entity, action, actor, JSON diff. Powers `changes_since`, history and audit.

### 3.3 Status semantics

| Status | Meaning | Who usually sets it |
| --- | --- | --- |
| `todo` | Captured, not ready (needs detail or blocked by deps) | Planner |
| `open` | Ready to be picked up | Planner |
| `inprogress` | Claimed and being worked | Worker agent (via claim) |
| `verifying` | Work done, tests/review running | Worker |
| `verified` | Passed verification | Reviewer agent / human |
| `deploying` | Release in progress | Deployer |
| `deployed` | Live; terminal state | Deployer |
| `reopen` | Failed verification, failed deploy or regression; ready to pick up again with history | Reviewer / deployer / human |

Allowed transitions (anything else needs `force: true` + `reason`, logged as an event):

- `todo` → `open`
- `open` → `inprogress`, `todo`
- `reopen` → `inprogress`, `todo`
- `inprogress` → `verifying`, `open` (release), `todo`
- `verifying` → `verified`, `reopen`
- `verified` → `deploying`, `reopen`
- `deploying` → `deployed`, `reopen`
- `deployed` → `reopen`

&#91;embedded content: task status flow · 8 states\]

The happy path runs todo → deployed; every failure after work is handed in lands in reopen, which goes straight back to inprogress. Releases (inprogress → open/todo) and parking (open/reopen → todo) are omitted for clarity.

Side effects: entering `inprogress` requires or creates a claim; leaving it for `open`/`todo`/`verifying` releases the claim. Entering `reopen` requires a comment (kind `blocker` or `verification`) explaining why. A task cannot move to `open` while any `depends_on` task is not `verified`/`deployed` (configurable). Cancelled work is `archived: true`, not a status.

### 3.4 SQL schema (migration 0001)

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE groups (
  pk             TEXT PRIMARY KEY,            -- ULID
  key            TEXT NOT NULL UNIQUE,        -- 'AUTH'
  name           TEXT NOT NULL,
  summary        TEXT NOT NULL DEFAULT '',
  default_model  TEXT,
  default_skills TEXT NOT NULL DEFAULT '[]',  -- JSON array
  default_mcps   TEXT NOT NULL DEFAULT '[]',
  task_seq       INTEGER NOT NULL DEFAULT 0,
  archived       INTEGER NOT NULL DEFAULT 0,
  version        INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE context_sections (
  pk             TEXT PRIMARY KEY,
  group_pk       TEXT NOT NULL REFERENCES groups(pk) ON DELETE CASCADE,
  slug           TEXT NOT NULL,               -- 'testing'
  title          TEXT NOT NULL,
  body           TEXT NOT NULL DEFAULT '',
  position       INTEGER NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,  -- cached estimate
  always_include INTEGER NOT NULL DEFAULT 0,  -- sent in every work bundle
  applies_to     TEXT NOT NULL DEFAULT '[]',  -- tags this section is relevant to
  version        INTEGER NOT NULL DEFAULT 1,
  updated_at     TEXT NOT NULL,
  UNIQUE (group_pk, slug)
);

CREATE TABLE tasks (
  pk              TEXT PRIMARY KEY,
  id              TEXT NOT NULL UNIQUE,       -- 'AUTH-12'
  group_pk        TEXT NOT NULL REFERENCES groups(pk),
  parent_pk       TEXT REFERENCES tasks(pk),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN
                  ('todo','open','inprogress','reopen','verifying','verified','deploying','deployed')),
  priority        INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 0 AND 3),
  preferred_model TEXT,
  skills          TEXT NOT NULL DEFAULT '[]',
  mcps            TEXT NOT NULL DEFAULT '[]',
  tags            TEXT NOT NULL DEFAULT '[]',
  acceptance      TEXT NOT NULL DEFAULT '[]', -- [{text, done}]
  assignee        TEXT,
  claim_owner     TEXT,
  claim_expires   TEXT,
  desc_tokens     INTEGER NOT NULL DEFAULT 0,
  comment_count   INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);
CREATE INDEX tasks_group_status ON tasks(group_pk, status, priority);
CREATE INDEX tasks_claim ON tasks(claim_owner, claim_expires);

CREATE TABLE task_deps (
  task_pk       TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  depends_on_pk TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  PRIMARY KEY (task_pk, depends_on_pk)
);

CREATE TABLE comments (
  pk             TEXT PRIMARY KEY,
  id             TEXT NOT NULL UNIQUE,        -- 'AUTH-12#3'
  task_pk        TEXT NOT NULL REFERENCES tasks(pk) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  author         TEXT NOT NULL,
  kind           TEXT NOT NULL DEFAULT 'note',
  body           TEXT NOT NULL,
  summary        TEXT NOT NULL,
  tokens         INTEGER NOT NULL DEFAULT 0,
  pinned         INTEGER NOT NULL DEFAULT 0,
  reply_to_pk    TEXT REFERENCES comments(pk),
  compacted_into TEXT REFERENCES comments(pk), -- set when superseded by a summary
  created_at     TEXT NOT NULL
);
CREATE INDEX comments_task ON comments(task_pk, seq);

CREATE TABLE events (
  rev        INTEGER PRIMARY KEY AUTOINCREMENT,
  entity     TEXT NOT NULL,   -- 'task' | 'group' | 'comment' | 'section'
  entity_id  TEXT NOT NULL,   -- human id
  group_key  TEXT NOT NULL,
  action     TEXT NOT NULL,   -- 'create' | 'update' | 'status' | 'claim' | 'delete' ...
  actor      TEXT NOT NULL,
  diff       TEXT NOT NULL,   -- JSON {field: [old, new]}
  at         TEXT NOT NULL
);
CREATE INDEX events_group_rev ON events(group_key, rev);

CREATE VIRTUAL TABLE tasks_fts    USING fts5(title, description, content='tasks', content_rowid='rowid');
CREATE VIRTUAL TABLE comments_fts USING fts5(body, content='comments', content_rowid='rowid');
-- + triggers keeping FTS tables in sync on insert/update/delete
```

### 3.5 Tenancy and the Postgres schema

The hierarchy is **org → project → group → task → comment**. A local database holds exactly one project; a cloud database holds many. Every table above gains `project_pk`, and every uniqueness rule is scoped by it, so `AUTH-12` is unique within its project, not globally.

```sql
CREATE TABLE orgs     (pk TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE projects (pk TEXT PRIMARY KEY, org_pk TEXT NOT NULL REFERENCES orgs(pk),
                       slug TEXT NOT NULL, name TEXT NOT NULL, rev BIGINT NOT NULL DEFAULT 0,
                       settings JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL,
                       UNIQUE (org_pk, slug));
CREATE TABLE members  (org_pk TEXT, user_id TEXT, role TEXT CHECK (role IN ('owner','admin','member','viewer')),
                       PRIMARY KEY (org_pk, user_id));
CREATE TABLE api_tokens (pk TEXT PRIMARY KEY, project_pk TEXT REFERENCES projects(pk), name TEXT NOT NULL,
                       hash TEXT NOT NULL, toolset_ceiling TEXT NOT NULL, groups TEXT[],
                       expires_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ);

-- every entity table: project_pk TEXT NOT NULL REFERENCES projects(pk)
-- groups:   UNIQUE (project_pk, key)
-- tasks:    UNIQUE (project_pk, id)
-- comments: UNIQUE (project_pk, id)
-- events:   PRIMARY KEY (project_pk, rev), PARTITION BY HASH (project_pk)
```

**Dialect differences handled in the adapters, not the services:**

| Concern | SQLite (local) | Postgres (cloud) |
| --- | --- | --- |
| JSON arrays | `TEXT` + `json_each` | `JSONB` / `TEXT[]` with GIN indexes on `tags`, `skills` |
| Full-text search | FTS5 virtual tables | `tsvector` generated columns + GIN |
| Claim next task | `BEGIN IMMEDIATE` + select + update | `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` |
| Per-project revision | `events` autoincrement | `UPDATE projects SET rev = rev + 1 … RETURNING rev` in the write tx |
| Tenant isolation | One project per file | Row-level security policy `project_pk = current_setting('app.project')`, set per transaction |
| Large tables | — | `events` and `comments` hash-partitioned by `project_pk` (16 partitions to start) |
| Timestamps | ISO text | `TIMESTAMPTZ` |

## 4. Context minimisation

The rule: **every read returns the least an agent needs to decide its next call, and says how to get more.** Eleven mechanisms, all implemented in one `Shaper` module so every tool behaves the same.

| # | Mechanism | How it works | Default |
| --- | --- | --- | --- |
| 1 | Detail levels | `view: "id" \| "line" \| "brief" \| "full"` on every read. `line` = one text line per item (`AUTH-12 [open] P1 Fix token refresh · opus · 3c`) | lists `line`, gets `brief` |
| 2 | Field projection | `fields: ["status","skills"]` returns only those keys | off |
| 3 | No empty fields | Nulls, `[]`, `""` and defaults are omitted from JSON | always |
| 4 | Pagination | Opaque `cursor`, `limit` (default 20, max 100); response ends with `next: "<cursor>"` or nothing | 20 |
| 5 | Token budget | `max_tokens` on any read; Shaper estimates size, truncates long text with `…[+842 tok, use view=full]`, and stops lists early with a cursor | 2,000 |
| 6 | Comment digest | Tasks never inline comment bodies. `brief` shows `comments: {n: 14, pinned: [...summaries], last: "AUTH-12#14 handoff: tests green, PR #88"}` | on |
| 7 | Comment compaction | `comment_compact` writes a `summary` comment that supersedes older ones; superseded comments are hidden from default reads (kept for audit). Tasks with > 15 live comments or > 3,000 comment tokens get `needs_compaction: true` | threshold configurable |
| 8 | Sectioned group context | `context_get` without `sections` returns only the table of contents with token cost per section; agent then fetches the 1–3 it needs | TOC only |
| 9 | Deltas | `changes_since(rev)` returns only events after a revision; every response carries the current `rev` so an agent can resume cheaply | — |
| 10 | Work bundle | `task_next` / `task_start` return, in one call: the task (`full`), pinned + last 3 comment summaries, `always_include` context sections, and sections whose `applies_to` matches task tags | on |
| 11 | Tiny write acks | Mutations return `{id, v, status}` (and `warnings` if any), never the full object; `echo: true` opts in | on |

**Output format.** Default responses are compact text blocks, not pretty JSON, because they cost noticeably fewer tokens for list data (measure it in phase 3). `format: "json"` returns structured JSON (also sent as MCP `structuredContent` for clients that use it). Example `task_list` in `line` view:

```text
AUTH rev=482 · 3 of 11 open
AUTH-12 [open] P1 Fix token refresh race · opus · skills:tdd · 3c
AUTH-15 [reopen] P0 Session cookie not HttpOnly · 1c!blocker
AUTH-17 [open] P2 Add rate limit to /login
next: c_eyJvIjoyMH0
```

**Tool-schema budget.** Tool definitions sit in the agent's context for the whole session, so they are minimised too:

- One-sentence tool descriptions; parameter descriptions ≤ 10 words; shared enums defined once.
- Toolsets selected by env/flag: `core` (10 tools an implementing agent needs), `plan` (+ group/context authoring, bulk create), `admin` (+ delete, force, export). A worker agent loads `core` only, ≈ 1.5k tokens of schema.
- Target sizes, enforced by a test: full schema ≤ 5k tokens; `core` ≤ 1.8k.

**Size guards on write.** `title` ≤ 120 chars, comment `summary` ≤ 160, group `summary` ≤ 280. Descriptions and comment bodies over 4k tokens are accepted with a warning suggesting a split or compaction.

## 5. MCP surface

24 tools in three toolsets, 5 resources, 4 prompts. Every tool takes an optional `agent` (actor name for claims and audit; defaults to the connection's configured name). Every read accepts `view`, `fields`, `max_tokens`, `format`; every list adds `limit`, `cursor`.

### 5.1 Toolset `core` (workers)

| Tool | Key inputs | Returns |
| --- | --- | --- |
| `task_next` | `group?`, `tags?`, `model?`, `skills?`, `claim` (default true), `ttl_min` (default 60) | Highest-priority `open`/`reopen` task with deps met that matches filters, claimed atomically, as a **work bundle** (§4 #10); or `none` |
| `task_get` | `id`, `include?: ["comments","deps","history","context"]` | Task at `brief` (or requested view) + requested extras |
| `task_list` | `group?`, `status?[]`, `tags?`, `assignee?`, `q?` (full-text), `sort` (`priority` \| `updated`) | Task lines + `next` cursor + `rev` |
| `task_create` | `group`, `tasks: [{title, description?, priority?, preferred_model?, skills?, mcps?, tags?, depends_on?, parent?, acceptance?}]` (1–50) | `[{id, v}]` |
| `task_update` | `id`, `v` (expected version), `set: {…}`, `append_description?`, `add/remove` for list fields | `{id, v}` or `VERSION_CONFLICT` with changed fields |
| `task_status` | `id`, `to`, `comment?` ({body, kind}), `force?`, `reason?` | `{id, v, status}`; `INVALID_TRANSITION` lists allowed targets |
| `comment_add` | `task`, `body`, `kind` (default `note`), `summary?`, `pinned?`, `reply_to?` | `{id}` |
| `comment_list` | `task`, `since?` (comment id), `kinds?`, `ids?`, `view` (`summary` default \| `full`), `include_compacted?` | Comment summaries or bodies, oldest→newest |
| `context_get` | `group`, `sections?` (slugs), `for_task?` | TOC with token costs, or requested sections; `for_task` picks `always_include` + tag-matched sections |
| `changes_since` | `rev`, `group?`, `entities?` | Compact event lines + new `rev` |

### 5.2 Toolset `plan` (planners, leads)

| Tool | Key inputs | Returns |
| --- | --- | --- |
| `group_create` | `name`, `key?`, `summary`, `defaults?`, `context_markdown?` | `{key}` |
| `group_update` | `key`, `v`, `set: {name, summary, defaults}` | `{key, v}` |
| `group_list` | `archived?` | One line per group: key, name, summary, open/total counts |
| `group_get` | `key` | Summary, status counts, defaults, context TOC |
| `context_update` | `group`, `ops: [{op: upsert\|append\|replace_text\|delete\|move, slug, …}]` | `{sections: [{slug, v, tokens}]}` |
| `context_import` | `group`, `markdown`, `mode` (`merge` \| `replace`) | Sections created/updated (splits on `##`) |
| `context_export` | `group`, `flavor` (`claude_md` \| `agents_md` \| `plain`), `sections?` | Markdown text |
| `comment_compact` | `task`, `summary_body`, `supersedes` (ids or `"all"`), `keep_pinned` (default true) | `{id, hidden: n}` |
| `task_claim` / `task_release` | `id`, `ttl_min?` / `id`, `to_status?` | `{id, claim_expires}` / `{id, status}` |
| `task_move` | `id`, `group` | `{id, group}` |

### 5.3 Toolset `admin`

| Tool | Key inputs | Returns |
| --- | --- | --- |
| `task_archive` | `id`, `reason` | `{id}` (soft delete; `hard: true` allowed only with `ALLOW_HARD_DELETE=1`) |
| `group_archive` | `key` | `{key}` |
| `history` | `id` (task or group) | Event lines for that entity |

### 5.4 Errors

Errors are MCP tool results with `isError: true` and one line: `CODE: message · hint`. Codes: `NOT_FOUND`, `VALIDATION`, `VERSION_CONFLICT` (includes current `v` and changed fields), `INVALID_TRANSITION` (includes allowed targets), `CLAIMED` (owner + expiry), `DEPS_UNMET` (blocking ids), `BUDGET` (payload would exceed hard cap). Hints tell the agent the exact next call, e.g. `hint: task_get AUTH-12 fields=[v]`.

### 5.5 Resources

- `todo://groups` — group lines.
- `todo://group/{key}/context` — TOC; `todo://group/{key}/context/{slug}` — one section (lets clients that @-mention resources attach context without a tool call).
- `todo://task/{id}` — task at `brief`.
- `todo://group/{key}/board` — status counts + top open tasks.

### 5.6 Prompts

- `start_work(group)` — tells the agent to call `task_next`, read the bundle, and follow the comment/handoff conventions.
- `write_group_context(group)` — drafts or refreshes the group's context sections from the repo and recent task decisions (§6).
- `handoff(task)` — writes a `handoff` comment: state, what's done, what's next, gotchas; ≤ 150 words.
- `compact(task)` — reads comments at `full` and calls `comment_compact` with a faithful summary.

## 6. Group context: replacing CLAUDE.md / AGENTS.md

Each group's context is a list of named sections instead of one file, so an agent loads the 2–3 sections relevant to its task rather than the whole document on every session.

**Recommended default sections** (created empty by `group_create`, all optional):

| Slug | Holds | `always_include` |
| --- | --- | --- |
| `overview` | What this group/project is, in ≤ 150 words | yes |
| `commands` | Build, test, lint, run commands | yes |
| `conventions` | Code style, naming, commit/PR rules | no (tag `code`) |
| `architecture` | Modules, data flow, key files | no |
| `testing` | How to test, fixtures, what "verified" means here | no (tag `test`) |
| `deploy` | Release steps, environments, rollback | no (tag `deploy`) |
| `gotchas` | Known traps, flaky things, don'ts | yes |
| `decisions` | Running log of decisions promoted from task comments | no |

**How agents consume it**

1. `task_next` / `task_get include=[context]` automatically attaches `always_include` sections plus sections whose `applies_to` tags match the task's tags. Budget: context in a bundle is capped at 1,500 tokens (configurable); overflow is listed by slug and cost, not sent.
2. `context_get(group)` alone returns the TOC, e.g. `AUTH context · overview 180t · commands 90t · architecture 1.2kt · testing 400t …`.
3. The repo keeps a 5-line stub `CLAUDE.md` / `AGENTS.md` generated by `context_export flavor=stub` (a fourth flavor alongside claude\_md, agents\_md, plain): “Project context lives in agent-todo group AUTH. Call `context_get AUTH` for the index; call `task_next group=AUTH` to start work.” This keeps tools that only read files working.

**How it gets written (the “generate description” flow)**

- **Import:** `context_import(group, markdown)` splits an existing CLAUDE.md/AGENTS.md on `##` headings into sections (slugified), estimates tokens, and flags any section over 800 tokens for splitting.
- **Generate:** the `write_group_context` prompt instructs the connected agent to inspect the repo (README, package manifests, CI config, directory tree) and the group's recent `decision` comments, then call `context_update` section by section. The server has no LLM of its own; if the client supports MCP **sampling**, an optional `context_generate` tool (phase 4) can request the draft directly.
- **Promote decisions:** when a comment of kind `decision` is added, the ack includes `hint: consider context_update AUTH decisions append`. Planners periodically fold durable decisions into `conventions`/`architecture`.
- **Export:** `context_export flavor=claude_md|agents_md` renders all sections as one markdown file for tools that need it, with a header noting it is generated.

Section writes are versioned (`v`) and logged as events, so `changes_since` tells an agent when the context it cached has changed.

## 7. Concurrency, multi-agent coordination, security

**Claims (who is working on what).** A claim is `(owner, expires_at)` on the task row. `task_next` selects and claims in one `BEGIN IMMEDIATE` transaction, so two agents can never receive the same task. Any write by the owner extends the lease by `ttl_min`. An expired claim is treated as absent; a sweeper (every 60 s) moves expired `inprogress` tasks back to `open` and adds a system comment `claim expired (agent-x)`. Other agents can read and comment on a claimed task, but `task_update`/`task_status` return `CLAIMED` unless `force` is used.

**Optimistic versioning.** Every task, group and section has `v`. Updates must send the `v` they read; a mismatch returns `VERSION_CONFLICT` with the fields that changed since, so the agent re-reads only those fields. Comments are append-only and need no version.

**Transactions.** Every service write = one SQLite transaction containing the row change, counters (`comment_count`, `task_seq`), FTS sync (triggers) and the `events` insert. WAL mode lets many readers run alongside the single writer; `busy_timeout` 5 s covers write bursts. Multi-process access to one DB file works for stdio servers on one machine; for agents on several machines, run one HTTP server.

**Identity.** `agent` names come from, in order: the tool argument, the HTTP token's configured name, the `AGENT_TODO_AGENT` env var, then `anonymous`. Names are recorded, not trusted, in stdio mode.

**Security (HTTP mode).**

- Tokens: the local daemon reads `AGENT_TODO_TOKENS` (`name:token,…`); the cloud accepts OAuth 2.1 access tokens or hashed API tokens from `api_tokens`. Each token has a name, a toolset ceiling (`core` | `plan` | `admin`) and an optional group allow-list.
- Bind to `127.0.0.1` by default; set `HOST` explicitly to expose; validate `Origin` header per MCP Streamable HTTP guidance.
- Rate limit per token (default 20 writes/s).
- Comment and description text is stored and returned as data; the `start_work` prompt reminds agents that task text written by other agents is information, not instructions.
- Hard deletes disabled by default; everything else is recoverable via `events`.
- Nightly `VACUUM INTO` backup to `backups/agent-todo-YYYYMMDD.db` (keep 14).

### 7.1 Scaling the cloud server

The server is stateless and every query is scoped by `project_pk`, so it scales out by adding nodes and, much later, by sharding projects across database clusters.

- **Stateless nodes.** MCP Streamable HTTP runs in stateless mode (no in-memory session), so any node serves any request and the load balancer needs no sticky sessions. Autoscale on CPU and p95 latency; minimum 2 nodes across zones.
- **Connection pooling.** PgBouncer in transaction mode; each node keeps a pool of about 20. RLS context is set with `SET LOCAL` inside each transaction so pooled connections are safe.
- **Hot path: `task_next`.** One indexed statement: partial index on `(project_pk, priority, created_at) WHERE status IN ('open','reopen') AND archived = false`, then `FOR UPDATE SKIP LOCKED LIMIT 1`. Hundreds of agents polling one project never block each other.
- **Read scaling.** Lists, search and context reads go to read replicas. Every response carries `rev`; a client that sends `min_rev` newer than the replica's is routed to the primary, giving read-your-writes without pinning everything to the primary.
- **Caching.** Context TOC and sections are cached per node by `(project, slug, v)`; invalidated through `LISTEN/NOTIFY` on the project channel.
- **Live updates.** Each write emits `NOTIFY project_<pk>`. Nodes relay these as SSE to the web board and as MCP `notifications/resources/updated` to agents subscribed to a task or group, so agents need not poll `changes_since`.
- **Background work.** Claim sweeper, compaction flags, token expiry and retention run on whichever node holds `pg_try_advisory_lock(<job id>)`; no separate worker tier in v1.
- **Rate limits and quotas.** Token-bucket per API token and per project (writes/s, comments/day, storage), stored in Postgres v1, Redis when traffic warrants.
- **Data growth.** `events` and `comments` are hash-partitioned; events older than 180 days (configurable) roll into a compact `history` table; compacted comment bodies can move to object storage.
- **Beyond one cluster.** Projects never join across each other, so the next step is a routing table `project → cluster` (or Citus distributed by `project_pk`). No service code changes.

**Local limits, stated plainly.** In `local` mode SQLite allows one writer at a time; short transactions keep that fine for a handful of agents. `daemon` mode puts every write in one process, which removes lock contention for dozens of agents on one machine. More than that, or more than one machine, is what `remote` mode is for.

## 8. Project structure and configuration

```text
agent-todo/                      # Bun workspace monorepo, one binary out
├─ packages/
│  ├─ core/                      # domain (ids, status machine), zod types, services, Shaper, Store interface
│  ├─ store-sqlite/              # SqliteStore on bun:sqlite + FTS5
│  ├─ store-postgres/            # PostgresStore, RLS, SKIP LOCKED, tsvector
│  ├─ mcp/                       # tool/resource/prompt registration, toolsets, error mapping
│  ├─ server/                    # Hono: HTTP MCP (stateless), REST, OAuth, SSE, rate limits, jobs
│  ├─ cli/                       # install/uninstall, init/uninit, serve --mcp (router + proxy),
│  │  └─ integrations/           #   daemon, server, push/pull, import/export, doctor, upgrade
│  │                             #   claude-code.ts cursor.ts codex.ts gemini.ts vscode.ts opencode.ts
│  └─ web/                       # board SPA, embedded as static assets
├─ migrations/
│  ├─ sqlite/0001_init.sql
│  └─ postgres/0001_init.sql
├─ deploy/
│  ├─ Dockerfile                 # distroless, runs `agent-todo server`
│  ├─ helm/  terraform/aws/  terraform/gcp/  fly.toml
│  └─ docker-compose.yml         # server + Postgres + PgBouncer for self-hosting
├─ scripts/install.sh  install.ps1  build-binaries.ts   # linux/mac/windows × x64/arm64
└─ test/
   ├─ conformance/               # one suite, run against both stores
   ├─ mcp/  concurrency/  budgets/  e2e-install/  load/ (k6)
```

**Configuration** (project file, env var, or server env):

| Setting | Where | Default | Purpose |
| --- | --- | --- | --- |
| `mode`, `project`, `default_group`, `toolsets`, `[remote].url`, `[limits]` | `.agent-todo/config.toml` | `local` | Per-project behaviour; committed (§2b) |
| `AGENT_TODO_PROJECT` | env | discovered | Override project discovery |
| `AGENT_TODO_AGENT` | env / tool arg | agent's client name | Actor name for claims and audit |
| `AGENT_TODO_TOOLSETS` | env | from config | Narrow tools for a given agent (e.g. subagents get `core`) |
| `DATABASE_URL` / `DATABASE_REPLICA_URLS` | server env | — | Postgres primary and replicas |
| `PUBLIC_URL`, `PORT` | server env | — / `8080` | External URL for OAuth redirects |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | server env | — | Human login and OAuth for MCP clients |
| `REDIS_URL` | server env | unset | Optional: rate limits and fan-out at high scale |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | server env | unset | Traces |
| `JOBS_ENABLED` | server env | `true` | Let this node compete for background-job locks |
| `CLAIM_TTL_MIN`, `COMPACT_THRESHOLD`, `DEPS_GATE`, `ALLOW_HARD_DELETE` | project settings (config or cloud UI) | `60`, `15`/`3000`, `on`, `0` | Behaviour knobs |

## 9. Implementation phases

Ten phases, about 30 developer-days for one engineer (estimates, not commitments). Each phase ends with something runnable; phase 3 is the first point where an agent can actually use it.

| Phase | Delivers | Est. |
| --- | --- | --- |
| 0 Scaffold | Bun workspace, CI, cross-platform binary builds | 1.5 d |
| 1 Core + SQLite store | Store interface, SQLite adapter, IDs, status machine, conformance suite | 3 d |
| 2 Services | Business rules, events, claims, search | 3 d |
| 3 Core MCP (stdio) | 10 `core` tools + Shaper — **usable local MVP** | 3 d |
| 4 Installer and init | `install`, `init`, project discovery, agent integrations — **codegraph-style setup** | 3 d |
| 5 Planning and context | `plan`/`admin` tools, context import/export, compaction, prompts, resources | 3 d |
| 6 Daemon and board | Local daemon, stdio proxy, embedded web board | 2.5 d |
| 7 Cloud | Postgres store, HTTP server, OAuth, tenancy, `push`/`pull` — **team-ready** | 5 d |
| 8 Scale and operations | Replicas, live updates, jobs, quotas, partitioning, observability, deploy kits, load tests | 4 d |
| 9 Hardening and release | Budget suite, docs, signed binaries, container image, dogfooding | 2 d |

### Phase 0 — Scaffold

- [ ] Bun workspace (`packages/*`), TypeScript strict, Biome lint/format, `bun test`; `bun build --compile` matrix for linux/mac/windows × x64/arm64
- [ ] Install `@modelcontextprotocol/sdk`, `better-sqlite3`, `drizzle-orm`, `zod`, `ulid`
- [ ] CI: lint, typecheck, test on Node 22
- [ ] `src/index.ts` CLI skeleton with `serve` and `migrate`

*Done when:* `pnpm test` and `pnpm build` pass in CI; `npx agent-todo --help` prints commands.

### Phase 1 — Data layer and domain

- [ ] `0001_init.sql` from §3.4, FTS triggers, migration runner (runs on startup)
- [ ] `db/client.ts` with pragmas and `tx(fn)` helper using `BEGIN IMMEDIATE`
- [ ] Store interface (repos + tx + claimNext + search + events) and SqliteStore, plus a conformance suite written against the interface so the phase 7 Postgres adapter must pass the same tests
- [ ] `domain/ids.ts`: key regex, derive-key-from-name, `KEY-N` allocation inside tx
- [ ] `domain/status.ts`: transition table, guards (deps, claim, reopen-needs-comment)
- [ ] `util/tokens.ts`: `estimate()`, `truncate(text, budget)` on paragraph/line boundaries

*Done when:* unit tests cover every allowed and forbidden transition; 1,000 concurrent `KEY-N` allocations across 4 worker threads yield no duplicates or gaps.

### Phase 2 — Services

- [ ] `GroupService`: create (with default sections + defaults), update, list, get, archive
- [ ] `TaskService`: create (batch, inherits group defaults), update with `v`, status change, move, archive, list/search with filters + cursor pagination
- [ ] `CommentService`: add (auto-summary, counters, decision hint), list (since/kinds/ids), compact
- [ ] `ContextService`: TOC, get sections, upsert/append/replace\_text/delete/move, `for_task` selection by tags within budget
- [ ] `WorkService`: `next` (select + claim in one tx), claim/release/extend, bundle assembly, expired-claim sweeper
- [ ] Every write appends an `events` row with a field diff; `changesSince(rev)`

*Done when:* integration tests run a full lifecycle (`todo`→…→`deployed`, plus a `reopen` loop) through services only; two parallel `next` calls never return the same task.

### Phase 3 — Core MCP over stdio (MVP)

- [ ] `Shaper`: views `id/line/brief/full`, `fields`, empty-field stripping, `max_tokens` truncation, cursors, text and JSON renderers, `structuredContent`
- [ ] `mcp/server.ts` with toolset filtering from config
- [ ] Tools: `task_next`, `task_get`, `task_list`, `task_create`, `task_update`, `task_status`, `comment_add`, `comment_list`, `context_get`, `changes_since`
- [ ] Error mapping to `CODE: message · hint`
- [ ] stdio transport; `claude mcp add` instructions in README

*Done when:* in Claude Code, an agent with only this server can take a seeded task from `open` to `verifying` with comments, without reading any file for context; `core` tool schemas measure ≤ 1.8k tokens; a `task_list` of 20 tasks in `line` view is ≤ 600 tokens.

### Phase 4 — Installer and project init

- [ ] `install.sh` / `install.ps1`, Homebrew formula, npm wrapper that fetches the platform binary; `agent-todo upgrade`
- [ ] `install` / `uninstall` with one integration module per agent (Claude Code, Cursor, Codex CLI, Gemini CLI, VS Code Copilot, opencode): detect, write MCP entry, set tool permissions, reverse cleanly
- [ ] `init` / `uninit`: `.agent-todo/` layout, `config.toml`, `.gitignore`, first group, CLAUDE.md/AGENTS.md import + marker-delimited stub, project `.mcp.json`, `--yes`
- [ ] Project discovery (walk up; git worktree → common dir; `AGENT_TODO_PROJECT`)
- [ ] `doctor`: checks binary on PATH, each agent's wiring, project config, DB integrity

*Done when:* on clean macOS, Linux and Windows VMs, `install` + `init` + opening Claude Code and Cursor in the repo lets both agents list the same tasks with no manual config; two Claude Code sessions in separate git worktrees share one board; `uninstall` leaves every agent config byte-identical to before.

### Phase 5 — Planning, context, compaction

- [ ] `plan` tools: `group_*`, `context_update`, `context_import`, `context_export` (incl. `stub`), `comment_compact`, `task_claim`, `task_release`, `task_move`
- [ ] `admin` tools: `task_archive`, `group_archive`, `history`
- [ ] `needs_compaction` flag and compaction hint in `task_get`
- [ ] Resources (§5.5) and prompts (§5.6)
- [ ] Optional `context_generate` using MCP sampling when the client advertises it
- [ ] CLI: `agent-todo import CLAUDE.md --group AUTH`, `agent-todo export AUTH --flavor agents_md`

*Done when:* importing a real 3k-token CLAUDE.md produces sections whose TOC is ≤ 150 tokens; a task with 30 comments, after compaction, returns a `brief` view ≤ 500 tokens with no lost pinned/decision content.

### Phase 6 — Daemon mode and web board

- [ ] `agent-todo daemon`: owns the SQLite file, serves MCP + REST on a per-project Unix socket (named pipe on Windows) and `localhost`
- [ ] Router in `serve --mcp`: `mode = daemon` → auto-start daemon if absent, proxy calls; idle exit after 30 min
- [ ] Embedded board SPA: columns by status, task drawer with comments, context sections view, live via SSE

*Done when:* 30 agents on one machine hammering one project for 10 minutes see no `SQLITE_BUSY` errors and no duplicate claims; the board reflects changes within 1 s.

### Phase 7 — Cloud server

- [ ] `PostgresStore` passing the full conformance suite (Testcontainers in CI)
- [ ] Postgres migrations incl. orgs, projects, members, api\_tokens, RLS policies, partitions (§3.5)
- [ ] `agent-todo server`: stateless Streamable HTTP MCP, REST, board, health/readiness endpoints
- [ ] Auth: OAuth 2.1 authorization server metadata + dynamic client registration per the MCP spec, OIDC login for humans, API tokens with toolset ceiling and group allow-list
- [ ] `init --remote` device-code login, keychain storage; `serve --mcp` remote proxy mode
- [ ] `push` / `pull` / `export --format jsonl` with ID preservation
- [ ] Dockerfile + `docker-compose.yml` (server, Postgres, PgBouncer) for self-hosting

*Done when:* a local project with 500 tasks is pushed to the cloud with every ID and comment intact; agents on three machines share it; a token scoped to `core` + one group cannot read other groups or projects (verified by RLS tests, not only app checks).

### Phase 8 — Scale and operations

- [ ] Read-replica routing with `min_rev` read-your-writes
- [ ] `LISTEN/NOTIFY` fan-out → SSE and MCP resource-update notifications; per-node context cache invalidation
- [ ] Advisory-lock job runner: claim sweeper, compaction flags, retention, token expiry
- [ ] Per-token and per-project rate limits and quotas
- [ ] OpenTelemetry traces, Prometheus metrics (tool latency, claim contention, pool saturation), JSON logs, dashboards
- [ ] Helm chart, Terraform for AWS (ECS + RDS) and GCP (Cloud Run + Cloud SQL), `fly.toml`
- [ ] k6 load test: 1,000 simulated agents across 1,000 projects

*Done when:* the k6 run on 4 server nodes + one Postgres primary and replica holds p95 < 100 ms for all `core` tools with zero duplicate claims; killing a node mid-test causes no failed tool calls beyond client retry.

### Phase 9 — Hardening and release

- [ ] Budget regression suite (see §10) wired into CI
- [ ] Local load test: 10k tasks, 100k comments — `task_list` p95 < 50 ms, `task_next` p95 < 30 ms
- [ ] Signed and notarised binaries (macOS), checksums, SBOM; container image published
- [ ] Docs: quick start (install → init → first task), self-hosting guide, tool reference generated from zod schemas, agent conventions
- [ ] Dogfood: manage this project's own remaining work in agent-todo, first local then cloud

*Done when:* all CI suites green, v1.0 published, and one week of dogfooding produces no data-loss or claim bugs.

## 10. Testing, client setup, risks

### 10.1 Testing

| Suite | What it proves |
| --- | --- |
| Unit | Status transitions, ID allocation, key derivation, token estimate/truncate, cursor encode/decode, Shaper views |
| Service integration | Lifecycles, reopen loops, deps gate, version conflicts, compaction hides but keeps comments, events diff correctness |
| MCP integration | Real `Client` ↔ `McpServer` over in-memory transport; every tool's happy path and each error code |
| Concurrency | N worker threads calling `task_next` / `task_update` on one DB file; asserts no double claims, no lost updates |
| Budget regression | Snapshot token counts for: tool schemas per toolset, `task_list` (20, `line`), `task_get` (`brief`), work bundle, context TOC. CI fails if any grows > 10% without an updated baseline |
| Agent eval (manual, per release) | Scripted scenario in Claude Code: planner creates group + 5 tasks; two workers complete them; reviewer reopens one. Record total tokens and tool calls; compare with previous release |

### 10.2 Client setup

Nobody writes MCP config by hand: `agent-todo install` (§2b) writes it for every detected agent. For reference, this is the whole entry, identical for every project and every mode:

```json
{ "mcpServers": { "agent-todo": { "command": "agent-todo", "args": ["serve", "--mcp"] } } }
```

Where installing the binary is not wanted (hosted agents, CI runners), clients that support remote MCP connect straight to the cloud with an API token:

```json
{
  "mcpServers": {
    "agent-todo": {
      "type": "http",
      "url": "https://todo.acme.dev/mcp/acme/web",
      "headers": { "Authorization": "Bearer ${AGENT_TODO_TOKEN}" }
    }
  }
}
```

**Agent conventions** (shipped in the `start_work` prompt and the stub CLAUDE.md):

1. Start with `task_next group=KEY`; work only from the bundle; fetch more context sections only if the TOC shows you need them.
2. Post a `decision` comment for any non-obvious choice; a `blocker` comment before stopping on a problem.
3. Before ending a session with the task unfinished, post a `handoff` comment and `task_release`.
4. Move to `verifying` with a comment listing what to check; reviewers move to `verified` or `reopen` with a `verification` comment.
5. When `needs_compaction` appears, run the `compact` prompt before continuing.

### 10.3 Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Agents ignore budgets and ask for `full` everywhere | Defaults are lean; `full` responses carry a size note; per-token hard cap returns `BUDGET` |
| Compaction loses information | Superseded comments kept and retrievable (`include_compacted`); pinned and `decision` comments are never compacted by default |
| Context sections drift from the code | `changes_since` covers sections; the `write_group_context` prompt is re-run per milestone; sections show `updated_at` in the TOC |
| SQLite write contention with many agents | WAL + short transactions; HTTP mode centralises writes; Postgres adapter behind the repo interface if ever needed |
| Tool-schema bloat as features grow | Toolsets + CI budget test on schema size |
| Prompt injection via task/comment text | Text returned as data; prompt reminds agents; group allow-lists limit blast radius |

### 10.4 Open questions

- Should `verified` → `deploying` be allowed for tasks with no deploy step, or should those tasks end at `verified`? (Proposal: add a per-group `terminal_status` setting.)
- Do you want a separate `blocked` flag, or is a `blocker` comment + `todo` enough?
- Cloud: will you only self-host (the deploy kits in phase 8), or should the plan also cover a managed multi-tenant service with signup and billing?

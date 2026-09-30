---
name: Phase 7 — Cloud server
overview: PostgresStore, multi-tenant HTTP server with OAuth and API tokens, init --remote, push/pull, and self-host Docker Compose.
todos:
  - id: postgres-store
    content: PostgresStore + migrations (§3.5) passing full conformance suite via Testcontainers
    status: pending
  - id: http-server
    content: agent-todo server stateless Streamable HTTP MCP, REST, board, health
    status: pending
  - id: auth
    content: OAuth 2.1 + OIDC humans + hashed API tokens with toolset ceiling and group allow-list
    status: pending
  - id: remote-cli
    content: init --remote device login + keychain; serve --mcp remote proxy; push/pull/export jsonl
    status: pending
  - id: docker
    content: Dockerfile + docker-compose (server, Postgres, PgBouncer)
    status: pending
  - id: rls-tests
    content: Prove token scoped to core + one group cannot read other groups/projects
    status: pending
isProject: true
---

# Phase 7 — Cloud server

## Goal

Ship **team-ready** cloud mode: one codebase, Postgres backend, HTTPS MCP, tenancy, auth, and local↔cloud sync — **self-hosted only** (no signup/billing product).

**Runnable outcome:** `push` a local project (500 tasks) preserving every ID and comment; agents on three machines share it; RLS+app checks block cross-group/project access for scoped tokens.

## Prerequisites

- Phase 6 daemon/board (reuse Hono app patterns and embedded board).
- Phase 1 conformance suite must run unchanged against Postgres.
- Spec: §2b remote, §3.5 tenancy, §7 security/scaling intro, §9 phase 7.

## Out of scope

- Managed multi-tenant SaaS billing/signup.
- Read replicas, LISTEN/NOTIFY at scale, Helm/Terraform/k6 — phase 8 (basic NOTIFY optional if easy; full fan-out in 8).
- Redis required — leave optional unset.

## Locked decisions

- Self-host only for v1.
- Add `postgres` driver (+ Kysely Postgres dialect) and Testcontainers in this phase.
- Dialect differences stay in adapters (JSON/JSONB, FTS5 vs tsvector, SKIP LOCKED, TIMESTAMPTZ, RLS) per §3.5 table.
- Secrets for remote never committed; OS keychain for tokens.

## File tree

```text
migrations/postgres/0001_init.sql
packages/store-postgres/src/
  PostgresStore.ts
  migrate.ts
  rls.ts
packages/server/src/
  commands path via cli: server.ts
  oauth/                 # metadata, DCR, token endpoints per MCP OAuth 2.1
  oidc.ts
  apiTokens.ts
  mcpHttp.ts             # stateless Streamable HTTP
  tenancy.ts             # set app.project per tx
packages/cli/src/commands/
  server.ts
  push.ts
  pull.ts
  export.ts              # --format jsonl
  init.ts                # enable --remote
  serve.ts               # remote proxy
deploy/
  Dockerfile
  docker-compose.yml
test/conformance/        # run matrix: sqlite | postgres
test/rls/
  tenant-isolation.test.ts
```

## Implementation

### 1. Postgres schema (§3.5)

- Tables: `orgs`, `projects`, `members`, `api_tokens`.
- Every entity table gains `project_pk`; uniqueness scoped: `UNIQUE (project_pk, key|id)`.
- `events` PK `(project_pk, rev)`; start with HASH partitions (16) by `project_pk`.
- RLS: `project_pk = current_setting('app.project', true)::text` (or equivalent); set with `SET LOCAL` inside each transaction.
- `tsvector` generated columns + GIN for search; GIN on tags/skills as appropriate.
- `claimNext`: `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` with partial index on open/reopen.

### 2. PostgresStore

- Implement `Store` interface fully.
- Pass **entire** conformance suite under Testcontainers in CI.
- Connection from `DATABASE_URL`; pool sized for single-node v1.

### 3. `agent-todo server`

Env: `DATABASE_URL`, `PUBLIC_URL`, `PORT` (default 8080), `OIDC_*`, optional `DATABASE_REPLICA_URLS` stubbed/ignored until phase 8.

Endpoints:

- Stateless MCP Streamable HTTP at `/mcp/:org/:project` (or `/mcp` with token-bound project).
- REST + board (reuse phase 6).
- `/health` and `/ready` (DB ping).

Stateless: no sticky sessions.

### 4. Auth

- OAuth 2.1 authorization server metadata + dynamic client registration per MCP spec (for Claude Code / Cursor remote).
- OIDC login for humans (board).
- API tokens: store **hash** only; fields name, toolset ceiling (`core|plan|admin`), optional group allow-list, expiry.
- Rate limit stub: 20 writes/s per token (in-memory ok; phase 8 moves to durable quotas).

### 5. CLI remote

- `init --remote <url> --project org/slug`: device-code login, create/link project, store token in OS keychain, write `config.toml` `mode = "remote"` + `[remote].url`.
- `serve --mcp` when remote: stdio proxy over HTTPS with bearer token.
- `push --remote <url>`: upload local project preserving IDs, comments, events; flip mode.
- `pull`: cloud → local file.
- `export --format jsonl`: portable backup.

### 6. Docker self-host

- Distroless (or slim) image running `agent-todo server`.
- `docker-compose.yml`: server + Postgres 16 + PgBouncer (transaction mode).
- Document env vars in README / deploy README.

## Tests

1. Conformance on Postgres (Testcontainers).
2. Push fixture with 500 tasks (can be generated) — IDs and comments intact.
3. RLS tests: token limited to `core` + one group cannot read other groups or other projects (query as that role / setting).
4. OAuth metadata smoke test; API token rejection without hash match.

## Done when

- [x] PostgresStore passes full conformance suite in CI.
- [x] Local→cloud push preserves IDs/comments.
- [x] Remote proxy works from `serve --mcp`.
- [x] Scoped token isolation proven by RLS tests.
- [x] `docker compose up` brings a working stack on a clean machine (documented).
- [x] No billing/signup code paths.

Stop here. Do not start phase 8.

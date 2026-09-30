---
name: Phase 8 — Scale and operations
overview: Replicas, live fan-out, jobs, quotas, observability, deploy kits, and k6 load proof for cloud scale targets.
todos:
  - id: replica-routing
    content: Read-replica routing with min_rev read-your-writes
    status: pending
  - id: listen-notify
    content: LISTEN/NOTIFY to SSE and MCP resource updates; context cache invalidation
    status: pending
  - id: jobs
    content: Advisory-lock job runner for sweeper, compaction flags, retention, token expiry
    status: pending
  - id: quotas
    content: Per-token and per-project rate limits and quotas in Postgres
    status: pending
  - id: observability
    content: OpenTelemetry traces, Prometheus /metrics, JSON logs, example dashboards
    status: pending
  - id: deploy-kits
    content: Helm chart, Terraform AWS and GCP, fly.toml
    status: pending
  - id: k6
    content: k6 load test 1000 agents × 1000 projects; p95 < 100ms; no duplicate claims
    status: pending
isProject: true
---

# Phase 8 — Scale and operations

## Goal

Make the cloud deployment **operable at the v1 scale target**: 10k projects, 1k concurrent agents, p95 &lt; 100 ms for core tools, zero duplicate claims, and kill-a-node resilience with client retry.

**Runnable outcome:** k6 scenario documented and runnable against a 4-node + primary/replica lab; Helm/Terraform/Fly kits exist; metrics and traces export.

## Prerequisites

- Phase 7 cloud server and PostgresStore green.
- Spec: §7.1 scaling, §9 phase 8, §2 observability row.

## Out of scope

- Citus / multi-cluster routing table (document as future only).
- Requiring Redis — implement Postgres-backed limits; wire Redis only if `REDIS_URL` set (optional enhancement, not required for done-when).
- Public managed SaaS.
- Binary signing — phase 9.

## Locked decisions

- MCP stays **stateless**; LB needs no stickiness.
- PgBouncer transaction mode; `SET LOCAL` for RLS per tx.
- Events older than 180 days may roll to compact `history` (implement job; default retention configurable).
- Add OpenTelemetry SDK and Prometheus exporter this phase.

## File tree

```text
packages/server/src/
  replicas.ts            # route reads; honor min_rev
  fanout/notify.ts       # LISTEN/NOTIFY relay
  cache/contextCache.ts
  jobs/runner.ts         # pg_try_advisory_lock
  jobs/sweepClaims.ts
  jobs/compactionFlags.ts
  jobs/retention.ts
  jobs/tokenExpiry.ts
  quotas.ts
  otel.ts
  metrics.ts
deploy/
  helm/agent-todo/…
  terraform/aws/…
  terraform/gcp/…
  fly.toml
test/load/
  k6/core-tools.js
  README.md              # how to run lab topology
```

## Implementation

### 1. Read replicas

- `DATABASE_REPLICA_URLS` comma-separated.
- Lists/search/context reads go to replicas.
- Every response carries `rev`. If client sends `min_rev` newer than replica’s applied rev → route that request to primary (read-your-writes).

### 2. Fan-out

- On write: `NOTIFY project_<pk>` (or single channel with payload).
- Nodes LISTEN and:
  - push SSE to board clients,
  - emit MCP `notifications/resources/updated` for subscribed resources,
  - invalidate per-node context cache keyed by `(project, slug, v)`.

### 3. Jobs

Single runner on each node; compete with `pg_try_advisory_lock(job_id)`:

| Job | Behaviour |
| --- | --- |
| Claim sweeper | Every 60s; expired inprogress → open + system comment |
| Compaction flags | Mark tasks over thresholds |
| Retention | Roll old events; optional comment body archival stub |
| Token expiry | Invalidate / delete expired api_tokens |

Disable with `JOBS_ENABLED=false`.

### 4. Quotas

- Token bucket per API token and per project: writes/s, comments/day, storage estimate.
- Store counters in Postgres for v1.
- Exceed → `BUDGET` or dedicated rate-limit error mapped to MCP.

### 5. Observability

- OTLP traces via `OTEL_EXPORTER_OTLP_ENDPOINT`.
- Prometheus `/metrics`: tool latency histograms, claim contention, pool saturation, notify lag.
- Structured JSON logs (request id, project, tool, duration).
- Example Grafana dashboard JSON optional under `deploy/dashboards/`.

### 6. Deploy kits

- Helm chart: Deployment (min 2), Service, Ingress, config/secrets, PDB.
- Terraform AWS: ECS (or equivalent) + RDS Postgres.
- Terraform GCP: Cloud Run + Cloud SQL.
- `fly.toml` for Fly.io.

Keep examples minimal but apply-able with documented variables.

### 7. k6 load test

Simulate **1,000 agents across 1,000 projects** calling core tools (weighted: list, get, next, status, comment).

Pass criteria:

- p95 &lt; 100 ms for all core tools.
- Zero duplicate claims.
- Document: run on 4 server nodes + one primary + one replica; killing a node mid-test → no failed calls beyond client retry.

CI may run a **scaled-down** k6 smoke; full test is documented for lab/nightly.

## Tests

- Unit: replica router picks primary when `min_rev` ahead.
- Integration: NOTIFY reaches SSE test client.
- Job: only one node runs sweeper under lock (two-process test).
- k6 smoke in CI; full script + README for lab.

## Done when

- [ ] Replica routing + min_rev behaviour tested.
- [ ] Live fan-out updates board/MCP notifications without polling.
- [ ] Jobs run under advisory locks.
- [ ] Quotas enforced.
- [ ] `/metrics` and OTel export work when configured.
- [ ] Helm, Terraform AWS/GCP, `fly.toml` present and documented.
- [ ] k6 script meets pass criteria on lab topology (document results template).

Stop here. Do not start phase 9.

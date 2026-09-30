# Load testing (phase 8)

## Lab topology (full pass criteria)

Run **4 server nodes** behind a load balancer, **one Postgres primary**, and **one read replica**:

1. Set `DATABASE_URL` to the primary (via PgBouncer transaction mode).
2. Set `DATABASE_REPLICA_URLS` to the replica URL on every node.
3. Start four `agent-todo server` processes on different ports (or use the Helm chart with `replicaCount: 4`).
4. Seed 1,000 projects and open tasks (see `test/scale/k6-smoke.test.ts` seed pattern).

## k6 — core tools

```bash
export BASE_URL=http://localhost:8080
export API_TOKEN=at_...
export GROUP_KEY=LOAD
export K6_VUS=1000
export K6_DURATION=2m
k6 run test/load/k6/core-tools.js
```

**Pass:** p95 &lt; 100 ms for all core tool trends; **zero duplicate claims** when running `task_next` with `claim: true` (use a dedicated claim script or grep event log).

## Results template

| Metric | Target | Observed |
| --- | --- | --- |
| task_list p95 | &lt; 100 ms | |
| task_get p95 | &lt; 100 ms | |
| task_next p95 | &lt; 100 ms | |
| task_status p95 | &lt; 100 ms | |
| comment_add p95 | &lt; 100 ms | |
| Duplicate claims | 0 | |
| Node kill mid-test | client retry only | |

## CI smoke

`bun test test/scale/k6-smoke.test.ts` runs a scaled-down concurrent MCP check when Docker is available (no k6 binary required).

## Local SQLite load (phase 9)

`test/load/local-sqlite-load.test.ts` seeds a large SQLite file and measures `task_list` / `task_next` latency.

| Profile | Env | Tasks | Comments | Gates |
| --- | --- | --- | --- | --- |
| CI smoke | (default) | 500 | 2,000 | list p95 &lt; 200 ms, next p95 &lt; 150 ms |
| Full | `AGENT_TODO_LOAD_FULL=1` | 10,000 | 100,000 | list p95 &lt; 50 ms, next p95 &lt; 30 ms |

```bash
bun test test/load/local-sqlite-load.test.ts
AGENT_TODO_LOAD_FULL=1 bun run test:load:local
```

# Load testing

## Local SQLite daemon

```bash
bun run test:load:local
```

Runs hammer-style concurrency against a single machine daemon and SQLite database.

## k6 — core tools (optional)

Point k6 at a running daemon base URL:

```bash
export BASE_URL=http://127.0.0.1:8787
export GROUP_KEY=LOAD
export K6_VUS=50
export K6_DURATION=1m
k6 run test/load/k6/core-tools.js
```

Adjust `GROUP_KEY` to a group that exists in the target database.

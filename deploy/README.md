# Self-hosted agent-todo (phase 7)

```bash
export DATABASE_URL=postgres://agent:agent@postgres:5432/agenttodo
export PUBLIC_URL=http://localhost:8080
export AGENT_TODO_BOOTSTRAP_SECRET=change-me
docker compose -f deploy/docker-compose.yml up --build
```

Environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (via PgBouncer in compose) |
| `PUBLIC_URL` | External URL for OAuth metadata |
| `PORT` | HTTP port (default 8080) |
| `AGENT_TODO_BOOTSTRAP_SECRET` | Enables `POST /api/bootstrap` for `agent-todo init --remote` |
| `OIDC_*` | Optional human login (phase 7 stub metadata only) |

No signup or billing endpoints are included.

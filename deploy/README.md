# Self-hosted agent-todo (phase 7–8)

```bash
export DATABASE_URL=postgres://agent:agent@postgres:5432/agenttodo
export PUBLIC_URL=http://localhost:8080
export AGENT_TODO_BOOTSTRAP_SECRET=change-me
docker compose -f deploy/docker-compose.yml up --build
```

## Deploy kits (phase 8)

| Kit | Path |
| --- | --- |
| Docker Compose | `deploy/docker-compose.yml` |
| Helm (K8s, min 2 pods) | `deploy/helm/agent-todo/` |
| Terraform AWS (RDS + ECS skeleton) | `deploy/terraform/aws/` |
| Terraform GCP (Cloud SQL + Cloud Run) | `deploy/terraform/gcp/` |
| Fly.io | `deploy/fly.toml` |
| Example Grafana JSON | `deploy/dashboards/agent-todo-overview.json` |
| k6 load script | `test/load/k6/core-tools.js` |

Environment:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres primary (PgBouncer transaction mode in production) |
| `DATABASE_REPLICA_URLS` | Comma-separated read replica URLs (optional) |
| `PUBLIC_URL` | External URL for OAuth metadata |
| `PORT` | HTTP port (default 8080) |
| `JOBS_ENABLED` | Background jobs (default true; set `false` to disable) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry trace export (optional) |
| `EVENT_RETENTION_DAYS` | Event retention job (default 180) |
| `AGENT_TODO_BOOTSTRAP_SECRET` | Enables `POST /api/bootstrap` for `agent-todo init --remote` |
| `OIDC_*` | Optional human login (phase 7 stub metadata only) |

Scrape **`GET /metrics`** for Prometheus. Send **`X-Min-Rev`** on reads for read-your-writes with replicas.

No signup or billing endpoints are included.

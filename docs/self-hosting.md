# Self-hosting (cloud v1)

Cloud v1 is **self-hosted only**: Docker Compose, Helm, Terraform, or Fly. No signup or billing portal.

## Docker Compose (fastest)

```bash
export AGENT_TODO_BOOTSTRAP_SECRET=change-me-in-production
docker compose -f deploy/docker-compose.yml up --build
```

Services: Postgres 16, PgBouncer, `agent-todo` HTTP server (MCP + REST board).

Point clients at `http://localhost:8080` (or your TLS front door).

## Initialise a remote project

```bash
export AGENT_TODO_BOOTSTRAP_SECRET=change-me-in-production
bun run cli -- init --remote http://localhost:8080 --project acme/web --yes
bun run cli -- push --remote http://localhost:8080
```

After `init`, local `serve --mcp` can proxy to cloud when `mode=remote` (token in OS keychain).

## Helm (Kubernetes)

Chart: `deploy/helm/agent-todo/`. See [deploy/helm/agent-todo/README.md](../deploy/helm/agent-todo/README.md) for values (`image`, `ingress`, secrets).

## Terraform

- AWS: `deploy/terraform/aws/`
- GCP: `deploy/terraform/gcp/`

Each README lists required variables and outputs.

## Fly.io

`deploy/fly.toml` — deploy with `fly deploy` from that directory after setting secrets.

## Container image

Release workflow publishes to **GitHub Container Registry**:

`ghcr.io/<owner>/agent-todo:<tag>`

Build locally:

```bash
docker build -f deploy/Dockerfile -t agent-todo:local .
```

## Environment reference

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection (server) |
| `AGENT_TODO_BOOTSTRAP_SECRET` | One-time org/project bootstrap |
| `AGENT_TODO_TOKEN` | Bearer token for HTTP MCP (clients) |
| `PORT` | HTTP listen port (default `8080`) |
| `AGENT_TODO_AGENT` | Agent name for local claims/audit |

See [deploy/README.md](../deploy/README.md) for observability, RLS, and quotas.

## MCP over HTTP

```json
{
  "mcpServers": {
    "agent-todo": {
      "type": "http",
      "url": "https://todo.example.com/mcp/acme/web",
      "headers": { "Authorization": "Bearer ${AGENT_TODO_TOKEN}" }
    }
  }
}
```

Full client setup notes: `project_doc.md` §10.2.

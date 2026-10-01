# Helm — agent-todo

```bash
helm upgrade --install agent-todo ./deploy/helm/agent-todo \
  --set ingress.host=todo.example.com \
  --set env.PUBLIC_URL=https://todo.example.com
```

Edit `templates/secret.yaml` or use `--set-file` / external secrets for `DATABASE_URL` and optional `DATABASE_REPLICA_URLS`.

Minimum **2 replicas** (no sticky sessions). Scrapes Prometheus from `/metrics` on each pod.

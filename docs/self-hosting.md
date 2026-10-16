# Self-hosting

agent-todo runs as an **open SQLite machine daemon** on each host. There is no separate cloud server or Postgres deployment in this product.

## On a machine

```bash
agent-todo install
agent-todo init
```

Use `agent-todo install --url https://your-host:port` when agents on this machine should talk to a daemon that already runs elsewhere. The install flow checks `/health` before writing config.

## Network install

`agent-todo install --local` listens on the LAN (`0.0.0.0`) while MCP clients on the same machine still use the loopback URL. Other machines on the network can open the board at the printed LAN URLs.

## Data

The machine database lives under `~/.agent-todo/` (override with `AGENT_TODO_DB`). `agent-todo export` and `agent-todo import` move project data through JSON or JSONL without a sync service.

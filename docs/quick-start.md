# Quick start

Get from zero to your first claimed task in a few minutes.

## Install

**From source (development):**

```bash
git clone https://github.com/saleeq/agent-todo.git
cd agent-todo
bun install
```

**Binary (release):** download `agent-todo-<os>-<arch>` from [GitHub Releases](https://github.com/saleeq/agent-todo/releases) and put it on your `PATH`, or use the install scripts under `scripts/install.sh` / `scripts/install.ps1`.

## Initialise a project

In your repo:

```bash
agent-todo init
# or from this monorepo:
bun run cli -- init
```

This creates `.agent-todo/`, migrates SQLite, imports a starter group, and wires MCP config for detected agents (`agent-todo install`).

Set who you are when claiming work:

```bash
export AGENT_TODO_AGENT=my-agent-name
```

## First task

1. Start the MCP server (stdio):

   ```bash
   agent-todo serve --mcp
   ```

2. In your agent client, call **`task_next`** with your group key (shown by `init`) and `claim: true`.

3. Work from the **bundle** (task, recent comments, matched context). Use **`task_status`** and **`comment_add`** to move the task toward `verifying`.

4. When blocked, add a **`blocker`** comment and release or hand off with **`comment_add`** kind `handoff` + **`task_release`**.

See [agent-conventions.md](./agent-conventions.md) and the `start_work` MCP prompt.

## Local vs cloud

| Mode | When |
| --- | --- |
| Local SQLite | Solo dev, offline, fastest iteration |
| Daemon + board | Many agents on one machine |
| Self-hosted cloud | Team, multi-machine — see [self-hosting.md](./self-hosting.md) |

## Next steps

- [Tool reference](./tool-reference.md) (generated from schemas)
- [Self-hosting](./self-hosting.md)
- Full design: [project_doc.md](../project_doc.md)

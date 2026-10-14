# Quick start

Get from zero to your first claimed task in a few minutes.

## Install

**From source (development):**

```bash
git clone https://github.com/DaltonVector-ai/agent-todo.git
cd agent-todo
bun install
```

**Binary (release):** download `agent-todo-<os>-<arch>` from [GitHub Releases](https://github.com/DaltonVector-ai/agent-todo/releases) and put it on your `PATH`, or use the install scripts under `scripts/install.sh` / `scripts/install.ps1`.

## Start the machine daemon

`install` starts one loopback machine daemon, wires detected agents, and registers login autostart. The daemon needs no token and stays up with no idle shutdown, including before any project is registered.

```bash
agent-todo install
# or from this monorepo:
bun run cli -- install
```

## Register a repository

In the repository agents should work on:

```bash
agent-todo init
```

`init` registers that directory on the machine daemon and writes the project code and the default group id into `AGENTS.md`. Use the project code to list or create groups, the group id to list or create what is inside a group, and the task id alone to read or update one task.

Set who you are when claiming work:

```bash
export AGENT_TODO_AGENT=my-agent-name
```

A test can point at its own SQLite file with `AGENT_TODO_DB=/path/to/todo.db`.

## First task

1. Forward stdio to the machine daemon:

   ```bash
   agent-todo serve --mcp
   ```

2. In your agent client, call **`task_next`** with your group id (written by `init`) and `claim: true`.

3. Work from the **bundle** (task, recent comments, matched context). Use **`task_status`** and **`comment_add`** to move the task toward `verifying`.

4. When blocked, add a **`blocker`** comment and release or hand off with **`comment_add`** kind `handoff` + **`task_release`**.

See [agent-conventions.md](./agent-conventions.md) and the `start_work` MCP prompt.

## Local vs cloud

| Mode | When |
| --- | --- |
| Machine daemon | Every local project on this machine |
| Self-hosted cloud | Team, multi-machine — see [self-hosting.md](./self-hosting.md) |

## Next steps

- [Tool reference](./tool-reference.md) (generated from schemas)
- [Agent conventions](./agent-conventions.md)
- [Self-hosting](./self-hosting.md)

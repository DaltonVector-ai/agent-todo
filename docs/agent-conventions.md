# Agent conventions

Shipped in the `start_work` MCP prompt and stub `CLAUDE.md` / `AGENTS.md` from `context_export flavor=stub`. Source: `project_doc.md` §10.2.

1. Start with **`task_next group=KEY`**; work only from the bundle; fetch more context sections only if the TOC shows you need them.
2. Post a **`decision`** comment for any non-obvious choice; a **`blocker`** comment before stopping on a problem.
3. Before ending a session with the task unfinished, post a **`handoff`** comment and **`task_release`**.
4. Move to **`verifying`** with a comment listing what to check; reviewers move to **`verified`** or **`reopen`** with a **`verification`** comment.
5. When **`needs_compaction`** appears, run the **`compact`** prompt before continuing.

## MCP config (local)

`agent-todo install` writes:

```json
{ "mcpServers": { "agent-todo": { "command": "agent-todo", "args": ["serve", "--mcp"] } } }
```

## Status model reminders

- There is **no `blocked` status** — use comment kind `blocker` with status `todo` or `reopen`.
- Group **`terminal_status`**: `verified` | `deployed` (default `deployed`). Moving `verified → deploying` when terminal is `verified` requires `force: true` and `reason`.

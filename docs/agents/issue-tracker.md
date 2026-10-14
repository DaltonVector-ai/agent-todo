# Issue tracker: agent-todo

Specs and tickets for this repo live in agent-todo, accessed through the agent-todo MCP (Cursor namespace `user-agent-todo`). Do not use GitHub Issues or `.scratch/` markdown for specs or tickets.

The project code and default group are in the `<!-- agent-todo:start -->` block in `AGENTS.md`. Use the project code to list or create groups. Use the group id to list or create what is inside a group. Use the task id alone to read or update one task.

## Conventions

- A feature is a **group**. Create it with `group_create`. Find existing groups with `group_list` and `group_get`.
- The **spec** is that group's context section with slug `spec`. Write it with `context_update` op `upsert` (`slug: "spec"`, `title: "Spec"`, `body` set to the spec markdown). Read it with `context_get`.
- **Tickets** are tasks in that group, created with `task_create`. Each task description contains:
  - What to build
  - Acceptance criteria
  - Blocked by
- Blocking edges are native `depends_on` task ids. Create blockers first so later tasks can reference real ids.
- New tickets stay status `todo`. Comments go through `comment_add`.
- Fetch a ticket with `task_get`, including comments and deps. List tickets with `task_list` scoped to the group.

## When a skill says "publish to the issue tracker"

Create the group if it does not exist. For a spec, upsert the `spec` context section. For tickets, call `task_create` once per ticket, in dependency order, with `depends_on` set to the blocking task ids. Do not close or modify a parent task unless the skill says to.

## When a skill says "fetch the relevant ticket"

Call `task_get` with the task id, including comments and deps. For a spec, call `context_get` for the group's `spec` section.

## Wayfinding operations

Used by `/wayfinder`.

- **Map**: a parent task tagged `wayfinder:map`. Its description holds Destination, Notes, Decisions so far, Not yet specified, and Out of scope.
- **Child ticket**: a task with `parent` set to the map task id. The description is the question. Tag `wayfinder:research`, `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- **Blocking**: native `depends_on`. A ticket is unblocked when every task it depends on is `verified`.
- **Frontier**: open children of the map whose dependencies are all `verified` and that have no active claim. First in map order wins.
- **Claim**: `task_claim` before any work.
- **Resolve**: `comment_add` with the answer, then `task_status` to `verified`. Append a one-line gist and the task id to the map description's Decisions so far. Do not restate the full answer on the map.

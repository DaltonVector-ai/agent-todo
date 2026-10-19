/** Fixed usage guide returned by the `docs` MCP tool (not project context). */
export const AGENT_USAGE_GUIDE = `agent-todo is the shared context layer for every agent on a project.

The first group (project code plus -1) holds decisions, planning, architecture, and each module's behavior as logic only: no code and no pseudocode. The commands section may hold the exact build and test commands. Read that logic with context_get on the first group id; record decisions with context_update on the first group id.

Later groups are specs; their tasks are the work. Do not put feature specs in the first group.

Call rules:
- task_next with the project code claims the next ready task across the project; pass group only to stay inside one feature.
- group_list and group_create require the project code (machine daemon).
- task_list and task_create require a group id.
- context_get and context_update use a group id (the first group for project logic, a feature group for spec context).
`;

export const DOCS_TOOL_DESCRIPTION = "Return the fixed agent-todo usage guide.";

export const TASK_NEXT_DESCRIPTION =
	"Claim next ready task: pass project for project-wide or group to stay in one feature.";

export const START_WITH_TASK_NEXT_SENTENCE =
	"Call task_next with the project code (claim=true) to claim the next ready task; pass group only to stay inside one feature.";

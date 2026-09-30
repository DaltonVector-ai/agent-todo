import { allAllowedTransitions } from "@agent-todo/core";
import type { ServiceError, ServiceErrorCode } from "@agent-todo/core";
import type { TaskStatus } from "@agent-todo/core";

export function formatServiceError(err: ServiceError, context?: { taskId?: string }): string {
	const hint = hintFor(err, context);
	return `${err.code}: ${err.message} · hint: ${hint}`;
}

function hintFor(err: ServiceError, context?: { taskId?: string }): string {
	const id = context?.taskId ?? (typeof err.details?.id === "string" ? err.details.id : undefined);
	switch (err.code) {
		case "NOT_FOUND":
			return id ? `task_list group filter or task_get ${id}` : "task_list to find valid ids";
		case "VALIDATION":
			return "fix inputs and retry";
		case "VERSION_CONFLICT":
			return id ? `task_get ${id} fields=[v]` : "task_get fields=[v]";
		case "INVALID_TRANSITION": {
			const from = err.details?.from as TaskStatus | undefined;
			const allowed = from
				? (allAllowedTransitions()
						.filter((p) => p.from === from)
						.map((p) => p.to) as string[])
				: [];
			const targets = allowed.length ? allowed.join(",") : "see status machine";
			return id ? `task_status ${id} to one of: ${targets}` : `allowed: ${targets}`;
		}
		case "CLAIMED":
			return id ? `task_claim ${id} or task_release after expiry` : "task_claim or wait for lease expiry";
		case "DEPS_UNMET": {
			const deps = err.details?.blockingDeps as string[] | undefined;
			return deps?.length ? `complete deps: ${deps.join(",")}` : "task_get include deps";
		}
		case "BUDGET":
			return (err.details?.hint as string) ?? "use view=brief, fields, or lower max_tokens";
		default:
			return "retry or task_get for details";
	}
}

export function isServiceError(err: unknown): err is ServiceError {
	return (
		typeof err === "object" &&
		err !== null &&
		"name" in err &&
		(err as ServiceError).name === "ServiceError" &&
		"code" in err
	);
}

export function mcpErrorLine(code: ServiceErrorCode, message: string, hint: string): string {
	return `${code}: ${message} · hint: ${hint}`;
}

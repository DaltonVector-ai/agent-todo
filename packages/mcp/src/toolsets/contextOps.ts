import type { ContextOp } from "@agent-todo/core";

export function parseContextOps(raw: Array<Record<string, unknown>>): ContextOp[] {
	return raw.map((op) => op as ContextOp);
}

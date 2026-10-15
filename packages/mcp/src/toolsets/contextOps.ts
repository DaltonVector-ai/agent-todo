import type { ContextOp } from "@agent-todo/core";

function stringList(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const tags = value.filter((item): item is string => typeof item === "string");
	return tags.length === value.length ? tags : undefined;
}

/** Map snake_case wire fields onto the service's camelCase context ops. */
export function parseContextOps(raw: Array<Record<string, unknown>>): ContextOp[] {
	return raw.map((op) => {
		if (op.op !== "upsert") return op as ContextOp;
		const mapped: Extract<ContextOp, { op: "upsert" }> = {
			op: "upsert",
			slug: String(op.slug ?? ""),
			title: String(op.title ?? ""),
		};
		if (typeof op.body === "string") mapped.body = op.body;
		if (typeof op.always_include === "boolean") mapped.alwaysInclude = op.always_include;
		const appliesTo = stringList(op.applies_to);
		if (appliesTo) mapped.appliesTo = appliesTo;
		return mapped;
	});
}

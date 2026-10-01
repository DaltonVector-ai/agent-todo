import type { PushPayload } from "./payload.js";

export type { PushPayload } from "./payload.js";
export { buildPushPayload } from "./payload.js";

export async function exportProjectJsonl(payload: PushPayload): Promise<string> {
	const lines: string[] = [];
	for (const g of payload.groups) lines.push(JSON.stringify({ type: "group", data: g }));
	for (const t of payload.tasks) lines.push(JSON.stringify({ type: "task", data: t }));
	for (const c of payload.comments) lines.push(JSON.stringify({ type: "comment", data: c }));
	for (const s of payload.sections) lines.push(JSON.stringify({ type: "section", data: s }));
	for (const e of payload.events) lines.push(JSON.stringify({ type: "event", data: e }));
	for (const d of payload.taskDeps) lines.push(JSON.stringify({ type: "task_dep", data: d }));
	return `${lines.join("\n")}\n`;
}

export async function parseJsonlExport(text: string): Promise<PushPayload> {
	const payload: PushPayload = {
		groups: [],
		tasks: [],
		comments: [],
		sections: [],
		events: [],
		taskDeps: [],
	};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		const row = JSON.parse(trimmed) as { type: string; data: unknown };
		switch (row.type) {
			case "group":
				payload.groups.push(row.data as PushPayload["groups"][0]);
				break;
			case "task":
				payload.tasks.push(row.data as PushPayload["tasks"][0]);
				break;
			case "comment":
				payload.comments.push(row.data as PushPayload["comments"][0]);
				break;
			case "section":
				payload.sections.push(row.data as PushPayload["sections"][0]);
				break;
			case "event":
				payload.events.push(row.data as PushPayload["events"][0]);
				break;
			case "task_dep":
				payload.taskDeps.push(row.data as PushPayload["taskDeps"][0]);
				break;
			default:
				break;
		}
	}
	return payload;
}

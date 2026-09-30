import { deriveKeyFromName, isGroupKey } from "../domain/ids.js";
import type { TerminalStatus } from "../domain/status.js";
import type { Store } from "../store/Store.js";
import type { GroupRow } from "../store/types.js";
import { DEFAULT_GROUP_SECTIONS } from "./defaultSections.js";
import { notFound, ServiceError, validation } from "./errors.js";
import { appendEvent, fieldDiff } from "./eventLog.js";

export type GroupSummary = GroupRow & {
	openTasks: number;
	totalTasks: number;
};

export type GroupCreateParams = {
	key?: string;
	name: string;
	summary?: string;
	defaultModel?: string | null;
	defaultSkills?: string[];
	defaultMcps?: string[];
	terminalStatus?: TerminalStatus;
	actor?: string;
};

export type GroupUpdateParams = {
	v: number;
	name?: string;
	summary?: string;
	defaultModel?: string | null;
	defaultSkills?: string[];
	defaultMcps?: string[];
	terminalStatus?: TerminalStatus;
	actor?: string;
};

export class GroupService {
	constructor(private readonly store: Store) {}

	async create(input: GroupCreateParams): Promise<GroupRow> {
		const actor = input.actor ?? "anonymous";
		const key = input.key ?? deriveKeyFromName(input.name);
		if (!isGroupKey(key)) {
			throw validation("Invalid group key", { key });
		}
		if (input.summary && input.summary.length > 280) {
			throw validation("Group summary must be ≤ 280 characters");
		}

		return await this.store.tx(async (s) => {
			const group = await s.groups.create({
				key,
				name: input.name,
				summary: input.summary ?? "",
				defaultModel: input.defaultModel ?? null,
				defaultSkills: input.defaultSkills ?? [],
				defaultMcps: input.defaultMcps ?? [],
				terminalStatus: input.terminalStatus,
			});

			for (const [i, spec] of DEFAULT_GROUP_SECTIONS.entries()) {
				await s.sections.create({
					groupKey: key,
					slug: spec.slug,
					title: spec.title,
					position: i,
					alwaysInclude: spec.alwaysInclude,
					appliesTo: spec.appliesTo,
				});
			}

			await appendEvent(s, {
				entity: "group",
				entityId: key,
				groupKey: key,
				action: "create",
				actor,
				diff: { name: [null, group.name] },
			});

			return group;
		});
	}

	async update(key: string, input: GroupUpdateParams): Promise<GroupRow> {
		const actor = input.actor ?? "anonymous";
		const existing = await this.store.groups.getByKey(key);
		if (!existing) throw notFound("group", key);
		if (existing.version !== input.v) {
			throw new ServiceError("VERSION_CONFLICT", "Group version mismatch", {
				currentV: existing.version,
				changedFields: ["version"],
			});
		}
		if (input.summary && input.summary.length > 280) {
			throw validation("Group summary must be ≤ 280 characters");
		}

		return await this.store.tx(async (s) => {
			const before = { ...existing };
			const updated = await s.groups.update(key, {
				name: input.name,
				summary: input.summary,
				defaultModel: input.defaultModel,
				defaultSkills: input.defaultSkills,
				defaultMcps: input.defaultMcps,
				terminalStatus: input.terminalStatus,
				version: input.v,
			});
			const diff = fieldDiff(before, updated, [
				"name",
				"summary",
				"defaultModel",
				"defaultSkills",
				"defaultMcps",
				"terminalStatus",
			]);
			if (Object.keys(diff).length > 0) {
				await appendEvent(s, {
					entity: "group",
					entityId: key,
					groupKey: key,
					action: "update",
					actor,
					diff,
				});
			}
			return updated;
		});
	}

	async get(key: string): Promise<GroupSummary> {
		const group = await this.store.groups.getByKey(key);
		if (!group) throw notFound("group", key);
		const tasks = await this.store.tasks.listByGroup(key);
		const openTasks = tasks.filter((t) => t.status === "open" || t.status === "reopen").length;
		return { ...group, openTasks, totalTasks: tasks.length };
	}

	async list(opts?: { includeArchived?: boolean }): Promise<GroupRow[]> {
		return await this.store.groups.list(opts);
	}

	async archive(key: string, actor = "anonymous"): Promise<GroupRow> {
		const existing = await this.store.groups.getByKey(key);
		if (!existing) throw notFound("group", key);

		return await this.store.tx(async (s) => {
			const updated = await s.groups.update(key, {
				archived: true,
				version: existing.version,
			});
			await appendEvent(s, {
				entity: "group",
				entityId: key,
				groupKey: key,
				action: "archive",
				actor,
				diff: { archived: [false, true] },
			});
			return updated;
		});
	}
}

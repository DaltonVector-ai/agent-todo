import type {
	AppendEventInput,
	ClaimFilter,
	CreateCommentInput,
	CreateGroupInput,
	CreateSectionInput,
	CreateTaskInput,
	ListEventsOpts,
	SearchQuery,
	UpdateCommentInput,
	UpdateGroupInput,
	UpdateSectionInput,
	UpdateTaskInput,
} from "@agent-todo/core";
import {
	allocateTaskId,
	estimate,
	formatCommentId,
	formatSectionId,
	type Store,
} from "@agent-todo/core";
import { basename } from "node:path";
import { type Kysely, sql } from "kysely";
import { ulid } from "ulid";
import { openSqliteClient, type SqliteClient } from "./client.js";
import type { SqliteDatabase, TasksTable } from "./db-types.js";
import { parseJsonArray, stringifyAcceptance, stringifyJsonArray } from "./json.js";
import { mapComment, mapEvent, mapGroup, mapSection, mapTask } from "./mappers.js";
import { migrate } from "./migrate.js";
import { allocateProjectCode } from "./projectCode.js";

function unregisteredProject(projectCode: string): Error {
	return new Error(
		`project not found: ${projectCode}. Run agent-todo init to register this directory.`,
	);
}

function must<T>(value: T | null | undefined, message: string): T {
	if (value === null || value === undefined) {
		throw new Error(message);
	}
	return value;
}

export type OpenStoreOptions = {
	path: string;
	migrationsDir?: string;
};

export async function openStore(options: OpenStoreOptions): Promise<SqliteStore> {
	const client = openSqliteClient(options.path);
	await migrate(client.db, (stmt) => client.sqlite.exec(stmt), options.migrationsDir);
	return new SqliteStore(client);
}

export class SqliteStore implements Store {
	private client: SqliteClient;
	private txDepth = 0;

	constructor(client: SqliteClient) {
		this.client = client;
	}

	get groups() {
		return {
			create: (input: CreateGroupInput) => this.createGroup(input),
			getByKey: (key: string) => this.getGroupByKey(key),
			getByPk: (pk: string) => this.getGroupByPk(pk),
			update: (key: string, input: UpdateGroupInput) => this.updateGroup(key, input),
			list: (opts?: { includeArchived?: boolean }) => this.listGroups(opts),
		};
	}

	get tasks() {
		return {
			create: (input: CreateTaskInput) => this.createTask(input),
			getById: (id: string) => this.getTaskById(id),
			getByPk: (pk: string) => this.getTaskByPk(pk),
			update: (id: string, input: UpdateTaskInput) => this.updateTask(id, input),
			listByGroup: (groupKey: string, opts?: { includeArchived?: boolean }) =>
				this.listTasksByGroup(groupKey, opts),
			setDependencies: (taskPk: string, dependsOnPks: string[]) =>
				this.setDependencies(taskPk, dependsOnPks),
			listDependsOn: (taskId: string) => this.listDependsOn(taskId),
			moveToGroup: (taskId: string, groupKey: string) => this.moveTaskToGroup(taskId, groupKey),
		};
	}

	get comments() {
		return {
			create: (input: CreateCommentInput) => this.createComment(input),
			getById: (id: string) => this.getCommentById(id),
			listByTask: (taskId: string) => this.listCommentsByTask(taskId),
			update: (id: string, input: UpdateCommentInput) => this.updateComment(id, input),
		};
	}

	get sections() {
		return {
			create: (input: CreateSectionInput) => this.createSection(input),
			getById: (sectionId: string) => this.getSectionById(sectionId),
			update: (sectionId: string, input: UpdateSectionInput) =>
				this.updateSection(sectionId, input),
			listByGroup: (groupKey: string) => this.listSectionsByGroup(groupKey),
		};
	}

	get events() {
		return {
			append: (input: AppendEventInput) => this.appendEvent(input),
			listSince: (groupKey: string, sinceRev: number, limit?: number) =>
				this.listEventsSince(groupKey, sinceRev, limit),
			latestRev: () => this.latestEventRev(),
			listSinceRev: (sinceRev: number, opts?: ListEventsOpts) =>
				this.listEventsSinceRev(sinceRev, opts),
		};
	}

	async tx<T>(fn: (s: Store) => Promise<T> | T): Promise<T> {
		if (this.txDepth > 0) {
			return await fn(this);
		}
		this.client.sqlite.exec("BEGIN IMMEDIATE");
		this.txDepth += 1;
		try {
			const result = await fn(this);
			this.client.sqlite.exec("COMMIT");
			return result;
		} catch (err) {
			this.client.sqlite.exec("ROLLBACK");
			throw err;
		} finally {
			this.txDepth -= 1;
		}
	}

	async registerProject(input: { path?: string; name?: string; code?: string }): Promise<{
		code: string;
		name: string;
		path: string;
		groupId: string;
		created: boolean;
	}> {
		return await this.tx(async () => {
			const requestedCode = input.code?.trim();
			if (requestedCode) {
				const existing = this.client.sqlite
					.query("SELECT code, name, path FROM projects WHERE code = ?")
					.get(requestedCode) as { code: string; name: string; path: string } | null;
				if (!existing) throw unregisteredProject(requestedCode);
				const groupId = `${existing.code}-1`;
				const group = await this.getGroupByKey(groupId);
				if (!group) throw new Error(`project ${existing.code} is missing its first group`);
				return {
					code: existing.code,
					name: existing.name,
					path: existing.path,
					groupId,
					created: false,
				};
			}

			if (!input.path) throw new Error("path is required");
			const projectName = input.name?.trim() || basename(input.path) || "project";
			const existing = this.client.sqlite
				.query("SELECT code, name, path FROM projects WHERE path = ?")
				.get(input.path) as { code: string; name: string; path: string } | null;
			if (existing) {
				const groupId = `${existing.code}-1`;
				const group = await this.getGroupByKey(groupId);
				if (!group) throw new Error(`project ${existing.code} is missing its first group`);
				return {
					code: existing.code,
					name: existing.name,
					path: existing.path,
					groupId,
					created: false,
				};
			}

			const rows = this.client.sqlite.query("SELECT code FROM projects").all() as {
				code: string;
			}[];
			const code = allocateProjectCode(new Set(rows.map((row) => row.code)));
			const now = new Date().toISOString();
			const groupId = `${code}-1`;
			this.client.sqlite
				.query(
					"INSERT INTO projects (code, name, path, group_seq, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)",
				)
				.run(code, projectName, input.path, now, now);
			await this.createGroup({
				key: groupId,
				name: projectName,
				summary: "",
			});
			this.client.sqlite
				.query("UPDATE groups SET project_code = ? WHERE key = ?")
				.run(code, groupId);
			return {
				code,
				name: projectName,
				path: input.path,
				groupId,
				created: true,
			};
		});
	}

	async listProjects(): Promise<Array<{ code: string; name: string; path: string }>> {
		return this.client.sqlite
			.query("SELECT code, name, path FROM projects ORDER BY rowid ASC")
			.all() as Array<{ code: string; name: string; path: string }>;
	}

	async listProjectGroups(projectCode: string): Promise<Array<{ id: string; name: string }>> {
		const project = this.client.sqlite
			.query("SELECT code FROM projects WHERE code = ?")
			.get(projectCode) as { code: string } | null;
		if (!project) throw unregisteredProject(projectCode);
		return this.client.sqlite
			.query(
				"SELECT key AS id, name FROM groups WHERE project_code = ? AND archived = 0 ORDER BY rowid ASC",
			)
			.all(projectCode) as Array<{ id: string; name: string }>;
	}

	/**
	 * Assign `{code}-{n}` from the project's group sequence.
	 * `n` only moves forward, including after the group row is removed.
	 */
	async createProjectGroup(input: {
		projectCode: string;
		name: string;
	}): Promise<{ id: string; name: string }> {
		const name = input.name.trim();
		if (!name) throw new Error("name is required");
		return await this.tx(async () => {
			const now = new Date().toISOString();
			const updated = this.client.sqlite
				.query("UPDATE projects SET group_seq = group_seq + 1, updated_at = ? WHERE code = ?")
				.run(now, input.projectCode);
			if (updated.changes !== 1) throw unregisteredProject(input.projectCode);
			const row = this.client.sqlite
				.query("SELECT group_seq FROM projects WHERE code = ?")
				.get(input.projectCode) as { group_seq: number };
			const id = `${input.projectCode}-${row.group_seq}`;
			await this.createGroup({ key: id, name, summary: "" });
			this.client.sqlite
				.query("UPDATE groups SET project_code = ? WHERE key = ?")
				.run(input.projectCode, id);
			return { id, name };
		});
	}

	async incrementTaskSeq(groupPk: string): Promise<{ key: string; seq: number }> {
		const now = new Date().toISOString();
		const row = await this.db()
			.updateTable("groups")
			.set((eb) => ({
				task_seq: eb("task_seq", "+", 1),
				updated_at: now,
			}))
			.where("pk", "=", groupPk)
			.returning(["key", "task_seq"])
			.executeTakeFirstOrThrow();
		return { key: row.key, seq: row.task_seq };
	}

	async peekNextOpen(filter: ClaimFilter): Promise<import("@agent-todo/core").TaskRow | null> {
		return await this.findNextClaimCandidate(filter, async (row) => mapTask(row, row.group_key));
	}

	async claimNext(filter: ClaimFilter): Promise<import("@agent-todo/core").TaskRow | null> {
		return await this.tx(async () => {
			const leaseSeconds = filter.leaseSeconds ?? 3600;
			const expires = new Date(Date.now() + leaseSeconds * 1000).toISOString();
			const now = new Date().toISOString();

			return await this.findNextClaimCandidate(filter, async (row) => {
				await this.db()
					.updateTable("tasks")
					.set({
						status: "inprogress",
						claim_owner: filter.owner,
						claim_expires: expires,
						updated_at: now,
						version: row.version + 1,
					})
					.where("pk", "=", row.pk)
					.where("status", "in", ["open", "reopen"])
					.execute();

				const updated = await this.db()
					.selectFrom("tasks")
					.selectAll()
					.where("pk", "=", row.pk)
					.executeTakeFirst();
				if (updated?.status === "inprogress" && updated.claim_owner === filter.owner) {
					return mapTask(updated, row.group_key);
				}
				return null;
			});
		});
	}

	private claimCandidateQuery(filter: ClaimFilter) {
		let query = this.db()
			.selectFrom("tasks as t")
			.innerJoin("groups as g", "g.pk", "t.group_pk")
			.selectAll("t")
			.select("g.key as group_key")
			.where("t.archived", "=", 0)
			.where("t.status", "in", ["open", "reopen"])
			.orderBy("t.priority", "asc")
			.orderBy("t.created_at", "asc");

		if (filter.groupKey) {
			query = query.where("g.key", "=", filter.groupKey);
		}
		return query;
	}

	private async findNextClaimCandidate(
		filter: ClaimFilter,
		tryClaim: (
			row: TasksTable & { group_key: string },
		) => Promise<import("@agent-todo/core").TaskRow | null>,
	): Promise<import("@agent-todo/core").TaskRow | null> {
		const batchSize = 64;
		let offset = 0;
		while (true) {
			const candidates = await this.claimCandidateQuery(filter)
				.limit(batchSize)
				.offset(offset)
				.execute();
			if (candidates.length === 0) return null;

			for (const row of candidates) {
				if (!(await this.dependenciesMet(row.pk))) continue;
				if (!this.taskMatchesClaimFilter(row, filter)) continue;
				const claimed = await tryClaim(row);
				if (claimed) return claimed;
			}

			offset += batchSize;
			if (candidates.length < batchSize) return null;
		}
	}

	async search(q: SearchQuery): Promise<import("@agent-todo/core").SearchHit[]> {
		const limit = q.limit ?? 20;
		const term = q.q.trim();
		if (!term) return [];

		const entity = q.entity ?? "task";
		if (entity === "comment") {
			const rows = await sql<{
				id: string;
				group_key: string;
				body: string;
			}>`
				SELECT c.id as id, g.key as group_key, c.body as body
				FROM comments_fts fts
				INNER JOIN comments c ON c.rowid = fts.rowid
				INNER JOIN tasks t ON t.pk = c.task_pk
				INNER JOIN groups g ON g.pk = t.group_pk
				WHERE comments_fts MATCH ${term}
				${q.groupKey ? sql`AND g.key = ${q.groupKey}` : sql``}
				LIMIT ${limit}
			`.execute(this.db());
			return rows.rows.map((r) => ({
				entity: "comment" as const,
				id: r.id,
				groupKey: r.group_key,
				snippet: r.body.slice(0, 200),
			}));
		}

		const rows = await sql<{
			id: string;
			group_key: string;
			title: string;
			description: string;
		}>`
			SELECT t.id as id, g.key as group_key, t.title as title, t.description as description
			FROM tasks_fts fts
			INNER JOIN tasks t ON t.rowid = fts.rowid
			INNER JOIN groups g ON g.pk = t.group_pk
			WHERE tasks_fts MATCH ${term}
			${q.groupKey ? sql`AND g.key = ${q.groupKey}` : sql``}
			LIMIT ${limit}
		`.execute(this.db());
		return rows.rows.map((r) => ({
			entity: "task" as const,
			id: r.id,
			groupKey: r.group_key,
			snippet: `${r.title} ${r.description}`.slice(0, 200),
		}));
	}

	async close(): Promise<void> {
		this.client.close();
	}

	private db(): Kysely<SqliteDatabase> {
		return this.client.db;
	}

	private async dependenciesMet(taskPk: string): Promise<boolean> {
		const deps = await this.db()
			.selectFrom("task_deps as d")
			.innerJoin("tasks as dep", "dep.pk", "d.depends_on_pk")
			.select(["dep.status"])
			.where("d.task_pk", "=", taskPk)
			.execute();
		return deps.every((d) => d.status === "verified" || d.status === "deployed");
	}

	private async createGroup(input: CreateGroupInput) {
		const now = new Date().toISOString();
		const pk = ulid();
		await this.db()
			.insertInto("groups")
			.values({
				pk,
				key: input.key,
				name: input.name,
				project_code: null,
				summary: input.summary ?? "",
				default_model: input.defaultModel ?? null,
				default_skills: stringifyJsonArray(input.defaultSkills ?? []),
				default_mcps: stringifyJsonArray(input.defaultMcps ?? []),
				task_seq: 0,
				terminal_status: input.terminalStatus ?? "deployed",
				archived: 0,
				version: 1,
				created_at: now,
				updated_at: now,
			})
			.execute();
		return must(await this.getGroupByPk(pk), `group missing after create: ${pk}`);
	}

	private async getGroupByKey(key: string) {
		const row = await this.db()
			.selectFrom("groups")
			.selectAll()
			.where("key", "=", key)
			.executeTakeFirst();
		return row ? mapGroup(row) : null;
	}

	private async getGroupByPk(pk: string) {
		const row = await this.db()
			.selectFrom("groups")
			.selectAll()
			.where("pk", "=", pk)
			.executeTakeFirst();
		return row ? mapGroup(row) : null;
	}

	private async updateGroup(key: string, input: UpdateGroupInput) {
		const existing = await this.getGroupByKey(key);
		if (!existing) throw new Error(`group not found: ${key}`);
		const now = new Date().toISOString();
		await this.db()
			.updateTable("groups")
			.set({
				name: input.name ?? existing.name,
				summary: input.summary ?? existing.summary,
				default_model:
					input.defaultModel !== undefined ? input.defaultModel : existing.defaultModel,
				default_skills: stringifyJsonArray(input.defaultSkills ?? existing.defaultSkills),
				default_mcps: stringifyJsonArray(input.defaultMcps ?? existing.defaultMcps),
				terminal_status: input.terminalStatus ?? existing.terminalStatus,
				archived:
					input.archived !== undefined ? (input.archived ? 1 : 0) : existing.archived ? 1 : 0,
				version: (input.version ?? existing.version) + 1,
				updated_at: now,
			})
			.where("key", "=", key)
			.execute();
		return must(await this.getGroupByKey(key), `group missing after update: ${key}`);
	}

	private async listGroups(opts?: { includeArchived?: boolean }) {
		let q = this.db().selectFrom("groups").selectAll().orderBy("key", "asc");
		if (!opts?.includeArchived) {
			q = q.where("archived", "=", 0);
		}
		const rows = await q.execute();
		return rows.map(mapGroup);
	}

	private async createTask(input: CreateTaskInput) {
		return await this.tx(async () => {
			const group = await this.getGroupByKey(input.groupKey);
			if (!group) throw new Error(`group not found: ${input.groupKey}`);
			const id = await allocateTaskId(this, group.pk);
			const now = new Date().toISOString();
			const pk = ulid();
			const description = input.description ?? "";
			await this.db()
				.insertInto("tasks")
				.values({
					pk,
					id,
					group_pk: group.pk,
					parent_pk: input.parentPk ?? null,
					title: input.title,
					description,
					status: input.status ?? "todo",
					priority: input.priority ?? 2,
					preferred_model: input.preferredModel ?? null,
					skills: stringifyJsonArray(input.skills ?? []),
					mcps: stringifyJsonArray(input.mcps ?? []),
					tags: stringifyJsonArray(input.tags ?? []),
					acceptance: stringifyAcceptance(input.acceptance ?? []),
					assignee: input.assignee ?? null,
					claim_owner: null,
					claim_expires: null,
					desc_tokens: estimate(description),
					comment_count: 0,
					archived: 0,
					version: 1,
					created_at: now,
					updated_at: now,
				})
				.execute();
			if (input.dependsOnPks?.length) {
				await this.setDependencies(pk, input.dependsOnPks);
			}
			return must(await this.getTaskByPk(pk), `task missing after create: ${pk}`);
		});
	}

	private async getTaskById(id: string) {
		const row = await this.db()
			.selectFrom("tasks as t")
			.innerJoin("groups as g", "g.pk", "t.group_pk")
			.selectAll("t")
			.select("g.key as group_key")
			.where("t.id", "=", id)
			.executeTakeFirst();
		return row ? mapTask(row, row.group_key) : null;
	}

	private async getTaskByPk(pk: string) {
		const row = await this.db()
			.selectFrom("tasks as t")
			.innerJoin("groups as g", "g.pk", "t.group_pk")
			.selectAll("t")
			.select("g.key as group_key")
			.where("t.pk", "=", pk)
			.executeTakeFirst();
		return row ? mapTask(row, row.group_key) : null;
	}

	private async updateTask(id: string, input: UpdateTaskInput) {
		const existing = await this.getTaskById(id);
		if (!existing) throw new Error(`task not found: ${id}`);
		const now = new Date().toISOString();
		const description = input.description ?? existing.description;
		await this.db()
			.updateTable("tasks")
			.set({
				title: input.title ?? existing.title,
				description,
				status: input.status ?? existing.status,
				priority: input.priority ?? existing.priority,
				preferred_model:
					input.preferredModel !== undefined ? input.preferredModel : existing.preferredModel,
				skills: stringifyJsonArray(input.skills ?? existing.skills),
				mcps: stringifyJsonArray(input.mcps ?? existing.mcps),
				tags: stringifyJsonArray(input.tags ?? existing.tags),
				acceptance: stringifyAcceptance(input.acceptance ?? existing.acceptance),
				assignee: input.assignee !== undefined ? input.assignee : existing.assignee,
				claim_owner: input.claimOwner !== undefined ? input.claimOwner : existing.claimOwner,
				claim_expires:
					input.claimExpires !== undefined ? input.claimExpires : existing.claimExpires,
				desc_tokens: estimate(description),
				archived:
					input.archived !== undefined ? (input.archived ? 1 : 0) : existing.archived ? 1 : 0,
				version: (input.version ?? existing.version) + 1,
				updated_at: now,
			})
			.where("id", "=", id)
			.execute();
		if (input.dependsOnPks) {
			await this.setDependencies(existing.pk, input.dependsOnPks);
		}
		return must(await this.getTaskById(id), `task missing after update: ${id}`);
	}

	private async listTasksByGroup(groupKey: string, opts?: { includeArchived?: boolean }) {
		const group = await this.getGroupByKey(groupKey);
		if (!group) return [];
		let q = this.db()
			.selectFrom("tasks")
			.selectAll()
			.where("group_pk", "=", group.pk)
			.orderBy("created_at", "asc");
		if (!opts?.includeArchived) {
			q = q.where("archived", "=", 0);
		}
		const rows = await q.execute();
		return rows.map((r) => mapTask(r, groupKey));
	}

	private async setDependencies(taskPk: string, dependsOnPks: string[]) {
		await this.db().deleteFrom("task_deps").where("task_pk", "=", taskPk).execute();
		if (dependsOnPks.length === 0) return;
		await this.db()
			.insertInto("task_deps")
			.values(dependsOnPks.map((depends_on_pk) => ({ task_pk: taskPk, depends_on_pk })))
			.execute();
	}

	private async createComment(input: CreateCommentInput) {
		return await this.tx(async () => {
			const task = await this.getTaskById(input.taskId);
			if (!task) throw new Error(`task not found: ${input.taskId}`);
			const maxSeq = await this.db()
				.selectFrom("comments")
				.select((eb) => eb.fn.max("seq").as("max_seq"))
				.where("task_pk", "=", task.pk)
				.executeTakeFirst();
			const seq = (maxSeq?.max_seq ?? 0) + 1;
			const id = formatCommentId(task.id, seq);
			const pk = ulid();
			const now = new Date().toISOString();
			const body = input.body;
			const summary = input.summary ?? body.split("\n")[0]?.slice(0, 160) ?? body.slice(0, 160);
			await this.db()
				.insertInto("comments")
				.values({
					pk,
					id,
					task_pk: task.pk,
					seq,
					author: input.author,
					kind: input.kind,
					body,
					summary,
					tokens: estimate(body),
					pinned: input.pinned ? 1 : 0,
					reply_to_pk: input.replyToPk ?? null,
					compacted_into: null,
					created_at: now,
				})
				.execute();
			await this.db()
				.updateTable("tasks")
				.set({
					comment_count: task.commentCount + 1,
					updated_at: now,
				})
				.where("pk", "=", task.pk)
				.execute();
			return must(await this.getCommentById(id), `comment missing after create: ${id}`);
		});
	}

	private async getCommentById(id: string) {
		const row = await this.db()
			.selectFrom("comments as c")
			.innerJoin("tasks as t", "t.pk", "c.task_pk")
			.selectAll("c")
			.select("t.id as task_id")
			.where("c.id", "=", id)
			.executeTakeFirst();
		return row ? mapComment(row, row.task_id) : null;
	}

	private async listCommentsByTask(taskId: string) {
		const task = await this.getTaskById(taskId);
		if (!task) return [];
		const rows = await this.db()
			.selectFrom("comments")
			.selectAll()
			.where("task_pk", "=", task.pk)
			.orderBy("seq", "asc")
			.execute();
		return rows.map((r) => mapComment(r, taskId));
	}

	private async createSection(input: CreateSectionInput) {
		const group = await this.getGroupByKey(input.groupKey);
		if (!group) throw new Error(`group not found: ${input.groupKey}`);
		const now = new Date().toISOString();
		const pk = ulid();
		const body = input.body ?? "";
		await this.db()
			.insertInto("context_sections")
			.values({
				pk,
				group_pk: group.pk,
				slug: input.slug,
				title: input.title,
				body,
				position: input.position,
				tokens: estimate(body),
				always_include: input.alwaysInclude ? 1 : 0,
				applies_to: stringifyJsonArray(input.appliesTo ?? []),
				version: 1,
				updated_at: now,
			})
			.execute();
		return must(
			await this.getSectionById(formatSectionId(group.key, input.slug)),
			`section missing after create: ${input.slug}`,
		);
	}

	private async getSectionById(sectionId: string) {
		const slash = sectionId.indexOf("/");
		if (slash < 0) return null;
		const groupKey = sectionId.slice(0, slash);
		const slug = sectionId.slice(slash + 1);
		const group = await this.getGroupByKey(groupKey);
		if (!group) return null;
		const row = await this.db()
			.selectFrom("context_sections")
			.selectAll()
			.where("group_pk", "=", group.pk)
			.where("slug", "=", slug)
			.executeTakeFirst();
		return row ? mapSection(row, groupKey) : null;
	}

	private async updateSection(sectionId: string, input: UpdateSectionInput) {
		const existing = await this.getSectionById(sectionId);
		if (!existing) throw new Error(`section not found: ${sectionId}`);
		const now = new Date().toISOString();
		const body = input.body ?? existing.body;
		await this.db()
			.updateTable("context_sections")
			.set({
				title: input.title ?? existing.title,
				body,
				position: input.position ?? existing.position,
				tokens: estimate(body),
				always_include:
					input.alwaysInclude !== undefined
						? input.alwaysInclude
							? 1
							: 0
						: existing.alwaysInclude
							? 1
							: 0,
				applies_to: stringifyJsonArray(input.appliesTo ?? existing.appliesTo),
				version: (input.version ?? existing.version) + 1,
				updated_at: now,
			})
			.where("pk", "=", existing.pk)
			.execute();
		return must(await this.getSectionById(sectionId), `section missing after update: ${sectionId}`);
	}

	private async listSectionsByGroup(groupKey: string) {
		const group = await this.getGroupByKey(groupKey);
		if (!group) return [];
		const rows = await this.db()
			.selectFrom("context_sections")
			.selectAll()
			.where("group_pk", "=", group.pk)
			.orderBy("position", "asc")
			.execute();
		return rows.map((r) => mapSection(r, groupKey));
	}

	private async appendEvent(input: AppendEventInput) {
		const at = new Date().toISOString();
		const inserted = await this.db()
			.insertInto("events")
			.values({
				entity: input.entity,
				entity_id: input.entityId,
				group_key: input.groupKey,
				action: input.action,
				actor: input.actor,
				diff: JSON.stringify(input.diff),
				at,
			})
			.returningAll()
			.executeTakeFirstOrThrow();
		return mapEvent(inserted);
	}

	private async listEventsSince(groupKey: string, sinceRev: number, limit = 100) {
		const rows = await this.db()
			.selectFrom("events")
			.selectAll()
			.where("group_key", "=", groupKey)
			.where("rev", ">", sinceRev)
			.orderBy("rev", "asc")
			.limit(limit)
			.execute();
		return rows.map(mapEvent);
	}

	private async latestEventRev() {
		const row = await this.db()
			.selectFrom("events")
			.select((eb) => eb.fn.max("rev").as("max_rev"))
			.executeTakeFirst();
		return row?.max_rev ?? 0;
	}

	private async listEventsSinceRev(sinceRev: number, opts?: ListEventsOpts) {
		const limit = opts?.limit ?? 500;
		let q = this.db()
			.selectFrom("events")
			.selectAll()
			.where("rev", ">", sinceRev)
			.orderBy("rev", "asc")
			.limit(limit);
		if (opts?.groupKey) {
			q = q.where("group_key", "=", opts.groupKey);
		}
		const rows = await q.execute();
		return rows.map(mapEvent);
	}

	private taskMatchesClaimFilter(
		row: {
			preferred_model: string | null;
			skills: string;
			tags: string;
		},
		filter: ClaimFilter,
	): boolean {
		if (filter.preferredModel && row.preferred_model !== filter.preferredModel) {
			return false;
		}
		if (filter.skills?.length) {
			const taskSkills = new Set(parseJsonArray(row.skills));
			if (!filter.skills.every((s) => taskSkills.has(s))) return false;
		}
		if (filter.tags?.length) {
			const taskTags = new Set(parseJsonArray(row.tags));
			if (!filter.tags.every((t) => taskTags.has(t))) return false;
		}
		return true;
	}

	private async listDependsOn(taskId: string): Promise<string[]> {
		const task = await this.getTaskById(taskId);
		if (!task) return [];
		const rows = await this.db()
			.selectFrom("task_deps as d")
			.innerJoin("tasks as dep", "dep.pk", "d.depends_on_pk")
			.select("dep.id as id")
			.where("d.task_pk", "=", task.pk)
			.execute();
		return rows.map((r) => r.id);
	}

	private async moveTaskToGroup(taskId: string, groupKey: string) {
		const task = await this.getTaskById(taskId);
		if (!task) throw new Error(`task not found: ${taskId}`);
		const group = await this.getGroupByKey(groupKey);
		if (!group) throw new Error(`group not found: ${groupKey}`);
		const now = new Date().toISOString();
		await this.db()
			.updateTable("tasks")
			.set({
				group_pk: group.pk,
				updated_at: now,
				version: task.version + 1,
			})
			.where("id", "=", taskId)
			.execute();
		return must(await this.getTaskById(taskId), `task missing after move: ${taskId}`);
	}

	private async updateComment(id: string, input: UpdateCommentInput) {
		const existing = await this.getCommentById(id);
		if (!existing) throw new Error(`comment not found: ${id}`);
		const updates: Record<string, unknown> = {};
		if (input.compactedInto !== undefined) {
			let compactedPk: string | null = null;
			if (input.compactedInto) {
				const target = await this.getCommentById(input.compactedInto);
				if (!target) throw new Error(`compaction target not found: ${input.compactedInto}`);
				compactedPk = target.pk;
			}
			updates.compacted_into = compactedPk;
		}
		if (input.pinned !== undefined) {
			updates.pinned = input.pinned ? 1 : 0;
		}
		if (Object.keys(updates).length > 0) {
			await this.db().updateTable("comments").set(updates).where("pk", "=", existing.pk).execute();
		}
		return must(await this.getCommentById(id), `comment missing after update: ${id}`);
	}
}

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	CommentService,
	changesSince,
	GroupService,
	ServiceError,
	TaskService,
	WorkService,
} from "../../packages/core/src/index.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

async function tempServices() {
	const dir = mkdtempSync(join(tmpdir(), "agent-todo-services-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	return {
		store,
		groups: new GroupService(store),
		tasks: new TaskService(store),
		comments: new CommentService(store),
		work: new WorkService(store),
	};
}

describe("services integration", () => {
	test("full lifecycle todo through deployed", async () => {
		const { store, groups, tasks, work } = await tempServices();
		const rev0 = await store.events.latestRev();

		const group = await groups.create({ key: "AUTH", name: "Auth" });
		expect(group.key).toBe("AUTH");

		const { tasks: created } = await tasks.create(group.key, [
			{ title: "Ship feature", status: "todo" },
		]);
		const task = created[0];

		let t = await tasks.status(task.id, task.version, { to: "open", actor: "planner" });
		expect(t.status).toBe("open");

		const bundle = await work.next({ groupKey: "AUTH", owner: "worker-a" });
		expect(bundle?.task.id).toBe(task.id);
		expect(bundle?.task.status).toBe("inprogress");

		const claimed = await store.tasks.getById(task.id);
		if (!claimed) throw new Error("task missing");
		t = await tasks.status(claimed.id, claimed.version, { to: "verifying", actor: "worker-a" });
		t = await tasks.status(t.id, t.version, { to: "verified", actor: "reviewer" });
		t = await tasks.status(t.id, t.version, { to: "deploying", actor: "deployer" });
		t = await tasks.status(t.id, t.version, { to: "deployed", actor: "deployer" });
		expect(t.status).toBe("deployed");

		const delta = await changesSince(store, rev0, { groupKey: "AUTH" });
		expect(delta.rev).toBeGreaterThan(rev0);
		expect(delta.events.some((e) => e.action === "create")).toBe(true);
		await store.close();
	});

	test("reopen requires blocker or verification comment", async () => {
		const { store, groups, tasks } = await tempServices();
		await groups.create({ key: "WEB", name: "Web" });
		const { tasks: created } = await tasks.create("WEB", [{ title: "Fix bug", status: "open" }]);
		let t = created[0];
		t = await tasks.status(t.id, t.version, {
			to: "inprogress",
			actor: "dev",
		});
		t = await tasks.status(t.id, t.version, { to: "verifying", actor: "dev" });
		t = await tasks.status(t.id, t.version, { to: "verified", actor: "qa" });

		await expect(
			tasks.status(t.id, t.version, { to: "reopen", actor: "qa" }),
		).rejects.toMatchObject({ code: "INVALID_TRANSITION" });

		t = await tasks.status(t.id, t.version, {
			to: "reopen",
			actor: "qa",
			comment: { kind: "verification", body: "Regression in staging" },
		});
		expect(t.status).toBe("reopen");

		t = await tasks.status(t.id, t.version, { to: "inprogress", actor: "dev" });
		expect(t.status).toBe("inprogress");
		await store.close();
	});

	test("deps gate blocks open until dependency terminal", async () => {
		const { store, groups, tasks } = await tempServices();
		await groups.create({ key: "API", name: "API" });
		const { tasks: batch } = await tasks.create("API", [
			{ title: "Foundation", status: "todo" },
			{ title: "Consumer", status: "todo", dependsOn: ["API-1"] },
		]);
		const consumer = batch[1];
		await expect(
			tasks.status(consumer.id, consumer.version, { to: "open", actor: "planner" }),
		).rejects.toMatchObject({ code: "DEPS_UNMET" });

		let foundation = batch[0];
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "open",
			actor: "planner",
		});
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "inprogress",
			actor: "dev",
		});
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "verifying",
			actor: "dev",
		});
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "verified",
			actor: "qa",
		});
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "deploying",
			actor: "ops",
		});
		foundation = await tasks.status(foundation.id, foundation.version, {
			to: "deployed",
			actor: "ops",
		});

		const opened = await tasks.status(consumer.id, consumer.version, {
			to: "open",
			actor: "planner",
		});
		expect(opened.status).toBe("open");
		await store.close();
	});

	test("version conflict on stale v", async () => {
		const { store, groups, tasks } = await tempServices();
		await groups.create({ key: "OPS", name: "Ops" });
		const { tasks: created } = await tasks.create("OPS", [{ title: "Task", status: "open" }]);
		const t = created[0];
		await tasks.update(t.id, t.version, { set: { title: "Task A" }, actor: "a" });
		await expect(
			tasks.update(t.id, t.version, { set: { title: "Task B" }, actor: "b" }),
		).rejects.toBeInstanceOf(ServiceError);
		await store.close();
	});

	test("parallel next never returns same task", async () => {
		const { store, groups, tasks, work } = await tempServices();
		await groups.create({ key: "CLM", name: "Claim" });
		await tasks.create("CLM", [
			{ title: "One", status: "open", priority: 0 },
			{ title: "Two", status: "open", priority: 1 },
		]);

		const [a, b] = await Promise.all([
			work.next({ groupKey: "CLM", owner: "agent-a" }),
			work.next({ groupKey: "CLM", owner: "agent-b" }),
		]);
		const ids = [a?.task.id, b?.task.id].filter(Boolean);
		expect(new Set(ids).size).toBe(2);

		await groups.create({ key: "ONE", name: "One" });
		await tasks.create("ONE", [{ title: "Only", status: "open" }]);
		const [w1, w2] = await Promise.all([
			work.next({ groupKey: "ONE", owner: "x" }),
			work.next({ groupKey: "ONE", owner: "y" }),
		]);
		const winners = [w1, w2].filter(Boolean);
		expect(winners.length).toBe(1);
		await store.close();
	});

	test("comment compaction hides superseded from default list", async () => {
		const { store, groups, tasks, comments } = await tempServices();
		await groups.create({ key: "CMP", name: "Cmp" });
		const { tasks: created } = await tasks.create("CMP", [{ title: "T", status: "open" }]);
		const taskId = created[0].id;
		await comments.add({
			taskId,
			author: "a",
			kind: "note",
			body: "first",
		});
		const decision = await comments.add({
			taskId,
			author: "a",
			kind: "decision",
			body: "use sqlite",
		});
		await comments.add({
			taskId,
			author: "a",
			kind: "note",
			body: "second",
		});

		await comments.compact({
			taskId,
			summaryBody: "combined thread",
		});

		const listed = await comments.list(taskId);
		expect(listed.some((c) => c.id === decision.comment.id)).toBe(true);
		expect(listed.filter((c) => c.kind === "note").length).toBe(0);
		expect(listed.some((c) => c.kind === "summary")).toBe(true);
		await store.close();
	});
});

import { describe, expect, test } from "bun:test";
import { openStore, seedDefaultProject } from "../../packages/store-postgres/src/index.ts";
import { hasDocker, startPostgres } from "../postgres/helpers.ts";

const docker = await hasDocker();

describe.skipIf(!docker)("PostgresStore conformance", () => {
	test("creates group, task, comment, section", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl);
		const store = await openStore({ databaseUrl: pg.databaseUrl, projectPk });
		const group = await store.groups.create({ key: "AUTH", name: "Auth" });
		expect(group.key).toBe("AUTH");
		const task = await store.tasks.create({
			groupKey: "AUTH",
			title: "Fix login",
			description: "Refresh token rotation",
			status: "open",
		});
		expect(task.id).toBe("AUTH-1");
		const comment = await store.comments.create({
			taskId: task.id,
			author: "agent",
			kind: "note",
			body: "Started investigation",
		});
		expect(comment.id).toBe("AUTH-1#1");
		const section = await store.sections.create({
			groupKey: "AUTH",
			slug: "testing",
			title: "Testing",
			body: "Run bun test",
			position: 0,
		});
		expect(section.slug).toBe("testing");
		await store.close();
		await pg.stop();
	});

	test("claimNext is exclusive for parallel callers", async () => {
		const pg = await startPostgres();
		const { projectPk } = await seedDefaultProject(pg.databaseUrl);
		const store = await openStore({ databaseUrl: pg.databaseUrl, projectPk });
		await store.groups.create({ key: "CLM", name: "Claim" });
		await store.tasks.create({ groupKey: "CLM", title: "One", status: "open" });
		await store.tasks.create({ groupKey: "CLM", title: "Two", status: "open", priority: 1 });
		const [a, b] = await Promise.all([
			store.claimNext({ groupKey: "CLM", owner: "agent-a" }),
			store.claimNext({ groupKey: "CLM", owner: "agent-b" }),
		]);
		const ids = [a?.id, b?.id].filter(Boolean);
		expect(new Set(ids).size).toBe(2);
		await store.close();
		await pg.stop();
	});
});

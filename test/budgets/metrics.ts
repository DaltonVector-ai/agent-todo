import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	ContextService,
	commentDigest,
	GroupService,
	Shaper,
	TaskService,
	WorkService,
} from "../../packages/core/src/index.ts";
import { renderContextToc } from "../../packages/core/src/shaper/renderText.ts";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { serializeCoreToolSchemasForBudget } from "../../packages/mcp/src/schemas.ts";
import {
	serializeAdminToolSchemasForBudget,
	serializeAllToolSchemasForBudget,
	serializePlanToolSchemasForBudget,
} from "../../packages/mcp/src/schemas-plan-admin.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

export type BudgetMetricKey =
	| "schema_core"
	| "schema_plan"
	| "schema_admin"
	| "schema_full"
	| "task_list_line_20"
	| "task_get_brief"
	| "work_bundle"
	| "context_toc";

export type BudgetMetrics = Record<BudgetMetricKey, number>;

function buildLargeMarkdown(targetTokens: number): string {
	const chunk = "word ".repeat(40).trim();
	const sections: string[] = [];
	let total = 0;
	let i = 0;
	while (total < targetTokens) {
		const title = `Section ${i}`;
		const body = `${chunk}\n${chunk}\n${chunk}`;
		const section = `## ${title}\n${body}`;
		total += estimate(section);
		sections.push(section);
		i += 1;
	}
	return sections.join("\n\n");
}

/** Collect token estimates used by budget regression (deterministic fixtures). */
export async function collectBudgetMetrics(): Promise<BudgetMetrics> {
	const schema_core = estimate(serializeCoreToolSchemasForBudget());
	const schema_plan = estimate(serializePlanToolSchemasForBudget());
	const schema_admin = estimate(serializeAdminToolSchemasForBudget());
	const schema_full = estimate(serializeAllToolSchemasForBudget());

	const dir = mkdtempSync(join(tmpdir(), "agent-todo-budget-metrics-"));
	const store = await openStore({ path: join(dir, "todo.db") });
	const groups = new GroupService(store);
	const tasks = new TaskService(store);
	const context = new ContextService(store);
	const work = new WorkService(store);

	await groups.create({ key: "AUTH", name: "Auth" });
	const items = Array.from({ length: 20 }, (_, i) => ({
		title: `Task number ${i + 1}`,
		status: "open" as const,
		priority: (i % 3) + 1,
	}));
	await tasks.create("AUTH", items);

	const all = await store.tasks.listByGroup("AUTH");
	const rev = await store.events.latestRev();
	const shaper = new Shaper(2000);
	const listResult = shaper.renderTaskList({
		groupKey: "AUTH",
		rev,
		openCount: all.length,
		total: all.length,
		tasks: all,
		view: "line",
	});
	const task_list_line_20 = estimate(listResult.text);

	const taskRow = all[0];
	if (!taskRow) throw new Error("expected task");
	const briefResult = shaper.renderTaskGet(taskRow, {
		view: "brief",
		digest: commentDigest([]),
		extras: { needs_compaction: false },
	});
	const task_get_brief = estimate(briefResult.text);

	await context.importMarkdown("AUTH", buildLargeMarkdown(3000), "test");
	const toc = await context.toc("AUTH");
	const context_toc = estimate(renderContextToc("AUTH", toc));

	const bundle = await work.next({ groupKey: "AUTH", owner: "budget-agent", claim: false });
	if (!bundle) throw new Error("expected work bundle");
	const bundleRendered = shaper.renderWorkBundle(bundle, rev, { view: "full" });
	const work_bundle = estimate(bundleRendered.text);

	await store.close();

	return {
		schema_core,
		schema_plan,
		schema_admin,
		schema_full,
		task_list_line_20,
		task_get_brief,
		work_bundle,
		context_toc,
	};
}

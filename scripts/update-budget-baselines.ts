/**
 * Refresh test/budgets/baselines.json from current metrics.
 * Run when intentionally growing token budgets (same PR as baseline commit).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { collectBudgetMetrics } from "../test/budgets/metrics.ts";

const root = join(import.meta.dir, "..");
const out = join(root, "test/budgets/baselines.json");

const metrics = await collectBudgetMetrics();
const payload = {
	version: 1,
	description:
		"Token estimates for budget regression. CI fails if any metric exceeds baseline × 1.1 unless this file is updated in the same change.",
	metrics,
	hardCaps: {
		schema_core: 1800,
		schema_full: 5000,
		task_list_line_20: 600,
		task_get_brief: 500,
		context_toc: 150,
	},
};

writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
console.log(`Wrote ${out}`);
console.log(JSON.stringify(metrics, null, 2));

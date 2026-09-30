import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type BudgetMetricKey, collectBudgetMetrics } from "./metrics.ts";

const GROWTH_FACTOR = 1.1;

type BaselinesFile = {
	version: number;
	metrics: Record<BudgetMetricKey, number>;
	hardCaps?: Partial<Record<BudgetMetricKey, number>>;
};

function loadBaselines(): BaselinesFile {
	const path = join(import.meta.dir, "baselines.json");
	return JSON.parse(readFileSync(path, "utf8")) as BaselinesFile;
}

describe("budget regression vs baselines", () => {
	test("metrics within 10% of baselines (or baselines updated)", async () => {
		const baselines = loadBaselines();
		const current = await collectBudgetMetrics();
		const failures: string[] = [];

		for (const key of Object.keys(baselines.metrics) as BudgetMetricKey[]) {
			const base = baselines.metrics[key];
			const actual = current[key];
			const cap = baselines.hardCaps?.[key];
			if (cap !== undefined && actual > cap) {
				failures.push(`${key}: ${actual} tokens exceeds hard cap ${cap}`);
			}
			const maxWithoutBaselineBump = base * GROWTH_FACTOR;
			if (actual > maxWithoutBaselineBump) {
				failures.push(
					`${key}: ${actual} tokens > ${maxWithoutBaselineBump.toFixed(1)} (${GROWTH_FACTOR}× baseline ${base}). Update test/budgets/baselines.json in this change if intentional.`,
				);
			}
		}

		expect(failures).toEqual([]);
	});
});

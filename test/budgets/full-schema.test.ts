import { describe, expect, test } from "bun:test";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { serializeAllToolSchemasForBudget } from "../../packages/mcp/src/schemas-plan-admin.ts";

describe("full tool schema budget", () => {
	test("all toolsets serialized ≤ 5000 tokens", () => {
		const text = serializeAllToolSchemasForBudget();
		const tokens = estimate(text);
		expect(tokens).toBeLessThanOrEqual(5000);
	});
});

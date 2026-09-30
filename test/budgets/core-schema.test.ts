import { describe, expect, test } from "bun:test";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { serializeCoreToolSchemasForBudget } from "../../packages/mcp/src/schemas.ts";

describe("core tool schema budget", () => {
	test("serialized core schemas ≤ 1800 tokens", () => {
		const text = serializeCoreToolSchemasForBudget();
		const tokens = estimate(text);
		expect(tokens).toBeLessThanOrEqual(1800);
	});
});

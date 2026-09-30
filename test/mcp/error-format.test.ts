import { describe, expect, test } from "bun:test";
import { ServiceError } from "../../packages/core/src/index.ts";
import { formatServiceError } from "../../packages/mcp/src/errors.ts";

describe("MCP error lines", () => {
	test("BUDGET matches CODE: message · hint", () => {
		const line = formatServiceError(
			new ServiceError("BUDGET", "Payload too large", { hint: "use view=brief" }),
		);
		expect(line).toBe("BUDGET: Payload too large · hint: use view=brief");
	});
});

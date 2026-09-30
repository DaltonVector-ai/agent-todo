import { describe, expect, test } from "bun:test";
import { isGroupKey, validateStatusTransition } from "./index";

describe("@agent-todo/core", () => {
	test("exports domain helpers", () => {
		expect(isGroupKey("AUTH")).toBe(true);
		expect(validateStatusTransition("todo", "open", { depsGateEnabled: false }).ok).toBe(true);
	});
});

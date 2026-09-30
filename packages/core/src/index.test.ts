import { describe, expect, test } from "bun:test";
import { PACKAGE } from "./index";

describe("@agent-todo/core", () => {
	test("exports PACKAGE name", () => {
		expect(PACKAGE).toBe("@agent-todo/core");
	});
});

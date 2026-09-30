import { describe, expect, test } from "bun:test";
import { estimate, truncate } from "./tokens.js";

describe("tokens", () => {
	test("estimate is positive for non-empty text", () => {
		expect(estimate("hello world")).toBeGreaterThan(0);
		expect(estimate("")).toBe(0);
	});

	test("truncate respects budget and marks truncation", () => {
		const long = "word ".repeat(200);
		const result = truncate(long, 10);
		expect(result.truncated).toBe(true);
		expect(result.text).toContain("use view=full");
		expect(estimate(result.text)).toBeLessThanOrEqual(estimate(long));
	});

	test("short text is not truncated", () => {
		const result = truncate("hi", 100);
		expect(result.truncated).toBe(false);
		expect(result.omittedTokens).toBe(0);
	});
});

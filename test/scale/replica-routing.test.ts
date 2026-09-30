import { describe, expect, test } from "bun:test";
import { routeReadToPrimary } from "../../packages/server/src/replicas.ts";

describe("replica routing", () => {
	test("uses replica when min_rev is absent", () => {
		expect(routeReadToPrimary(undefined, 10)).toBe(false);
	});

	test("uses primary when min_rev ahead of replica", () => {
		expect(routeReadToPrimary(15, 10)).toBe(true);
	});

	test("uses replica when min_rev satisfied on replica", () => {
		expect(routeReadToPrimary(10, 10)).toBe(false);
		expect(routeReadToPrimary(8, 10)).toBe(false);
	});
});

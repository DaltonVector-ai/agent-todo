import { describe, expect, test } from "bun:test";
import {
	acceptanceStringsToItems,
	normalizeAcceptanceInput,
} from "../../packages/mcp/src/acceptance.ts";

describe("acceptance normalization", () => {
	test("normalizeAcceptanceInput maps strings and legacy objects", () => {
		expect(normalizeAcceptanceInput([" a ", ""])).toEqual(["a"]);
		const legacy = normalizeAcceptanceInput([{ text: "Legacy", done: true }]);
		expect(legacy).toHaveLength(1);
		expect(acceptanceStringsToItems(legacy)).toEqual([{ text: "Legacy", done: true }]);
		expect(normalizeAcceptanceInput([-1, 1, 1])).toEqual([]);
	});
});

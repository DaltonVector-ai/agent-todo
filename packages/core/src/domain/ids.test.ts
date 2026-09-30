import { describe, expect, test } from "bun:test";
import {
	allocateTaskId,
	deriveKeyFromName,
	formatCommentId,
	formatSectionId,
	formatTaskId,
	isGroupKey,
	parseCommentId,
	parseSectionId,
	parseTaskId,
	type TaskSeqAllocator,
} from "./ids.js";

describe("group keys", () => {
	test("isGroupKey validates format", () => {
		expect(isGroupKey("AUTH")).toBe(true);
		expect(isGroupKey("A1")).toBe(true);
		expect(isGroupKey("auth")).toBe(false);
		expect(isGroupKey("A")).toBe(false);
		expect(isGroupKey("1AUTH")).toBe(false);
	});

	test("deriveKeyFromName slugifies", () => {
		expect(deriveKeyFromName("authentication")).toMatch(/^A/);
		expect(isGroupKey(deriveKeyFromName("!!"))).toBe(true);
	});
});

describe("task and comment ids", () => {
	test("format and parse task id", () => {
		expect(formatTaskId("AUTH", 12)).toBe("AUTH-12");
		expect(parseTaskId("AUTH-12")).toEqual({ key: "AUTH", n: 12 });
	});

	test("format and parse comment id", () => {
		expect(formatCommentId("AUTH-12", 3)).toBe("AUTH-12#3");
		expect(parseCommentId("AUTH-12#3")).toEqual({ taskId: "AUTH-12", seq: 3 });
	});

	test("format and parse section id", () => {
		expect(formatSectionId("AUTH", "testing")).toBe("AUTH/testing");
		expect(parseSectionId("AUTH/testing")).toEqual({ key: "AUTH", slug: "testing" });
	});
});

describe("allocateTaskId", () => {
	test("sequential allocation in one logical tx", async () => {
		let seq = 0;
		const allocator: TaskSeqAllocator = {
			async incrementTaskSeq() {
				seq += 1;
				return { key: "AUTH", seq };
			},
		};
		const a = await allocateTaskId(allocator, "group-pk");
		const b = await allocateTaskId(allocator, "group-pk");
		expect(a).toBe("AUTH-1");
		expect(b).toBe("AUTH-2");
	});
});

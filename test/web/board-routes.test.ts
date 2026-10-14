import { describe, expect, test } from "bun:test";
import { chooseProject } from "../../packages/web/src/projectChoice.ts";
import { type AppRoute, parsePath, pathForRoute } from "../../packages/web/src/routing.ts";

describe("board project routes", () => {
	test("a project address nests its group, context, and task views", () => {
		expect(parsePath("/")).toEqual({ kind: "root" });
		expect(parsePath("/p/ALP")).toEqual({ kind: "all", projectCode: "ALP" });
		expect(parsePath("/p/ALP/")).toEqual({ kind: "all", projectCode: "ALP" });
		expect(parsePath("/p/ALP/g/ALP-1")).toEqual({
			kind: "group",
			projectCode: "ALP",
			groupKey: "ALP-1",
			tab: "board",
		});
		expect(parsePath("/p/ALP/g/ALP-1/context")).toEqual({
			kind: "context",
			projectCode: "ALP",
			groupKey: "ALP-1",
		});
		expect(parsePath("/p/ALP/g/ALP-1/t/ALP-1-3")).toEqual({
			kind: "task",
			projectCode: "ALP",
			groupKey: "ALP-1",
			taskId: "ALP-1-3",
		});
		expect(parsePath("/p/A%2EB/g/G%20H/t/T%2F1")).toEqual({
			kind: "task",
			projectCode: "A.B",
			groupKey: "G H",
			taskId: "T/1",
		});
	});

	test("project addresses round-trip through the path builder", () => {
		const routes: AppRoute[] = [
			{ kind: "root" },
			{ kind: "all", projectCode: "ALP" },
			{ kind: "group", projectCode: "ALP", groupKey: "ALP-1", tab: "board" },
			{ kind: "context", projectCode: "ALP", groupKey: "ALP-1" },
			{ kind: "task", projectCode: "ALP", groupKey: "ALP-1", taskId: "ALP-1-3" },
			{ kind: "group", projectCode: null, groupKey: "HAM", tab: "board" },
			{ kind: "context", projectCode: null, groupKey: "HAM" },
			{ kind: "task", projectCode: null, groupKey: "HAM", taskId: "HAM-1" },
		];
		for (const route of routes) {
			expect(parsePath(pathForRoute(route))).toEqual(route);
		}
	});

	test("legacy group paths stay available for the per-project daemon", () => {
		expect(parsePath("/g/HAM")).toEqual({
			kind: "group",
			projectCode: null,
			groupKey: "HAM",
			tab: "board",
		});
		expect(parsePath("/g/HAM/context")).toEqual({
			kind: "context",
			projectCode: null,
			groupKey: "HAM",
		});
		expect(parsePath("/g/HAM/t/HAM-1")).toEqual({
			kind: "task",
			projectCode: null,
			groupKey: "HAM",
			taskId: "HAM-1",
		});
	});
});

describe("remembered project", () => {
	const alpha = { code: "ALP" };
	const beta = { code: "BET" };

	test("an empty list has nothing to open", () => {
		expect(chooseProject([], null)).toEqual({ kind: "empty" });
		expect(chooseProject([], "ALP", "ALP")).toEqual({ kind: "empty" });
	});

	test("one project opens directly", () => {
		expect(chooseProject([alpha], null)).toEqual({ kind: "open", code: "ALP" });
		expect(chooseProject([alpha], "GONE")).toEqual({ kind: "open", code: "ALP" });
	});

	test("several projects stay on the picker until a stored project is still registered", () => {
		expect(chooseProject([alpha, beta], null)).toEqual({ kind: "picker" });
		expect(chooseProject([alpha, beta], "BET")).toEqual({ kind: "open", code: "BET" });
	});

	test("a stored or addressed project that is gone shows the picker again", () => {
		expect(chooseProject([alpha, beta], "GONE")).toEqual({ kind: "picker" });
		expect(chooseProject([alpha, beta], "ALP", "GONE")).toEqual({ kind: "picker" });
		expect(chooseProject([alpha], "ALP", "GONE")).toEqual({ kind: "picker" });
	});

	test("an addressed project stays open while it is registered", () => {
		expect(chooseProject([alpha, beta], null, "ALP")).toEqual({ kind: "open", code: "ALP" });
	});
});

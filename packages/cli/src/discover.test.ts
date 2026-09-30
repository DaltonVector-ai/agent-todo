import { describe, expect, test } from "bun:test";
import { mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverProject } from "./discover.js";

describe("discoverProject", () => {
	test("AGENT_TODO_PROJECT points at repo root", () => {
		const root = join(tmpdir(), `discover-${Date.now()}`);
		mkdirSync(join(root, ".agent-todo"), { recursive: true });
		writeFileSync(
			join(root, ".agent-todo", "config.toml"),
			'version = 1\nmode = "local"\n',
			"utf8",
		);
		const prev = process.env.AGENT_TODO_PROJECT;
		process.env.AGENT_TODO_PROJECT = root;
		const found = discoverProject(join(root, "subdir"));
		if (prev === undefined) delete process.env.AGENT_TODO_PROJECT;
		else process.env.AGENT_TODO_PROJECT = prev;
		expect(realpathSync(found?.configPath ?? "")).toBe(
			realpathSync(join(root, ".agent-todo", "config.toml")),
		);
		rmSync(root, { recursive: true, force: true });
	});
});

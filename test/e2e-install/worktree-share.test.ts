import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";
import { discoverProject } from "../../packages/cli/src/discover.js";

describe("worktree discovery", () => {
	let root: string;

	afterEach(() => {
		if (root) rmSync(root, { recursive: true, force: true });
	});

	test("two worktrees resolve the same todo.db via git common dir", async () => {
		root = join(tmpdir(), `agent-todo-wt-${Date.now()}`);
		const main = join(root, "main");
		const wt = join(root, "feature");
		mkdirSync(main, { recursive: true });

		await $`git init`.cwd(main).quiet();
		await $`git config user.email test@example.com`.cwd(main).quiet();
		await $`git config user.name test`.cwd(main).quiet();
		writeFileSync(join(main, "README.md"), "hi\n");
		await $`git add README.md`.cwd(main).quiet();
		await $`git commit -m init`.cwd(main).quiet();

		const agentDir = join(main, ".agent-todo");
		mkdirSync(agentDir, { recursive: true });
		writeFileSync(
			join(agentDir, "config.toml"),
			`version = 1\nmode = "local"\ndefault_group = "MAIN"\ntoolsets = ["core"]\n`,
			"utf8",
		);
		writeFileSync(join(agentDir, "todo.db"), "", "utf8");

		await $`git worktree add ${wt} -b feature`.cwd(main).quiet();

		const fromMain = discoverProject(main);
		const fromWt = discoverProject(wt);

		expect(fromWt?.dbPath).toBe(fromMain?.dbPath);
		expect(existsSync(fromWt?.dbPath ?? "")).toBe(true);
	});
});

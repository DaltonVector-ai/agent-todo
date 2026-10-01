import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("init --remote", () => {
	test("requires bootstrap secret", async () => {
		const result =
			await $`bun run ${cliEntry} init --remote https://todo.example.com --project acme/web`
				.nothrow()
				.quiet();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("AGENT_TODO_BOOTSTRAP_SECRET");
	});
});

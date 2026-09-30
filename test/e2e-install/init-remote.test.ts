import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("init --remote", () => {
	test("rejects until cloud phase", async () => {
		const result = await $`bun run ${cliEntry} init --remote https://todo.example.com`
			.nothrow()
			.quiet();
		expect(result.exitCode).toBe(1);
		expect(result.stderr.toString()).toContain("not available until cloud");
	});
});

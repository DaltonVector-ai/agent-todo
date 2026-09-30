import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";

// Always run the TypeScript entry under src/, not a compiled dist/ copy.
const cliEntry = join(import.meta.dir, "index.ts");

describe("CLI help", () => {
	test("--help lists serve and migrate", async () => {
		const result = await $`bun run ${cliEntry} --help`.quiet();
		const stdout = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(stdout).toContain("serve");
		expect(stdout).toContain("migrate");
	});

	test("unknown command exits non-zero", async () => {
		const result = await $`bun run ${cliEntry} nope`.nothrow().quiet();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("unknown command: nope");
	});
});

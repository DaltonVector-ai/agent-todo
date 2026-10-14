import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { $ } from "bun";
import { RELEASE_BASE_URL } from "./commands/upgrade.ts";

// Always run the TypeScript entry under src/, not a compiled dist/ copy.
const cliEntry = join(import.meta.dir, "index.ts");

function cliEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value !== undefined) env[key] = value;
	}
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) delete env[key];
		else env[key] = value;
	}
	return env;
}

describe("CLI help", () => {
	test("--help lists the current commands and the machine daemon path", async () => {
		const result = await $`bun run ${cliEntry} --help`.quiet();
		const stdout = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		for (const command of [
			"install",
			"uninstall",
			"init",
			"uninit",
			"doctor",
			"upgrade",
			"daemon",
			"serve",
			"migrate",
			"import",
			"export",
			"pull",
			"push",
			"server",
		]) {
			expect(stdout).toContain(command);
		}
		expect(stdout).toContain("AGENTS.md");
		expect(stdout).toContain("machine daemon");
		expect(stdout).toContain("no idle shutdown");
		expect(stdout).toContain("AGENT_TODO_AGENT");
		expect(stdout).toContain("AGENT_TODO_DB");
		expect(stdout).toContain("AGENT_TODO_DAEMON_URL");
		expect(stdout).not.toContain("not available until phase 7");
		expect(stdout).not.toContain("phase 9");
	});

	test("unknown command exits non-zero", async () => {
		const result = await $`bun run ${cliEntry} nope`.nothrow().quiet();
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr.toString()).toContain("unknown command: nope");
	});

	test("upgrade prints this repository's release URL", async () => {
		const result = await $`bun run ${cliEntry} upgrade`
			.env(cliEnv({ AGENT_TODO_RELEASE_BASE_URL: undefined }))
			.quiet();
		const stdout = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(stdout).toContain(RELEASE_BASE_URL);
		expect(stdout).not.toContain("saleeq");
		expect(stdout).not.toContain("phase 9");
	});

	test("AGENT_TODO_RELEASE_BASE_URL overrides the upgrade release URL", async () => {
		const override = "https://example.test/fork/releases/latest";
		const result = await $`bun run ${cliEntry} upgrade`
			.env(cliEnv({ AGENT_TODO_RELEASE_BASE_URL: override }))
			.quiet();
		const stdout = result.stdout.toString();
		expect(result.exitCode).toBe(0);
		expect(stdout).toContain(override);
		expect(stdout).not.toContain(RELEASE_BASE_URL);
	});
});

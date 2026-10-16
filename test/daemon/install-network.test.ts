import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstallArgs } from "../../packages/cli/src/commands/installArgs.ts";
import { normalizeServerBaseUrl } from "../../packages/cli/src/machine/serverUrl.ts";
import { machineHttpUrls } from "../../packages/cli/src/machine/networkUrls.ts";
import {
	MACHINE_LOOPBACK_HOST,
	MACHINE_NETWORK_HOST,
	readMachineListenHost,
	writeMachineListenHost,
} from "../../packages/server/src/machineListenConfig.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("local network install", () => {
	test("--local without --loopback selects network listen mode", () => {
		const parsed = parseInstallArgs(["--local"]);
		expect(parsed).toEqual({ mode: "local", loopback: false });
	});

	test("--local --loopback selects loopback listen mode", () => {
		const parsed = parseInstallArgs(["--local", "--loopback"]);
		expect(parsed).toEqual({ mode: "local", loopback: true });
	});

	test("persists network listen host and prints LAN URLs", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-net-config-"));
		const configPath = join(dir, "daemon.toml");
		writeMachineListenHost(MACHINE_NETWORK_HOST, configPath);
		expect(readMachineListenHost(configPath)).toBe(MACHINE_NETWORK_HOST);
		writeMachineListenHost(MACHINE_LOOPBACK_HOST, configPath);
		expect(readMachineListenHost(configPath)).toBe(MACHINE_LOOPBACK_HOST);
		rmSync(dir, { recursive: true, force: true });
		expect(machineHttpUrls(8787).length).toBeGreaterThan(0);
	});

	test("normalizeServerBaseUrl accepts base and /mcp URLs", () => {
		expect(normalizeServerBaseUrl("http://192.168.0.5:8787/")).toEqual({
			ok: true,
			baseUrl: "http://192.168.0.5:8787",
		});
		expect(normalizeServerBaseUrl("http://192.168.0.5:8787/mcp")).toEqual({
			ok: true,
			baseUrl: "http://192.168.0.5:8787",
		});
		expect(normalizeServerBaseUrl("http://x/foo").ok).toBe(false);
	});

	test("CLI rejects --local together with --url", async () => {
		const parsed = parseInstallArgs(["--local", "--url", "http://127.0.0.1:8787"]);
		expect(parsed).toEqual({ error: "agent-todo install: choose either --local or --url" });
	});

	test("CLI rejects install without --local or --url", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-net-home-"));
		const proc = Bun.spawn(["bun", cliEntry, "install"], {
			env: { ...process.env, HOME: home, AGENT_TODO_INTEGRATION_HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited).toBe(1);
		expect(stderr).toContain("--local");
		rmSync(home, { recursive: true, force: true });
	});
});

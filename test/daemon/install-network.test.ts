import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseInstallArgs } from "../../packages/cli/src/commands/installArgs.ts";
import { machineHttpUrls } from "../../packages/cli/src/machine/networkUrls.ts";
import {
	MACHINE_LOOPBACK_HOST,
	MACHINE_NETWORK_HOST,
	readMachineListenHost,
	writeMachineListenHost,
} from "../../packages/server/src/machineListenConfig.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

describe("network export install", () => {
	test("requires a password for non-interactive network install", async () => {
		const parsed = parseInstallArgs(["--network"]);
		expect(parsed).toEqual({
			error: "agent-todo install: --password is required for --network",
		});
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

	test("CLI rejects network install without password", async () => {
		const home = mkdtempSync(join(tmpdir(), "agent-todo-net-home-"));
		const proc = Bun.spawn(["bun", cliEntry, "install", "--network"], {
			env: { ...process.env, HOME: home, AGENT_TODO_INTEGRATION_HOME: home },
			stdout: "pipe",
			stderr: "pipe",
		});
		const stderr = await new Response(proc.stderr).text();
		expect(await proc.exited).toBe(1);
		expect(stderr).toContain("--password");
		rmSync(home, { recursive: true, force: true });
	});

});

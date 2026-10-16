import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnDetachedDaemon } from "../autostart.js";
import { machineDaemonBaseUrl, machineDaemonDbPath } from "../daemon/endpoint.js";
import { isThisDaemon, readDaemonHealth } from "../daemon/health.js";
import { dirname } from "node:path";

function daemonPidPath(dbPath = machineDaemonDbPath()): string {
	return join(dirname(dbPath), "daemon.pid");
}

export function stopMachineDaemonIfRunning(): void {
	const pidPath = daemonPidPath();
	try {
		const pid = Number.parseInt(readFileSync(pidPath, "utf8").trim(), 10);
		if (Number.isInteger(pid) && pid > 0) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {
				// already stopped
			}
		}
	} catch {
		// no pid file
	}
	rmSync(pidPath, { force: true });
}

export async function waitForMachineDaemon(
	baseUrl: string,
	timeoutMs: number,
): Promise<boolean> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		if (isThisDaemon(await readDaemonHealth(baseUrl))) return true;
		await Bun.sleep(100);
	}
	return isThisDaemon(await readDaemonHealth(baseUrl));
}

/** Stop a running daemon and start a fresh one (picks up listen config). */
export async function restartMachineDaemon(): Promise<void> {
	stopMachineDaemonIfRunning();
	spawnDetachedDaemon();
	const baseUrl = machineDaemonBaseUrl();
	const ready = await waitForMachineDaemon(baseUrl, 15_000);
	if (!ready) {
		throw new Error(`agent-todo install: machine daemon did not become ready at ${baseUrl}`);
	}
}

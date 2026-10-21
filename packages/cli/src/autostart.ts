import { spawn, spawnSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { integrationHome } from "./integrations/paths.js";

export const LAUNCH_AGENT_LABEL = "com.daltonvector.agent-todo";
export const SYSTEMD_UNIT_NAME = "agent-todo.service";

/** Command that boots the machine daemon. Source checkouts run the TypeScript entry. */
export function daemonProgramArgs(): string[] {
	const devEntry = join(import.meta.dirname, "index.ts");
	if (existsSync(devEntry)) return [process.execPath, devEntry, "daemon"];
	return [process.execPath, "daemon"];
}

export function spawnDetachedDaemon(): void {
	const [command, ...args] = daemonProgramArgs();
	if (!command) throw new Error("could not resolve the agent-todo daemon command");
	const child = spawn(command, args, {
		detached: true,
		stdio: "ignore",
		env: process.env,
	});
	child.unref();
}

/**
 * macOS writes a LaunchAgent. Linux writes a user unit and the enable symlink.
 * `AGENT_TODO_AUTOSTART_PLATFORM` selects the file shape in tests.
 * `enableAutostart` loads that definition; `disableAutostart` unloads it.
 */
export function autostartPlatform(): "darwin" | "linux" | null {
	const raw = process.env.AGENT_TODO_AUTOSTART_PLATFORM?.trim() || process.platform;
	if (raw === "darwin" || raw === "linux") return raw;
	return null;
}

export function writeAutostart(home = integrationHome()): string | null {
	const platform = autostartPlatform();
	if (platform === "darwin") return writeLaunchAgent(home);
	if (platform === "linux") return writeSystemdUserService(home);
	return null;
}

export type CommandRunner = (command: string, args: string[]) => void;

function defaultCommandRunner(command: string, args: string[]): void {
	const log = process.env.AGENT_TODO_AUTOSTART_COMMAND_LOG?.trim();
	if (log) {
		appendFileSync(log, `${JSON.stringify({ command, args })}\n`);
		return;
	}
	const result = spawnSync(command, args, { stdio: "inherit" });
	if (result.error) throw result.error;
	if (result.status !== 0) {
		// macOS launchctl bootstrap returns 5 (I/O error) when already loaded.
		// Unload the old registration and retry bootstrap.
		if (command === "launchctl" && args[0] === "bootstrap" && result.status === 5) {
			const bootoutArgs = ["bootout", ...args.slice(1)];
			spawnSync("launchctl", bootoutArgs, { stdio: "ignore" });
			const retry = spawnSync(command, args, { stdio: "inherit" });
			if (retry.status === 0) return;
		}
		throw new Error(`${command} ${args.join(" ")} exited ${result.status ?? "unknown"}`);
	}
}

function launchAgentPath(home: string): string {
	return join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
}

/** Load the autostart definition into the user session. Tests pass `run` and never call the real tools. */
export function enableAutostart(
	home = integrationHome(),
	run: CommandRunner = defaultCommandRunner,
): void {
	const platform = autostartPlatform();
	if (platform === "darwin") {
		const uid = process.getuid?.();
		if (uid === undefined) return;
		run("launchctl", ["bootstrap", `gui/${uid}`, launchAgentPath(home)]);
		return;
	}
	if (platform === "linux") {
		run("systemctl", ["--user", "enable", SYSTEMD_UNIT_NAME]);
	}
}

/** Unload the autostart definition. File deletion happens afterwards. */
export function disableAutostart(
	home = integrationHome(),
	run: CommandRunner = defaultCommandRunner,
): void {
	const attempt = (command: string, args: string[]) => {
		try {
			run(command, args);
		} catch (err) {
			console.error(err instanceof Error ? err.message : String(err));
		}
	};
	const platform = autostartPlatform();
	if (platform === "darwin") {
		const uid = process.getuid?.();
		if (uid === undefined) return;
		attempt("launchctl", ["bootout", `gui/${uid}`, launchAgentPath(home)]);
		return;
	}
	if (platform === "linux") {
		attempt("systemctl", ["--user", "disable", SYSTEMD_UNIT_NAME]);
		attempt("systemctl", ["--user", "stop", SYSTEMD_UNIT_NAME]);
	}
}

/**
 * Deletes the LaunchAgent plist or the systemd user unit and its enable symlink.
 * Does not touch the machine database. Unload with `disableAutostart` first.
 */
export function removeAutostart(home = integrationHome()): string | null {
	const platform = autostartPlatform();
	if (platform === "darwin") return removeLaunchAgent(home);
	if (platform === "linux") return removeSystemdUserService(home);
	return null;
}

function writeLaunchAgent(home: string): string {
	const path = join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`);
	const args = daemonProgramArgs()
		.map((arg) => `\t\t<string>${escapeXml(arg)}</string>`)
		.join("\n");
	const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LAUNCH_AGENT_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${args}
	</array>
	<key>RunAtLoad</key>
	<true/>
</dict>
</plist>
`;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, body, "utf8");
	return path;
}

function writeSystemdUserService(home: string): string {
	const unitDir = join(home, ".config", "systemd", "user");
	const unitPath = join(unitDir, SYSTEMD_UNIT_NAME);
	const exec = daemonProgramArgs().map(quoteSystemdArg).join(" ");
	const body = `[Unit]
Description=agent-todo machine daemon

[Service]
ExecStart=${exec}
Restart=on-failure

[Install]
WantedBy=default.target
`;
	mkdirSync(unitDir, { recursive: true });
	writeFileSync(unitPath, body, "utf8");

	const wantsDir = join(unitDir, "default.target.wants");
	const linkPath = join(wantsDir, SYSTEMD_UNIT_NAME);
	mkdirSync(wantsDir, { recursive: true });
	try {
		if (lstatSync(linkPath)) unlinkSync(linkPath);
	} catch {
		/* absent */
	}
	symlinkSync(`../${SYSTEMD_UNIT_NAME}`, linkPath);
	return unitPath;
}

function removeLaunchAgent(home: string): string | null {
	const path = launchAgentPath(home);
	return unlinkIfPresent(path) ? path : null;
}

function removeSystemdUserService(home: string): string | null {
	const unitDir = join(home, ".config", "systemd", "user");
	const unitPath = join(unitDir, SYSTEMD_UNIT_NAME);
	const linkPath = join(unitDir, "default.target.wants", SYSTEMD_UNIT_NAME);
	const removedLink = unlinkIfPresent(linkPath);
	const removedUnit = unlinkIfPresent(unitPath);
	if (removedUnit) return unitPath;
	if (removedLink) return linkPath;
	return null;
}

function unlinkIfPresent(path: string): boolean {
	try {
		lstatSync(path);
	} catch {
		return false;
	}
	unlinkSync(path);
	return true;
}

function escapeXml(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function quoteSystemdArg(arg: string): string {
	if (!/[\s"]/.test(arg)) return arg;
	return `"${arg.replaceAll('"', '\\"')}"`;
}

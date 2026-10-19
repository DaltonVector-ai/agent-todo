import { afterEach, describe, expect, test } from "bun:test";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { disableAutostart, enableAutostart } from "../../packages/cli/src/autostart.ts";
import { readMachineClient } from "../../packages/cli/src/machine/client.ts";
import { startMachineDaemon } from "../../packages/server/src/index.ts";

const cliEntry = join(import.meta.dir, "../../packages/cli/src/index.ts");

const CONFIG_ENV_KEYS = [
	"AGENT_TODO_DB",
	"AGENT_TODO_PROJECT",
	"AGENT_TODO_DAEMON_URL",
	"AGENT_TODO_DAEMON_PORT",
	"AGENT_TODO_INTEGRATION_HOME",
	"AGENT_TODO_INTEGRATION_BACKUP_DIR",
	"AGENT_TODO_CURSOR_MCP_JSON",
	"AGENT_TODO_VSCODE_MCP_JSON",
	"AGENT_TODO_GEMINI_MCP_JSON",
	"AGENT_TODO_OPENCODE_MCP_JSON",
	"AGENT_TODO_CODEX_CONFIG",
	"AGENT_TODO_CLAUDE_CONFIG",
	"AGENT_TODO_AUTOSTART_PLATFORM",
	"AGENT_TODO_MACHINE_CLIENT",
] as const;

type InstallResult = { exitCode: number; stdout: string; stderr: string };

function childEnv(opts: {
	home: string;
	dbPath: string;
	baseUrl: string;
	platform: "darwin" | "linux";
	commandLog: string;
}): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined) continue;
		if ((CONFIG_ENV_KEYS as readonly string[]).includes(key)) continue;
		env[key] = value;
	}
	env.HOME = opts.home;
	env.AGENT_TODO_INTEGRATION_HOME = opts.home;
	env.AGENT_TODO_DB = opts.dbPath;
	env.AGENT_TODO_DAEMON_URL = opts.baseUrl;
	env.AGENT_TODO_AUTOSTART_PLATFORM = opts.platform;
	env.AGENT_TODO_AUTOSTART_COMMAND_LOG = opts.commandLog;
	return env;
}

async function runUninstall(opts: {
	project: string;
	home: string;
	dbPath: string;
	port: number;
	platform: "darwin" | "linux";
	commandLog: string;
}): Promise<InstallResult> {
	const proc = Bun.spawn(["bun", cliEntry, "uninstall"], {
		cwd: opts.project,
		env: childEnv({
			home: opts.home,
			dbPath: opts.dbPath,
			baseUrl: `http://127.0.0.1:${opts.port}`,
			platform: opts.platform,
			commandLog: opts.commandLog,
		}),
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

function pathExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}

async function runInstall(
	opts: {
		project: string;
		home: string;
		dbPath: string;
		port: number;
		platform: "darwin" | "linux";
		commandLog: string;
		clientPath: string;
	},
	installArgs: string[] = [],
): Promise<InstallResult> {
	const args = installArgs.length > 0 ? installArgs : ["--local", "--loopback"];
	const proc = Bun.spawn(["bun", cliEntry, "install", ...args], {
		cwd: opts.project,
		env: {
			...childEnv({
				home: opts.home,
				dbPath: opts.dbPath,
				baseUrl: `http://127.0.0.1:${opts.port}`,
				platform: opts.platform,
				commandLog: opts.commandLog,
			}),
			AGENT_TODO_MACHINE_CLIENT: opts.clientPath,
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const exitCode = await proc.exited;
	return { exitCode, stdout, stderr };
}

function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string" || address.port === 8787) {
				server.close(() => reject(new Error("could not allocate a non-8787 port")));
				return;
			}
			const { port } = address;
			server.close(() => resolve(port));
		});
	});
}

async function stopRecordedDaemon(dbPath: string): Promise<void> {
	const pidPath = join(dirname(dbPath), "daemon.pid");
	if (!existsSync(pidPath)) return;
	const pid = Number(readFileSync(pidPath, "utf8").trim());
	if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		return;
	}
	for (let attempt = 0; attempt < 30; attempt++) {
		try {
			process.kill(pid, 0);
		} catch {
			return;
		}
		await Bun.sleep(50);
	}
}

function readCommands(path: string): Array<{ command: string; args: string[] }> {
	if (!existsSync(path)) return [];
	return readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().length > 0)
		.map((line) => JSON.parse(line) as { command: string; args: string[] });
}

function readMcpEntry(path: string): {
	type?: string;
	url?: string;
	command?: string;
	args?: string[];
	headers?: Record<string, string>;
} {
	const data = JSON.parse(readFileSync(path, "utf8")) as {
		mcpServers?: Record<
			string,
			{
				type?: string;
				url?: string;
				command?: string;
				args?: string[];
				headers?: Record<string, string>;
			}
		>;
	};
	const entry = data.mcpServers?.["agent-todo"];
	if (!entry) throw new Error(`missing agent-todo entry in ${path}`);
	return entry;
}

function httpMcpEntry(mcpUrl: string) {
	return {
		type: "http",
		url: mcpUrl,
	};
}

describe("install wires agents and autostart", () => {
	const cleanups: Array<() => Promise<void>> = [];
	const dirs: string[] = [];

	afterEach(async () => {
		for (const cleanup of cleanups.splice(0)) await cleanup();
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function layout(platform: "darwin" | "linux") {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-install-"));
		const home = join(dir, "home");
		const project = join(dir, "project");
		const dbPath = join(dir, "machine", "todo.db");
		mkdirSync(home);
		mkdirSync(project);
		writeFileSync(join(project, "README.md"), "project\n", "utf8");
		const commandLog = join(dir, "autostart-commands.log");
		const clientPath = join(dir, "client.toml");
		dirs.push(dir);
		cleanups.push(async () => {
			await stopRecordedDaemon(dbPath);
		});
		return { dir, home, project, dbPath, platform, commandLog, clientPath };
	}

	function detectAll(home: string) {
		mkdirSync(join(home, ".cursor"));
		mkdirSync(join(home, ".codex"));
		mkdirSync(join(home, ".gemini"));
		mkdirSync(join(home, ".vscode"));
		mkdirSync(join(home, ".config", "opencode"), { recursive: true });
		writeFileSync(join(home, ".claude.json"), "{}\n", "utf8");
		writeFileSync(
			join(home, ".gemini", "settings.json"),
			`${JSON.stringify({ theme: "dark" })}\n`,
			"utf8",
		);
	}

	test("creates the machine database, starts the daemon, and writes URL and command entries", async () => {
		const env = layout("darwin");
		detectAll(env.home);
		const port = await freePort();
		const mcpUrl = `http://127.0.0.1:${port}/mcp`;

		const result = await runInstall({ ...env, port });
		expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0);
		expect(existsSync(env.dbPath)).toBe(true);
		const client = readMachineClient(env.clientPath);
		expect(client).toEqual({
			url: `http://127.0.0.1:${port}`,
			flow: "default",
		});

		const health = await fetch(`http://127.0.0.1:${port}/health`);
		expect(health.status).toBe(200);
		expect(await health.json()).toEqual({ status: "ok", service: "agent-todo" });

		const board = await fetch(`http://127.0.0.1:${port}/api/projects`);
		expect(board.status).toBe(200);

		expect(readMcpEntry(join(env.home, ".cursor", "mcp.json"))).toEqual(httpMcpEntry(mcpUrl));
		expect(readMcpEntry(join(env.home, ".claude.json"))).toEqual(httpMcpEntry(mcpUrl));
		const gemini = JSON.parse(readFileSync(join(env.home, ".gemini", "settings.json"), "utf8")) as {
			theme?: string;
			mcpServers?: Record<string, { httpUrl?: string }>;
		};
		expect(gemini.theme).toBe("dark");
		expect(gemini.mcpServers?.["agent-todo"]).toEqual({
			httpUrl: mcpUrl,
		});
		const vscode = JSON.parse(readFileSync(join(env.home, ".vscode", "mcp.json"), "utf8")) as {
			servers?: Record<string, { type?: string; url?: string }>;
			mcpServers?: unknown;
		};
		expect(vscode.mcpServers).toBeUndefined();
		expect(vscode.servers?.["agent-todo"]).toEqual(httpMcpEntry(mcpUrl));
		const opencode = JSON.parse(
			readFileSync(join(env.home, ".config", "opencode", "mcp.json"), "utf8"),
		) as { mcp?: Record<string, { type?: string; url?: string }> };
		expect(opencode.mcp?.["agent-todo"]).toEqual({
			type: "remote",
			url: mcpUrl,
		});

		const codex = readFileSync(join(env.home, ".codex", "config.toml"), "utf8");
		expect(codex).toContain("[mcp_servers.agent-todo]");
		expect(codex).toContain(`url = "${mcpUrl}"`);
		expect(codex).not.toContain("http_headers");
		expect(codex).not.toContain("command =");

		const plistPath = join(
			env.home,
			"Library",
			"LaunchAgents",
			"com.daltonvector.agent-todo.plist",
		);
		const plist = readFileSync(plistPath, "utf8");
		expect(plist).toContain("<string>com.daltonvector.agent-todo</string>");
		expect(plist).toContain("<key>RunAtLoad</key>");
		expect(plist).toContain("<string>daemon</string>");
		expect(readCommands(env.commandLog)).toEqual([
			{
				command: "launchctl",
				args: ["bootstrap", `gui/${process.getuid()}`, plistPath],
			},
		]);
		expect(existsSync(join(env.home, ".config", "systemd", "user", "agent-todo.service"))).toBe(
			false,
		);

		expect(existsSync(join(env.project, ".mcp.json"))).toBe(false);
		expect(existsSync(join(env.project, ".cursor", "mcp.json"))).toBe(false);
		expect(existsSync(join(env.project, ".agent-todo"))).toBe(false);
	}, 20_000);

	test("keeps the same client URL on a second loopback install", async () => {
		const env = layout("darwin");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();

		const first = await runInstall({ ...env, port });
		expect(first.exitCode, `${first.stderr}\n${first.stdout}`).toBe(0);
		const firstClient = readMachineClient(env.clientPath);

		const second = await runInstall({ ...env, port }, ["--local", "--loopback"]);
		expect(second.exitCode, `${second.stderr}\n${second.stdout}`).toBe(0);
		expect(readMachineClient(env.clientPath)).toEqual(firstClient);
	}, 20_000);

	test("skips agents that are not installed", async () => {
		const env = layout("darwin");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();

		const result = await runInstall({ ...env, port }, ["--local", "--loopback"]);
		expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0);
		expect(readMcpEntry(join(env.home, ".cursor", "mcp.json"))).toEqual(
			httpMcpEntry(`http://127.0.0.1:${port}/mcp`),
		);

		expect(existsSync(join(env.home, ".codex", "config.toml"))).toBe(false);
		expect(existsSync(join(env.home, ".gemini", "settings.json"))).toBe(false);
		expect(existsSync(join(env.home, ".vscode", "mcp.json"))).toBe(false);
		expect(existsSync(join(env.home, ".config", "opencode", "mcp.json"))).toBe(false);
		if (Bun.which("claude")) {
			expect(readMcpEntry(join(env.home, ".claude.json"))).toEqual(
				httpMcpEntry(`http://127.0.0.1:${port}/mcp`),
			);
		} else {
			expect(existsSync(join(env.home, ".claude.json"))).toBe(false);
		}
	}, 20_000);

	test("exits before agent config or autostart when another program holds the port", async () => {
		const env = layout("darwin");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();
		const foreign = Bun.serve({
			hostname: "127.0.0.1",
			port,
			fetch() {
				return Response.json({ status: "other" });
			},
		});
		cleanups.push(async () => {
			foreign.stop(true);
		});

		const result = await runInstall({ ...env, port });
		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain(String(port));
		expect(existsSync(join(env.home, ".cursor", "mcp.json"))).toBe(false);
		expect(
			existsSync(join(env.home, "Library", "LaunchAgents", "com.daltonvector.agent-todo.plist")),
		).toBe(false);
		expect(existsSync(env.dbPath)).toBe(false);
		expect(existsSync(join(env.project, ".mcp.json"))).toBe(false);
		expect(readCommands(env.commandLog)).toEqual([]);
	});

	test("repairs agent config and autostart when this daemon already holds the port", async () => {
		const env = layout("darwin");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();
		const runtime = await startMachineDaemon({ dbPath: env.dbPath, port });
		cleanups.push(async () => {
			await runtime.stop();
		});

		writeFileSync(
			join(env.home, ".cursor", "mcp.json"),
			`${JSON.stringify({ mcpServers: { "agent-todo": { command: "agent-todo", args: ["serve", "--mcp"] } } }, null, 2)}\n`,
			"utf8",
		);
		const plistPath = join(
			env.home,
			"Library",
			"LaunchAgents",
			"com.daltonvector.agent-todo.plist",
		);
		mkdirSync(join(env.home, "Library", "LaunchAgents"), { recursive: true });
		writeFileSync(plistPath, "broken\n", "utf8");

		const first = await runInstall({ ...env, port });
		expect(first.exitCode, `${first.stderr}\n${first.stdout}`).toBe(0);
		expect(readMcpEntry(join(env.home, ".cursor", "mcp.json"))).toEqual(
			httpMcpEntry(`http://127.0.0.1:${port}/mcp`),
		);
		const plist = readFileSync(plistPath, "utf8");
		expect(plist).toContain("<key>RunAtLoad</key>");
		expect(plist).toContain("<string>daemon</string>");
		expect(existsSync(join(dirname(env.dbPath), "daemon.pid"))).toBe(false);

		writeFileSync(plistPath, "broken-again\n", "utf8");
		const second = await runInstall({ ...env, port });
		expect(second.exitCode, `${second.stderr}\n${second.stdout}`).toBe(0);
		expect(readFileSync(plistPath, "utf8")).toContain("<string>daemon</string>");
		const health = await fetch(`http://127.0.0.1:${port}/health`);
		expect(await health.json()).toEqual({ status: "ok", service: "agent-todo" });
		expect(readCommands(env.commandLog).map((call) => call.args[0])).toEqual([
			"bootstrap",
			"bootstrap",
		]);
	}, 20_000);

	test("exits before agent config or autostart when status is ok but the listener is not this daemon", async () => {
		const env = layout("darwin");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();
		const foreign = Bun.serve({
			hostname: "127.0.0.1",
			port,
			fetch() {
				return Response.json({ status: "ok" });
			},
		});
		cleanups.push(async () => {
			foreign.stop(true);
		});

		const result = await runInstall({ ...env, port });
		expect(result.exitCode).not.toBe(0);
		expect(existsSync(join(env.home, ".cursor", "mcp.json"))).toBe(false);
		expect(
			existsSync(join(env.home, "Library", "LaunchAgents", "com.daltonvector.agent-todo.plist")),
		).toBe(false);
		expect(readCommands(env.commandLog)).toEqual([]);
	});

	test("writes a systemd user service and enables it without calling systemctl", async () => {
		const env = layout("linux");
		mkdirSync(join(env.home, ".cursor"));
		const port = await freePort();

		const result = await runInstall({ ...env, port });
		expect(result.exitCode, `${result.stderr}\n${result.stdout}`).toBe(0);

		const unitPath = join(env.home, ".config", "systemd", "user", "agent-todo.service");
		const unit = readFileSync(unitPath, "utf8");
		expect(unit).toContain("[Service]");
		expect(unit).toContain("daemon");
		expect(unit).toContain("WantedBy=default.target");
		const wants = join(
			env.home,
			".config",
			"systemd",
			"user",
			"default.target.wants",
			"agent-todo.service",
		);
		expect(readlinkSync(wants)).toBe("../agent-todo.service");
		expect(readCommands(env.commandLog)).toEqual([
			{ command: "systemctl", args: ["--user", "enable", "agent-todo.service"] },
		]);
		expect(
			existsSync(join(env.home, "Library", "LaunchAgents", "com.daltonvector.agent-todo.plist")),
		).toBe(false);
		expect(result.stdout + result.stderr).not.toContain("systemctl");
		expect(result.stdout + result.stderr).not.toContain("launchctl");
	}, 20_000);

	test("uninstall restores agent config, removes the LaunchAgent, and keeps the database", async () => {
		const env = layout("darwin");
		const cursorDir = join(env.home, ".cursor");
		mkdirSync(cursorDir);
		const cursorPath = join(cursorDir, "mcp.json");
		const originalCursor = `${JSON.stringify({ mcpServers: { other: { command: "other" } } }, null, 2)}\n`;
		writeFileSync(cursorPath, originalCursor, "utf8");
		const agentsPath = join(env.project, "AGENTS.md");
		const originalAgents = "# project agents\n\nLeave this file alone.\n";
		writeFileSync(agentsPath, originalAgents, "utf8");
		const port = await freePort();

		const installed = await runInstall({ ...env, port });
		expect(installed.exitCode, `${installed.stderr}\n${installed.stdout}`).toBe(0);
		expect(readFileSync(cursorPath, "utf8")).not.toBe(originalCursor);
		const plistPath = join(
			env.home,
			"Library",
			"LaunchAgents",
			"com.daltonvector.agent-todo.plist",
		);
		expect(pathExists(plistPath)).toBe(true);

		const removed = await runUninstall({ ...env, port });
		expect(removed.exitCode, `${removed.stderr}\n${removed.stdout}`).toBe(0);
		expect(readFileSync(cursorPath, "utf8")).toBe(originalCursor);
		expect(pathExists(plistPath)).toBe(false);
		expect(readCommands(env.commandLog)).toEqual([
			{
				command: "launchctl",
				args: ["bootstrap", `gui/${process.getuid()}`, plistPath],
			},
			{
				command: "launchctl",
				args: ["bootout", `gui/${process.getuid()}`, plistPath],
			},
		]);
		expect(existsSync(env.dbPath)).toBe(true);
		expect(readFileSync(agentsPath, "utf8")).toBe(originalAgents);
		expect(removed.stdout + removed.stderr).not.toContain("launchctl");
		expect(removed.stdout + removed.stderr).not.toContain("systemctl");
	}, 20_000);

	test("uninstall removes the systemd unit and wants symlink without deleting the database", async () => {
		const env = layout("linux");
		mkdirSync(join(env.home, ".cursor"));
		const agentsPath = join(env.project, "AGENTS.md");
		const originalAgents = "# linux project\n";
		writeFileSync(agentsPath, originalAgents, "utf8");
		const port = await freePort();

		const installed = await runInstall({ ...env, port });
		expect(installed.exitCode, `${installed.stderr}\n${installed.stdout}`).toBe(0);
		const unitPath = join(env.home, ".config", "systemd", "user", "agent-todo.service");
		const wants = join(
			env.home,
			".config",
			"systemd",
			"user",
			"default.target.wants",
			"agent-todo.service",
		);
		expect(pathExists(unitPath)).toBe(true);
		expect(readlinkSync(wants)).toBe("../agent-todo.service");
		const removed = await runUninstall({ ...env, port });
		expect(removed.exitCode, `${removed.stderr}\n${removed.stdout}`).toBe(0);
		expect(pathExists(unitPath)).toBe(false);
		expect(pathExists(wants)).toBe(false);
		expect(readCommands(env.commandLog)).toEqual([
			{ command: "systemctl", args: ["--user", "enable", "agent-todo.service"] },
			{ command: "systemctl", args: ["--user", "disable", "agent-todo.service"] },
			{ command: "systemctl", args: ["--user", "stop", "agent-todo.service"] },
		]);
		expect(existsSync(env.dbPath)).toBe(true);
		expect(readFileSync(agentsPath, "utf8")).toBe(originalAgents);
		expect(removed.stdout + removed.stderr).not.toContain("systemctl");
		expect(removed.stdout + removed.stderr).not.toContain("launchctl");
	}, 20_000);
});

describe("autostart command runner", () => {
	const previousPlatform = process.env.AGENT_TODO_AUTOSTART_PLATFORM;

	afterEach(() => {
		if (previousPlatform === undefined) delete process.env.AGENT_TODO_AUTOSTART_PLATFORM;
		else process.env.AGENT_TODO_AUTOSTART_PLATFORM = previousPlatform;
	});

	test("injects launchctl bootstrap and bootout", () => {
		process.env.AGENT_TODO_AUTOSTART_PLATFORM = "darwin";
		const home = "/tmp/agent-todo-autostart-home";
		const calls: string[][] = [];
		const run = (command: string, args: string[]) => {
			calls.push([command, ...args]);
		};
		const plist = `${home}/Library/LaunchAgents/com.daltonvector.agent-todo.plist`;
		enableAutostart(home, run);
		disableAutostart(home, run);
		expect(calls).toEqual([
			["launchctl", "bootstrap", `gui/${process.getuid()}`, plist],
			["launchctl", "bootout", `gui/${process.getuid()}`, plist],
		]);
	});

	test("injects systemctl enable, disable, and stop", () => {
		process.env.AGENT_TODO_AUTOSTART_PLATFORM = "linux";
		const calls: string[][] = [];
		const run = (command: string, args: string[]) => {
			calls.push([command, ...args]);
		};
		enableAutostart("/tmp/agent-todo-linux-home", run);
		disableAutostart("/tmp/agent-todo-linux-home", run);
		expect(calls).toEqual([
			["systemctl", "--user", "enable", "agent-todo.service"],
			["systemctl", "--user", "disable", "agent-todo.service"],
			["systemctl", "--user", "stop", "agent-todo.service"],
		]);
	});
});

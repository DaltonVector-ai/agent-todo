import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type ProjectConfig = {
	projectDir: string;
	configPath: string;
	dbPath: string;
	mode: "local" | "daemon" | "remote";
	defaultGroup?: string;
	projectRef?: string;
	remoteUrl?: string;
	toolsets: string[];
	defaultMaxTokens: number;
};

export function discoverProject(startDir = process.cwd()): ProjectConfig | null {
	const fromOverride = discoverFromEnv();
	if (fromOverride) return fromOverride;

	const fromDbOverride = discoverFromDbEnv();
	if (fromDbOverride) return fromDbOverride;

	const mainRoot = resolveGitMainWorktreeRoot(startDir);
	if (mainRoot) {
		const mainConfig = join(mainRoot, ".agent-todo", "config.toml");
		if (existsSync(mainConfig)) {
			return loadProjectConfig(mainRoot);
		}
	}

	const walked = findConfigWalkingUp(startDir);
	if (walked) return walked;

	return null;
}

function discoverFromEnv(): ProjectConfig | null {
	const raw = process.env.AGENT_TODO_PROJECT?.trim();
	if (!raw) return null;
	const resolved = resolve(raw);
	let projectRoot: string;
	if (resolved.endsWith(".agent-todo")) {
		projectRoot = dirname(resolved);
	} else {
		projectRoot = resolved;
	}
	const configPath = join(projectRoot, ".agent-todo", "config.toml");
	if (!existsSync(configPath)) return null;
	return loadProjectConfig(projectRoot);
}

/** Legacy test override: path to todo.db file. */
function discoverFromDbEnv(): ProjectConfig | null {
	const override = process.env.AGENT_TODO_DB;
	if (!override) return null;
	const dbPath = resolve(override);
	const projectDir = dirname(dirname(dbPath));
	return {
		projectDir: join(projectDir, ".agent-todo"),
		configPath: join(projectDir, ".agent-todo", "config.toml"),
		dbPath,
		mode: "local",
		toolsets: ["core"],
		defaultMaxTokens: 2000,
	};
}

function findConfigWalkingUp(startDir: string): ProjectConfig | null {
	let dir = resolve(startDir);
	for (;;) {
		const configPath = join(dir, ".agent-todo", "config.toml");
		if (existsSync(configPath)) {
			return loadProjectConfig(dir);
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function normalizeRoot(projectRoot: string): string {
	const resolved = resolve(projectRoot);
	try {
		return realpathSync(resolved);
	} catch {
		return resolved;
	}
}

function loadProjectConfig(projectRoot: string): ProjectConfig {
	const root = normalizeRoot(projectRoot);
	const configPath = join(root, ".agent-todo", "config.toml");
	const parsed = parseMinimalToml(readFileSync(configPath, "utf8"));
	const mode = (parsed.mode ?? "local") as ProjectConfig["mode"];
	const dbPath = join(root, ".agent-todo", "todo.db");
	let dbPathResolved = dbPath;
	try {
		dbPathResolved = realpathSync(dbPath);
	} catch {
		dbPathResolved = dbPath;
	}
	return {
		projectDir: join(root, ".agent-todo"),
		configPath,
		dbPath: dbPathResolved,
		mode,
		defaultGroup: parsed.default_group,
		projectRef: parsed.project,
		remoteUrl: parsed.remote_url,
		toolsets: parsed.toolsets ?? ["core"],
		defaultMaxTokens: parsed.default_max_tokens ?? 2000,
	};
}

/** Main checkout root from git common dir (worktrees share one board). */
export function resolveGitMainWorktreeRoot(startDir: string): string | null {
	try {
		const commonDir = execFileSync("git", ["rev-parse", "--git-common-dir"], {
			cwd: startDir,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		if (!commonDir) return null;
		const absCommon = isAbsolute(commonDir) ? commonDir : join(startDir, commonDir);
		const normalized = resolve(absCommon);
		const base = normalized.endsWith(".git") ? dirname(normalized) : dirname(normalized);
		return normalizeRoot(base);
	} catch {
		return null;
	}
}

function parseMinimalToml(text: string): {
	mode?: string;
	default_group?: string;
	project?: string;
	remote_url?: string;
	toolsets?: string[];
	default_max_tokens?: number;
} {
	const out: {
		mode?: string;
		default_group?: string;
		project?: string;
		remote_url?: string;
		toolsets?: string[];
		default_max_tokens?: number;
	} = {};
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
		const eq = trimmed.indexOf("=");
		if (eq < 0) continue;
		const key = trimmed.slice(0, eq).trim();
		let value = trimmed.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		if (key === "mode") out.mode = value;
		if (key === "default_group") out.default_group = value;
		if (key === "project") out.project = value;
		if (key === "toolsets" && value.startsWith("[")) {
			out.toolsets = value
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
		}
	}
	const limits = text.match(/\[limits\][\s\S]*?(?=\n\[|$)/);
	if (limits) {
		const m = limits[0].match(/default_max_tokens\s*=\s*(\d+)/);
		if (m) out.default_max_tokens = Number(m[1]);
	}
	const remote = text.match(/\[remote\][\s\S]*?(?=\n\[|$)/);
	if (remote) {
		const url = remote[0].match(/url\s*=\s*"([^"]+)"/);
		if (url) out.remote_url = url[1];
	}
	return out;
}

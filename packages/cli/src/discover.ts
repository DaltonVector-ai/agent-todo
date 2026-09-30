import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export type ProjectConfig = {
	projectDir: string;
	configPath: string;
	dbPath: string;
	mode: "local" | "daemon" | "remote";
	defaultGroup?: string;
	toolsets: string[];
	defaultMaxTokens: number;
};

export function discoverProject(startDir = process.cwd()): ProjectConfig | null {
	const override = process.env.AGENT_TODO_DB;
	if (override) {
		const dbPath = resolve(override);
		const projectDir = dirname(dirname(dbPath));
		return {
			projectDir,
			configPath: join(projectDir, "config.toml"),
			dbPath,
			mode: "local",
			toolsets: ["core"],
			defaultMaxTokens: 2000,
		};
	}

	let dir = resolve(startDir);
	for (;;) {
		const configPath = join(dir, ".agent-todo", "config.toml");
		if (existsSync(configPath)) {
			const parsed = parseMinimalToml(readFileSync(configPath, "utf8"));
			const mode = (parsed.mode ?? "local") as ProjectConfig["mode"];
			return {
				projectDir: join(dir, ".agent-todo"),
				configPath,
				dbPath: join(dir, ".agent-todo", "todo.db"),
				mode,
				defaultGroup: parsed.default_group,
				toolsets: parsed.toolsets ?? ["core"],
				defaultMaxTokens: parsed.default_max_tokens ?? 2000,
			};
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return null;
}

function parseMinimalToml(text: string): {
	mode?: string;
	default_group?: string;
	toolsets?: string[];
	default_max_tokens?: number;
} {
	const out: {
		mode?: string;
		default_group?: string;
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
	return out;
}

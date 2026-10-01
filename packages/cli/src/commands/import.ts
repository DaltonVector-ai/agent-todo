import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ContextService } from "@agent-todo/core";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";

export type ImportCommandOptions = {
	yes: boolean;
	group: string;
	filePath: string;
	mode?: "merge" | "replace";
	cwd?: string;
};

export async function runImport(opts: ImportCommandOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const project = discoverProject(cwd);
	if (!project) {
		console.error("agent-todo: no .agent-todo/config.toml found (run init first).");
		return 1;
	}
	if (project.mode !== "local") {
		console.error(`agent-todo: import requires local mode (got ${project.mode}).`);
		return 1;
	}

	const abs = resolve(cwd, opts.filePath);
	let markdown: string;
	try {
		markdown = readFileSync(abs, "utf8");
	} catch {
		console.error(`agent-todo: cannot read ${abs}`);
		return 1;
	}

	const store = await openStore({ path: project.dbPath });
	try {
		const context = new ContextService(store);
		const group = await store.groups.getByKey(opts.group);
		if (!group) {
			console.error(`agent-todo: unknown group ${opts.group}`);
			return 1;
		}
		const result = await context.importMarkdown(opts.group, markdown, "cli-import", {
			mode: opts.mode ?? "merge",
		});
		const slugs = result.sections.map((s) => s.slug).join(", ");
		console.log(`imported ${result.sections.length} sections into ${opts.group}: ${slugs}`);
		if (result.largeSections.length) {
			console.log(`warning: large sections (>800 tok): ${result.largeSections.join(", ")}`);
		}
		return 0;
	} finally {
		await store.close();
	}
}

export function parseImportArgs(args: string[]): ImportCommandOptions | null {
	let yes = false;
	let group: string | undefined;
	let filePath: string | undefined;
	let mode: "merge" | "replace" | undefined;
	const positional: string[] = [];
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;
		if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--group") {
			group = args[i + 1];
			i += 1;
		} else if (arg === "--mode") {
			const m = args[i + 1];
			if (m === "merge" || m === "replace") mode = m;
			i += 1;
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}
	if (positional[0]) filePath = positional[0];
	if (!filePath || !group) return null;
	const g = group;
	const f = filePath;
	return { yes, group: g, filePath: f, mode };
}

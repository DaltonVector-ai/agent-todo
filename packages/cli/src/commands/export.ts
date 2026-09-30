import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { type ContextExportFlavor, ContextService } from "@agent-todo/core";
import { openStore } from "@agent-todo/store-sqlite";
import { discoverProject } from "../discover.js";

export type ExportCommandOptions = {
	yes: boolean;
	group: string;
	flavor: ContextExportFlavor;
	outPath?: string;
	cwd?: string;
};

export async function runExport(opts: ExportCommandOptions): Promise<number> {
	const cwd = opts.cwd ?? process.cwd();
	const project = discoverProject(cwd);
	if (!project) {
		console.error("agent-todo: no .agent-todo/config.toml found (run init first).");
		return 1;
	}
	if (project.mode !== "local") {
		console.error(`agent-todo: export requires local mode (got ${project.mode}).`);
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
		const md = await context.exportMarkdown(opts.group, opts.flavor);
		if (opts.outPath) {
			const out = resolve(cwd, opts.outPath);
			writeFileSync(out, md, "utf8");
			console.log(`wrote ${out}`);
		} else {
			process.stdout.write(md);
			if (!md.endsWith("\n")) process.stdout.write("\n");
		}
		return 0;
	} finally {
		await store.close();
	}
}

export function parseExportArgs(args: string[]): ExportCommandOptions | null {
	let yes = false;
	let group: string | undefined;
	let flavor: ContextExportFlavor = "plain";
	let outPath: string | undefined;
	const positional: string[] = [];
	for (let i = 1; i < args.length; i++) {
		const arg = args[i];
		if (!arg) continue;
		if (arg === "--yes" || arg === "-y") yes = true;
		else if (arg === "--flavor") {
			const f = args[i + 1];
			if (f === "claude_md" || f === "agents_md" || f === "plain" || f === "stub") {
				flavor = f;
			}
			i += 1;
		} else if (arg === "--out" || arg === "-o") {
			outPath = args[i + 1];
			i += 1;
		} else if (!arg.startsWith("-")) {
			positional.push(arg);
		}
	}
	if (positional[0]) group = positional[0];
	if (!group) return null;
	return { yes, group, flavor, outPath };
}

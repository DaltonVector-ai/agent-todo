/**
 * Compile the CLI for the current host OS/arch.
 *
 * Full matrix (linux/mac/windows × x64/arm64) is completed in phase 9.
 * This script only builds for the machine running it (CI + local).
 *
 * Output: dist/bin/agent-todo-<os>-<arch>
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const entry = join(root, "packages/cli/src/index.ts");
const outDir = join(root, "dist/bin");

const osMap: Record<string, string> = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
};

const archMap: Record<string, string> = {
	arm64: "arm64",
	x64: "x64",
};

const os = osMap[process.platform] ?? process.platform;
const arch = archMap[process.arch] ?? process.arch;
const outfile = join(outDir, `agent-todo-${os}-${arch}`);

await mkdir(outDir, { recursive: true });

console.log(`Building host binary → ${outfile}`);

const result = await Bun.build({
	entrypoints: [entry],
	outdir: outDir,
	target: "bun",
	compile: {
		outfile,
	},
});

if (!result.success) {
	console.error("Build failed:");
	for (const log of result.logs) {
		console.error(log);
	}
	process.exit(1);
}

console.log(`Wrote ${outfile}`);
console.log("Note: full OS/arch release matrix (linux/mac/windows × x64/arm64) ships in phase 9.");

/**
 * Compile the CLI for one or more OS/arch targets.
 *
 * Usage:
 *   bun run scripts/build-binaries.ts              # current host only
 *   bun run scripts/build-binaries.ts --all        # full matrix (native + cross where Bun supports)
 *   bun run scripts/build-binaries.ts --target linux-x64
 *
 * Output: dist/bin/agent-todo-<os>-<arch>[.exe]
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const entry = join(root, "packages/cli/src/index.ts");
const outDir = join(root, "dist/bin");

export const RELEASE_TARGETS: Array<{ os: string; arch: string; bunTarget: string }> = [
	{ os: "linux", arch: "x64", bunTarget: "bun-linux-x64" },
	{ os: "linux", arch: "arm64", bunTarget: "bun-linux-arm64" },
	{ os: "darwin", arch: "x64", bunTarget: "bun-darwin-x64" },
	{ os: "darwin", arch: "arm64", bunTarget: "bun-darwin-arm64" },
	{ os: "windows", arch: "x64", bunTarget: "bun-windows-x64" },
];

const osMap: Record<string, string> = {
	darwin: "darwin",
	linux: "linux",
	win32: "windows",
};

const archMap: Record<string, string> = {
	arm64: "arm64",
	x64: "x64",
};

function outfileFor(os: string, arch: string): string {
	const ext = os === "windows" ? ".exe" : "";
	return join(outDir, `agent-todo-${os}-${arch}${ext}`);
}

async function buildOne(target: { os: string; arch: string; bunTarget: string }): Promise<void> {
	const outfile = outfileFor(target.os, target.arch);
	console.log(`Building ${target.os}-${target.arch} → ${outfile}`);

	const result = await Bun.build({
		entrypoints: [entry],
		outdir: outDir,
		target: target.bunTarget,
		compile: {
			outfile,
		},
	});

	if (!result.success) {
		console.error(`Build failed for ${target.os}-${target.arch}:`);
		for (const log of result.logs) {
			console.error(log);
		}
		process.exit(1);
	}
	console.log(`Wrote ${outfile}`);
}

function parseArgs(argv: string[]): { mode: "host" | "all" | "target"; target?: string } {
	if (argv.includes("--all")) return { mode: "all" };
	const idx = argv.indexOf("--target");
	if (idx >= 0 && argv[idx + 1]) {
		return { mode: "target", target: argv[idx + 1] };
	}
	return { mode: "host" };
}

await mkdir(outDir, { recursive: true });

const args = parseArgs(process.argv.slice(2));

if (args.mode === "all") {
	for (const t of RELEASE_TARGETS) {
		await buildOne(t);
	}
} else if (args.mode === "target" && args.target) {
	const [os, arch] = args.target.split("-");
	const found = RELEASE_TARGETS.find((t) => t.os === os && t.arch === arch);
	if (!found) {
		console.error(
			`Unknown target ${args.target}. Use one of: ${RELEASE_TARGETS.map((t) => `${t.os}-${t.arch}`).join(", ")}`,
		);
		process.exit(1);
	}
	await buildOne(found);
} else {
	const os = osMap[process.platform] ?? process.platform;
	const arch = archMap[process.arch] ?? process.arch;
	const bunTarget = `bun-${os === "windows" ? "windows" : os}-${arch}`;
	await buildOne({ os, arch, bunTarget });
}

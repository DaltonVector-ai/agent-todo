/**
 * Minimal CycloneDX SBOM from workspace package.json files and bun.lock presence.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const outFile = join(root, "dist/sbom.json");

const rootPkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
	name: string;
	version: string;
};

const packagesDir = join(root, "packages");
const pkgNames = await readdir(packagesDir);
const components: Array<{
	type: string;
	name: string;
	version: string;
	purl: string;
}> = [];

for (const dir of pkgNames) {
	const path = join(packagesDir, dir, "package.json");
	try {
		const pkg = JSON.parse(await readFile(path, "utf8")) as { name: string; version?: string };
		components.push({
			type: "library",
			name: pkg.name,
			version: pkg.version ?? "0.0.0",
			purl: `pkg:npm/${pkg.name}@${pkg.version ?? "0.0.0"}`,
		});
	} catch {
		// skip non-packages
	}
}

const bom = {
	bomFormat: "CycloneDX",
	specVersion: "1.5",
	version: 1,
	metadata: {
		timestamp: new Date().toISOString(),
		component: {
			type: "application",
			name: rootPkg.name,
			version: rootPkg.version,
		},
		tools: [{ name: "agent-todo-sbom", version: "1.0" }],
	},
	components,
	dependencies: [{ ref: "pkg:npm/agent-todo", dependsOn: components.map((c) => c.purl) }],
};

await writeFile(outFile, `${JSON.stringify(bom, null, 2)}\n`);
console.log(`Wrote ${outFile}`);

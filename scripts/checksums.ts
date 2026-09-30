/**
 * Write SHA256 checksums for release binaries under dist/bin/.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const binDir = join(root, "dist/bin");
const outFile = join(binDir, "SHA256SUMS");

const names = (await readdir(binDir))
	.filter((n) => n.startsWith("agent-todo-") && !n.endsWith(".json"))
	.sort();

const lines: string[] = [];
for (const name of names) {
	const buf = await readFile(join(binDir, name));
	const hash = createHash("sha256").update(buf).digest("hex");
	lines.push(`${hash}  ${name}`);
}

await writeFile(outFile, `${lines.join("\n")}\n`);
console.log(`Wrote ${outFile} (${lines.length} files)`);

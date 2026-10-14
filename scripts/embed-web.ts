/**
 * Build packages/web and embed static assets into packages/server/src/boardAssets.ts
 */
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const webDir = join(root, "packages/web");
const outFile = join(root, "packages/server/src/boardAssets.ts");

const proc = Bun.spawnSync(["bun", "run", "build"], {
	cwd: webDir,
	stdout: "inherit",
	stderr: "inherit",
});
if (proc.exitCode !== 0) process.exit(proc.exitCode ?? 1);

const dist = join(webDir, "dist");
const assets: { path: string; content: Uint8Array; contentType: string }[] = [];

function walk(dir: string, base = dist) {
	for (const name of readdirSync(dir)) {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) {
			walk(full, base);
			continue;
		}
		const rel = relative(base, full).replace(/\\/g, "/");
		const webPath = rel === "index.html" ? "/index.html" : `/${rel}`;
		assets.push({
			path: webPath,
			content: new Uint8Array(readFileSync(full)),
			contentType: contentTypeFor(rel),
		});
	}
}

walk(dist);

const body = `/**
 * Embedded web board assets. Regenerate with \`bun run scripts/embed-web.ts\`.
 */
export type BoardAsset = { path: string; content: Uint8Array; contentType: string };

const FILES: Record<string, { content: Uint8Array; contentType: string }> = {
${assets
	.map(
		(a) =>
			`\t"${a.path}": { content: new Uint8Array([${[...a.content].join(",")}]), contentType: "${a.contentType}" },`,
	)
	.join("\n")}
};

export const BOARD_ASSETS: BoardAsset[] = Object.entries(FILES).map(([path, v]) => ({
	path,
	content: v.content,
	contentType: v.contentType,
}));

export function findBoardAsset(pathname: string): BoardAsset | undefined {
	if (pathname === "/" || pathname.startsWith("/g/") || pathname.startsWith("/p/")) {
		const index = FILES["/index.html"];
		if (index) {
			return { path: "/index.html", content: index.content, contentType: index.contentType };
		}
	}
	const normalized = pathname === "/" ? "/index.html" : pathname;
	return FILES[normalized]
		? { path: normalized, content: FILES[normalized].content, contentType: FILES[normalized].contentType }
		: undefined;
}
`;

mkdirSync(join(root, "packages/server/src"), { recursive: true });
writeFileSync(outFile, body, "utf8");
console.log(`Wrote ${assets.length} assets → ${outFile}`);

function contentTypeFor(file: string): string {
	if (file.endsWith(".html")) return "text/html; charset=utf-8";
	if (file.endsWith(".js")) return "application/javascript; charset=utf-8";
	if (file.endsWith(".css")) return "text/css; charset=utf-8";
	if (file.endsWith(".svg")) return "image/svg+xml";
	if (file.endsWith(".png")) return "image/png";
	return "application/octet-stream";
}

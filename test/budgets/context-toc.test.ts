import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ContextService, GroupService } from "../../packages/core/src/index.ts";
import { renderContextToc } from "../../packages/core/src/shaper/renderText.ts";
import { estimate } from "../../packages/core/src/util/tokens.ts";
import { openStore } from "../../packages/store-sqlite/src/index.ts";

function buildLargeMarkdown(targetTokens: number): string {
	const chunk = "word ".repeat(40).trim(); // ~40 tokens per section body chunk
	const sections: string[] = [];
	let total = 0;
	let i = 0;
	while (total < targetTokens) {
		const title = `Section ${i}`;
		const body = `${chunk}\n${chunk}\n${chunk}`;
		const section = `## ${title}\n${body}`;
		total += estimate(section);
		sections.push(section);
		i += 1;
	}
	return sections.join("\n\n");
}

describe("context import TOC budget", () => {
	test("~3k token import yields TOC ≤ 150 tokens", async () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-toc-"));
		const store = await openStore({ path: join(dir, "todo.db") });
		const groups = new GroupService(store);
		const context = new ContextService(store);
		await groups.create({ key: "DOC", name: "Doc" });
		const markdown = buildLargeMarkdown(3000);
		expect(estimate(markdown)).toBeGreaterThanOrEqual(2800);
		await context.importMarkdown("DOC", markdown, "test");
		const toc = await context.toc("DOC");
		const tocText = renderContextToc("DOC", toc);
		expect(estimate(tocText)).toBeLessThanOrEqual(150);
		await store.close();
	});
});

describe("CLI import file fixture", () => {
	test("fixture file meets ~3k tokens", () => {
		const dir = mkdtempSync(join(tmpdir(), "agent-todo-fix-"));
		const path = join(dir, "CLAUDE.md");
		const md = buildLargeMarkdown(3000);
		writeFileSync(path, md);
		const read = Bun.file(path);
		expect(read.size).toBeGreaterThan(1000);
	});
});

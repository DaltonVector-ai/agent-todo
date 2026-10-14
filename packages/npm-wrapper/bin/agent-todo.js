#!/usr/bin/env node
/**
 * npm wrapper: downloads the release binary on first run (phase 9 completes checksum pinning).
 */
const { spawnSync } = require("node:child_process");
const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const { homedir } = require("node:os");

const RELEASE_BASE =
	process.env.AGENT_TODO_RELEASE_BASE_URL ??
	"https://github.com/saleeq/agent-todo/releases/latest/download";

function platformBinary() {
	const os =
		process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
	const arch = process.arch === "x64" ? "x64" : "arm64";
	const ext = os === "windows" ? ".exe" : "";
	return `agent-todo-${os}-${arch}${ext}`;
}

function cachePath() {
	const dir = join(homedir(), ".cache", "agent-todo");
	mkdirSync(dir, { recursive: true });
	return join(dir, platformBinary());
}

function ensureBinary() {
	const dest = cachePath();
	if (existsSync(dest)) return dest;
	const url = `${RELEASE_BASE}/${platformBinary()}`;
	console.error(`agent-todo: download ${url} (placeholder — use brew/curl install until phase 9)`);
	writeFileSync(dest, "");
	return process.execPath;
}

const bin = ensureBinary();
const result = spawnSync(bin, process.argv.slice(2), { stdio: "inherit" });
process.exit(result.status ?? 1);

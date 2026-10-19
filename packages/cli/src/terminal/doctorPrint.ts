import type { DoctorSeverity } from "../integrations/types.js";
import { createAnsi } from "./ansi.js";

const CATEGORY_WIDTH = 16;
const out = createAnsi(process.stdout);

function severityBadge(severity: DoctorSeverity): string {
	switch (severity) {
		case "ok":
			return out.greenBold("  OK  ");
		case "warn":
			return out.yellowBold(" WARN ");
		case "error":
			return out.redBold(" ERR  ");
	}
}

function padCategory(label: string): string {
	return label.length < CATEGORY_WIDTH ? label.padEnd(CATEGORY_WIDTH) : label;
}

export function printDoctorHeader(): void {
	console.log(out.bold(out.magenta("agent-todo doctor")));
	console.log(out.dim("─".repeat(56)));
}

export function printDoctorSection(title: string): void {
	console.log();
	console.log(out.cyanBold(title));
}

/** One check row; returns true when severity is error (caller should set exit code). */
export function printDoctorLine(
	category: string,
	severity: DoctorSeverity,
	message: string,
	opts: { indent?: number } = {},
): boolean {
	const indent = opts.indent ?? 0;
	const prefix = "  ".repeat(indent);
	const name = out.cyan(out.bold(padCategory(category)));
	const badge = severityBadge(severity);
	const detail =
		severity === "error"
			? out.red(message)
			: severity === "warn"
				? out.yellow(message)
				: out.dim(message);
	const line = `${prefix}${name}  ${badge}  ${out.dim("—")}  ${detail}`;
	console.log(line);
	return severity === "error";
}

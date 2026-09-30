import { runAgentInstall } from "../integrations/index.js";

export function runInstall(): number {
	const { exitCode } = runAgentInstall();
	return exitCode;
}

import { runAgentUninstall } from "../integrations/index.js";

export function runUninstall(): number {
	const { exitCode } = runAgentUninstall();
	return exitCode;
}

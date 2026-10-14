import { removeAutostart } from "../autostart.js";
import { runAgentUninstall } from "../integrations/index.js";

export function runUninstall(): number {
	const removed = removeAutostart();
	if (removed) console.log(`autostart removed: ${removed}`);
	const { exitCode } = runAgentUninstall();
	return exitCode;
}

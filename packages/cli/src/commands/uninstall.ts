import { disableAutostart, removeAutostart } from "../autostart.js";
import { runAgentUninstall } from "../integrations/index.js";

export function runUninstall(): number {
	disableAutostart();
	const removed = removeAutostart();
	if (removed) console.log(`autostart removed: ${removed}`);
	const { exitCode } = runAgentUninstall();
	return exitCode;
}

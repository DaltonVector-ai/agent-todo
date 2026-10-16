import { disableAutostart, removeAutostart } from "../autostart.js";
import { runAgentUninstall } from "../integrations/index.js";
import { stopMachineDaemonIfRunning } from "../machine/restartDaemon.js";

export function runUninstall(): number {
	stopMachineDaemonIfRunning();
	disableAutostart();
	const removed = removeAutostart();
	if (removed) console.log(`autostart removed: ${removed}`);
	const { exitCode } = runAgentUninstall();
	return exitCode;
}

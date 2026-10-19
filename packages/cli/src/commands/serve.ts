import { machineDaemonBaseUrl, machineMcpUrlWithFlow } from "../daemon/endpoint.js";
import { readDaemonHealth } from "../daemon/health.js";
import { runStdioMcpProxy } from "../daemon/proxy.js";
import { readMachineClient } from "../machine/client.js";

export { machineDaemonBaseUrl };

/**
 * Forward stdio MCP to the server chosen at install.
 * Does not open the database and does not look for a repository config.
 */
export async function runServeMcp(opts: { baseUrl?: string } = {}): Promise<number> {
	const client = readMachineClient();
	const baseUrl = machineDaemonBaseUrl(opts.baseUrl ?? client?.url);
	if (!(await readDaemonHealth(baseUrl))?.ok) {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}
	const flow = client?.flow ?? "default";
	return await runStdioMcpProxy(machineMcpUrlWithFlow(baseUrl, flow));
}

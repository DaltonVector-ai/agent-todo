import { machineDaemonBaseUrl } from "../daemon/endpoint.js";
import { readDaemonHealth } from "../daemon/health.js";
import { runStdioMcpProxy } from "../daemon/proxy.js";

export { machineDaemonBaseUrl };

/**
 * Forward stdio MCP to the running machine daemon.
 * Does not open the database and does not look for a repository config.
 */
export async function runServeMcp(opts: { baseUrl?: string } = {}): Promise<number> {
	const baseUrl = machineDaemonBaseUrl(opts.baseUrl);
	if (!(await readDaemonHealth(baseUrl))?.ok) {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}
	return await runStdioMcpProxy(`${baseUrl}/mcp`);
}

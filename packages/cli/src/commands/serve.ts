import { machineDaemonBaseUrl } from "../daemon/endpoint.js";
import { runStdioMcpProxy } from "../daemon/proxy.js";

export { machineDaemonBaseUrl };

async function machineDaemonListening(baseUrl: string): Promise<boolean> {
	try {
		const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2_000) });
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Forward stdio MCP to the running machine daemon.
 * Does not open the database and does not look for a repository config.
 */
export async function runServeMcp(opts: { baseUrl?: string } = {}): Promise<number> {
	const baseUrl = machineDaemonBaseUrl(opts.baseUrl);
	if (!(await machineDaemonListening(baseUrl))) {
		console.error("agent-todo: machine daemon is not running. Run `agent-todo install`.");
		return 1;
	}
	return await runStdioMcpProxy(`${baseUrl}/mcp`);
}

import { createJsonMcpIntegration } from "./json-file-agent.js";
import { hasOpencodeServer, mergeOpencodeServer } from "./json-mcp.js";
import { opencodeMcpPath } from "./paths.js";

export const opencodeIntegration = createJsonMcpIntegration({
	id: "opencode",
	label: "opencode",
	configPath: opencodeMcpPath,
	merge: mergeOpencodeServer,
	hasEntry: hasOpencodeServer,
});

import { createJsonMcpIntegration } from "./json-file-agent.js";
import { hasVscodeServer, mergeVscodeServer } from "./json-mcp.js";
import { vscodeMcpPath } from "./paths.js";

export const vscodeIntegration = createJsonMcpIntegration({
	id: "vscode",
	label: "VS Code Copilot",
	configPath: vscodeMcpPath,
	merge: mergeVscodeServer,
	hasEntry: hasVscodeServer,
});

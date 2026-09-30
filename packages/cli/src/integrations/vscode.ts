import { createJsonMcpIntegration } from "./json-file-agent.js";
import { vscodeMcpPath } from "./paths.js";

export const vscodeIntegration = createJsonMcpIntegration({
	id: "vscode",
	label: "VS Code Copilot",
	configPath: vscodeMcpPath,
});

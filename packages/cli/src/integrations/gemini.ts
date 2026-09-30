import { createJsonMcpIntegration } from "./json-file-agent.js";
import { geminiMcpPath } from "./paths.js";

export const geminiIntegration = createJsonMcpIntegration({
	id: "gemini",
	label: "Gemini CLI",
	configPath: geminiMcpPath,
});

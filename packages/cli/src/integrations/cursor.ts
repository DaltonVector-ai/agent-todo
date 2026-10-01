import { createJsonMcpIntegration } from "./json-file-agent.js";
import { cursorMcpPath } from "./paths.js";

export const cursorIntegration = createJsonMcpIntegration({
	id: "cursor",
	label: "Cursor",
	configPath: cursorMcpPath,
});

import { createJsonMcpIntegration } from "./json-file-agent.js";
import { opencodeMcpPath } from "./paths.js";

export const opencodeIntegration = createJsonMcpIntegration({
	id: "opencode",
	label: "opencode",
	configPath: opencodeMcpPath,
});

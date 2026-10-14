export const RELEASE_BASE_URL =
	process.env.AGENT_TODO_RELEASE_BASE_URL ??
	"https://github.com/DaltonVector-ai/agent-todo/releases/latest";

export function runUpgrade(): number {
	console.log(`agent-todo upgrade: re-download the binary from ${RELEASE_BASE_URL}`);
	console.log("  curl -fsSL <install.sh URL> | sh");
	console.log("  or: brew upgrade agent-todo");
	return 0;
}

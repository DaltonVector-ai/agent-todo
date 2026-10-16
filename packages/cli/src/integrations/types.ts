export type DoctorSeverity = "ok" | "warn" | "error";

export type DoctorCheck = {
	agent: string;
	severity: DoctorSeverity;
	message: string;
};

export type AgentIntegration = {
	id: string;
	label: string;
	/** Path where install writes the MCP entry (shown in the install prompt). */
	mcpConfigPath(): string;
	detect(): boolean;
	install(): { changed: boolean; detail: string };
	uninstall(): { changed: boolean; detail: string };
	doctor(): DoctorCheck[];
};

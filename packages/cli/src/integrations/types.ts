export type DoctorSeverity = "ok" | "warn" | "error";

export type DoctorCheck = {
	agent: string;
	severity: DoctorSeverity;
	message: string;
};

export type AgentIntegration = {
	id: string;
	label: string;
	detect(): boolean;
	install(): { changed: boolean; detail: string };
	uninstall(): { changed: boolean; detail: string };
	doctor(): DoctorCheck[];
};

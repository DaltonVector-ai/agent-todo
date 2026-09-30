import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

const registry = new Registry();
collectDefaultMetrics({ register: registry });

export const toolLatencyMs = new Histogram({
	name: "agent_todo_tool_duration_ms",
	help: "MCP tool handler duration in milliseconds",
	labelNames: ["tool"],
	buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500],
	registers: [registry],
});

export const claimContention = new Counter({
	name: "agent_todo_claim_contention_total",
	help: "claimNext returned null while candidates existed (contention proxy)",
	registers: [registry],
});

export const pgPoolWaiting = new Gauge({
	name: "agent_todo_pg_pool_waiting",
	help: "Postgres pool clients waiting",
	registers: [registry],
});

export const notifyLagMs = new Histogram({
	name: "agent_todo_notify_lag_ms",
	help: "Time from NOTIFY emit to LISTEN handler",
	buckets: [1, 5, 10, 25, 50, 100, 250, 500, 1000],
	registers: [registry],
});

export const quotaDenied = new Counter({
	name: "agent_todo_quota_denied_total",
	help: "Quota or rate limit denials",
	labelNames: ["bucket"],
	registers: [registry],
});

export async function metricsText(): Promise<string> {
	return registry.metrics();
}

export function observeTool(tool: string, durationMs: number): void {
	toolLatencyMs.labels(tool).observe(durationMs);
}

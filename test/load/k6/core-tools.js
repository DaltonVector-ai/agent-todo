import { check, sleep } from "k6";
import http from "k6/http";
import { Trend } from "k6/metrics";

const listLatency = new Trend("task_list_latency", true);
const getLatency = new Trend("task_get_latency", true);
const nextLatency = new Trend("task_next_latency", true);
const statusLatency = new Trend("task_status_latency", true);
const commentLatency = new Trend("comment_add_latency", true);

export const options = {
	vus: Number(__ENV.K6_VUS || 50),
	duration: __ENV.K6_DURATION || "30s",
	thresholds: {
		task_list_latency: ["p(95)<100"],
		task_get_latency: ["p(95)<100"],
		task_next_latency: ["p(95)<100"],
		task_status_latency: ["p(95)<100"],
		comment_add_latency: ["p(95)<100"],
	},
};

const baseUrl = __ENV.BASE_URL || "http://127.0.0.1:8080";
const token = __ENV.API_TOKEN;

function mcpCall(tool, args) {
	const payload = JSON.stringify({
		jsonrpc: "2.0",
		id: 1,
		method: "tools/call",
		params: { name: tool, arguments: args },
	});
	const res = http.post(`${baseUrl}/mcp`, payload, {
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
		},
	});
	check(res, { "status 200": (r) => r.status === 200 });
	return res;
}

export default function () {
	const roll = Math.random();
	if (roll < 0.35) {
		const r = mcpCall("task_list", { group: __ENV.GROUP_KEY || "LOAD", limit: 20 });
		listLatency.add(r.timings.duration);
	} else if (roll < 0.55) {
		const id = `${__ENV.GROUP_KEY || "LOAD"}-${(__VU % 100) + 1}`;
		const r = mcpCall("task_get", { id, view: "line" });
		getLatency.add(r.timings.duration);
	} else if (roll < 0.7) {
		const r = mcpCall("task_next", { group: __ENV.GROUP_KEY || "LOAD", claim: false });
		nextLatency.add(r.timings.duration);
	} else if (roll < 0.85) {
		const id = `${__ENV.GROUP_KEY || "LOAD"}-${(__VU % 100) + 1}`;
		const r = mcpCall("task_status", { id, to: "open" });
		statusLatency.add(r.timings.duration);
	} else {
		const id = `${__ENV.GROUP_KEY || "LOAD"}-${(__VU % 100) + 1}`;
		const r = mcpCall("comment_add", {
			task: id,
			kind: "note",
			body: `k6 note ${__ITER}`,
		});
		commentLatency.add(r.timings.duration);
	}
	sleep(0.01);
}

import { env } from "cloudflare:workers";
import { shouldRun } from "./schedule.ts";

async function dispatch(): Promise<Response> {
	return fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`, {
		method: "POST",
		headers: {
			Accept: "application/vnd.github+json",
			Authorization: `Bearer ${env.GITHUB_TOKEN}`,
			"X-GitHub-Api-Version": "2022-11-28",
			"User-Agent": "humquote-update-trigger",
		},
		body: JSON.stringify({ ref: "main" }),
	});
}

export default {
	async scheduled(controller) {
		const { run, day, time } = shouldRun(new Date(controller.scheduledTime));
		if (!run) return;
		const res = await dispatch();
		if (res.status !== 204) {
			// Throwing marks the invocation as failed in the Worker's logs.
			throw new Error(`GitHub dispatch failed (${day} ${time} Sydney): ${res.status} ${await res.text()}`);
		}
		console.log(`Started ${env.WORKFLOW} (${day} ${time} Sydney)`);
	},

	fetch() {
		return new Response("Not found", { status: 404 });
	},
} satisfies ExportedHandler;

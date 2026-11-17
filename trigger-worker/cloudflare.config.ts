import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Starts the "Update ASX Futures Data" GitHub workflow at set Sydney times, because
// GitHub's own schedule starts runs hours late and sometimes not at all.
// The cron fires hourly (UTC); src/index.ts picks the Sydney times, so daylight
// saving needs no change here.
export default defineConfig({
	worker: {
		name: "humquote-update-trigger",
		compatibilityDate: "2026-11-13",
		entrypoint,
		env: {
			REPO: bindings.text("eliasft/humquote"),
			WORKFLOW: bindings.text("update-futures-data.yml"),
			// Fine-grained GitHub token: this repository only, "Actions: read and write".
			GITHUB_TOKEN: bindings.secret(),
		},
		triggers: [triggers.scheduled({ schedule: "45 * * * *" })],
		// Cron only: no public workers.dev address or preview URLs.
		workersDev: false,
		previewUrls: false,
	},
});

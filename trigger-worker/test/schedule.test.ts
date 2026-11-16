// node --test test/schedule.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldRun } from "../src/schedule.ts";

// Every hourly :45 cron (UTC) in a week, the Sydney times it starts the update.
function week(fromUtc: string): string[] {
	const out: string[] = [];
	const start = new Date(fromUtc).getTime();
	for (let h = 0; h < 24 * 7; h++) {
		const r = shouldRun(new Date(start + h * 3600_000));
		if (r.run) out.push(`${r.day} ${r.time}`);
	}
	return out;
}

const EXPECTED = [
	"Mon 16:45", "Mon 18:45",
	"Tue 09:45", "Tue 16:45", "Tue 18:45",
	"Wed 09:45", "Wed 16:45", "Wed 18:45",
	"Thu 09:45", "Thu 16:45", "Thu 18:45",
	"Fri 09:45", "Fri 16:45", "Fri 18:45",
	"Sat 09:45",
];

test("summer (AEDT, UTC+11): 15 runs a week at the Sydney times", () => {
	assert.deepEqual(week("2026-11-15T13:45:00Z"), EXPECTED); // from Mon 00:45 AEDT
});

test("winter (AEST, UTC+10): same Sydney times", () => {
	assert.deepEqual(week("2027-06-13T14:45:00Z"), EXPECTED); // from Mon 00:45 AEST
});

test("4:45 pm Sydney is 05:45 UTC in summer and 06:45 UTC in winter", () => {
	assert.equal(shouldRun(new Date("2026-11-17T05:45:00Z")).run, true);
	assert.equal(shouldRun(new Date("2027-06-15T06:45:00Z")).run, true);
	assert.equal(shouldRun(new Date("2027-06-15T05:45:00Z")).run, false);
});

test("a cron that fires a few minutes late still matches", () => {
	assert.equal(shouldRun(new Date("2026-11-17T05:51:30Z")).run, true);
});

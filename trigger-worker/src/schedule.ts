// Sydney times (24 h, hour:minute of the hourly :45 cron) to start the update, by
// weekday. ASX publishes each day's settlement at about 4:20 pm, so 4:45 pm gets it
// first and 6:45 pm is a backup; 9:45 am the next day is a last backup, well after
// the page's blank pre-open spell (around 8 am). update_db.py dates prices by the
// ASX calendar, so a run on a public holiday or a Saturday morning is harmless.
export const SCHEDULE: Record<string, string[]> = {
	Mon: ["16:45", "18:45"],
	Tue: ["09:45", "16:45", "18:45"],
	Wed: ["09:45", "16:45", "18:45"],
	Thu: ["09:45", "16:45", "18:45"],
	Fri: ["09:45", "16:45", "18:45"],
	Sat: ["09:45"],
};

export function sydneyNow(at: Date): { day: string; time: string } {
	const parts = new Intl.DateTimeFormat("en-AU", {
		timeZone: "Australia/Sydney",
		weekday: "short",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(at);
	const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
	// Round the minute down to the quarter hour, so a cron that fires a little late still matches.
	const minute = String(Math.floor(Number(get("minute")) / 15) * 15).padStart(2, "0");
	return { day: get("weekday"), time: `${get("hour")}:${minute}` };
}

export function shouldRun(at: Date): { run: boolean; day: string; time: string } {
	const { day, time } = sydneyNow(at);
	return { run: SCHEDULE[day]?.includes(time) ?? false, day, time };
}

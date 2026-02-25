import { formatInTimeZone } from "date-fns-tz";

const TIMESTAMP_FORMAT = "yyyy-MMM-dd hh:mm:ss a";
const TIMEZONE = "Australia/Sydney";

export function formatSydneyTime(date: Date): string {
	return formatInTimeZone(date, TIMEZONE, TIMESTAMP_FORMAT);
}

export function log(...args: unknown[]): void {
	console.log(`[${formatSydneyTime(new Date())}]`, ...args);
}

export function logError(...args: unknown[]): void {
	console.error(`[${formatSydneyTime(new Date())}]`, ...args);
}

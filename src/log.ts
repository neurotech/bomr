import { format } from "date-fns";

const TIMESTAMP_FORMAT = "yyyy-MMM-dd hh:mm:ss a";

export function log(...args: unknown[]): void {
	console.log(`[${format(new Date(), TIMESTAMP_FORMAT)}]`, ...args);
}

export function logError(...args: unknown[]): void {
	console.error(`[${format(new Date(), TIMESTAMP_FORMAT)}]`, ...args);
}

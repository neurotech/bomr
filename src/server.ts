import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";
import { CronJob } from "cron";
import { downloadAndCreateGif, type RadarRange } from "./index";
import { log, logError } from "./log";

const PORT = 7777;
const RADAR_RANGE: RadarRange = "512km";
const FRAME_DELAY = 350;
const CRON_SCHEDULE = "0 0-2,6-23 * * *"; // Every hour on the hour, 6AM-2AM
const DOWNLOADS_DIR = "./downloads";
const GIF_FILENAME = "radar.gif";
const MAX_GIF_AGE_MS = 60 * 60 * 1000; // 1 hour

interface ServerState {
	lastGeneration: Date | null;
	nextGeneration: Date | null;
	isGenerating: boolean;
	generationError: string | null;
}

const state: ServerState = {
	lastGeneration: null,
	nextGeneration: null,
	isGenerating: false,
	generationError: null,
};

async function generateRadarGif(): Promise<void> {
	if (state.isGenerating) {
		log("Generation already in progress, skipping...");
		return;
	}

	state.isGenerating = true;
	state.generationError = null;
	log("Starting radar GIF generation...");

	try {
		await downloadAndCreateGif(RADAR_RANGE, FRAME_DELAY);
		state.lastGeneration = new Date();
		log("Radar GIF generation complete");
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		state.generationError = errorMessage;
		logError(`Generation failed: ${errorMessage}`);
	} finally {
		state.isGenerating = false;
	}
}

function getGifPath(): string {
	return path.join(DOWNLOADS_DIR, GIF_FILENAME);
}

function isGifFresh(): boolean {
	const gifPath = getGifPath();
	if (!fs.existsSync(gifPath)) {
		return false;
	}

	const stats = fs.statSync(gifPath);
	const age = Date.now() - stats.mtimeMs;
	return age < MAX_GIF_AGE_MS;
}

function handleRequest(
	req: http.IncomingMessage,
	res: http.ServerResponse,
): void {
	const url = req.url || "/";
	const method = req.method || "GET";

	log(`${method} ${url}`);

	// Health check endpoint
	if (url === "/health" && method === "GET") {
		const gifPath = getGifPath();
		const gifExists = fs.existsSync(gifPath);

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				status: "ok",
				gifAvailable: gifExists,
				isGenerating: state.isGenerating,
			}),
		);
		return;
	}

	// Status endpoint
	if (url === "/status" && method === "GET") {
		const gifPath = getGifPath();
		const gifExists = fs.existsSync(gifPath);
		let gifAge: number | null = null;

		if (gifExists) {
			const stats = fs.statSync(gifPath);
			gifAge = Math.round((Date.now() - stats.mtimeMs) / 1000);
		}

		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				status: "ok",
				radarRange: RADAR_RANGE,
				frameDelay: FRAME_DELAY,
				gifAvailable: gifExists,
				gifAgeSeconds: gifAge,
				lastGeneration: state.lastGeneration?.toISOString() || null,
				nextGeneration: state.nextGeneration?.toISOString() || null,
				isGenerating: state.isGenerating,
				generationError: state.generationError,
			}),
		);
		return;
	}

	// Refresh endpoint (POST only)
	if (url === "/refresh" && method === "POST") {
		if (state.isGenerating) {
			res.writeHead(409, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "error",
					message: "Generation already in progress",
				}),
			);
			return;
		}

		// Trigger generation asynchronously
		generateRadarGif().catch(logError);

		res.writeHead(202, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				status: "accepted",
				message: "Radar GIF regeneration started",
			}),
		);
		return;
	}

	// Serve GIF at / or /radar.gif
	if ((url === "/" || url === "/radar.gif") && method === "GET") {
		const gifPath = getGifPath();

		if (!fs.existsSync(gifPath)) {
			res.writeHead(503, { "Content-Type": "application/json" });
			res.end(
				JSON.stringify({
					status: "error",
					message: "Radar GIF not yet available",
					isGenerating: state.isGenerating,
				}),
			);
			return;
		}

		const stats = fs.statSync(gifPath);
		const gifBuffer = fs.readFileSync(gifPath);

		res.writeHead(200, {
			"Content-Type": "image/gif",
			"Content-Length": stats.size,
			"Cache-Control": "public, max-age=300",
			"Last-Modified": stats.mtime.toUTCString(),
		});
		res.end(gifBuffer);
		return;
	}

	// 404 for everything else
	res.writeHead(404, { "Content-Type": "application/json" });
	res.end(
		JSON.stringify({
			status: "error",
			message: "Not found",
		}),
	);
}

async function main(): Promise<void> {
	log("BOM Radar Service starting...");
	log(`  Port: ${PORT}`);
	log(`  Radar range: ${RADAR_RANGE}`);
	log(`  Frame delay: ${FRAME_DELAY}ms`);
	log(`  Schedule: ${CRON_SCHEDULE}`);

	// Check if GIF needs to be generated on startup
	if (!isGifFresh()) {
		log("GIF is stale or missing, generating on startup...");
		await generateRadarGif();
	} else {
		log("GIF is fresh, skipping initial generation");
		const stats = fs.statSync(getGifPath());
		state.lastGeneration = stats.mtime;
	}

	// Set up cron job for hourly updates
	const cronJob = new CronJob(
		CRON_SCHEDULE,
		() => {
			generateRadarGif().catch(logError);
		},
		null,
		true,
		"Australia/Sydney",
	);

	// Update next generation time
	state.nextGeneration = cronJob.nextDate().toJSDate();
	log(`Next scheduled generation: ${state.nextGeneration.toISOString()}`);

	// Start HTTP server
	const server = http.createServer(handleRequest);

	server.listen(PORT, () => {
		log(`Server listening on http://localhost:${PORT}`);
		log("Endpoints:");
		log("  GET  /           - Serve radar GIF");
		log("  GET  /radar.gif  - Serve radar GIF (alias)");
		log("  GET  /health     - Health check");
		log("  GET  /status     - Detailed status");
		log("  POST /refresh    - Trigger regeneration");
	});

	// Handle shutdown gracefully
	const shutdown = (): void => {
		log("\nShutting down...");
		cronJob.stop();
		server.close(() => {
			log("Server closed");
			process.exit(0);
		});
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((error) => {
	logError("Fatal error:", error);
	process.exit(1);
});

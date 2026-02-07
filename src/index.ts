import * as fs from "node:fs";
import * as path from "node:path";
import * as ftp from "basic-ftp";
import sharp from "sharp";

const BOM_FTP_HOST = "ftp.bom.gov.au";
const RADAR_PATH = "/anon/gen/radar";
const TRANSPARENCIES_PATH = "/anon/gen/radar_transparencies";
const DOWNLOADS_DIR = "./downloads";
const BACKGROUNDS_DIR = "./downloads/backgrounds";

export type RadarRange = "512km" | "256km" | "128km" | "64km";

const TERREY_HILLS_IDS: Record<RadarRange, string> = {
	"512km": "IDR711",
	"256km": "IDR712",
	"128km": "IDR713",
	"64km": "IDR714",
};

const BACKGROUND_LAYERS = [
	"background.png",
	"topography.png",
	"locations.png",
	"range.png",
];

async function withFtpClient<T>(
	fn: (client: ftp.Client) => Promise<T>,
): Promise<T> {
	const client = new ftp.Client();
	try {
		await client.access({ host: BOM_FTP_HOST, secure: false });
		console.log(`Connected to ${BOM_FTP_HOST}`);
		return await fn(client);
	} finally {
		client.close();
		console.log("Disconnected from FTP server");
	}
}

async function downloadBackgrounds(
	client: ftp.Client,
	stationId: string,
): Promise<void> {
	if (!fs.existsSync(BACKGROUNDS_DIR)) {
		fs.mkdirSync(BACKGROUNDS_DIR, { recursive: true });
	}

	for (const layer of BACKGROUND_LAYERS) {
		const fileName = `${stationId}.${layer}`;
		const localPath = path.join(BACKGROUNDS_DIR, fileName);

		if (!fs.existsSync(localPath)) {
			const remotePath = `${TRANSPARENCIES_PATH}/${fileName}`;
			await client.downloadTo(localPath, remotePath);
			console.log(`Downloaded background: ${fileName}`);
		}
	}
}

async function downloadRadarFrames(
	client: ftp.Client,
	stationId: string,
): Promise<void> {
	if (!fs.existsSync(DOWNLOADS_DIR)) {
		fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
	}

	const files = await client.list(RADAR_PATH);

	const pngFiles = files.filter(
		(f) =>
			f.type === ftp.FileType.File &&
			f.name.startsWith(stationId) &&
			f.name.endsWith(".png") &&
			!f.name.endsWith(".tmp"),
	);

	console.log(`Found ${pngFiles.length} radar frames`);

	for (const file of pngFiles) {
		const remotePath = `${RADAR_PATH}/${file.name}`;
		const localPath = path.join(DOWNLOADS_DIR, file.name);
		await client.downloadTo(localPath, remotePath);
		console.log(`Downloaded: ${file.name}`);
	}
}

async function compositeFrame(
	radarFramePath: string,
	stationId: string,
): Promise<Buffer> {
	const layer = (name: string) =>
		path.join(BACKGROUNDS_DIR, `${stationId}.${name}.png`);

	return sharp(layer("background"))
		.composite([
			{ input: layer("topography"), blend: "over" },
			{ input: radarFramePath, blend: "over" },
			{ input: layer("locations"), blend: "over" },
			{ input: layer("range"), blend: "over" },
		])
		.png()
		.toBuffer();
}

async function createGif(
	stationId: string,
	delay: number,
	outputName: string,
): Promise<string | null> {
	const backgroundPath = path.join(
		BACKGROUNDS_DIR,
		`${stationId}.background.png`,
	);

	const files = fs
		.readdirSync(DOWNLOADS_DIR)
		.filter((f) => f.startsWith(stationId) && f.match(/\.T\.\d+\.png$/))
		.sort();

	if (files.length === 0) {
		console.log("No radar images found");
		return null;
	}

	console.log(`Creating GIF from ${files.length} frames...`);

	const bgMetadata = await sharp(backgroundPath).metadata();
	if (!bgMetadata.width || !bgMetadata.height) {
		throw new Error("Could not read background image dimensions");
	}
	const { width, height } = bgMetadata;

	console.log("Compositing frames...");
	const compositedFrames: Buffer[] = [];
	for (const file of files) {
		const radarPath = path.join(DOWNLOADS_DIR, file);
		const frame = await compositeFrame(radarPath, stationId);
		compositedFrames.push(frame);
	}

	const rawFrames = await Promise.all(
		compositedFrames.map((frame) =>
			sharp(frame).ensureAlpha().raw().toBuffer(),
		),
	);

	const outputPath = path.join(DOWNLOADS_DIR, outputName);

	await sharp(Buffer.concat(rawFrames), {
		raw: {
			width,
			height: height * files.length,
			channels: 4,
			pages: files.length,
			pageHeight: height,
		} as sharp.CreateRaw,
	})
		.gif({ delay: Array(files.length).fill(delay), loop: 0 })
		.toFile(outputPath);

	console.log(`Created: ${outputPath}`);
	return outputPath;
}

export async function downloadAndCreateGif(
	range: RadarRange,
	delay = 500,
	outputName = "radar.gif",
): Promise<string | null> {
	const stationId = TERREY_HILLS_IDS[range];

	await withFtpClient(async (client) => {
		await downloadBackgrounds(client, stationId);
		await downloadRadarFrames(client, stationId);
	});

	return createGif(stationId, delay, outputName);
}

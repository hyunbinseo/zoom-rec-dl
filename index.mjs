import { createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'path';
import { fileURLToPath } from 'url';
import settings from './settings.json' assert { type: 'json' };
import urls from './urls.json' assert { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const regex = {
	// Reference Zoom Vanity URL https://support.zoom.us/hc/en-us/articles/215062646
	zoomShare: /^https:\/\/(?:([a-z][a-z\-]{2,}[a-z])\.)?(zoom.us|zoomgov.com)\/rec\/share\/([^?\s]+)\?pwd=([^?\s]+)$/,
	zoomVideo: /https:\/\/ssrweb\..+\/(.+)\.mp4[^'"]+/g,
	setCookie: /([^,= ]+=[^,;]+);? *(?:[^,= ]+(?:=(?:Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g
};

// Setting Validation

const { download } = settings;

if (typeof download.folder !== 'string' || !/^[a-z]+$/.test(download.folder))
	throw new Error(`Download folder is not valid. (${download.folder})`);

const downloadFolder = `${__dirname}/${download.folder}`;

// Runtime Validation

if (typeof (fetch) === 'undefined')
	throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

// Zoom URL Validation

if (!(Array.isArray(urls) && urls.length))
	throw new Error('Zoom URL is not found.');

for (const url of urls) {
	if (typeof url !== 'string' || !regex.zoomShare.test(url) || url === 'https://zoom.us/rec/share/unique-id?pwd=password')
		throw new Error(`Zoom URL is not valid. (${url})`);
};

// Download Video Files

for await (const url of urls) {
	const headers = new Headers({
		// Chrome 106 on Windows 11
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
	});

	// Redirect response with Set-Cookie header
	const initialResponse = await fetch(url, { headers });

	if (!initialResponse.ok || !initialResponse.redirected || !initialResponse.headers.has('set-cookie'))
		throw new Error(`Initial fetch has failed. (${url})`);

	// Node.js Fetch API merges Set-Cookie headers into a single string
	const setCookieString = initialResponse.headers.get('set-cookie') || '';
	const cookieString = [...setCookieString.matchAll(regex.setCookie)]
		.map(([, nameValue]) => (nameValue))
		.join('; ');

	headers.append('Cookie', cookieString);

	// Re-request the video download page with authentication cookie (_zm_ssid)
	// Returns different response based on the User-Agent (e.g. global data)
	const downloadPageResponse = await fetch(url, { headers });

	if (!downloadPageResponse.ok)
		throw new Error(`Download page fetch has failed. (${url})`);

	const downloadPageHtml = await downloadPageResponse.text();
	const videoUrlMatches = [...downloadPageHtml.matchAll(regex.zoomVideo)]
		.map(([url, filename]) => ({ url, filename }));

	if (!videoUrlMatches.length)
		throw new Error(`Video URL is not found. (${url})`);

	headers.append('Referer', 'https://zoom.us/');

	console.log(`Downloading video file(s). (${url})`);

	for await (const { url, filename } of videoUrlMatches) {
		const response = await fetch(url, { headers });

		if (!response.ok)
			throw new Error(`Video file fetch has failed. (${filename})`);

		if (!existsSync(downloadFolder)) mkdirSync(downloadFolder);

		const temporaryFilename = Date.now().toString();

		const writeStream = createWriteStream(`${downloadFolder}/${temporaryFilename}.part`);

		// @ts-ignore
		const readable = Readable.fromWeb(response.body);

		readable.pipe(writeStream);

		await new Promise((resolve, reject) => {
			readable.on('end', () => {
				renameSync(`${downloadFolder}/${temporaryFilename}.part`, `${downloadFolder}/${filename}.mp4`);
				console.log(`Successfully downloaded file. (${filename})`);
				resolve();
			});
			readable.on('error', (error) => {
				console.log(`Failed to download file. (${filename})`);
				reject(error);
			});
		});
	};

	console.log(`Downloaded video file(s). (${url})`);
};

console.log('Download completed.');

import { createWriteStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'path';
import { fileURLToPath } from 'url';
import information from './package.json' assert { type: 'json' };
import settings from './settings.json' assert { type: 'json' };
import urls from './urls.json' assert { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const regex = {
	// Reference Zoom Vanity URL https://support.zoom.us/hc/en-us/articles/215062646
	zoomSample: /^https:\/\/zoom.us\/rec\/share\/something-unique-[1-9]\?pwd=something-strong-[1-9]$/,
	zoomShare: /^https:\/\/(?:([a-z][a-z\-]{2,}[a-z])\.)?(zoom.us|zoomgov.com)\/rec\/share\/([^?\s]+)\?pwd=([^?\s]+)$/,
	zoomVideo: /https:\/\/ssrweb\..+\/(.+)\.mp4[^'"]+/g,
	zoomTopic: /topic: "(.+)",/,
	setCookie: /([^,= ]+=[^,;]+);? *(?:[^,= ]+(?:=(?:Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g
};

// Runtime Validation

if (typeof (fetch) === 'undefined') throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

// Setting Validation

const { download_folder } = settings;

if (typeof download_folder !== 'string') throw new Error('Download folder should be a string.');
if (!/^[a-z]+$/.test(download_folder)) throw new Error(`Download folder is not valid. (${download_folder})`);

const downloadFolder = `${__dirname}/${download_folder}`;

// Zoom URL Validation

if (!Array.isArray(urls)) throw new Error('The urls.json file should be an array.');
if (!urls.length) throw new Error('Zoom URLs are not found.');

for (const url of urls) {
	if (typeof url !== 'string') throw new Error('Zoom URL should be a string.');
	if (!regex.zoomShare.test(url)) throw new Error(`Zoom URL is not valid. (${url})`);
	if (regex.zoomSample.test(url)) throw new Error('Sample Zoom URL is found. Remove if from the urls.json file.');
};

// Download Video Files

const failedShareUrls = [];
const failedVideoUrls = [];

for await (const url of urls) {
	const id = (url.match(regex.zoomShare) || [])[3] || '';

	console.log();
	console.log(new Date().toISOString());
	if (id) console.log(id);

	const headers = new Headers({
		// Chrome 106 on Windows 11
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
	});

	const initialResponse = await fetch(url, { headers });

	// Redirect response with a Set-Cookie header expected
	if (!initialResponse.ok || !initialResponse.redirected) {
		console.error('Initial fetch has failed. Skipping.');
		failedShareUrls.push(url);
		continue;
	};

	const setCookieString = initialResponse.headers.get('set-cookie');

	// Node.js Fetch API merges Set-Cookie headers into a single string
	// This behavior can change, since Fetch API is an experimental feature.
	// (node:6532) ExperimentalWarning: The Fetch API is an experimental feature. This feature could change at any time
	if (typeof setCookieString !== 'string') throw new Error(`Set-Cookie is not a string. Please leave an issue in ${information.bugs.url}`);

	const cookieString = [...setCookieString.matchAll(regex.setCookie)]
		.map(([, nameValue]) => (nameValue))
		.join('; ');

	headers.append('Cookie', cookieString);

	// Re-request the video download page with authentication cookie (_zm_ssid)
	// Returns different response based on the User-Agent (e.g. global data)
	const downloadPageResponse = await fetch(url, { headers });

	if (!downloadPageResponse.ok) {
		console.error('Download page fetch has failed. Skipping.');
		failedShareUrls.push(url);
		continue;
	};

	const downloadPageHtml = await downloadPageResponse.text();
	const videoUrlMatches = [...downloadPageHtml.matchAll(regex.zoomVideo)]
		.map(([url, filename]) => ({ url, filename }));

	if (!videoUrlMatches.length) {
		console.error('Video URL is not found. Skipping.');
		failedShareUrls.push(url);
		continue;
	};

	const meetingTopic = ((downloadPageHtml.match(regex.zoomTopic) || [])[1] || '').trim();

	// Required to prevent 403 Forbidden error
	headers.append('Referer', 'https://zoom.us/');

	for await (const { url, filename } of videoUrlMatches) {
		console.log();
		console.log(`Downloading ${filename}`);

		const response = await fetch(url, { headers });

		if (!response.ok) {
			console.error('Video fetch has failed. Skipping.');
			failedVideoUrls.push(url);
			continue;
		};

		if (!existsSync(downloadFolder)) mkdirSync(downloadFolder);

		const temporaryFilename = `${Date.now()}.part`;

		const writeStream = createWriteStream(`${downloadFolder}/${temporaryFilename}`);

		// @ts-ignore Reference https://stackoverflow.com/a/66629140/12817553
		const readable = Readable.fromWeb(response.body);

		readable.pipe(writeStream);

		const customFilename = (meetingTopic
			? `[${meetingTopic}] ${filename}`
			: filename
		).replaceAll(/[<>:"/\\|?*]/g, '_') + '.mp4';

		await new Promise((resolve) => {
			readable.on('end', () => {
				renameSync(`${downloadFolder}/${temporaryFilename}`, `${downloadFolder}/${customFilename}`);
				console.log(`Saved as ${customFilename}`);
				resolve();
			});
			readable.on('error', () => {
				console.error(`Download has failed.`);
				failedVideoUrls.push(url);
				resolve();
			});
		});
	};

	console.log();
};

console.log();
console.log(new Date().toISOString());
console.log('All downloads are completed.');

if (failedShareUrls.length || failedVideoUrls.length) {
	const filename = `${Date.now()}.txt`;
	const log = [
		`Failed Zoom Share URL (${failedShareUrls.length})`,
		...failedShareUrls,
		'',
		`Failed Zoom Video URL (${failedVideoUrls.length})`,
		...failedVideoUrls
	].join('\n');
	writeFileSync(`${__dirname}/${filename}`, log);
	console.error(`Failed attempts found. Check ${filename} for more information.`);
};

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
	// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
	// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
	zoomShare: /^https:\/\/(?:[a-z][a-z\-]{1,}[a-z]\.)?(?:zoom.us|zoomgov.com)\/rec\/share\/([^?\s]+)(?:\?pwd=[^?\s]+)?$/,
	zoomVideo: /https:\/\/ssrweb\..+\/(.+)\.mp4[^'"]+/g,
	zoomTopic: /topic: "(.+)",/,
	setCookie: /([^,= ]+=[^,;]+);? *(?:[^,= ]+(?:=(?:Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g
};

const styles = {
	underscore: '\x1b[4m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m'
};

/**
 * @param {keyof typeof styles} style 
 * @param {string | number} text 
 */
const styleText = (style, text) => (`${styles[style]}${text}\x1b[0m`);

/**
 * @param {'' | '├─' | '└─'} type
 * @param {string} message
 */
const message = (type, message) => (`${styleText('cyan', new Date().toISOString())}  ${type ? `${type} ${message}` : message}`);

// Runtime Validation

if (typeof (fetch) === 'undefined') throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

// Setting Validation

const {
	download_folder,
	filename_meeting_topic,
	filename_unix_timestamp
} = settings;

if (typeof download_folder !== 'string') throw new Error('download_folder should be a string.');
if (!/^[a-z]+$/.test(download_folder)) throw new Error(`download_folder is not valid. (${download_folder})`);

const downloadFolder = `${__dirname}/${download_folder}`;

if (typeof filename_meeting_topic !== 'boolean') throw new Error('filename_meeting_topic should be a boolean');
if (typeof filename_unix_timestamp !== 'boolean') throw new Error('filename_unix_timestamp should be a boolean');

// Zoom URL Validation

if (!Array.isArray(urls)) throw new Error('The urls.json file should be an array.');
if (!urls.length) throw new Error('Zoom URLs are not found.');

for (const url of urls) {
	if (typeof url !== 'string') throw new Error('Zoom URL should be a string.');
	if (!regex.zoomShare.test(url)) throw new Error(`Zoom URL is not valid. (${url})`);
	if (url.includes('something-unique-and-very-long-can-include-symbols-such-as-period-dash-underscore'))
		throw new Error('Sample Zoom URL is found. Remove it from the urls.json file.');
};

// Download Video Files

const failedShareUrls = [];
const failedVideoUrls = [];

for await (const url of urls) {
	const [, id] = (url.match(regex.zoomShare) || []);

	console.log();
	console.log(message('', `Processing ${styleText('magenta', id)}`));

	const headers = new Headers({
		// Chrome 106 on Windows 11
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
	});

	const initialResponse = await fetch(url, { headers });

	// Redirect response with a Set-Cookie header expected
	if (!initialResponse.ok || !initialResponse.redirected) {
		console.error(message('└─', styleText('red', 'Initial fetch has failed.')));
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
		console.error(message('└─', styleText('red', 'Download page fetch has failed.')));
		failedShareUrls.push(url);
		continue;
	};

	const downloadPageHtml = await downloadPageResponse.text();
	const videoUrlMatches = [...downloadPageHtml.matchAll(regex.zoomVideo)]
		.map(([url, filename]) => ({ url, filename }));

	if (!videoUrlMatches.length) {
		console.error(message('└─', styleText('red', 'Video URL is not found.')));
		failedShareUrls.push(url);
		continue;
	};

	const meetingTopic = ((downloadPageHtml.match(regex.zoomTopic) || [])[1] || '').trim();

	// Required to prevent 403 Forbidden error
	headers.append('Referer', 'https://zoom.us/');

	for await (const { url, filename } of videoUrlMatches) {
		console.log(message('├─', `Downloading ${styleText('yellow', filename)}`));

		const response = await fetch(url, { headers });

		if (!response.ok) {
			console.error(message('├─', styleText('red', 'Video fetch has failed. Skipping.')));
			failedVideoUrls.push(url);
			continue;
		};

		if (!existsSync(downloadFolder)) mkdirSync(downloadFolder);

		const temporaryFilename = `${Date.now()}.part`;

		const writeStream = createWriteStream(`${downloadFolder}/${temporaryFilename}`);

		// @ts-ignore Reference https://stackoverflow.com/a/66629140/12817553
		const readable = Readable.fromWeb(response.body);

		readable.pipe(writeStream);

		const customFilename = [
			filename_meeting_topic ? meetingTopic : '',
			filename,
			filename_unix_timestamp ? `@${Date.now()}`.slice(0, -3) : ''
		]
			.filter((value) => (value))
			.join(' ')
			.replaceAll(/[<>:"/\\|?*]/g, '_')
			.concat('.mp4');

		await new Promise((resolve) => {
			readable.on('end', () => {
				renameSync(`${downloadFolder}/${temporaryFilename}`, `${downloadFolder}/${customFilename}`);
				console.log(message('├─', `Saved as ${styleText('underscore', customFilename)}`));
				resolve();
			});
			readable.on('error', () => {
				console.error(message('├─', styleText('red', 'Download has failed. Skipping.')));
				failedVideoUrls.push(url);
				resolve();
			});
		});
	};

	console.log(message('└─', 'Completed.'));
};

console.log();
console.log(message('', 'All downloads are completed.'));

if (failedShareUrls.length || failedVideoUrls.length) {
	const count = failedShareUrls.length + failedVideoUrls.length;
	const log = [
		`Failed Zoom Share URL (${failedShareUrls.length}) - Check if the URL is password protected`,
		...failedShareUrls,
		'',
		`Failed Zoom Video URL (${failedVideoUrls.length})`,
		...failedVideoUrls
	].join('\n');
	const filename = `${Date.now()}.txt`;
	writeFileSync(`${__dirname}/${filename}`, log);
	console.log(message('├─', `There are ${styleText('red', count)} failed attempts.`));
	console.log(message('└─', `Check ${styleText('underscore', filename)} for more information.`));
};

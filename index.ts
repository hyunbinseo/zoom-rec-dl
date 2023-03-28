#!/usr/bin/env node

import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import puppeteer, { type Browser } from 'puppeteer';

const regex = {
	httpSetCookieHeader:
		/([^,= ]+)=([^,;]+);? *(?:[^,= ]+(?:=(?:Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g,
	// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
	// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
	zoomRecordingShareUrl:
		/^https:\/\/(?:(?:[a-z][a-z\-]{1,}[a-z]|us[0-9]{2}web)\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/([^?\s]+)(?:\?pwd=[^?\s]+)?$/,
	zoomTotalClips: /(?<=totalClips: )\d+(?=,)/,
	zoomCookieTs: /^TS.{8}$/,
	zoomCurrentClip: /(?<=currentClip: )\d+(?=,)/,
	zoomNextClipStartTime: /(?<=nextClipStartTime: )-?\d+(?=,)/,
	zoomMeetingTopic: /topic: "(.+)",/,
	zoomMediaUrl: /https:\/\/ssrweb\.[^'"]+\/((?:[^'"]+)\.(?:mp4|m4a))[^'"]+/g,
} satisfies Record<string, RegExp>;

const ansiEscapeCodes = {
	underscore: '\x1b[4m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
} satisfies Record<string, `\x1b[${number}m`>;

type AnsiEscapeCode = keyof typeof ansiEscapeCodes;

const styleText = (style: AnsiEscapeCode, text: string | number) =>
	`${ansiEscapeCodes[style]}${text}\x1b[0m`;

const generateColoredTimestamp = () =>
	styleText('cyan', new Date().toISOString());

const log = (
	prefix: '' | '├─' | '└─',
	message: string,
	type: 'log' | 'error' = 'log'
) => {
	const prefixedMessage = (prefix && `${prefix} `) + message;
	const formattedMessage = `${generateColoredTimestamp()} ${prefixedMessage}`;
	console[type](formattedMessage);
};

const safeName = (name: string) =>
	name
		.replaceAll(' / ', ', ')
		.replaceAll(': ', ' - ')
		.replaceAll(/[<>:"/\\|?*]/g, '-');

// Validation

if (typeof fetch === 'undefined')
	throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

if (!existsSync('./urls.txt')) throw new Error('urls.txt file is not found.');

// Download Media Files

const failedRecordingShareUrls = [];
const failedMediaUrls = [];

const downloadDirectory = `./${safeName(new Date().toISOString())}`;
if (!existsSync(downloadDirectory)) mkdirSync(downloadDirectory);

const recodingShareUrls = readFileSync('./urls.txt', { encoding: 'utf-8' })
	.split(/\r?\n/)
	.filter((v) => v);

log('', `Found ${recodingShareUrls.length} URLs.`);

let browser: Browser | undefined;

for await (const url of recodingShareUrls) {
	console.log();

	const match = url.match(regex.zoomRecordingShareUrl);

	if (match === null) {
		log('', styleText('red', 'Zoom record sharing URL is not valid.'), 'error');
		continue;
	}

	log('', `Processing ${styleText('magenta', match[1])}`);

	const cookieMap = new Map<string, string>();

	const removeTsCookie = () => {
		for (const existingKey of cookieMap.keys()) {
			if (existingKey.match(regex.zoomCookieTs)) cookieMap.delete(existingKey);
		}
	};

	const updateCookie = (response: Response) => {
		const matches = response.headers
			.get('set-cookie')
			?.matchAll(regex.httpSetCookieHeader);

		for (const [, key, value] of matches || []) {
			if (key.match(regex.zoomCookieTs)) removeTsCookie();
			cookieMap.set(key, value);
		}
	};

	const createHeaders = (data: Record<string, string> = {}) =>
		new Headers({
			'Accept':
				'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
			'Cookie': [...cookieMap]
				.map(([key, value]) => `${key}=${value}`)
				.join('; '),
			'Referer': 'https://zoom.us/', // Required to prevent 403 Forbidden error
			'User-Agent':
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36', // Chrome 111 on macOS
		});

	let response = await fetch(url, { headers: createHeaders() });

	if (!response.ok) {
		log('└─', styleText('red', 'Initial page fetch has failed.'), 'error');
		failedRecordingShareUrls.push(url);
		continue;
	}

	updateCookie(response);

	if (response.redirected) {
		// Re-request the media download page with authentication cookie (_zm_ssid)
		// Returns different response based on the User-Agent (e.g. global data)
		const redirectedPageResponse = await fetch(url, {
			headers: createHeaders(),
		});

		if (!redirectedPageResponse.ok) {
			log('└─', styleText('red', 'Redirected page fetch has failed.'), 'error');
			failedRecordingShareUrls.push(url);
			continue;
		}

		response = redirectedPageResponse;
	}

	const initialPage = await response.text();

	const totalClipCount =
		Number(initialPage.match(regex.zoomTotalClips)?.[0]) || 1;

	const meetingTopic = (
		initialPage.match(regex.zoomMeetingTopic)?.[1] || 'topic-not-found'
	).trim();

	let nextClipStartTime = -1;

	for (let i = 1; i < totalClipCount + 1; i++) {
		log('├─', `Downloading part ${i}/${totalClipCount}`);

		let clipPage = initialPage;

		if (i !== 1 && nextClipStartTime !== -1) {
			const clipUrl = `${response.url}&startTime=${nextClipStartTime}`;
			const clipResponse = await fetch(clipUrl, { headers: createHeaders() });
			if (!clipResponse.ok) {
				log('├─', styleText('red', 'Clip page fetch has failed.'), 'error');
				failedRecordingShareUrls.push(url);
				break;
			}
			clipPage = await clipResponse.text();
		}

		nextClipStartTime = Number(
			clipPage.match(regex.zoomNextClipStartTime)?.[0] || -1
		);

		let matchedMediaUrls = [...clipPage.matchAll(regex.zoomMediaUrl)];

		if (!matchedMediaUrls.length) {
			try {
				if (!browser) browser = await puppeteer.launch();

				const page = await browser.newPage();
				await page.goto(url, { waitUntil: 'networkidle2' });

				const downloadBtnSelector = '.download-btn';
				await page.waitForSelector(downloadBtnSelector);
				await page.click(downloadBtnSelector);

				const response = await page.waitForResponse((request) =>
					request.url().includes('/nws/recording/1.0/download-meeting/')
				);

				if (!response.ok()) throw new Error();

				const client = await page.target().createCDPSession();
				const cookies = (await client.send('Network.getAllCookies')).cookies;

				for (const { name, value } of cookies) {
					if (name.match(regex.zoomCookieTs)) removeTsCookie();
					cookieMap.set(name, encodeURI(value));
				}

				matchedMediaUrls = [
					...(await response.text()).matchAll(regex.zoomMediaUrl),
				];

				if (!matchedMediaUrls.length) throw new Error();

				await page.close();
			} catch (e) {
				log('└─', styleText('red', 'No media URLs are found.'), 'error');
				failedRecordingShareUrls.push(url);
				continue;
			}
		}

		cookieMap.delete('cdn_detect_result');
		cookieMap.delete('cred');

		for await (const [mediaUrl, filename] of matchedMediaUrls) {
			log('├─', `Downloading ${styleText('yellow', filename)}`);

			const response = await fetch(mediaUrl, { headers: createHeaders() });

			if (!response.ok) {
				log('├─', styleText('red', 'Media file fetch has failed.'), 'error');
				failedMediaUrls.push(mediaUrl);
				continue;
			}

			const temporaryFilename = `${Date.now()}.part`;

			const writeStream = createWriteStream(
				`${downloadDirectory}/${temporaryFilename}`
			);

			// @ts-ignore Reference https://stackoverflow.com/a/66629140/12817553
			const readable = Readable.fromWeb(response.body);

			readable.pipe(writeStream);
			const contentLength = Number(response.headers.get('content-length') || 0);

			if (!Number.isNaN(contentLength) && contentLength) {
				process.stdout.write(
					`${generateColoredTimestamp()} ${'-'.repeat(100)}`
				);

				let cumulatedLength = 0;
				let previousPercentage: number;

				const handleProgress = ({ length }: { length: number }) => {
					if (length === 0) return;

					cumulatedLength += length;

					const percentage = Math.round(
						(cumulatedLength / contentLength) * 100
					);
					if (previousPercentage === percentage) return;

					previousPercentage = percentage;

					if (percentage === 100) {
						process.stdout.clearLine(0);
						process.stdout.cursorTo(0);
						readable.removeListener('data', handleProgress);
						return;
					}

					// Write 100 # from 0% to 99%
					process.stdout.cursorTo(25 + percentage);
					process.stdout.write('#');
				};

				readable.on('data', handleProgress);
			}

			await new Promise<void>((resolve) => {
				readable.on('end', () => {
					const customFilename = safeName(`${meetingTopic} ${filename}`);

					renameSync(
						`${downloadDirectory}/${temporaryFilename}`,
						`${downloadDirectory}/${customFilename}`
					);

					log('├─', `Saved as ${styleText('underscore', customFilename)}`);
					resolve();
				});
				readable.on('error', () => {
					log('├─', styleText('red', 'Download has failed.'), 'error');
					failedMediaUrls.push(mediaUrl);
					resolve();
				});
			});

			readable.removeAllListeners();
		}
	}

	log('└─', 'Completed.');
}

if (browser) await browser.close();

console.log();

log(
	'',
	`Download completed. Check ${styleText('underscore', downloadDirectory)}.`
);

const generateLog = (urls: string[], type: string) =>
	urls.length
		? `${urls.length} ${type} URL(s) failed.\n` + urls.join('\n')
		: '';

if (failedRecordingShareUrls.length || failedMediaUrls.length) {
	const filename = `${Date.now()}.txt`;

	writeFileSync(
		`${__dirname}/${filename}`,
		[
			generateLog(failedRecordingShareUrls, 'Recording Share'),
			generateLog(failedMediaUrls, 'Media'),
		]
			.filter((v) => v)
			.join('\n\n')
	);

	log('├─', `There are failed attempt(s).`);
	log(
		'└─',
		`Reference ${styleText('underscore', filename)} for more information.`
	);
}

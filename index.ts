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
import { log, styleText } from './src/log';
import { convertToSafeName } from './src/miscellaneous';
import { samplePathname, sampleUrls } from './src/sample';

// Startup check

if (typeof fetch === 'undefined')
	throw new Error(
		`Fetch API is not supported. Please use Node.js v18 or later. (${process.version})`
	);

if (!existsSync('./urls.txt')) {
	writeFileSync('urls.txt', sampleUrls);
	throw new Error(
		'urls.txt file is not found. A sample urls.txt file is created in the directory. Please edit the file and re-run the command.'
	);
}

const urlText = readFileSync('./urls.txt', { encoding: 'utf-8' });

if (urlText.includes(samplePathname))
	throw new Error(
		'Sample URL(s) are found. Please remove them from the urls.txt file.'
	);

const recShareUrls = new Set(
	urlText.match(
		// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
		// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
		/^https:\/\/(?:[a-z][a-z-]{1,}[a-z]\.|us[0-9]{2}web\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/[^?\s]+(?:\?pwd=[^?\s]+)?$/gm
	)
);

if (!recShareUrls.size)
	throw new Error('No valid URLs are found. Please check the urls.txt file.');

// Global variables

const cookieMap = new Map<string, string>();

const baseHeaders = new Headers({
	// Required to prevent 403 Forbidden error
	'Referer': 'https://zoom.us/',
	// Chrome 111 on macOS
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
});

const createHeaders = () => {
	baseHeaders.set(
		'Cookie',
		[...cookieMap].map(([key, value]) => `${key}=${value};`).join(' ')
	);
	return baseHeaders;
};

const failedAttempts: Array<string> = [];

// Start download(s)

const downloadDirectory = `./${convertToSafeName(new Date().toISOString())}`;
if (!existsSync(downloadDirectory)) mkdirSync(downloadDirectory);

log('', `Found ${recShareUrls.size} valid URLs.`);

for (const recShareUrl of recShareUrls) {
	try {
		log();
		cookieMap.clear();

		const { origin } = new URL(recShareUrl);

		const recordId =
			recShareUrl.match(/(?<=share\/|play\/)[^?\s]{20}/)?.[0] || '';

		log('┌', recordId, 'magenta');

		const shareInfoResponse = await fetch(
			new URL(
				recShareUrl.replace(
					'/rec/share/',
					'/nws/recording/1.0/play/share-info/'
				)
			).toString(),
			{
				headers: createHeaders(),
			}
		);

		if (!shareInfoResponse.ok) throw new Error('/share-info fetch has failed.');

		for (const [, name, value] of shareInfoResponse.headers
			.get('set-cookie')
			?.match(/(_zm_ssid|cred)=([^;]+)/g) || []) {
			cookieMap.set(name, value);
		}

		type ShareInfo = { redirectUrl?: string; pwd?: string };

		const { result: shareInfo } = (await shareInfoResponse.json()) as {
			result: ShareInfo;
		};

		if (!shareInfo.redirectUrl)
			throw new Error('Record play URL is not found.');

		const recPlayUrl = new URL(shareInfo.redirectUrl, origin);

		if (shareInfo.pwd) recPlayUrl.searchParams.set('pwd', shareInfo.pwd);

		const recPlayResponse = await fetch(
			new URL(recPlayUrl.toString(), origin).toString(),
			{ headers: createHeaders() }
		);

		if (!recPlayResponse.ok) throw new Error('/rec/play fetch has failed.');

		const fileId = (await recPlayResponse.text()).match(
			// Zoom uses both single and double quotes in JavaScript data.
			/(?<=fileId: ['"])[^'"]+/
		)?.[0];

		if (!fileId) throw new Error('File ID is not found.');

		const playInfoUrl = new URL(
			`/nws/recording/1.0/play/info/${fileId}`,
			origin
		);

		if (shareInfo.pwd) playInfoUrl.searchParams.set('pwd', shareInfo.pwd);

		playInfoUrl.searchParams.set('canPlayFromShare', 'true');
		playInfoUrl.searchParams.set('from', 'share_recording_detail');
		playInfoUrl.searchParams.set('continueMode', 'true');
		playInfoUrl.searchParams.set('componentName', 'rec-play');

		const initPlayInfoResponse = await fetch(playInfoUrl.toString(), {
			headers: createHeaders(),
		});

		if (!initPlayInfoResponse.ok)
			throw new Error('/play/info fetch has failed.');

		type PlayInfo = {
			meet: { topic: string };
			totalClips: number;
			currentClip: number;
			nextClipStartTime: number;
		} & Record<string, unknown>;

		const { result: initPlayInfo } = (await initPlayInfoResponse.json()) as {
			result: PlayInfo;
		};

		const { topic } = initPlayInfo.meet;

		let nextClipStartTime = initPlayInfo.nextClipStartTime;

		for (let i = 1; i <= initPlayInfo.totalClips; i++) {
			log('│');

			if (initPlayInfo.totalClips > 1)
				log('│', `Processing clip ${i}/${initPlayInfo.totalClips}.`);

			let playInfo: PlayInfo;

			if (i === 1) {
				playInfo = initPlayInfo;
			} else {
				playInfoUrl.searchParams.set('startTime', nextClipStartTime.toString());

				const playInfoResponse = await fetch(playInfoUrl.toString(), {
					headers: createHeaders(),
				});

				if (!playInfoResponse.ok)
					throw new Error(`/play/info-${i} fetch has failed.`);

				const { result } = (await playInfoResponse.json()) as {
					result: PlayInfo;
				};

				playInfo = result;
				nextClipStartTime = result.nextClipStartTime;
			}

			const mediaUrls = new Set(
				Object.values(playInfo).filter(
					(v): v is string =>
						typeof v === 'string' &&
						/^https:\/\/ssrweb.zoom.us\/.+(.mp4|.m4a).*$/.test(v)
				)
			);

			log('│', `Found ${mediaUrls.size} media file(s).`);

			for (const mediaUrl of mediaUrls) {
				try {
					const response = await fetch(mediaUrl, {
						headers: createHeaders(),
					});

					if (!response.ok) throw new Error('Media file fetch has failed.');
					if (!response.body) throw new Error('Media file response is empty.');

					const temporaryFilename = `${Date.now()}.part`;

					const writeStream = createWriteStream(
						`${downloadDirectory}/${temporaryFilename}`
					);

					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					// @ts-ignore - reference https://stackoverflow.com/a/66629140/12817553
					const readable = Readable.fromWeb(response.body);

					readable.pipe(writeStream);

					const contentLength = Number(
						response.headers.get('content-length') || 0
					);

					if (!Number.isNaN(contentLength) && contentLength) {
						process.stdout.write('-'.repeat(100));

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
							process.stdout.cursorTo(percentage);
							process.stdout.write('#');
						};

						readable.on('data', handleProgress);
					}

					const filename = mediaUrl.match(/[^/]+(?:\.mp4|\.m4a)/)?.[0] || '';
					const customFilename = convertToSafeName(`${topic} ${filename}`);

					await new Promise<void>((resolve) => {
						readable.on('end', () => {
							renameSync(
								`${downloadDirectory}/${temporaryFilename}`,
								`${downloadDirectory}/${customFilename}`
							);

							log('│', `Saved ${styleText('underscore', customFilename)}`);
							resolve();
						});
						readable.on('error', () => {
							failedAttempts.push(`${recShareUrl}\n${mediaUrl}`);
							log('│', 'Download has failed.', 'red');
							resolve();
						});
					});

					readable.removeAllListeners();
				} catch (e) {
					failedAttempts.push(`${recShareUrl}\n${mediaUrl}`);
					let message = 'Processing a media file URL has failed.';
					if (e instanceof Error && e.message) message = e.message;
					log('│', message, 'red');
					continue;
				}
			}

			log('│', 'Downloaded media file(s).');
		}

		log('│');
		log('└', 'Completed.');
	} catch (e) {
		failedAttempts.push(recShareUrl);
		let message = 'Processing a recording share URL has failed.';
		if (e instanceof Error && e.message) message = e.message;
		log('└', message, 'red');
		continue;
	}
}

if (failedAttempts.length) {
	const logFilename = `${Date.now()}.txt`;

	writeFileSync(logFilename, failedAttempts.join('\n\n') + '\n');

	log();
	log('┌', `Found ${failedAttempts.length} failed attempts.`);
	log('└', `Reference ${styleText('underscore', logFilename)}`);
}

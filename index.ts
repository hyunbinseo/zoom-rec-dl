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
import { log, styleText } from './src/log.js';
import { convertToSafeName } from './src/miscellaneous.js';
import { samplePathname, sampleUrls } from './src/sample.js';

// Startup check

if (typeof fetch === 'undefined')
	throw new Error(
		`Fetch API is not supported. Please use Node.js v18 or later. (${process.version})`
	);

const urlTextFilename = 'urls.txt';

if (!existsSync(urlTextFilename)) {
	writeFileSync(urlTextFilename, sampleUrls + '\n');
	throw new Error(
		`${urlTextFilename} file is not found. A sample ${urlTextFilename} file has been created in the current directory.`
	);
}

const urlText = readFileSync(urlTextFilename, { encoding: 'utf-8' });

if (urlText.includes(samplePathname))
	throw new Error(`Sample URL(s) are found. Please remove them from the ${urlTextFilename} file.`);

const recShareUrls = new Set(
	urlText.match(
		// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
		// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
		/^https:\/\/(?:[a-z][a-z-]{1,}[a-z]\.|us[0-9]{2}web\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/[^\s]+(?:\?pwd=[^?\s]+)?$/gm
	)
);

if (!recShareUrls.size)
	throw new Error(`No valid URL(s) are found. Please check the ${urlTextFilename} file.`);

// Global variables

const headers = new Headers({
	// Required to prevent 403 Forbidden error
	'Referer': 'https://zoom.us/',
	// Chrome 111 on macOS
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
});

const failedAttempts: Array<string> = [];

const downloadDirectory = `${convertToSafeName(new Date().toISOString())}`;

// Start download(s)

if (!existsSync(downloadDirectory)) mkdirSync(downloadDirectory);

log('', `Found ${recShareUrls.size} valid URLs.`);

for (const recShareUrl of recShareUrls) {
	log();

	headers.set('cookie', '');

	try {
		const { origin } = new URL(recShareUrl);

		const recordId = recShareUrl.match(/(?<=share\/|play\/)[^?\s]{20}/)?.[0] || '';

		log('┌', recordId, 'magenta');

		const shareInfoResponse = await fetch(
			recShareUrl.replace('/rec/share/', '/nws/recording/1.0/play/share-info/'),
			{ headers }
		);

		if (!shareInfoResponse.ok) throw new Error('Request to /share-info has failed.');

		const setCookieHeaders = shareInfoResponse.headers
			.get('set-cookie')
			?.match(/(_zm_ssid|cred)=([^;]+)/g);

		if (setCookieHeaders) headers.set('cookie', setCookieHeaders.join('; '));

		const { result: shareInfo } = (await shareInfoResponse.json()) as {
			result: { redirectUrl?: string; pwd?: string };
		};

		if (!shareInfo.redirectUrl) throw new Error('Record play URL is not found.');

		const recPlayUrl = new URL(shareInfo.redirectUrl, origin);

		if (shareInfo.pwd) recPlayUrl.searchParams.set('pwd', shareInfo.pwd);

		const recPlayResponse = await fetch(recPlayUrl, { headers });

		if (!recPlayResponse.ok) throw new Error('Request to /rec/play has failed.');

		const fileId = (await recPlayResponse.text()).match(
			// Zoom uses both single and double quotes in JavaScript data.
			/(?<=fileId: ['"])[^'"]+/
		)?.[0];

		if (!fileId) throw new Error('File ID is not found.');

		const playInfoUrl = new URL(`/nws/recording/1.0/play/info/${fileId}`, origin);

		if (shareInfo.pwd) playInfoUrl.searchParams.set('pwd', shareInfo.pwd);
		playInfoUrl.searchParams.set('canPlayFromShare', 'true');
		playInfoUrl.searchParams.set('from', 'share_recording_detail');
		playInfoUrl.searchParams.set('continueMode', 'true');
		playInfoUrl.searchParams.set('componentName', 'rec-play');

		const initPlayInfoResponse = await fetch(playInfoUrl, { headers });

		if (!initPlayInfoResponse.ok) throw new Error('Request to /play/info has failed.');

		type PlayInfo = {
			meet: { topic: string };
			totalClips: number;
			currentClip: number;
			nextClipStartTime: number;
		} & Record<string, unknown>;

		const { result: initPlayInfo } = (await initPlayInfoResponse.json()) as { result: PlayInfo };

		let nextClipStartTime = initPlayInfo.nextClipStartTime;

		for (let i = 1; i <= initPlayInfo.totalClips; i++) {
			log('│');

			if (initPlayInfo.totalClips > 1) log('│', `Processing clip ${i}/${initPlayInfo.totalClips}.`);

			let playInfo = initPlayInfo;

			if (i !== 1) {
				playInfoUrl.searchParams.set('startTime', nextClipStartTime.toString());

				const playInfoResponse = await fetch(playInfoUrl, { headers });

				if (!playInfoResponse.ok) throw new Error(`Request to /play/info has failed. (${i})`);

				const { result } = (await playInfoResponse.json()) as { result: PlayInfo };

				playInfo = result;
				nextClipStartTime = result.nextClipStartTime;
			}

			const mediaUrls = new Set(
				Object.values(playInfo).filter(
					(v): v is string =>
						typeof v === 'string' && /^https:\/\/ssrweb.zoom.us\/[^\s]+(.mp4|.m4a)[^\s]*$/.test(v)
				)
			);

			log('│', `Found ${mediaUrls.size} media file(s).`);

			for (const mediaUrl of mediaUrls) {
				try {
					const response = await fetch(mediaUrl, { headers });

					if (!response.ok) throw new Error('Requesting the media file has failed.');

					const temporaryFilename = `${Date.now()}.part`;

					const writeStream = createWriteStream(`${downloadDirectory}/${temporaryFilename}`);

					// eslint-disable-next-line @typescript-eslint/ban-ts-comment
					// @ts-ignore - reference https://stackoverflow.com/a/66629140/12817553
					const readable = Readable.fromWeb(response.body);

					readable.pipe(writeStream);

					const contentLength = Number(response.headers.get('content-length') || 0);

					if (!Number.isNaN(contentLength) && contentLength) {
						process.stdout.write('-'.repeat(100));

						let cumulatedLength = 0;
						let previousPercentage: number;

						const handleProgress = ({ length }: { length: number }) => {
							if (length === 0) return;

							cumulatedLength += length;

							const percentage = Math.round((cumulatedLength / contentLength) * 100);
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

					const filename = convertToSafeName(
						`${playInfo.meet.topic} ${mediaUrl.match(/[^/]+(?:\.mp4|\.m4a)/)?.[0] || Date.now()}`
					);

					await new Promise<void>((resolve) => {
						readable.on('end', () => {
							renameSync(
								`${downloadDirectory}/${temporaryFilename}`,
								`${downloadDirectory}/${filename}`
							);

							log('│', `Saved ${styleText('underscore', filename)}`);

							resolve();
						});

						readable.on('error', () => {
							failedAttempts.push(`${recShareUrl}\n\t${mediaUrl}`);

							log('│', 'Cannot save the media file.', 'red');

							resolve();
						});
					});

					readable.removeAllListeners();
				} catch (e) {
					failedAttempts.push(`${recShareUrl}\n\t${mediaUrl}`);

					const message =
						e instanceof Error && e.message ? e.message : 'Cannot download the media file.';

					log('│', message, 'red');

					continue;
				}
			}
		}

		log('│');
		log('└', 'Completed.');
	} catch (e) {
		failedAttempts.push(recShareUrl);

		const message =
			e instanceof Error && e.message ? e.message : 'Cannot access the recording information.';

		log('└', message, 'red');

		continue;
	}
}

if (failedAttempts.length) {
	log();

	const logFilename = `${Date.now()}.txt`;

	writeFileSync(logFilename, failedAttempts.join('\n\n') + '\n');

	log('┌', `Found ${failedAttempts.length} failed attempts.`);
	log('└', `Reference ${styleText('underscore', logFilename)}`);
}

#!/usr/bin/env node

import {
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from 'node:fs';
import { Readable } from 'node:stream';
import { generateSgSendRequest } from 'sendgrid-send';
import { z } from 'zod';
import { log, styleText } from './log.js';
import { samplePathname, sampleUrls } from './sample.js';
import { convertToSafeName, trimUrlSearchParams } from './utilities.js';

// Configurations

const urlTextFilename = 'urls.txt';
const sendGridJsonFilename = 'sendgrid.json';
const downloadDirectory = `${convertToSafeName(new Date().toISOString())}`;

// Startup check

if (typeof fetch === 'undefined')
	throw new Error(
		`Fetch API is not supported. Please use Node.js v18 or later. (${process.version})`,
	);

if (!existsSync(urlTextFilename)) {
	writeFileSync(urlTextFilename, sampleUrls + '\n');
	throw new Error(
		`${urlTextFilename} file is not found. A sample ${urlTextFilename} file has been created in the current directory.`,
	);
}

const urlText = readFileSync(urlTextFilename, { encoding: 'utf-8' });

if (urlText.includes(samplePathname))
	throw new Error(`Sample URL(s) are found. Please remove them from the ${urlTextFilename} file.`);

const recShareUrls = new Set(
	urlText.match(
		// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
		// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
		/^https:\/\/(?:[a-z][a-z-]{1,}[a-z]\.|us[0-9]{2}web\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/[^\s]+(?:\?pwd=[^?\s]+)?$/gm,
	),
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

// Start download(s)

if (!existsSync(downloadDirectory)) mkdirSync(downloadDirectory);

log('', `Found ${recShareUrls.size} valid URLs.`);

for (const recShareUrl of recShareUrls) {
	log();

	headers.set('cookie', '');

	try {
		const { origin } = new URL(recShareUrl);

		const recordId = recShareUrl.match(/(?<=(share|play)\/)[^?\s]{20}/)?.[0] || '';

		log('┌', recordId, 'magenta');

		const shareInfoResponse = await fetch(
			recShareUrl.replace(/\/rec\/(share|play)\//, '/nws/recording/1.0/play/share-info/'),
			{ headers },
		);

		if (!shareInfoResponse.ok) throw new Error('Request to /share-info has failed.');

		const setCookieHeaders = shareInfoResponse.headers
			.get('set-cookie')
			?.match(/(_zm_ssid|cred)=([^;]+)/g);

		if (setCookieHeaders) headers.set('cookie', setCookieHeaders.join('; '));

		const { result: shareInfo } = (await shareInfoResponse.json()) as {
			result: null | {
				hasValidToken?: boolean;
				pwd?: string;
				redirectUrl?: string;
			};
		};

		if (!shareInfo)
			throw new Error('Recording does not exist. Check if the URL requires a password.');

		if (shareInfo.hasValidToken === false)
			throw new Error('Valid token is not found. Check if the URL requires additional actions.');

		if (!shareInfo.redirectUrl) throw new Error('Record play URL is not found.');

		const recPlayUrl = new URL(shareInfo.redirectUrl, origin);

		if (shareInfo.pwd) recPlayUrl.searchParams.set('pwd', shareInfo.pwd);

		const recPlayResponse = await fetch(recPlayUrl, { headers });

		if (!recPlayResponse.ok) throw new Error('Request to /rec/play has failed.');

		const fileId = (await recPlayResponse.text()).match(
			// Zoom uses both single and double quotes in JavaScript data.
			/(?<=fileId: ['"])[^'"]+/,
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
						typeof v === 'string' && /^https:\/\/ssrweb.zoom.us\/[^\s]+(.mp4|.m4a)[^\s]*$/.test(v),
				),
			);

			log('│', `Found ${mediaUrls.size} media file(s).`);

			for (const mediaUrl of mediaUrls) {
				const temporaryFilename = `${Date.now()}.part`;

				try {
					const response = await fetch(mediaUrl, { headers });

					if (!response.ok) throw new Error('Requesting the media file has failed.');

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
						`${playInfo.meet.topic} ${mediaUrl.match(/[^/]+(?:\.mp4|\.m4a)/)?.[0] || Date.now()}`,
					);

					try {
						await new Promise<void>((resolve, reject) => {
							readable.on('end', () => {
								renameSync(
									`${downloadDirectory}/${temporaryFilename}`,
									`${downloadDirectory}/${filename}`,
								);
								log('│', `Saved ${styleText('underscore', filename)}`);
								resolve();
							});

							readable.on('error', () => {
								reject(new Error('Failed to stream the media file.'));
							});
						});
					} finally {
						readable.removeAllListeners();
						readable.destroy();
						writeStream.end();
						if (existsSync(temporaryFilename)) unlinkSync(temporaryFilename);
					}
				} catch (e) {
					failedAttempts.push(
						trimUrlSearchParams(recShareUrl) + '\n' + trimUrlSearchParams(mediaUrl),
					);

					const message =
						e instanceof Error && e.message ? e.message : 'Failed to download the media file.';

					process.stdout.write('\n');
					log('│', message, 'red');

					continue;
				}
			}
		}

		log('│');
		log('└', 'Completed.');
	} catch (e) {
		failedAttempts.push(trimUrlSearchParams(recShareUrl));

		const message =
			e instanceof Error && e.message ? e.message : 'Failed to access the recording information.';

		log('└', message, 'red');

		continue;
	}
}

const now = Date.now();

const logs = {
	processed: [...recShareUrls].join('\n') + '\n',
	failed: failedAttempts.join('\n\n') + '\n',
};

// Write local logs

writeFileSync(`${downloadDirectory}/${now}-requested.txt`, urlText);
writeFileSync(`${downloadDirectory}/${now}-processed.txt`, logs.processed);

if (logs.failed) {
	log();

	const failedLogPath = `${downloadDirectory}/${now}-failed.txt`;

	writeFileSync(failedLogPath, logs.failed);

	log('┌', `Found ${failedAttempts.length} failed attempts.`);
	log('└', `Reference ${styleText('underscore', failedLogPath)}`);
}

// Send logs via email

if (existsSync(sendGridJsonFilename)) {
	log();
	log('┌', 'Found SendGrid configuration file.');

	try {
		const result = z
			.object({
				API_KEY: z.string(),
				SENDER: z.string().email(),
				RECEIVER: z.string().email().optional(),
				RECEIVERS: z.string().email().array().min(1).optional(),
			})
			.safeParse(JSON.parse(readFileSync(sendGridJsonFilename, { encoding: 'utf-8' })));

		if (!result.success) throw new Error('Configuration is not valid.');

		const { API_KEY, SENDER, RECEIVER, RECEIVERS } = result.data;

		const receivers = RECEIVERS || [];
		if (RECEIVER) receivers.push(RECEIVER);
		if (!receivers.length) throw new Error('Email receiver(s) are not found.');

		const response = await fetch(
			generateSgSendRequest(
				{
					from: { email: SENDER },
					personalizations: [{ to: receivers.map((email) => ({ email })) }],
					subject: `[zoom-rec-dl] ${downloadDirectory}`,
					content: [
						{
							type: 'text/html',
							value: [
								'<ul>',
								`<li>${recShareUrls.size} recording(s) have been processed.</li>`,
								`<li>${failedAttempts.length || 'No'} attempt(s) have failed.</li>`,
								'</ul>',
							].join(''),
						},
					],
					attachments: Object.entries(logs)
						.filter(([, content]) => content)
						.map(([type, content]) => ({
							type: 'text/plain',
							filename: `${type}.txt`,
							content: Buffer.from(content).toString('base64'),
						})),
				},
				API_KEY,
			),
		);

		if (!response.ok) throw new Error();

		log('└', 'Sent logs via configured email.');
	} catch (e) {
		const message = e instanceof Error && e.message ? e.message : 'Failed to send logs via email.';

		log('└', message, 'red');
	}
}

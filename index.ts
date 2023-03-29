#!/usr/bin/env node

import fetch from 'node-fetch';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { log, styleText } from './src/log';
import { samplePathname, sampleUrls } from './src/sample';

// Startup check

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

const recShareUrls =
	urlText.match(
		// Zoom Vanity URLs should be at least 4 characters in length, but there are real-world examples that are shorter.
		// Reference 'Guidelines for Vanity URL requests' documentation https://support.zoom.us/hc/en-us/articles/215062646
		/^https:\/\/(?:[a-z][a-z-]{1,}[a-z]\.|us[0-9]{2}web\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/[^?\s]+(?:\?pwd=[^?\s]+)?$/gm
	) || [];

if (!recShareUrls.length)
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

// Start download(s)

log('', `Found ${recShareUrls.length} valid URLs.`);

for (const recShareUrl of recShareUrls) {
	log();
	cookieMap.clear();

	const { origin } = new URL(recShareUrl);

	const recordId = recShareUrl.match(/(?<=share|play)\/[^?\s]{10}/)?.[0] || '';

	log('┌', `Processing ${styleText('magenta', recordId)}`);

	const shareInfoResponse = await fetch(
		recShareUrl.replace('/rec/share/', '/nws/recording/1.0/play/share-info/'),
		{ headers: createHeaders() }
	);

	for (const setCookie of shareInfoResponse.headers.raw()['set-cookie']) {
		const match = setCookie.match(/^([^=]+)=([^;]+)/);
		if (!match) continue;
		const [, name, value] = match;
		cookieMap.set(name, value);
	}

	if (!shareInfoResponse.ok) {
		// TODO: Record and later log failed URLs.
		log('└', 'Information fetch has failed. Skipping.', 'red');
		continue;
	}

	type ShareInfo = {
		result: { redirectUrl?: string; pwd?: string };
	};

	const { result: shareInfo } = (await shareInfoResponse.json()) as ShareInfo;

	if (!shareInfo.redirectUrl) {
		log('└', 'Redirect URL is not found. Skipping.', 'red');
		continue;
	}

	const passwordQueryString = !shareInfo.pwd ? '' : `?pwd=${shareInfo.pwd}`;

	const redirectUrl = new URL(
		// Redirect URL starts with `/rec/play`.
		`${shareInfo.redirectUrl}${passwordQueryString}`,
		origin
	).toString();

	const recPlayResponse = await fetch(redirectUrl, {
		headers: createHeaders(),
	});

	if (!recPlayResponse.ok) {
		log('└', 'Page fetch has failed. Skipping.', 'red');
		continue;
	}

	const fileId = (await recPlayResponse.text()).match(
		// Zoom uses both single and double quotes in JavaScript data.
		/(?<=fileId: ['"])[^'"]+/
	)?.[0];

	if (!fileId) {
		log('└', 'File ID is not found. Skipping.', 'red');
		continue;
	}

	const playInfoUrl = new URL(
		`/nws/recording/1.0/play/info/${fileId}${passwordQueryString}`,
		origin
	).toString();

	const playInfoResponse = await fetch(playInfoUrl, {
		headers: createHeaders(),
	});

	const playInfoText = await playInfoResponse.text();

	const mediaUrls = playInfoText.match(
		/https:\/\/ssrweb\.[^'"]+\/((?:[^'"]+)\.(?:mp4|m4a))[^'"]+/g
	);
}

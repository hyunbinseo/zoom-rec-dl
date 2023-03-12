#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from 'node:fs';
import { Readable } from 'node:stream';
const regex = {
    httpSetCookieHeader: /([^,= ]+=[^,;]+);? *(?:[^,= ]+(?:=(?:Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g,
    zoomRecordingShareUrl: /^https:\/\/(?:(?:[a-z][a-z\-]{1,}[a-z]|us[0-9]{2}web)\.)?(?:zoom.us|zoomgov.com)\/rec\/(?:share|play)\/([^?\s]+)(?:\?pwd=[^?\s]+)?$/,
    zoomTotalClips: /(?<=totalClips: )\d+(?=,)/,
    zoomCurrentClip: /(?<=currentClip: )\d+(?=,)/,
    zoomNextClipStartTime: /(?<=nextClipStartTime: )-?\d+(?=,)/,
    zoomMeetingTopic: /topic: "(.+)",/,
    zoomMediaUrl: /https:\/\/ssrweb\..+\/((?:.+)\.(?:mp4|m4a))[^'"]+/g,
};
const ansiEscapeCodes = {
    underscore: '\x1b[4m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
};
const styleText = (style, text) => `${ansiEscapeCodes[style]}${text}\x1b[0m`;
const generateColoredTimestamp = () => styleText('cyan', new Date().toISOString());
const log = (prefix, message, type = 'log') => {
    const prefixedMessage = (prefix && `${prefix} `) + message;
    const formattedMessage = `${generateColoredTimestamp()} ${prefixedMessage}`;
    console[type](formattedMessage);
};
const safeName = (name) => name
    .replaceAll(' / ', ', ')
    .replaceAll(': ', ' - ')
    .replaceAll(/[<>:"/\\|?*]/g, '-');
if (typeof fetch === 'undefined')
    throw new Error('Fetch API is not supported. Use Node.js v18 or later.');
if (!existsSync('./urls.txt'))
    throw new Error('urls.txt file is not found.');
const failedRecordingShareUrls = [];
const failedMediaUrls = [];
const downloadDirectory = `./${safeName(new Date().toISOString())}`;
if (!existsSync(downloadDirectory))
    mkdirSync(downloadDirectory);
const recodingShareUrls = readFileSync('./urls.txt', { encoding: 'utf-8' })
    .split(/\r?\n/)
    .filter((v) => v);
log('', `Found ${recodingShareUrls.length} URLs.`);
for await (const url of recodingShareUrls) {
    console.log();
    const match = url.match(regex.zoomRecordingShareUrl);
    if (match === null) {
        log('', styleText('red', 'Zoom record sharing URL is not valid.'), 'error');
        continue;
    }
    log('', `Processing ${styleText('magenta', match[1])}`);
    const headers = new Headers({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/110.0.0.0 Safari/537.36',
    });
    let response = await fetch(url, { headers });
    if (!response.ok) {
        log('└─', styleText('red', 'Initial page fetch has failed.'), 'error');
        failedRecordingShareUrls.push(url);
        continue;
    }
    const setCookieString = response.headers.get('set-cookie');
    if (typeof setCookieString !== 'string')
        throw new Error(`Set-Cookie is not a string.`);
    const cookieString = [...setCookieString.matchAll(regex.httpSetCookieHeader)]
        .map(([, nameValue]) => nameValue)
        .join(';');
    headers.append('Cookie', cookieString);
    if (response.redirected) {
        const redirectedPageResponse = await fetch(url, { headers });
        if (!redirectedPageResponse.ok) {
            log('└─', styleText('red', 'Redirected page fetch has failed.'), 'error');
            failedRecordingShareUrls.push(url);
            continue;
        }
        response = redirectedPageResponse;
    }
    headers.append('Referer', 'https://zoom.us/');
    const initialPage = await response.text();
    const totalClipCount = Number(initialPage.match(regex.zoomTotalClips)?.[0]) || 1;
    const meetingTopic = (initialPage.match(regex.zoomMeetingTopic)?.[1] || 'topic-not-found').trim();
    let nextClipStartTime = -1;
    for (let i = 1; i < totalClipCount + 1; i++) {
        log('├─', `Downloading part ${i}/${totalClipCount}`);
        let clipPage = initialPage;
        if (i !== 1 && nextClipStartTime !== -1) {
            const clipUrl = `${response.url}&startTime=${nextClipStartTime}`;
            const clipResponse = await fetch(clipUrl, { headers });
            if (!clipResponse.ok) {
                log('├─', styleText('red', 'Clip page fetch has failed.'), 'error');
                failedRecordingShareUrls.push(url);
                break;
            }
            clipPage = await clipResponse.text();
        }
        nextClipStartTime = Number(clipPage.match(regex.zoomNextClipStartTime)?.[0] || -1);
        const matchedMediaUrls = [...clipPage.matchAll(regex.zoomMediaUrl)];
        if (!matchedMediaUrls.length) {
            log('└─', styleText('red', 'No media URLs are found.'), 'error');
            failedRecordingShareUrls.push(url);
            continue;
        }
        for await (const [mediaUrl, filename] of matchedMediaUrls) {
            log('├─', `Downloading ${styleText('yellow', filename)}`);
            const response = await fetch(mediaUrl, { headers });
            if (!response.ok) {
                log('├─', styleText('red', 'Media file fetch has failed.'), 'error');
                failedMediaUrls.push(mediaUrl);
                continue;
            }
            const temporaryFilename = `${Date.now()}.part`;
            const writeStream = createWriteStream(`${downloadDirectory}/${temporaryFilename}`);
            const readable = Readable.fromWeb(response.body);
            readable.pipe(writeStream);
            const contentLength = Number(response.headers.get('content-length') || 0);
            if (!Number.isNaN(contentLength) && contentLength) {
                process.stdout.write(`${generateColoredTimestamp()} ${'-'.repeat(100)}`);
                let cumulatedLength = 0;
                let previousPercentage;
                const handleProgress = ({ length }) => {
                    if (length === 0)
                        return;
                    cumulatedLength += length;
                    const percentage = Math.round((cumulatedLength / contentLength) * 100);
                    if (previousPercentage === percentage)
                        return;
                    previousPercentage = percentage;
                    if (percentage === 100) {
                        process.stdout.clearLine(0);
                        process.stdout.cursorTo(0);
                        readable.removeListener('data', handleProgress);
                        return;
                    }
                    process.stdout.cursorTo(25 + percentage);
                    process.stdout.write('#');
                };
                readable.on('data', handleProgress);
            }
            await new Promise((resolve) => {
                readable.on('end', () => {
                    const customFilename = safeName(`${meetingTopic} ${filename}`);
                    renameSync(`${downloadDirectory}/${temporaryFilename}`, `${downloadDirectory}/${customFilename}`);
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
console.log();
log('', `Download completed. Check ${styleText('underscore', downloadDirectory)}.`);
const generateLog = (urls, type) => urls.length
    ? `${urls.length} ${type} URL(s) failed.\n` + urls.join('\n')
    : '';
if (failedRecordingShareUrls.length || failedMediaUrls.length) {
    const filename = `${Date.now()}.txt`;
    writeFileSync(`${__dirname}/${filename}`, [
        generateLog(failedRecordingShareUrls, 'Recording Share'),
        generateLog(failedMediaUrls, 'Media'),
    ]
        .filter((v) => v)
        .join('\n\n'));
    log('├─', `There are failed attempt(s).`);
    log('└─', `Reference ${styleText('underscore', filename)} for more information.`);
}

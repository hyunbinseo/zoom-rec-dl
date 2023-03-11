import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'path';
import { fileURLToPath } from 'url';
import information from './package.json' assert { type: 'json' };
import settings from './settings.json' assert { type: 'json' };
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
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
if (typeof fetch === 'undefined')
    throw new Error('Fetch API is not supported. Use Node.js v18 or later.');
const { filename_meeting_topic, filename_unix_timestamp } = settings;
if (typeof filename_meeting_topic !== 'boolean')
    throw new Error('filename_meeting_topic should be a boolean');
if (typeof filename_unix_timestamp !== 'boolean')
    throw new Error('filename_unix_timestamp should be a boolean');
const urlText = readFileSync('urls.txt', { encoding: 'utf-8' });
if (urlText.includes('something-unique-and-very-long-can-include-symbols-such-as-period-dash-underscore'))
    throw new Error('Remove sample URLs from the urls.txt file.');
const failedRecordingShareUrls = [];
const failedMediaUrls = [];
const downloadFolder = `${__dirname}/downloads`;
if (!existsSync(downloadFolder))
    mkdirSync(downloadFolder);
const recodingShareUrls = urlText.split(/\r?\n/).filter((v) => v);
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
        throw new Error(`Set-Cookie is not a string. Please leave an issue in ${information.bugs.url}`);
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
    const meetingTopic = (initialPage.match(regex.zoomMeetingTopic)?.[1] || '').trim();
    let nextClipStartTime = -1;
    for (let i = 1; i < totalClipCount + 1; i++) {
        log('├─', `Downloading clip ${i}/${totalClipCount}`);
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
            const writeStream = createWriteStream(`${downloadFolder}/${temporaryFilename}`);
            const readable = Readable.fromWeb(response.body);
            readable.pipe(writeStream);
            const customFilename = [
                filename_meeting_topic ? meetingTopic : '',
                filename,
                filename_unix_timestamp ? `@${Date.now()}`.slice(0, -3) : '',
            ]
                .filter((value) => value)
                .join(' ')
                .replaceAll(' / ', ', ')
                .replaceAll(': ', ' - ')
                .replaceAll(/[<>:"/\\|?*]/g, '_');
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
                    renameSync(`${downloadFolder}/${temporaryFilename}`, `${downloadFolder}/${customFilename}`);
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
log('', 'All downloads are completed.');
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

import { UnsupportedFileError } from './errors.ts';
import { fetchResult } from './fetch.ts';
import { toRecordingFile } from './file.ts';
import {
	type PlayInfo,
	downloadMeetingSchema,
	playInfoSchema,
	shareInfoSchema,
	singleDownloadSchema,
} from './schema.ts';
import type { Recording, RecordingFile } from './types.ts';
import { parseRecordingUrl } from './url.ts';

/**
 * Resolves a Zoom cloud recording link into its files, following the web player's requests.
 * Protected recordings require the passcode embedded in the link (`?pwd=`).
 * Throws `UnsupportedFileError` for an unknown MP4 or M4A file, unless `onUnsupportedFile` is given.
 */
export const getRecording = async (
	recordingUrl: string | URL,
	{
		signal,
		onUnsupportedFile,
	}: {
		signal?: AbortSignal;
		/** Called instead of throwing. The file is excluded from `recording_files`. */
		onUnsupportedFile?: (error: UnsupportedFileError) => void;
	} = {},
): Promise<Recording> => {
	const { origin, type, id, pwd } = parseRecordingUrl(recordingUrl);
	const api = (path: string) => new URL(`/nws/recording/1.0/${path}`, origin);

	// 1. A share link is exchanged for a play ID and the play info parameters.
	const playInfoUrl = api('play/info/');
	const params = playInfoUrl.searchParams;

	if (type === 'share') {
		const shareInfoUrl = api(`play/share-info/${id}`);
		if (pwd) shareInfoUrl.searchParams.set('pwd', pwd);

		const shareInfo = await fetchResult(shareInfoUrl, shareInfoSchema, { signal });
		if (shareInfo.hasValidToken === false)
			throw new Error('The recording requires sign-in or registration.');

		const { playId, searchParams } = shareInfo.redirectUrl;
		playInfoUrl.pathname += playId;
		for (const [key, value] of searchParams) params.set(key, value);
		const sharePwd = shareInfo.pwd ?? pwd;
		if (sharePwd) params.set('pwd', sharePwd);
		if (shareInfo.accessLevel) params.set('accessLevel', shareInfo.accessLevel);
		params.set('canPlayFromShare', String(shareInfo.canPlayFromShare));
		params.set('from', shareInfo.from);
		params.set('continueMode', String(shareInfo.continueMode));
		params.set('componentName', shareInfo.componentName);
	} else {
		playInfoUrl.pathname += id;
		if (pwd) params.set('pwd', pwd);
		// Required for the clip fields (totalClips, currentClip, ...) to be returned.
		params.set('continueMode', 'true');
	}

	// 2. Play info is returned per clip. Long recordings are split into multiple clips.
	const clips: PlayInfo[] = [];
	const files: RecordingFile[] = [];
	const addFile = (url: string, clip: PlayInfo) => {
		try {
			const file = toRecordingFile(url, clip);
			if (file) files.push(file);
		} catch (error) {
			if (!(error instanceof UnsupportedFileError) || !onUnsupportedFile) throw error;
			onUnsupportedFile(error);
		}
	};

	do {
		const previous = clips.at(-1);
		if (previous) params.set('startTime', String(previous.nextClipStartTime));

		const clip = await fetchResult(playInfoUrl, playInfoSchema, { signal });
		if (clip.disableDownload) throw new Error('The host has disabled downloads.');
		if (clip.currentClip !== clips.length + 1)
			throw new Error(`Expected clip ${clips.length + 1}, but received ${clip.currentClip}.`);
		clips.push(clip);

		// 3. Same as the player's download button.
		if (clip.clipDownload) {
			const url = api(`download-meeting/${encodeURIComponent(clip.meet.encryptMeetingId)}`);
			url.searchParams.set('startTime', String(clip.clipStartTime));
			const { batchDownloadFileList } = await fetchResult(url, downloadMeetingSchema, {
				method: 'POST',
				signal,
			});
			for (const fileUrl of batchDownloadFileList) addFile(fileUrl, clip);
		} else {
			const url = api(`sdownload/${encodeURIComponent(clip.recording.playId)}`);
			const { redirectUrl } = await fetchResult(url, singleDownloadSchema, { signal });
			addFile(redirectUrl, clip);
		}
	} while (clips.length < clips[0]!.totalClips && clips.at(-1)!.nextClipStartTime !== -1);

	const [first] = clips as [PlayInfo];
	if (clips.length !== first.totalClips)
		throw new Error(`Expected ${first.totalClips} clips, but received ${clips.length}.`);

	return {
		topic: first.meet.topic,
		start_time: new Date(first.fileStartTime).toISOString(),
		duration: Math.round(clips.reduce((sum, clip) => sum + clip.duration, 0) / 60),
		recording_count: files.length,
		recording_files: files,
	};
};

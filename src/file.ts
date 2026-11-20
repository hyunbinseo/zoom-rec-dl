import { UnsupportedFileError } from './errors.ts';
import type { PlayInfo } from './schema.ts';
import type { RecordingFile, RecordingType } from './types.ts';

/**
 * Zoom names cloud recording files `GMT{date}-{time}_Recording[_{view}][_{width}x{height}].{ext}`.
 * Both name parts are mapped to the Cloud Recording API's `file_type` and `recording_type`.
 * Returns `undefined` for file types outside `FileType` (e.g. `TRANSCRIPT`, `CHAT`, `CC`).
 * Throws `UnsupportedFileError` for MP4 and M4A files in an unknown naming.
 * @see https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording/GET/meetings/{meetingId}/recordings
 */
const parseFileName = (
	fileName: string,
): Pick<RecordingFile, 'file_type' | 'recording_type'> | undefined => {
	const dot = fileName.lastIndexOf('.');
	const extension = fileName.slice(dot + 1).toUpperCase();
	const [, label, ...tokens] = fileName.slice(0, dot).split('_');
	const resolution = tokens.at(-1)?.split('x');
	const hasResolution = resolution?.length === 2 && resolution.every((n) => n && !isNaN(+n));
	const view = hasResolution ? tokens.slice(0, -1).join('_') : tokens.join('_');
	const error = new UnsupportedFileError(fileName);

	if (dot === -1) throw new Error(`Unexpected Zoom recording file name: ${fileName}`);
	if (extension !== 'MP4' && extension !== 'M4A') return;
	if (label !== 'Recording') throw error;

	if (extension === 'M4A') {
		if (tokens.length) throw error;
		return { file_type: 'M4A', recording_type: 'audio_only' };
	}

	if (!hasResolution) throw error;
	const recordingType = (
		{
			'': 'shared_screen_with_speaker_view',
			'gallery': 'shared_screen_with_gallery_view',
			'avo': 'active_speaker',
			'gvo': 'gallery_view',
			'as': 'shared_screen',
		} as const satisfies Record<string, RecordingType>
	)[view];
	if (!recordingType) throw error;
	return { file_type: 'MP4', recording_type: recordingType };
};

const decodeFileName = (url: string) => {
	const segment = new URL(url).pathname.split('/').at(-1) ?? '';
	try {
		const fileName = decodeURIComponent(segment);
		if (!/[/\\]/.test(fileName)) return fileName;
	} catch {}
	throw new Error(`Unexpected Zoom recording file name: ${segment}`);
};

/** Returns `undefined` for file types outside `FileType`. */
export const toRecordingFile = (url: string, clip: PlayInfo): RecordingFile | undefined => {
	const fileName = decodeFileName(url);
	const parsed = parseFileName(fileName);
	if (!parsed) return;
	const { file_type, recording_type } = parsed;
	return {
		recording_start: new Date(clip.clipStartTime).toISOString(),
		recording_end: new Date(clip.clipStartTime + clip.duration * 1000).toISOString(),
		file_type,
		file_extension: file_type,
		download_url: url,
		recording_type,
		file_name: fileName,
	};
};

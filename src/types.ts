import type { InferOutput } from 'valibot';
import type { recordingTypeSchema } from './schema.ts';

/**
 * Subset of `recording_files[].recording_type` in Zoom's Cloud Recording API.
 * @see https://developers.zoom.us/docs/api/meetings/#tag/cloud-recording
 */
export type RecordingType = InferOutput<typeof recordingTypeSchema>;

/** Subset of `recording_files[].file_type` (and `file_extension`) in Zoom's Cloud Recording API. */
export type FileType = 'MP4' | 'M4A';

/** Mirrors `recording_files[]` in Zoom's Cloud Recording API. */
export type RecordingFile = {
	/** ISO 8601 */
	recording_start: string;
	/** ISO 8601 */
	recording_end: string;
	file_type: FileType;
	file_extension: FileType;
	/** Signed URL. Requires a Zoom `Referer` header. Use `downloadFile`. */
	download_url: string;
	recording_type: RecordingType;
	/** File name in Zoom's cloud storage. Not part of Zoom's API. */
	file_name: string;
};

/** Mirrors the `Get meeting recordings` response in Zoom's Cloud Recording API. */
export type Recording = {
	topic: string;
	/** ISO 8601 */
	start_time: string;
	/** Minutes */
	duration: number;
	recording_count: number;
	recording_files: RecordingFile[];
};

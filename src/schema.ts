import {
	type InferOutput,
	array,
	boolean,
	check,
	literal,
	minValue,
	nonEmpty,
	null_,
	number,
	object,
	picklist,
	optional,
	pipe,
	safeInteger,
	startsWith,
	string,
	transform,
	union,
	unknown,
	url,
	variant,
} from 'valibot';

/** Subset of `recording_files[].recording_type` in Zoom's Cloud Recording API. */
export const recordingTypeSchema = picklist([
	'active_speaker',
	'gallery_view',
	'shared_screen',
	'shared_screen_with_speaker_view',
	'shared_screen_with_gallery_view',
	'audio_only',
]);

/** Every `/nws/recording/1.0/*` endpoint wraps its payload in this envelope. */
export const responseSchema = variant('status', [
	object({
		status: literal(true),
		errorCode: literal(0),
		errorMessage: null_(),
		result: unknown(),
	}),
	object({
		status: literal(false),
		errorCode: number(),
		errorMessage: string(),
		result: null_(),
	}),
]);

const PLAY_PATH = '/rec/play/';

/** `GET /nws/recording/1.0/play/share-info/{shareId}` */
export const shareInfoSchema = object({
	accessLevel: string(),
	canPlayFromShare: boolean(),
	from: string(),
	continueMode: boolean(),
	componentName: string(),
	hasValidToken: optional(boolean()),
	pwd: optional(string()),
	/** `/rec/play/{playId}[?{searchParams}]` */
	redirectUrl: pipe(
		string(),
		startsWith(PLAY_PATH),
		transform((path) => {
			const { pathname, searchParams } = new URL(path, 'https://zoom.us');
			return { playId: pathname.slice(PLAY_PATH.length), searchParams };
		}),
		check(({ playId }) => /^[^/]+$/.test(playId), 'Expected a play ID.'),
	),
});

const timestampSchema = pipe(number(), safeInteger(), minValue(0));

/** `GET /nws/recording/1.0/play/info/{playId}` */
export const playInfoSchema = object({
	meet: object({
		topic: string(),
		encryptMeetingId: pipe(string(), nonEmpty()),
	}),
	recording: object({
		playId: pipe(string(), nonEmpty()),
	}),
	fileStartTime: timestampSchema,
	clipStartTime: timestampSchema,
	/** Seconds */
	duration: pipe(number(), safeInteger(), minValue(0)),
	totalClips: pipe(number(), safeInteger(), minValue(1)),
	currentClip: pipe(number(), safeInteger(), minValue(1)),
	/** `-1` on the last clip. */
	nextClipStartTime: union([literal(-1), timestampSchema]),
	disableDownload: boolean(),
	/** Whether all files can be downloaded at once. Determines the download endpoint. */
	clipDownload: boolean(),
});

const mediaUrlSchema = pipe(
	string(),
	url(),
	check((value) => new URL(value).protocol === 'https:', 'Expected an HTTPS URL.'),
);

/** `POST /nws/recording/1.0/download-meeting/{encryptMeetingId}?startTime={clipStartTime}` */
export const downloadMeetingSchema = object({
	batchDownloadFileList: pipe(array(mediaUrlSchema), nonEmpty()),
});

/** `GET /nws/recording/1.0/sdownload/{recording.playId}` */
export const singleDownloadSchema = object({
	redirectUrl: mediaUrlSchema,
});

export type PlayInfo = InferOutput<typeof playInfoSchema>;

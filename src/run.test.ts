import { Writable } from 'node:stream';
import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { UnsupportedFileError } from './errors.ts';
import { type RunOptions, run } from './run.ts';
import type { Recording, RecordingFile, RecordingType } from './types.ts';

beforeEach(() => {
	// Colors depend only on the fake stream's `isTTY`, not on the terminal or CI.
	vi.stubEnv('FORCE_COLOR', undefined);
});

const capture = (isTTY = false) => {
	let text = '';
	const stream = Object.assign(
		new Writable({
			write(chunk, _, callback) {
				text += String(chunk);
				callback();
			},
		}),
		{ isTTY },
	);
	return { stream, text: () => text };
};

const file = (recording_type: RecordingType, file_name: string): RecordingFile => ({
	recording_start: '2026-11-20T01:00:00.000Z',
	recording_end: '2026-11-20T02:02:00.000Z',
	file_type: recording_type === 'audio_only' ? 'M4A' : 'MP4',
	file_extension: recording_type === 'audio_only' ? 'M4A' : 'MP4',
	download_url: `https://ssrweb.zoom.us/${file_name}`,
	recording_type,
	file_name,
});

const recording = (topic: string, files: RecordingFile[]): Recording => ({
	topic,
	start_time: '2026-11-20T01:00:00.000Z',
	duration: 62,
	recording_count: files.length,
	recording_files: files,
});

const SPEAKER = file('active_speaker', 'GMT20261120-010000_Recording_avo_1280x720.mp4');
const SCREEN = file(
	'shared_screen_with_speaker_view',
	'GMT20261120-010000_Recording_1920x1080.mp4',
);
const AUDIO = file('audio_only', 'GMT20261120-010000_Recording.m4a');

const setup = (
	recordings: Record<string, Recording | Error | { unsupported: string; recording: Recording }>,
	results: Record<string, 'done' | 'skip' | Error> = {},
	isTTY = false,
) => {
	const stdout = capture(isTTY);
	const stderr = capture();
	const dirs: string[] = [];
	const options: RunOptions = {
		stdout: stdout.stream,
		stderr: stderr.stream,
		getRecording: async (url, options) => {
			const value = recordings[String(url)];
			if (!value) throw new Error(`Unexpected URL: ${String(url)}`);
			if (value instanceof Error) throw value;
			if ('unsupported' in value) {
				options?.onUnsupportedFile?.(new UnsupportedFileError(value.unsupported));
				return value.recording;
			}
			return value;
		},
		downloadFile: async (file, options) => {
			const fileName = options?.fileName ?? file.file_name;
			dirs.push(options?.dir ?? '.');
			const result = results[file.file_name] ?? 'done';
			options?.onProgress?.({ received: 50, total: 100 });
			if (result instanceof Error) throw result;
			return { path: `downloads/${fileName}`, size: 100, skipped: result === 'skip' };
		},
	};
	return { options, stdout: stdout.text, stderr: stderr.text, dirs };
};

test('downloads, skips, and reports failures', async () => {
	const { options, stdout, stderr } = setup(
		{
			'https://zoom.us/rec/share/a?pwd=secret': recording('Weekly Sync', [SCREEN, SPEAKER, AUDIO]),
			'https://zoom.us/rec/share/b': {
				unsupported: 'GMT20261120-010000_Recording_hv_1280x720.mp4',
				recording: recording('Lecture 3', [AUDIO]),
			},
			'https://zoom.us/rec/play/c?pwd=secret': new Error('The host has disabled downloads.'),
		},
		{
			[SCREEN.file_name]: 'skip',
			[AUDIO.file_name]: new Error('HTTP 403 while downloading\nSecond line'),
		},
	);
	const failed = await run(
		{
			group: { by: 'none' },
			urls: [
				'https://zoom.us/rec/share/a?pwd=secret',
				'https://zoom.us/rec/share/b',
				'https://zoom.us/rec/play/c?pwd=secret',
			],
		},
		options,
	);
	expect(failed).toBe(3);
	expect(stdout()).toMatchSnapshot();
	expect(stderr()).toMatchSnapshot();
});

test('selects types in order of preference', async () => {
	const { options, stdout } = setup({
		'https://zoom.us/rec/share/all': recording('All', [SCREEN, SPEAKER, AUDIO]),
		'https://zoom.us/rec/share/partial': recording('Partial', [SCREEN, AUDIO]),
		'https://zoom.us/rec/share/none': recording('None', [SCREEN]),
	});
	const failed = await run(
		{
			group: { by: 'none' },
			urls: [
				'https://zoom.us/rec/share/all',
				'https://zoom.us/rec/share/partial',
				'https://zoom.us/rec/share/none',
			],
			select: { types: ['audio_only', 'active_speaker'], limit: 2 },
		},
		options,
	);
	expect(failed).toBe(1);
	expect(stdout()).toMatchSnapshot();
});

test('shows progress on a terminal', async () => {
	const { options, stdout } = setup(
		{ 'https://zoom.us/rec/share/a': recording('Weekly Sync', [AUDIO]) },
		{},
		true,
	);
	await run({ group: { by: 'none' }, urls: ['https://zoom.us/rec/share/a'] }, options);
	expect(stdout()).toMatchSnapshot();
});

test('groups by start date in the time zone', async () => {
	const { options, dirs } = setup({
		// 23:00 UTC on Nov 20 is Nov 21 in Seoul.
		'https://zoom.us/rec/share/late': {
			...recording('Late', [AUDIO]),
			start_time: '2026-11-20T23:00:00.000Z',
		},
		'https://zoom.us/rec/share/early': {
			...recording('Early', [AUDIO]),
			start_time: '2026-11-20T01:00:00.000Z',
		},
	});
	await run(
		{
			group: { by: 'date', timeZone: 'Asia/Seoul' },
			urls: ['https://zoom.us/rec/share/late', 'https://zoom.us/rec/share/early'],
		},
		options,
	);
	expect(dirs).toEqual(['downloads/2026-11-21', 'downloads/2026-11-20']);
});

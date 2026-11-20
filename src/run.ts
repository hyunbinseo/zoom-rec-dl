import { join } from 'node:path';
import { styleText } from 'node:util';
import { type InferOutput, ValiError, summarize } from 'valibot';
import { OUT_DIR, type configSchema } from './config.ts';
import type { downloadFile, getRecording } from './index.ts';
import type { RecordingFile } from './types.ts';

type Output = NodeJS.WritableStream & { isTTY?: boolean };

export type RunOptions = {
	getRecording: typeof getRecording;
	downloadFile: typeof downloadFile;
	stdout: Output;
	stderr: Output;
};

const toMessage = (error: unknown) => {
	if (error instanceof ValiError) return `Unexpected Zoom data:\n${summarize(error.issues)}`;
	return error instanceof Error ? error.message : String(error);
};

const withoutSearch = (url: string) => {
	if (!URL.canParse(url)) return url;
	const parsed = new URL(url);
	parsed.search = '';
	return parsed.href;
};

const INVALID_FILE_NAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

const toSafeFileName = (name: string) =>
	Array.from(name, (c) => (INVALID_FILE_NAME_CHARS.has(c) || c < ' ' ? '_' : c))
		.join('')
		.trim();

// Most file systems limit a file name to 255 bytes. Reserve 5 bytes for the `.part` suffix.
const MAX_FILE_NAME_BYTES = 250;

const toOutputFileName = (topic: string, fileName: string) => {
	const suffix = ` ${fileName}`;
	const budget = MAX_FILE_NAME_BYTES - Buffer.byteLength(suffix);
	let prefix = '';
	for (const char of toSafeFileName(topic)) {
		if (Buffer.byteLength(prefix + char) > budget) break;
		prefix += char;
	}
	return toSafeFileName(`${prefix.trim()}${suffix}`);
};

/** Applies `select` from the config. Returns a note if fewer types than `limit` are available. */
const selectFiles = (
	files: RecordingFile[],
	select: InferOutput<typeof configSchema>['select'],
): { files: RecordingFile[]; note?: string } => {
	if (!select) return { files };
	const { types, limit } = select;
	const available = new Set(files.map((file) => file.recording_type));
	const matched = types.filter((type) => available.has(type));
	const selected = limit === 'none' ? matched : matched.slice(0, limit);
	return {
		// In order of preference. The sort is stable, so clips of the same type stay in order.
		files: files
			.filter((file) => selected.includes(file.recording_type))
			.sort((a, b) => selected.indexOf(a.recording_type) - selected.indexOf(b.recording_type)),
		note:
			limit !== 'none' && selected.length && selected.length < limit
				? `${selected.length} of ${limit} types available`
				: undefined,
	};
};

/** Downloads the recordings in the config. Returns the number of failed recordings. */
export const run = async (
	config: InferOutput<typeof configSchema> & { urls: string[] },
	{ getRecording, downloadFile, stdout, stderr }: RunOptions,
): Promise<number> => {
	const color = (format: Parameters<typeof styleText>[0], text: string, stream = stdout) =>
		styleText(format, text, { stream });
	const log = (line: string) => stdout.write(`${line}\n`);
	const clearLine = () => stdout.isTTY && stdout.write('\r\x1b[K');

	const urls = [...new Set(config.urls)];
	const failed = new Set<string>();

	for (const url of urls) {
		log(`\n${color('magenta', withoutSearch(url))}`);

		try {
			const unsupported: string[] = [];
			const recording = await getRecording(url, {
				onUnsupportedFile: ({ fileName }) => unsupported.push(fileName),
			});
			log(`  ${recording.topic} (${recording.start_time}, ${recording.duration} min)`);

			for (const fileName of unsupported) {
				log(color('yellow', `  unsupported, skipped ${fileName}`));
				failed.add(url);
			}

			const dir =
				config.group.by === 'none'
					? OUT_DIR
					: join(
							OUT_DIR,
							Temporal.Instant.from(recording.start_time)
								.toZonedDateTimeISO(config.group.timeZone)
								.toPlainDate()
								.toString(),
						);

			const { files, note } = selectFiles(recording.recording_files, config.select);
			if (note) log(color('yellow', `  ${note}`));
			if (!files.length) {
				const available = new Set(recording.recording_files.map((file) => file.recording_type));
				log(color('red', `  No matching types. Available: ${[...available].join(', ')}`));
				failed.add(url);
			}

			for (const file of files) {
				const fileName = toOutputFileName(recording.topic, file.file_name);
				try {
					let lastPercent = -1;
					const { skipped } = await downloadFile(file, {
						dir,
						fileName,
						onProgress: ({ received, total }) => {
							const percent = Math.floor((received / total) * 100);
							if (!stdout.isTTY || percent === lastPercent) return;
							lastPercent = percent;
							stdout.write(`\r  ${String(percent).padStart(3)}% ${fileName}`);
						},
					});
					clearLine();
					const status = skipped ? color('yellow', 'skip') : color('green', 'done');
					log(`  ${status} ${fileName}`);
				} catch (error) {
					clearLine();
					log(`  ${color('red', 'fail')} ${fileName}`);
					// Indented under the file name. Some messages span multiple lines.
					log(color('red', toMessage(error).replace(/^/gm, '       ')));
					failed.add(url);
				}
			}
		} catch (error) {
			log(color('red', `  ${toMessage(error)}`));
			failed.add(url);
		}
	}

	if (failed.size) {
		stderr.write(
			`${color('red', `\n${failed.size} of ${urls.length} recording(s) failed:`, stderr)}\n`,
		);
		for (const url of failed) stderr.write(`  ${withoutSearch(url)}\n`);
	}

	return failed.size;
};

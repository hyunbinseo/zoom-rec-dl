import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { RecordingFile } from './types.ts';

const REFERER = 'https://zoom.us/';

export type DownloadOptions = {
	/** Output directory. Defaults to the current working directory. */
	dir?: string;
	/** Output file name. Defaults to `file_name`. */
	fileName?: string;
	signal?: AbortSignal;
	onProgress?: (progress: { received: number; total: number }) => void;
};

export type DownloadResult = { path: string; size: number; skipped: boolean };

/** Downloads a recording file. Skips the download if the file exists with the same size. */
export const downloadFile = async (
	file: RecordingFile,
	{ dir = '.', fileName = file.file_name, signal, onProgress }: DownloadOptions = {},
): Promise<DownloadResult> => {
	if (/[/\\]/.test(fileName) || fileName === '.' || fileName === '..')
		throw new TypeError(`Invalid file name: ${fileName}`);
	const path = join(dir, fileName);

	const response = await fetch(file.download_url, { headers: { Referer: REFERER }, signal });
	if (!response.ok || !response.body) {
		await response.body?.cancel();
		throw new Error(`HTTP ${response.status} while downloading ${file.file_name}`);
	}

	const total = Number(response.headers.get('content-length'));
	if (!Number.isSafeInteger(total) || total <= 0) {
		await response.body.cancel();
		throw new Error(`Missing Content-Length for ${file.file_name}`);
	}

	const existing = await stat(path).catch(() => undefined);
	if (existing?.size === total) {
		await response.body.cancel();
		return { path, size: total, skipped: true };
	}

	await mkdir(dir, { recursive: true });
	const partPath = `${path}.part`;
	let received = 0;

	try {
		await pipeline(
			Readable.fromWeb(response.body),
			new Transform({
				transform(chunk: Buffer, _, callback) {
					received += chunk.length;
					onProgress?.({ received, total });
					callback(null, chunk);
				},
			}),
			createWriteStream(partPath),
			{ signal },
		);
		if (received !== total) throw new Error(`Incomplete download of ${file.file_name}`);
		await rename(partPath, path);
	} catch (error) {
		await rm(partPath, { force: true });
		throw error;
	}

	return { path, size: total, skipped: false };
};

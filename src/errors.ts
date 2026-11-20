/** Thrown when Zoom responds with `status: false`. e.g. `3301` This recording does not exist. */
export class ZoomError extends Error {
	readonly code: number;

	constructor(code: number, message: string) {
		super(`${message} (${code})`);
		this.name = 'ZoomError';
		this.code = code;
	}
}

/** Thrown for an MP4 or M4A file whose name doesn't map to a known `recording_type`. */
export class UnsupportedFileError extends Error {
	readonly fileName: string;

	constructor(fileName: string) {
		super(`Unsupported Zoom recording file: ${fileName}`);
		this.name = 'UnsupportedFileError';
		this.fileName = fileName;
	}
}

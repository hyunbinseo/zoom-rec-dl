import {
	type InferInput,
	array,
	check,
	integer,
	literal,
	minValue,
	nonEmpty,
	number,
	optional,
	pipe,
	strictObject,
	string,
	union,
	variant,
} from 'valibot';
import { recordingTypeSchema } from './schema.ts';
import { isTimeZone } from './utils.ts';

export const CONFIG_FILE = 'config.mts';
export const URLS_FILE = 'recordings.txt';
export const OUT_DIR = 'downloads';

/**
 * Validates the optional `config.mts` at runtime, since Node.js strips types without checking them.
 * URLs are read from `recordings.txt` instead, so that they can be pasted as is.
 */
export const configSchema = strictObject({
	/**
	 * Groups downloads into subdirectories. Defaults to `{ by: 'none' }`.
	 * `{ by: 'date', timeZone: 'Asia/Seoul' }` saves to `downloads/2026-11-21/`,
	 * using the recording's start date in the IANA time zone.
	 */
	group: optional(
		variant('by', [
			strictObject({ by: literal('none') }),
			strictObject({
				by: literal('date'),
				timeZone: pipe(string(), check(isTimeZone, 'Invalid IANA time zone. e.g. Asia/Seoul')),
			}),
		]),
		{ by: 'none' },
	),
	/** Downloads all files if omitted. */
	select: optional(
		strictObject({
			/** Recording types to download, in order of preference. List more types to fall back to. */
			types: pipe(array(recordingTypeSchema), nonEmpty()),
			/** Maximum number of types per recording, picked in `types` order. e.g. `1` or `'none'` */
			limit: union([literal('none'), pipe(number(), integer(), minValue(1))]),
		}),
	),
});

/** CLI configuration in `config.mts`. */
export type Config = InferInput<typeof configSchema>;

/** Type-checks the CLI configuration in `config.mts`. */
export const defineConfig = (config: Config): Config => config;

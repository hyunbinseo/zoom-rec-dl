#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs, styleText } from 'node:util';
import { is, object, parse, safeParse, summarize, unknown } from 'valibot';
import { CONFIG_FILE, URLS_FILE, configSchema } from './config.ts';
import { downloadFile, getRecording } from './index.ts';
import { run } from './run.ts';
import { parseUrls } from './utils.ts';

// Read by v2, which ran via `npx zoom-rec-dl@latest`.
const V2_INPUT = 'urls.txt';

const HELP = `Usage: zoom-rec-dl

Downloads Zoom cloud recordings listed in ${URLS_FILE} in the current directory.
One URL per line. Only lines that start with https:// are read.

Recording types can be selected in an optional ${CONFIG_FILE}.

See https://github.com/hyunbinseo/zoom-rec-dl#readme`;

// A function declaration, so that TypeScript narrows types after calls.
function exit(message: string): never {
	console.error(message);
	process.exit(1);
}

try {
	const { values } = parseArgs({ options: { help: { type: 'boolean', short: 'h' } } });
	if (values.help) {
		console.log(HELP);
		process.exit(0);
	}
} catch (error) {
	exit(`${error instanceof Error ? error.message : String(error)}\n\n${HELP}`);
}

const readUrls = () => {
	if (!existsSync(URLS_FILE)) {
		if (existsSync(V2_INPUT))
			exit(`${V2_INPUT} is no longer read since v3. Rename it to ${URLS_FILE}.\n\n${HELP}`);
		exit(`${URLS_FILE} not found.\n\n${HELP}`);
	}
	if (existsSync(V2_INPUT)) console.warn(styleText('yellow', `${V2_INPUT} is ignored since v3.`));
	const urls = parseUrls(readFileSync(URLS_FILE, 'utf-8'));
	if (!urls.length) exit(`No URLs in ${URLS_FILE}.`);
	return urls;
};

const readConfig = async () => {
	// Applies the defaults.
	if (!existsSync(CONFIG_FILE)) return parse(configSchema, {});
	let module: unknown;
	try {
		module = await import(pathToFileURL(resolve(CONFIG_FILE)).href);
	} catch (error) {
		exit(
			`Failed to load ${CONFIG_FILE}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (!is(object({ default: unknown() }), module))
		exit(`${CONFIG_FILE} must have a default export. e.g. export default defineConfig({ ... })`);
	const result = safeParse(configSchema, module.default);
	if (!result.success) exit(`Invalid ${CONFIG_FILE}:\n${summarize(result.issues)}`);
	return result.output;
};

const urls = readUrls();
const config = await readConfig();

const failed = await run(
	{ ...config, urls },
	{
		getRecording,
		downloadFile,
		stdout: process.stdout,
		stderr: process.stderr,
	},
);
if (failed) process.exit(1);

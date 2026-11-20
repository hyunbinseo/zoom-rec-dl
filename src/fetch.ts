import { type GenericSchema, type InferOutput, parse } from 'valibot';
import { ZoomError } from './errors.ts';
import { responseSchema } from './schema.ts';

/** Fetches a `/nws/recording/1.0/*` endpoint and validates its envelope and result. */
export const fetchResult = async <T extends GenericSchema>(
	url: URL,
	schema: T,
	{ method = 'GET', signal }: { method?: 'GET' | 'POST'; signal?: AbortSignal | undefined },
): Promise<InferOutput<T>> => {
	const response = await fetch(url, { method, signal });
	if (!response.ok) throw new Error(`HTTP ${response.status} from ${url.pathname}`);

	const body = parse(responseSchema, await response.json());
	if (!body.status) throw new ZoomError(body.errorCode, body.errorMessage);
	return parse(schema, body.result);
};

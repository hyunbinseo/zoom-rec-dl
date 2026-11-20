import { array, email, minLength, object, optional, pipe, string } from 'valibot';

// Same format as v2.1.10.
export const sendGridConfigSchema = object({
	API_KEY: string(),
	SENDER: pipe(string(), email()),
	RECEIVER: optional(pipe(string(), email())),
	RECEIVERS: optional(pipe(array(pipe(string(), email())), minLength(1))),
});

import { array, email, object, pipe, string } from 'valibot';

export const sendGridConfigSchema = object({
	apiKey: string(),
	from: pipe(string(), email()),
	to: array(pipe(string(), email())),
});

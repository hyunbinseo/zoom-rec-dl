import { array, email, object, string } from 'valibot';

export const sendGridConfigSchema = object({
	apiKey: string(),
	from: string([email()]),
	to: array(string([email()])),
});

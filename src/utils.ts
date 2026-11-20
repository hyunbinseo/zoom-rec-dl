export const isTimeZone = (timeZone: string) => {
	try {
		Temporal.Now.zonedDateTimeISO(timeZone);
		return true;
	} catch {
		return false;
	}
};

export const parseUrls = (text: string) => text.match(/^https:\/\/\S+/gm) ?? [];

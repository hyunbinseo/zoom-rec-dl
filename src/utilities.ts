export const convertToSafeName = (name: string) =>
	name
		.replaceAll(' / ', ', ')
		.replaceAll(': ', ' - ')
		.replace(/[<>:"/\\|?*]/g, '-')
		.replace(/-{2,}/g, '-');

export const trimUrlSearchParams = (urlString: string) => {
	try {
		const url = new URL(urlString);
		url.search = '';
		return url.toString();
	} catch {
		return '';
	}
};

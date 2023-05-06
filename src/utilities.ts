export const convertToSafeName = (name: string) =>
	name
		.replaceAll(' / ', ', ')
		.replaceAll(': ', ' - ')
		.replace(/[<>:"/\\|?*]/g, '-')
		.replace(/-{2,}/g, '-');

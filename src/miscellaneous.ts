export const convertToSafeName = (name: string) =>
	name
		.replaceAll(' / ', ', ')
		.replaceAll(': ', ' - ')
		.replaceAll(/[<>:"/\\|?*]/g, '-');

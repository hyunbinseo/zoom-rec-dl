const ZOOM_DOMAINS = ['zoom.us', 'zoomgov.com'];

export const parseRecordingUrl = (input: string | URL) => {
	if (!URL.canParse(input)) throw new TypeError('Invalid URL.');
	const url = new URL(input);
	const { protocol, hostname, pathname, searchParams } = url;

	const isZoom = ZOOM_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`));
	if (protocol !== 'https:' || !isZoom) throw new TypeError('Not a Zoom URL.');

	const [root, rec, type, id, ...rest] = pathname.split('/');
	if (root !== '' || rec !== 'rec' || (type !== 'share' && type !== 'play') || !id || rest.length)
		throw new TypeError('Not a Zoom recording URL. Expected /rec/share/{id} or /rec/play/{id}.');

	return { origin: url.origin, type, id, pwd: searchParams.get('pwd') ?? undefined } as const;
};

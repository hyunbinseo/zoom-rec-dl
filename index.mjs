import urls from './urls.json' assert { type: 'json' };

if (typeof (fetch) === 'undefined')
	throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

if (!(Array.isArray(urls) && urls.length))
	throw new Error('Zoom URL is not found.');

const zoomUrlRegex = /https:\/\/(.*\.)?(zoom.us|zoomgov.com)\/rec\/share\/.+\?pwd=.+/;

for (const url of urls) {
	if (!zoomUrlRegex.test(url) || url === 'https://zoom.us/rec/share/unique-id?pwd=password')
		throw new Error(`Zoom URL is not valid. (${url})`);
};

for await (const url of urls) {
	// Redirect response with Set-Cookie header
	const initialResponse = await fetch(url);

	if (!initialResponse.ok || !initialResponse.redirected || !initialResponse.headers.has('set-cookie'))
		throw new Error(`Initial fetch has failed. (${url})`);

	// Node.js Fetch API merges Set-Cookie headers into a single string
	const cookie = initialResponse.headers
		.get('set-cookie')
		.match(/([^,= ]+(=(Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)+/g)
		.map((str) => (str.substring(0, str.indexOf(';'))))
		.join('; ');

	// Re-request the video download page with authentication cookie (_zm_ssid)
	const downloadPageResponse = await fetch(url, { headers: { cookie } });

	if (!downloadPageResponse.ok)
		throw new Error(`Download page fetch has failed. (${url})`);

	const downloadPageHtml = await downloadPageResponse.text();
	const videoUrlMatch = downloadPageHtml.match(/src="(.+\.mp4)/);

	if (videoUrlMatch === null)
		throw new Error(`Video URL is not found. (${url})`);

	const videoUrl = videoUrlMatch[1];
	console.log(videoUrl);
};

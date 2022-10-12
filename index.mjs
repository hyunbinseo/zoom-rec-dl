import urls from './urls.json' assert { type: 'json' };

const zoomUrlRegex = /https:\/\/(.*\.)?(zoom.us|zoomgov.com)\/rec\/share\/.+\?pwd=.+/;
const zoomMp4UrlRegex = /https:\/\/ssrweb\..+\/(.+\.mp4)[^'"]+/g;
const setCookieRegex = /([^,= ]+=[^,;]+);? *([^,= ]+(=(Mon,|Tue,|Wed,|Thu,|Fri,|Sat,|Sun,)?[^,;]+)?;? *)*/g;

if (typeof (fetch) === 'undefined')
	throw new Error('Fetch API is not supported. Use Node.js v18 or later.');

if (!(Array.isArray(urls) && urls.length))
	throw new Error('Zoom URL is not found.');

for (const url of urls) {
	if (!zoomUrlRegex.test(url) || url === 'https://zoom.us/rec/share/unique-id?pwd=password')
		throw new Error(`Zoom URL is not valid. (${url})`);
};

for await (const url of urls) {
	const headers = new Headers({
		// Chrome 106 on Windows 11
		'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/106.0.0.0 Safari/537.36',
	});

	// Redirect response with Set-Cookie header
	const initialResponse = await fetch(url, { headers });

	if (!initialResponse.ok || !initialResponse.redirected || !initialResponse.headers.has('set-cookie'))
		throw new Error(`Initial fetch has failed. (${url})`);

	// Node.js Fetch API merges Set-Cookie headers into a single string
	const setCookieString = initialResponse.headers.get('set-cookie');
	const cookieString = [...setCookieString.matchAll(setCookieRegex)]
		.map(([, group1]) => (group1))
		.join('; ');

	headers.append('Cookie', cookieString);

	// Re-request the video download page with authentication cookie (_zm_ssid)
	// Returns different response based on the User-Agent (e.g. global data)
	const downloadPageResponse = await fetch(url, { headers });

	if (!downloadPageResponse.ok)
		throw new Error(`Download page fetch has failed. (${url})`);

	const downloadPageHtml = await downloadPageResponse.text();
	const videoUrlMatches = [...downloadPageHtml.matchAll(zoomMp4UrlRegex)]
		.map(([url, filename]) => ({ url, filename }));

	if (!videoUrlMatches.length)
		throw new Error(`Video URL is not found. (${url})`);

	headers.append('Referer', 'https://zoom.us/');

	for await (const { url, filename } of videoUrlMatches) {
		const response = await fetch(url, { headers });
		console.log(response.ok, filename);
	};
};

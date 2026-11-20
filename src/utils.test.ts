import { expect, test } from 'vite-plus/test';
import { isTimeZone, parseUrls } from './utils.ts';

test('reads one URL per line', () => {
	expect(parseUrls('https://zoom.us/rec/share/a\nhttps://zoom.us/rec/share/b\n')).toEqual([
		'https://zoom.us/rec/share/a',
		'https://zoom.us/rec/share/b',
	]);
});

test('ignores lines that do not start with https://', () => {
	expect(
		parseUrls(
			'# Week 1\n\nLecture notes\nhttps://zoom.us/rec/share/a\nhttp://zoom.us/rec/share/b\n',
		),
	).toEqual(['https://zoom.us/rec/share/a']);
});

test('ignores text after the URL', () => {
	expect(parseUrls('https://zoom.us/rec/share/a?pwd=x Week 1 lecture\n')).toEqual([
		'https://zoom.us/rec/share/a?pwd=x',
	]);
});

test('handles CRLF line endings and trailing whitespace', () => {
	expect(parseUrls('https://zoom.us/rec/share/a \t\r\nhttps://zoom.us/rec/share/b\r\n')).toEqual([
		'https://zoom.us/rec/share/a',
		'https://zoom.us/rec/share/b',
	]);
});

test('ignores indented URLs', () => {
	expect(parseUrls('  https://zoom.us/rec/share/a\nhttps://zoom.us/rec/share/b\n')).toEqual([
		'https://zoom.us/rec/share/b',
	]);
});

test('returns nothing without URLs', () => {
	expect(parseUrls('# nothing yet\n')).toEqual([]);
});

test('validates IANA time zones', () => {
	expect(isTimeZone('Asia/Seoul')).toBe(true);
	expect(isTimeZone('UTC')).toBe(true);
	expect(isTimeZone('Asia/Seol')).toBe(false);
	expect(isTimeZone('')).toBe(false);
});

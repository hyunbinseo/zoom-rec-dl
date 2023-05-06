const ansiEscapeCodes = {
	underscore: '\x1b[4m',
	red: '\x1b[31m',
	yellow: '\x1b[33m',
	magenta: '\x1b[35m',
	cyan: '\x1b[36m',
} satisfies Record<string, `\x1b[${number}m`>;

type AnsiEscapeCode = keyof typeof ansiEscapeCodes;

export const styleText = (style: AnsiEscapeCode, text: string | number) =>
	`${ansiEscapeCodes[style]}${text}\x1b[0m`;

export const log = (prefix: '┌' | '│' | '└' | '' = '', message = '', style?: AnsiEscapeCode) => {
	if (!prefix && !message) {
		console.log(); // Blank line
	} else {
		const timestamp = styleText('cyan', new Date().toISOString());
		const styled = style ? styleText(style, message) : message;
		const prefixed = prefix ? `${prefix} ${styled}` : styled;
		console.log(`${timestamp} ${prefixed}`);
	}
};

import { defineConfig } from 'vite-plus';

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
	pack: {
		dts: {
			generator: 'tsgo',
		},
		exports: true,
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
	fmt: {
		overrides: [
			{
				files: ['*.md'],
				options: { useTabs: false },
			},
		],
		printWidth: 100,
		quoteProps: 'consistent',
		singleQuote: true,
		sortImports: {
			internalPattern: ['#'],
			newlinesBetween: false,
		},
		sortPackageJson: { sortScripts: true },
		useTabs: true,
	},
});

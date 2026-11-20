import { defineConfig } from 'vite-plus';

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
	pack: {
		entry: ['src/index.ts', 'src/cli.ts'],
		dts: {
			generator: 'tsgo',
		},
		exports: { exclude: ['cli'] },
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

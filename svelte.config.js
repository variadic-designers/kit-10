import adapter from '@sveltejs/adapter-vercel';
import { sveltePreprocess } from 'svelte-preprocess';
import path from 'path';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: sveltePreprocess({
		scss: {
			includePaths: [path.resolve('src/styles'), path.resolve('.kit10/live')]
		}
	}),

	kit: {
		adapter: adapter({
			precompress: true
		}),

		alias: {
			$components: './src/components',
			$utils: './src/utils',
			$fonts: './src/lib/fonts',
			$static: './static',
			$lib: './src/lib'
			// $styles: './src/styles',
		}
	}
};

export default config;

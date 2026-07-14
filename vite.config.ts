import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';

import { sveltekit } from '@sveltejs/kit/vite';
import k10 from './plugin/vite-kit10-plugin.js';
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation';

export default defineConfig({
	plugins: [k10(), sveltekit(), devtoolsJson(), crossOriginIsolation()],

	optimizeDeps: {
		// pglite and its extension packages ship a `.tar.gz`/wasm bundle loaded via
		// `new URL('./bundle', import.meta.url)`. Pre-bundling them with esbuild breaks
		// that asset resolution (the URL points into .vite/deps, the tarball 404s, and
		// PGlite init throws "failed to initialize properly"). Excluding keeps them served
		// as-is so Vite rewrites the asset URL correctly. As of pglite 0.5 the extensions
		// (pg_uuidv7) moved out of the main package into their own package, which must be
		// excluded on its own — it used to be covered by excluding '@electric-sql/pglite'.
		exclude: ['@electric-sql/pglite', '@electric-sql/pglite-pg_uuidv7']
	},

	worker: {
		format: 'es'
	},

	server: {
		fs: {
			allow: [searchForWorkspaceRoot(process.cwd())]
		}
	},

	test: {
		expect: { requireAssertions: true },

		projects: [
			{
				extends: './vite.config.ts',

				test: {
					name: 'client',
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},

			{
				extends: './vite.config.ts',

				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
});

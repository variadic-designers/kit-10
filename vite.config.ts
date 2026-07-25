import devtoolsJson from 'vite-plugin-devtools-json';
import { defineConfig, type Plugin } from 'vitest/config';
import { searchForWorkspaceRoot } from 'vite';

import { sveltekit } from '@sveltejs/kit/vite';
import k10 from './plugin/vite-kit10-plugin.js';
import crossOriginIsolation from 'vite-plugin-cross-origin-isolation';

// The editor's client-only stack (manager/Kysely/PGlite, Vellum's WASM loader, the
// Charter/Extism plugin runtime) is dynamically imported as one subtree from
// routes/edit/+page.svelte, and without manualChunks it lands in a single ~620kB client
// chunk. Splitting along these lines lets the browser fetch the pieces in parallel and
// lets an unrelated change (e.g. Vellum) avoid invalidating the DB/plugin chunks' cache.
// This does NOT reduce total bytes shipped -- the editor needs all of it before it's
// usable -- it only improves fetch parallelism and cache locality.
//
// Must be client-build-only: applying this during the SERVER build too accidentally
// co-locates Svelte's own shared internal runtime helpers (needed by every SSR'd
// component, e.g. DarkModeToggle) inside these chunks -- since a Rollup manualChunks
// bucket is one file, ANY route needing so much as one shared helper from it then has to
// load the whole chunk, dragging @extism/extism into every route's server bundle instead
// of just staying out of it (worse than the problem this fixes).
//
// SvelteKit doesn't run `vite build --ssr` (Vite's own isSsrBuild configEnv flag stays
// false for both passes) -- it injects `build.ssr` itself through its own plugin's
// `config` hook. So detecting the server pass means reading `config.build.ssr` from a
// plugin `config` hook placed AFTER sveltekit() in the plugins array, not from configEnv.
function clientOnlyManualChunks(): Plugin {
	return {
		name: 'client-only-manual-chunks',
		apply: 'build',
		config(config) {
			if (config.build?.ssr) return;

			config.build ??= {};
			config.build.rollupOptions ??= {};
			config.build.rollupOptions.output ??= {};
			const output = config.build.rollupOptions.output;
			if (Array.isArray(output)) return; // multi-output not used here

			output.manualChunks = (id: string) => {
				if (
					id.includes('/manager/src/') ||
					id.includes('/kysely/') ||
					id.includes('@electric-sql/pglite')
				) {
					return 'editor-db';
				}
				if (id.includes('/src/lib/vellum/')) {
					return 'editor-vellum';
				}
				if (id.includes('@extism/extism') || id.includes('/src/lib/plugins/')) {
					return 'editor-plugins';
				}
			};
		}
	};
}

export default defineConfig({
	plugins: [
		k10(),
		sveltekit(),
		devtoolsJson(),
		crossOriginIsolation(),
		clientOnlyManualChunks()
	],

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

	build: {
		// The PGlite web worker (a separate build, untouched by clientOnlyManualChunks
		// above) is an in-browser Postgres engine's JS glue -- inherently ~550kB, nothing
		// to split. Set just above that so a genuine future regression still gets flagged.
		chunkSizeWarningLimit: 600
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

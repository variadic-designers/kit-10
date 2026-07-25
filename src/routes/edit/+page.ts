import type { PageLoad } from './$types.js';

// The editor is a client-only app shell (PGlite in a worker+IndexedDB, Vellum WASM/GPU,
// Charter WASM plugin) -- nothing here can produce meaningful server-rendered HTML, so
// SSR just bundles that whole stack into the server chunk for no benefit.
export const ssr = false;

export const load: PageLoad = () => {
	return {};
};
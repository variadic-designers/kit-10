declare module '$app/state' {
	import { type Page } from '@sveltejs/kit';
	export const page: Page;
}

// No published types for this plugin; it's only ever imported for its default export
// (registered in vite.config.ts), never for any named type.
declare module 'vite-plugin-cross-origin-isolation';

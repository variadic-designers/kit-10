// Host-owned canvas input mappings (pan button + zoom direction).
//
// Vellum is NOT an Extism plugin (it's wasm-bindgen) and exposes no input config -- pointer/wheel
// events are interpreted in Viewport.svelte before calling set_pan/zoom_*_at. So these mappings are
// a HOST concern, not a plugin-declared preference: Viewport.svelte reads this store and gates its
// handlers on it. Same store-as-source-of-truth shape as theming.ts/reduced-motion.ts, but persisted
// to localStorage (not a cookie) -- these are per-user editor prefs with no SSR anti-flicker need,
// and cookies ride every request for no reason here (see the Settings menu's persistence choice).

import { type Writable, writable, get } from 'svelte/store';

// Which mouse gesture pans the infinite canvas.
//   'left'   -- left-drag pans (current/default behavior)
//   'middle' -- middle-mouse-drag pans; left-drag is reserved (select only)
//   'space'  -- hold Space + left-drag pans (Figma-style); plain left-drag is reserved
export type PanButton = 'left' | 'middle' | 'space';

export interface ViewportInput {
	panButton: PanButton;
	// Invert wheel zoom direction (wheel-up zooms out instead of in).
	zoomInvert: boolean;
}

export const VIEWPORT_INPUT_DEFAULTS: ViewportInput = {
	panButton: 'left',
	zoomInvert: false
};

export const panButtonOptions: PanButton[] = ['left', 'middle', 'space'];

const STORAGE_KEY = 'kit10:viewport-input';

function load(): ViewportInput {
	try {
		if (typeof localStorage === 'undefined') return { ...VIEWPORT_INPUT_DEFAULTS };
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...VIEWPORT_INPUT_DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<ViewportInput>;
		// Merge over defaults so a value written by an older build (missing a newer field) still
		// yields a complete object rather than an undefined field.
		return { ...VIEWPORT_INPUT_DEFAULTS, ...parsed };
	} catch {
		return { ...VIEWPORT_INPUT_DEFAULTS };
	}
}

export const viewportInput: Writable<ViewportInput> = writable(load());

function persist(value: ViewportInput): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// best-effort -- a storage fault just means the pref doesn't survive reload
	}
}

// Patch one or more fields, persisting the result. Callers (the Settings dialog) never write the
// store directly, so persistence can never be forgotten at a call site.
export function updateViewportInput(patch: Partial<ViewportInput>): void {
	const next = { ...get(viewportInput), ...patch };
	viewportInput.set(next);
	persist(next);
}

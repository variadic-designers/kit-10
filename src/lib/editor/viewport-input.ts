// Host-owned canvas rendering/input prefs (zoom direction + box-model overlay).
//
// Vellum is NOT an Extism plugin (it's wasm-bindgen) and exposes no input config -- pointer/wheel
// events are interpreted in Viewport.svelte before calling set_pan/zoom_*_at. So these are a HOST
// concern, not a plugin-declared preference: Viewport.svelte reads this store and gates its handlers
// on it. The pan GESTURE itself now lives in the unified keybind registry (keybinds.ts, action
// `canvas.pan`); what remains here is the wheel-zoom direction and the box-model overlay toggle.
// Same store-as-source-of-truth shape as theming.ts/reduced-motion.ts, persisted to localStorage.

import { type Writable, writable, get } from 'svelte/store';

export interface ViewportInput {
	// Invert wheel zoom direction (wheel-up zooms out instead of in).
	zoomInvert: boolean;
	// Show Vellum's padding/gap (box-model) hatch overlay on hover.
	showBoxModel: boolean;
	// World-space grid (px) a live root-view drag snaps its position to -- fed to Vellum via
	// vellum.set_position_snap_px. One of DRAG_SNAP_OPTIONS; 16 is the default to match Vellum's
	// own hardcoded fallback (Graphics::position_snap_px), so a session before this preference
	// loads still snaps the same way.
	dragSnapPx: number;
}

// The only values the Settings select (host-preferences.ts, "drag-snap") offers -- Vellum's
// set_position_snap_px accepts any f32, but the UI is deliberately a closed set, not free entry.
export const DRAG_SNAP_OPTIONS = [4, 8, 16, 32, 64, 128] as const;

export const VIEWPORT_INPUT_DEFAULTS: ViewportInput = {
	zoomInvert: false,
	showBoxModel: true,
	dragSnapPx: 16
};

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

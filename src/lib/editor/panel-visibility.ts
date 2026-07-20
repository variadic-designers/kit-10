// Host-owned "is this console/side panel shown" prefs. Kept separate from viewport-input.ts
// (canvas/input concerns) and host-preferences.ts's theme/motion store -- panel visibility is
// neither. Currently just the Layers (resolution cascade) drawer, but the shape scales to more
// toggleable panels later. Same store-as-source-of-truth / patch-then-persist shape as
// viewport-input.ts and keybinds.ts, persisted to localStorage.

import { type Writable, writable, get } from 'svelte/store';

export interface PanelVisibility {
	// Show the Layers (resolution cascade) console drawer.
	showLayersPanel: boolean;
}

// Defaults to OFF: the console drawer's row is a fixed 40vh while expanded, so starting expanded
// by default means every fresh session (no stored preference yet) opens with that space already
// reserved before the user ever asked for it -- reads as a layout shift once the editor actually
// finishes loading into it. Starting collapsed means expansion only ever happens as a direct result
// of the user's own toggle/keybind action, never as a surprise on load.
export const PANEL_VISIBILITY_DEFAULTS: PanelVisibility = {
	showLayersPanel: false
};

const STORAGE_KEY = 'kit10:panel-visibility';

function load(): PanelVisibility {
	try {
		if (typeof localStorage === 'undefined') return { ...PANEL_VISIBILITY_DEFAULTS };
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { ...PANEL_VISIBILITY_DEFAULTS };
		const parsed = JSON.parse(raw) as Partial<PanelVisibility>;
		// Merge over defaults so a value written by an older build (missing a newer field) still
		// yields a complete object rather than an undefined field.
		return { ...PANEL_VISIBILITY_DEFAULTS, ...parsed };
	} catch {
		return { ...PANEL_VISIBILITY_DEFAULTS };
	}
}

export const panelVisibility: Writable<PanelVisibility> = writable(load());

function persist(value: PanelVisibility): void {
	try {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
	} catch {
		// best-effort -- a storage fault just means the pref doesn't survive reload
	}
}

// Patch one or more fields, persisting the result. Callers (the Settings dialog, the keybind
// toggle) never write the store directly, so persistence can never be forgotten at a call site.
export function updatePanelVisibility(patch: Partial<PanelVisibility>): void {
	const next = { ...get(panelVisibility), ...patch };
	panelVisibility.set(next);
	persist(next);
}

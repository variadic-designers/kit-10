// Host-owned global preferences, declared as data.
//
// These are the preferences the editor itself owns rather than any plugin: appearance (theme,
// motion), canvas input mappings (pan gesture, zoom direction, box-model overlay), and panel
// visibility (Layers). Vellum is wasm-bindgen, not an Extism plugin, so its input mapping is a host
// concern -- but it still shouldn't be bespoke markup. Panel-visibility toggles ride the CANVAS
// group (there's no dedicated "Panels" settings tab for a single entry -- CanvasTab.svelte/
// AppearanceTab.svelte each filter hostPreferences by one hardcoded group string, so a new group
// here would render nowhere without also adding a tab).
//
// Each entry is a PreferenceBinding: the same shape a plugin-declared preference collapses to, so
// the Settings menu renders host and plugin preferences through one generic control with zero
// per-preference markup. Adding a host preference means appending one declarative entry here (wire
// it to its store + codec) -- never touching the menu component.

import { derived } from 'svelte/store';
import { theme, updateTheme, type Theme } from '$lib/theming.js';
import { reducedMotion, updateReducedMotion, type ReducedMotion } from '$lib/reduced-motion.js';
import { viewportInput, updateViewportInput } from './viewport-input.js';
import { panelVisibility, updatePanelVisibility } from './panel-visibility.js';
import type { PreferenceBinding } from '$lib/plugins/preferences.js';

const APPEARANCE = 'Appearance';
const CANVAS = 'Canvas & Input';

export const hostPreferences: PreferenceBinding[] = [
	{
		key: 'host:theme',
		def: {
			id: 'theme',
			label: 'Theme',
			kind: 'select',
			group: APPEARANCE,
			default: 'auto',
			options: [
				{ value: 'dark', label: 'Dark' },
				{ value: 'light', label: 'Light' },
				{ value: 'auto', label: 'System' }
			]
		},
		value: derived(theme, (t) => (t ?? 'auto') as string),
		set: (v) => updateTheme(v as Theme)
	},
	{
		key: 'host:motion',
		def: {
			id: 'motion',
			label: 'Motion',
			kind: 'select',
			group: APPEARANCE,
			default: 'auto',
			options: [
				{ value: 'no-reduce', label: 'Full' },
				{ value: 'reduce', label: 'Reduced' },
				{ value: 'auto', label: 'System' }
			]
		},
		value: derived(reducedMotion, (m) => (m ?? 'auto') as string),
		set: (v) => updateReducedMotion(v as ReducedMotion)
	},
	{
		key: 'host:zoom-invert',
		def: {
			id: 'zoom-invert',
			label: 'Invert zoom direction',
			kind: 'toggle',
			group: CANVAS,
			default: 'false'
		},
		value: derived(viewportInput, (i) => String(i.zoomInvert)),
		set: (v) => updateViewportInput({ zoomInvert: v === 'true' })
	},
	{
		key: 'host:box-model',
		def: {
			id: 'box-model',
			label: 'Show padding/gap overlay',
			kind: 'toggle',
			group: CANVAS,
			default: 'true'
		},
		value: derived(viewportInput, (i) => String(i.showBoxModel)),
		set: (v) => updateViewportInput({ showBoxModel: v === 'true' })
	},
	{
		key: 'host:layers-panel',
		def: {
			id: 'layers-panel',
			label: 'Show Layers panel',
			kind: 'toggle',
			group: CANVAS,
			default: 'false'
		},
		value: derived(panelVisibility, (p) => String(p.showLayersPanel)),
		set: (v) => updatePanelVisibility({ showLayersPanel: v === 'true' })
	}
];

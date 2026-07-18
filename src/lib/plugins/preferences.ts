// Plugin-declared global preferences.
//
// This is the FieldDef/inputType idiom applied to editor-global settings: a plugin *declares* which
// global preferences it wants exposed, as data, and the host renders + stores them generically. The
// plugin never holds the value (it stays stateless -- Key Invariant #3); the host persists to
// localStorage and feeds the values back to the plugin through its normal call inputs.
//
// A plugin opts in by exporting a `preferences` function:
//
//     preferences(input: "{}") -> PreferenceDef[]   // JSON
//
// It's optional -- a plugin with no `preferences` export simply contributes nothing to the Settings
// menu (the aggregator tolerates the missing-function error). The one place that maps a preference's
// declared `kind` to a concrete control lives host-side (Settings.svelte), so adding a control kind
// never requires the declaring plugin to know how it's rendered.

import { type Writable, type Readable, writable, derived, get } from 'svelte/store';

// What kind of control a preference renders as. Deliberately small and closed for v1 -- mirrors how
// FieldDef.inputType started with a handful of kinds and grew.
export type PreferenceKind = 'toggle' | 'select' | 'number';

export interface PreferenceOption {
	value: string;
	label: string;
}

// One preference a plugin declares. Snake_case on the wire (Rust-authored, read by JS) -- same
// convention as OnResolveResult; see CLAUDE.md's camelCase-vs-snake_case pitfall.
export interface PreferenceDef {
	// Stable id, unique within the declaring plugin. Storage key is `<plugin>:<id>`.
	id: string;
	label: string;
	kind: PreferenceKind;
	// Grouping header in the Settings menu (e.g. "Layout"). Defaults to the plugin name if absent.
	group?: string;
	// Default value as a string (booleans as "true"/"false", numbers as their decimal text) -- one
	// wire type keeps the contract trivial; the host coerces per `kind`.
	default: string;
	// select-only.
	options?: PreferenceOption[];
	// number-only bounds (inclusive).
	min?: number;
	max?: number;
}

// A collected preference plus which plugin owns it.
export interface CollectedPreference {
	plugin: string;
	def: PreferenceDef;
}

// The one shape the Settings menu actually iterates -- a declared preference joined to a live value
// and a setter. Host-owned prefs (theme, motion, canvas input) and plugin-declared prefs both
// produce these, so the menu renders a single uniform list through one generic control and never
// hardcodes a row per preference. `value` is a store so the control re-renders when the underlying
// source (a theme store, viewport-input store, or the plugin value map) changes anywhere.
export interface PreferenceBinding {
	// Unique across the whole merged registry (host + every plugin). Also the control's element id.
	key: string;
	def: PreferenceDef;
	value: Readable<string>;
	set: (value: string) => void;
}

// ---------------------------------------------------------------------------
// Value storage (host-owned, localStorage-backed)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'kit10:plugin-prefs';

// Flat map of `<plugin>:<id>` -> string value. String-valued to match PreferenceDef.default's wire
// type; consumers coerce per kind.
type PrefMap = Record<string, string>;

function load(): PrefMap {
	try {
		if (typeof localStorage === 'undefined') return {};
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as PrefMap) : {};
	} catch {
		return {};
	}
}

export const pluginPreferenceValues: Writable<PrefMap> = writable(load());

function persist(map: PrefMap): void {
	try {
		if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
	} catch {
		// best-effort
	}
}

export function prefStorageKey(plugin: string, id: string): string {
	return `${plugin}:${id}`;
}

// Current value for a preference, falling back to its declared default.
export function preferenceValue(plugin: string, def: PreferenceDef): string {
	const map = get(pluginPreferenceValues);
	return map[prefStorageKey(plugin, def.id)] ?? def.default;
}

export function setPreferenceValue(plugin: string, id: string, value: string): void {
	const next = { ...get(pluginPreferenceValues), [prefStorageKey(plugin, id)]: value };
	pluginPreferenceValues.set(next);
	persist(next);
}

// The values for one plugin, keyed by bare preference id (no plugin prefix) -- this is the shape
// handed back to the plugin on its normal call inputs, so it reads its own prefs without knowing the
// host's storage-key scheme.
export function pluginPreferenceInput(plugin: string, defs: PreferenceDef[]): Record<string, string> {
	const out: Record<string, string> = {};
	for (const def of defs) out[def.id] = preferenceValue(plugin, def);
	return out;
}

// Turns collected plugin preferences into the uniform PreferenceBinding shape the menu renders --
// value derived live from the shared value map, set routed back through the localStorage-backed
// store. The group is namespaced under the plugin so two plugins declaring a "Layout" group don't
// collapse into one section.
export function pluginPreferenceBindings(collected: CollectedPreference[]): PreferenceBinding[] {
	return collected.map((cp) => {
		const key = prefStorageKey(cp.plugin, cp.def.id);
		return {
			key,
			def: {
				...cp.def,
				group: cp.def.group ? `${cp.plugin} · ${cp.def.group}` : cp.plugin
			},
			value: derived(pluginPreferenceValues, (map) => map[key] ?? cp.def.default),
			set: (v: string) => setPreferenceValue(cp.plugin, cp.def.id, v)
		} satisfies PreferenceBinding;
	});
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

// Calls each named plugin's optional `preferences` export and flattens the results. A plugin that
// doesn't export it (the common case today) throws inside Extism; we swallow that per-plugin so one
// opt-out never blanks the whole menu.
export async function collectPluginPreferences(
	pluginNames: string[],
	callUtilityPlugin: (name: string, fn: string, payload: string) => Promise<unknown>
): Promise<CollectedPreference[]> {
	const collected: CollectedPreference[] = [];
	await Promise.all(
		pluginNames.map(async (plugin) => {
			try {
				const raw = await callUtilityPlugin(plugin, 'preferences', '{}');
				const defs = parsePreferenceDefsExport(raw);
				for (const def of defs) collected.push({ plugin, def });
			} catch {
				// no `preferences` export, or it errored -- this plugin contributes nothing.
			}
		})
	);
	return collected;
}

// Coerces a plugin's `preferences` export result (a JSON string, or already-parsed value) into a
// validated PreferenceDef[]. Exported so the manager can reuse it for the interpreter plugin, which
// isn't reachable through callUtilityPlugin.
export function parsePreferenceDefsExport(raw: unknown): PreferenceDef[] {
	let value = raw;
	// callUtilityPlugin returns whatever the plugin call yields -- typically a JSON string.
	if (typeof value === 'string') {
		try {
			value = JSON.parse(value);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(value)) return [];
	return (value as PreferenceDef[]).filter(
		(d) => d && typeof d.id === 'string' && typeof d.label === 'string' && typeof d.kind === 'string'
	);
}

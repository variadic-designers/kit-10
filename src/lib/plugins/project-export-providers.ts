// Runtime resolver over listPlugins() -- same reason as suggestion-providers.ts (VISION.md's
// 1st Principle): the UI that builds the Export submenu never hardcodes a specific plugin's
// name inline, it reads whatever's actually installed. A plugin declares its own export
// capability on its manifest's `provides.exports` (see schema.ts); adding a new project-level
// export target is now a matter of a plugin registering itself with that capability, not an
// edit to this file.
//
// A provider only actually shows up in the Export submenu once the matching plugin is
// registered in the DB-backed catalogue (listPlugins()) with a matching `provides.exports`
// entry -- see Project.svelte's availableExportProviders.

import type { PluginRow, ExportCapability } from 'manager';

export interface ProjectExportProvider extends ExportCapability {
	// The owning plugin's registry name -- attached here rather than living on the manifest
	// capability itself, since a manifest has no way to know its own registry `name`.
	id: string;
}

export function resolveExportProviders(plugins: PluginRow[]): ProjectExportProvider[] {
	return plugins.flatMap((p) =>
		(p.manifest.provides?.exports ?? []).map((capability) => ({ id: p.name, ...capability }))
	);
}

// Import-side mirror of project-export-providers.ts -- same runtime-resolver-over-listPlugins()
// shape (VISION.md's 1st Principle), same reason: the "Import" submenu never hardcodes a
// plugin's name, it reads whatever's actually installed. A provider only shows up once the
// matching plugin is actually registered in the DB-backed catalogue and declares an
// `provides.imports` capability on its manifest (see schema.ts).

import type { PluginRow, ImportCapability } from 'manager';

export interface ProjectImportProvider extends ImportCapability {
	// The owning plugin's registry name -- attached here rather than living on the manifest
	// capability itself, since a manifest has no way to know its own registry `name`.
	id: string;
}

export function resolveImportProviders(plugins: PluginRow[]): ProjectImportProvider[] {
	return plugins.flatMap((p) =>
		(p.manifest.provides?.imports ?? []).map((capability) => ({ id: p.name, ...capability }))
	);
}

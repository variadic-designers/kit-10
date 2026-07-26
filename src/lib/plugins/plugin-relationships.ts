// Resolves plugin "support for" / "dependency of" relationships -- same pure, sync resolver
// posture as project-export-providers.ts/export-profile.ts. A plugin declares `supports` on its
// own manifest (e.g. WebCodium declares `supports: ['charter']`, meaning its export logic was
// built to understand Charter's specific translation opinions, not just "any interpreter"). The
// reverse view -- "Charter is a dependency of WebCodium" -- is never stored; it's derived here by
// scanning every installed plugin's own `supports` list.
//
// Informational only: nothing in the editor gates on whether a declared `supports` target is
// actually installed. See schema.ts's PluginManifest.supports doc comment.

import type { PluginRow } from 'manager';

export interface PluginRelationship {
	name: string;
	// This plugin's own declared `supports` list, each annotated with whether that plugin is
	// actually installed right now. The `installed` flag is honest, cheaply-computed data even
	// though the current UI doesn't react to it -- a future "warn when unsatisfied" pass reuses
	// this resolver unchanged.
	supports: { name: string; installed: boolean }[];
	// Derived, never stored: every other installed plugin whose own `supports` list names this
	// plugin.
	dependencyOf: string[];
}

export function resolvePluginRelationships(plugins: PluginRow[]): PluginRelationship[] {
	const installedNames = new Set(plugins.map((p) => p.name));

	return plugins.map((p) => {
		const supports = (p.manifest.supports ?? []).map((name) => ({
			name,
			installed: installedNames.has(name)
		}));

		const dependencyOf = plugins
			.filter((other) => other.name !== p.name && (other.manifest.supports ?? []).includes(p.name))
			.map((other) => other.name);

		return { name: p.name, supports, dependencyOf };
	});
}

// Resolves "which installed plugin actually handles which export target right now" -- used by
// both the Export panel (Export.svelte) and Project.svelte's export submenu. Kept pure and sync
// (no api/DB calls) so it's trivially unit-testable against a hand-built ProjectExportProvider[]
// fixture, mirroring project-export-providers.ts's own resolver posture.
//
// A project's chosen mapping lives at hints.exportProfile (target -> owning plugin's registry
// `name`), namespaced exactly like hints.vellum/hints.charter -- see updateProjectHints and its
// shallow top-level-only jsonb merge (manager/src/api/index.ts). There is no DB-side concept of
// an Export Profile: it's just another hints sub-object.

import type { ProjectExportProvider } from './project-export-providers.js';

export type ExportProfile = Record<string, string>;

export interface ExportTargetGroup {
	target: string;
	providers: ProjectExportProvider[];
	// The provider that should actually run for this target right now: the project's saved
	// choice if it's still an installed provider for this target, else the sole provider if
	// there's exactly one (no real choice to make), else null when 2+ providers compete and
	// nothing's been chosen yet -- ambiguous, needs the user to pick in the Export panel.
	effective: ProjectExportProvider | null;
}

// A provider's own normalized target, falling back to fileExtension for any manifest that
// predates the `target` field (see schema.ts's ExportCapability).
export function effectiveTarget(provider: ProjectExportProvider): string {
	return provider.target ?? provider.fileExtension;
}

export function groupExportProvidersByTarget(
	providers: ProjectExportProvider[]
): Map<string, ProjectExportProvider[]> {
	const groups = new Map<string, ProjectExportProvider[]>();
	for (const provider of providers) {
		const target = effectiveTarget(provider);
		const list = groups.get(target);
		if (list) list.push(provider);
		else groups.set(target, [provider]);
	}
	return groups;
}

// Combines grouping with the saved profile to produce one row per currently-installed target. A
// saved choice pointing at a plugin that's since been uninstalled (or no longer declares that
// target) is deliberately NOT trusted -- `saved` only matches from providers that are actually
// still in this target's group, so a stale hints entry just falls through to the
// single/ambiguous rule below instead of silently referencing a dead provider.
export function resolveExportProfile(
	providers: ProjectExportProvider[],
	exportProfile: ExportProfile | undefined
): ExportTargetGroup[] {
	const groups = groupExportProvidersByTarget(providers);
	return [...groups.entries()].map(([target, targetProviders]) => {
		const savedPluginId = exportProfile?.[target];
		const saved = savedPluginId ? targetProviders.find((p) => p.id === savedPluginId) : undefined;
		const effective = saved ?? (targetProviders.length === 1 ? targetProviders[0]! : null);
		return { target, providers: targetProviders, effective };
	});
}

// Builds the next hints.exportProfile object for a single changed target -- spreads the
// existing sub-object then overrides just the one key, same pattern Viewport.svelte already
// uses for hints.vellum (updateProjectHints's jsonb merge is shallow only at the top level, so
// the caller must pass the whole exportProfile sub-object, not just the changed key).
export function buildExportProfileHints(
	current: ExportProfile | undefined,
	target: string,
	pluginId: string
): ExportProfile {
	return { ...current, [target]: pluginId };
}

// Per-view "include this view when plugin X exports" flag -- lives at hints.<providerId>.export,
// namespaced by the exporting plugin's own registry id exactly like hints.vellum/hints.charter,
// never a literal plugin name hardcoded anywhere that reads/writes it (see
// feedback_editor_plugin_agnosticism / VISION.md's 1st Principle). Both Views.svelte (the
// per-view context-menu toggle) and Export.svelte (the view list an export run actually uses)
// read/write through these two functions instead of each poking at the hints shape directly, so
// the shape only has to be right in one place.
//
// Kept pure and sync, same posture as export-profile.ts's own resolvers -- trivially testable
// against a hand-built hints object, no api/DB calls.

export function isFlaggedForExport(
	hints: Record<string, unknown> | null | undefined,
	providerId: string
): boolean {
	const ns = hints?.[providerId] as { export?: boolean } | undefined;
	return ns?.export === true;
}

// Builds the next hints value for a single toggle -- spreads the existing per-provider
// sub-object (if any) so a future second key under that same namespace isn't clobbered, same
// shallow-merge discipline export-profile.ts's buildExportProfileHints already established
// (updateViewHints only merges hints itself shallowly at the top level; the caller owns merging
// within the namespace it's touching).
export function buildExportFlagHints(
	hints: Record<string, unknown> | null | undefined,
	providerId: string,
	flagged: boolean
): Record<string, unknown> {
	const current = (hints?.[providerId] as Record<string, unknown> | undefined) ?? {};
	return { [providerId]: { ...current, export: flagged } };
}

// Resolves a single property's ResolvedProperty (manager's resolve.ts) for an ARBITRARY view
// given only its already-resolved kits, without re-deriving the resolve/cascade pipeline itself.
// Extracted out of Styles.svelte's own `track()` (which builds the same sourceLayerId/isToken/
// tokenId facts but also carries UI-display-only fields track() needs and this doesn't, plus a
// "property never authored" fallback onto the active kit's null layer -- not reachable here for
// either caller: a resizable view's width/height must already be a resolved Fixed (Px) value to
// be resizable at all, and a draggable grid gutter's tracks must already be resolved Fr values --
// both are always already present in resolvedMap by construction).
//
// Returns the FULL `ResolvedProperty`, not just the narrower `CommitTarget` shape `commitFieldValue`
// needs (it's a structural superset, so it satisfies that call site directly) -- callers that also
// need the property's current raw string VALUE (e.g. the grid-gutter-drag commit, which must parse
// the current `grid-template-columns`/`rows` track list before editing two entries in it) would
// otherwise need a second, duplicate resolve just to read `.value`.
//
// Styles.svelte's `resolvedKits` prop only ever covers the currently ACTIVE view (Editor.svelte
// derives it from `resolvedViews.find(v => v.viewId === editorActivity.activeViewId)`), so a
// canvas gesture -- which can target whichever view is primary-selected on the canvas,
// independent of which panel view is "active" -- needs its own per-view lookup into the same
// `resolvedViews` array Viewport.svelte already has, not Styles.svelte's narrower prop.

import { flattenKitResults, type ResolvedKit, type ResolvedProperty } from 'manager';

export function resolveFieldTarget(
	resolvedKits: ResolvedKit[] | null,
	key: string
): ResolvedProperty | null {
	if (!resolvedKits) return null;
	return flattenKitResults(resolvedKits).get(key) ?? null;
}

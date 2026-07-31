// Structural (not imported) types -- TypeScript's ambient `.svelte` module declarations don't
// carry named-export info into plain .ts files, so EditorActivity/EditorSelection from
// Editor.svelte can't be imported here directly. These narrower shapes are satisfied by the
// real types structurally, so callers passing the genuine editorActivity/selection objects
// still get full type-checking at the call site.
interface SelectableActivity {
	activeViewId: string | null;
}

interface SelectableSelection {
	selectedViewPrimary: string | null;
	selectedOccurrencePrimary: string | null;
	selectedViewSecondary: string[];
	selectedOccurrenceSecondary: (string | null)[];
	selectedKitIndex: number | null;
}

// Shared by the Views panel (row click) and the Viewport (canvas click, via
// vellum.get_selection + Charter's node_view_ids/node_occurrence_ids side-maps) so both
// interaction paths funnel into the exact same selection state instead of drifting apart.
//
// `occurrenceKey` identifies the SPECIFIC rendered instance clicked (the referencing token's own
// id for a nested view, or the view's own id for a root -- see view-tree.ts's ViewOccurrence).
// Defaults to `viewId` itself when omitted, which is exactly correct for every call site that has
// no real occurrence context (fresh-view-creation flows, field pickers) -- a view with only one
// occurrence (the common case) has that occurrence's key equal to its own id anyway.
export function selectView(
	editorActivity: SelectableActivity,
	selection: SelectableSelection,
	viewId: string,
	occurrenceKey: string | null = viewId
) {
	if (editorActivity.activeViewId !== viewId) {
		editorActivity.activeViewId = viewId;
	}
	selection.selectedViewPrimary = viewId;
	selection.selectedOccurrencePrimary = occurrenceKey ?? viewId;
	selection.selectedViewSecondary = [];
	selection.selectedOccurrenceSecondary = [];
}

// Mirrors the Views panel's "Deselect" context-menu action -- used by the Viewport when a
// click hits empty canvas (no node under the cursor, or a structural grid-scaffolding node
// with no owning view).
//
// Also clears activeViewId: Charter's compute_selection draws the primary-selection border
// if EITHER activeViewId OR selectedOccurrencePrimary matches, so leaving activeViewId set
// left the border stuck on screen after a deselect. Styles/Axes panels already have an
// empty state for activeViewId === null, so this is safe.
export function deselectView(activity: SelectableActivity, selection: SelectableSelection) {
	activity.activeViewId = null;
	selection.selectedViewPrimary = null;
	selection.selectedOccurrencePrimary = null;
	selection.selectedKitIndex = null;
}

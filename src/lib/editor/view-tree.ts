// View composition-tree math, extracted so both the Views panel and the global navigation keybind
// handler read one source of truth instead of duplicating the graph walk.
//
// Charter's only nesting opinion is the `composition_field_keys` list (which resolved-property keys
// carry child `viewRefs`); everything here is generic graph math over already-resolved data, not
// Charter-specific. Lifted verbatim from what Views.svelte used to compute inline.
//
// OCCURRENCE-AWARE: a view can be rendered more than once simultaneously (once per referencing
// `view`-typed token -- see resolve.ts's OverriddenOccurrence). Every node in this tree is a
// ViewOccurrence, not a bare view id: `occurrenceKey` is the referencing token's own id for a
// nested view, or the view's own `viewId` for a root (a root is unreferenced by definition, so it
// has exactly one occurrence). This mirrors Charter's `occurrence_id`/`node_occurrence_ids`
// exactly, so a click/hover/selection on one specific rendered instance can be told apart from
// another instance of the same view.

import type { ResolvedView } from '$lib/plugins/types.js';
import type { OverriddenOccurrence } from 'manager';

export interface ViewOccurrence {
	viewId: string;
	occurrenceKey: string;
}

export interface ViewTree {
	// A view's OWN plain children (used for its root occurrence, or any non-overridden reference
	// occurrence of it) -- mirrors Charter's `view_map` fallback.
	childrenByViewId: Map<string, ViewOccurrence[]>;
	// Override-specific children, only for occurrence keys whose axis override could change which
	// Layer sets a composition property -- mirrors Charter's `occurrence_map`, consulted FIRST.
	overriddenChildrenByOccurrenceKey: Map<string, ViewOccurrence[]>;
	// Every VIEW id that is referenced by ANY occurrence (view-level, not occurrence-level --
	// mirrors Charter's own `referenced` set in build_viewport exactly, since a view is top-level
	// iff nothing's children lists it AT ALL, regardless of which specific occurrence does). A
	// view id NOT in this set is a root; its own (sole) occurrence key is its own viewId. Every
	// occurrence key that names a nested reference (a token id) is trivially never a root by
	// construction, so this set only needs view-id granularity.
	referencedViewIds: Set<string>;
	// Every occurrence key's own viewId -- needed because `overriddenChildrenByOccurrenceKey` is
	// keyed by occurrence key alone, so recovering "which view is this occurrence OF" (e.g. while
	// walking `parentOf`'s ancestor chain) needs an explicit lookup rather than being derivable
	// from the key itself. Populated for every ref this tree has ever seen, plus each view's own
	// root self-mapping (viewId -> viewId) and each OverriddenOccurrence's own viewId.
	viewIdByOccurrenceKey: Map<string, string>;
}

// An occurrence's effective children: its own override's children if it has one, else the
// underlying view's plain children. Mirrors Charter's `effective_child_kits` fallback exactly.
export function childrenOf(tree: ViewTree, occ: ViewOccurrence): ViewOccurrence[] {
	return (
		tree.overriddenChildrenByOccurrenceKey.get(occ.occurrenceKey) ??
		tree.childrenByViewId.get(occ.viewId) ??
		[]
	);
}

function collectRefs(
	resolvedKits: ResolvedView['resolvedKits'],
	compositionKeys: string[]
): ViewOccurrence[] {
	const refs: ViewOccurrence[] = [];
	for (const kit of resolvedKits) {
		for (const key of compositionKeys) {
			for (const ref of kit.properties?.get(key)?.viewRefs ?? []) {
				refs.push({ viewId: ref.viewId, occurrenceKey: ref.tokenId });
			}
		}
	}
	return refs;
}

// Union a view's child references across all its resolved kits and every composition key, PLUS
// (separately) every overridden occurrence's own child references -- an override can change which
// Layer sets a composition property, so its children can genuinely differ from the plain view's.
export function buildViewTree(
	resolvedViews: ResolvedView[],
	compositionKeys: string[],
	overriddenOccurrences: OverriddenOccurrence[] = []
): ViewTree {
	const childrenByViewId = new Map<string, ViewOccurrence[]>();
	const viewIdByOccurrenceKey = new Map<string, string>();
	for (const view of resolvedViews) {
		const refs = collectRefs(view.resolvedKits, compositionKeys);
		childrenByViewId.set(view.viewId, refs);
		// A view's own root occurrence key is itself.
		viewIdByOccurrenceKey.set(view.viewId, view.viewId);
		for (const ref of refs) viewIdByOccurrenceKey.set(ref.occurrenceKey, ref.viewId);
	}

	const overriddenChildrenByOccurrenceKey = new Map<string, ViewOccurrence[]>();
	for (const occ of overriddenOccurrences) {
		const refs = collectRefs(occ.resolvedKits, compositionKeys);
		overriddenChildrenByOccurrenceKey.set(occ.occurrenceKey, refs);
		viewIdByOccurrenceKey.set(occ.occurrenceKey, occ.viewId);
		for (const ref of refs) viewIdByOccurrenceKey.set(ref.occurrenceKey, ref.viewId);
	}

	const referencedViewIds = new Set<string>();
	for (const list of childrenByViewId.values()) {
		for (const occ of list) referencedViewIds.add(occ.viewId);
	}
	for (const list of overriddenChildrenByOccurrenceKey.values()) {
		for (const occ of list) referencedViewIds.add(occ.viewId);
	}

	return {
		childrenByViewId,
		overriddenChildrenByOccurrenceKey,
		referencedViewIds,
		viewIdByOccurrenceKey
	};
}

// ---------------------------------------------------------------------------
// Stateless first-parent navigation
// ---------------------------------------------------------------------------

export type NavDirection = 'parent' | 'child' | 'prev' | 'next';

function sameOccurrence(a: ViewOccurrence, b: ViewOccurrence): boolean {
	return a.occurrenceKey === b.occurrenceKey;
}

// Some real occurrence of `viewId` -- its own root identity if it's never referenced, else the
// first reference to it found anywhere (stateless "first match", same posture as parentOf
// itself). Needed because `childrenByViewId` is keyed by VIEW id (a view's plain children apply
// identically regardless of which of ITS OWN occurrences you're looking at), so finding a child
// there only tells you the parent's identity, not which of the parent's own occurrences is the
// "real" one -- if the parent itself isn't a root, assuming a self-keyed root occurrence would
// synthesize an occurrence key nothing in the tree actually uses.
function anyOccurrenceOf(viewId: string, tree: ViewTree): ViewOccurrence {
	if (!tree.referencedViewIds.has(viewId)) return { viewId, occurrenceKey: viewId };
	for (const kids of tree.childrenByViewId.values()) {
		const found = kids.find((k) => k.viewId === viewId);
		if (found) return found;
	}
	for (const kids of tree.overriddenChildrenByOccurrenceKey.values()) {
		const found = kids.find((k) => k.viewId === viewId);
		if (found) return found;
	}
	return { viewId, occurrenceKey: viewId };
}

// First parent occurrence whose children include `occ`. A view is a DAG node (can have several
// parents/occurrences); the "first parent found" is a deliberate stateless choice -- no
// breadcrumb, no remembered context. Scans every known occurrence as a potential parent: each
// view's own root occurrence (viewId as its own key) and every overridden occurrence.
export function parentOf(occ: ViewOccurrence, tree: ViewTree): ViewOccurrence | null {
	for (const [viewId, kids] of tree.childrenByViewId) {
		if (kids.some((k) => sameOccurrence(k, occ))) {
			return anyOccurrenceOf(viewId, tree);
		}
	}
	for (const [occurrenceKey, kids] of tree.overriddenChildrenByOccurrenceKey) {
		if (kids.some((k) => sameOccurrence(k, occ))) {
			const viewId = tree.viewIdByOccurrenceKey.get(occurrenceKey) ?? occurrenceKey;
			return { viewId, occurrenceKey };
		}
	}
	return null;
}

export function firstChildOf(occ: ViewOccurrence, tree: ViewTree): ViewOccurrence | null {
	return childrenOf(tree, occ)[0] ?? null;
}

// The ordered sibling list `occ` belongs to: its parent's children, or the root order if it's a root.
export function siblingsOf(
	occ: ViewOccurrence,
	tree: ViewTree,
	roots: ViewOccurrence[]
): ViewOccurrence[] {
	const parent = parentOf(occ, tree);
	if (parent) return childrenOf(tree, parent);
	return roots;
}

// Resolves which root view a canvas drag hit should actually move. A direct hit on a root
// view's own paint area works as before (falls through to the last line). But a root with zero
// padding fully tiled by covering children (composed child views, or even its own nested
// content) has no point that hit-tests to its own box -- every click resolves to whichever
// child covers that pixel, so it could never be dragged at all. When the ACTIVE view is a root
// and the hit view is it (or a descendant of it, walked via the same first-parent `parentOf`
// used for `[`/`]` nav), the active root is the target regardless of which specific descendant
// was actually hit. A non-active root still only drags on a direct hit -- deliberately not
// walking up to the nearest root ancestor unconditionally, since that would preclude a possible
// future drag-to-reorder-children feature (a drag on a non-active view's children should stay
// free for that, not always mean "move the root"). Returns null if neither applies.
//
// Drag-to-reparent targets a VIEW (composition tree edit), not a specific occurrence -- an
// occurrence has no independent position/hint storage (`hints.vellum.position` is per-view) -- so
// this still returns a plain view id. The occurrence-aware `hitOcc` is only used to walk the
// ancestor chain correctly when the hit view has more than one active occurrence.
export function resolveDragTargetViewId(
	hitOcc: ViewOccurrence,
	activeViewId: string | null,
	rootViewIds: Set<string>,
	tree: ViewTree
): string | null {
	if (activeViewId && rootViewIds.has(activeViewId)) {
		let current: ViewOccurrence | null = hitOcc;
		while (current !== null) {
			if (current.viewId === activeViewId) return activeViewId;
			current = parentOf(current, tree);
		}
	}
	return rootViewIds.has(hitOcc.viewId) ? hitOcc.viewId : null;
}

// Resolve a navigation step to a target occurrence (or null when there's nowhere to go).
//   parent -> first parent
//   child  -> first child
//   prev/next -> adjacent sibling (clamped at the ends, no wrap)
// With no current selection, `child`/`next` fall to the first root so the keys still do something.
export function navigate(
	current: ViewOccurrence | null,
	dir: NavDirection,
	tree: ViewTree,
	roots: ViewOccurrence[]
): ViewOccurrence | null {
	if (!current) {
		return dir === 'child' || dir === 'next' ? (roots[0] ?? null) : null;
	}
	switch (dir) {
		case 'parent':
			return parentOf(current, tree);
		case 'child':
			return firstChildOf(current, tree);
		case 'prev':
		case 'next': {
			const sibs = siblingsOf(current, tree, roots);
			const i = sibs.findIndex((s) => sameOccurrence(s, current));
			if (i === -1) return null;
			const j = dir === 'prev' ? i - 1 : i + 1;
			if (j < 0 || j >= sibs.length) return null;
			return sibs[j] ?? null;
		}
	}
}

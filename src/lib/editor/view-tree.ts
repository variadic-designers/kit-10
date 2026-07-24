// View composition-tree math, extracted so both the Views panel and the global navigation keybind
// handler read one source of truth instead of duplicating the graph walk.
//
// Charter's only nesting opinion is the `composition_field_keys` list (which resolved-property keys
// carry child `viewRefs`); everything here is generic graph math over already-resolved data, not
// Charter-specific. Lifted verbatim from what Views.svelte used to compute inline.

import type { ResolvedView } from '$lib/plugins/types.js';

export interface ViewTree {
	// parent viewId -> ordered child viewIds (unioned across the view's resolved kits + composition keys).
	childrenByViewId: Map<string, string[]>;
	// every viewId that appears as somebody's child. A view NOT in this set is a root.
	referencedViewIds: Set<string>;
}

// Union a view's child references across all its resolved kits and every composition key.
export function buildViewTree(resolvedViews: ResolvedView[], compositionKeys: string[]): ViewTree {
	const childrenByViewId = new Map<string, string[]>();
	for (const view of resolvedViews) {
		const ids = new Set<string>();
		for (const kit of view.resolvedKits) {
			for (const key of compositionKeys) {
				for (const id of kit.properties?.get(key)?.viewRefs ?? []) ids.add(id);
			}
		}
		childrenByViewId.set(view.viewId, [...ids]);
	}

	const referencedViewIds = new Set<string>();
	for (const list of childrenByViewId.values()) {
		for (const id of list) referencedViewIds.add(id);
	}

	return { childrenByViewId, referencedViewIds };
}

// ---------------------------------------------------------------------------
// Stateless first-parent navigation
// ---------------------------------------------------------------------------

export type NavDirection = 'parent' | 'child' | 'prev' | 'next';

// First parent whose child list includes `id`. A view is a DAG node (can have several parents); the
// "first parent found" is a deliberate stateless choice -- no breadcrumb, no remembered context.
export function parentOf(id: string, tree: ViewTree): string | null {
	for (const [parent, kids] of tree.childrenByViewId) {
		if (kids.includes(id)) return parent;
	}
	return null;
}

export function firstChildOf(id: string, tree: ViewTree): string | null {
	return tree.childrenByViewId.get(id)?.[0] ?? null;
}

// The ordered sibling list `id` belongs to: its parent's children, or the root order if it's a root.
export function siblingsOf(id: string, tree: ViewTree, roots: string[]): string[] {
	const parent = parentOf(id, tree);
	if (parent) return tree.childrenByViewId.get(parent) ?? [];
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
export function resolveDragTargetViewId(
	hitViewId: string,
	activeViewId: string | null,
	rootViewIds: Set<string>,
	tree: ViewTree
): string | null {
	if (activeViewId && rootViewIds.has(activeViewId)) {
		let current: string | null = hitViewId;
		while (current !== null) {
			if (current === activeViewId) return activeViewId;
			current = parentOf(current, tree);
		}
	}
	return rootViewIds.has(hitViewId) ? hitViewId : null;
}

// Resolve a navigation step to a target viewId (or null when there's nowhere to go).
//   parent -> first parent
//   child  -> first child
//   prev/next -> adjacent sibling (clamped at the ends, no wrap)
// With no current selection, `child`/`next` fall to the first root so the keys still do something.
export function navigate(
	current: string | null,
	dir: NavDirection,
	tree: ViewTree,
	roots: string[]
): string | null {
	if (!current) {
		return dir === 'child' || dir === 'next' ? roots[0] ?? null : null;
	}
	switch (dir) {
		case 'parent':
			return parentOf(current, tree);
		case 'child':
			return firstChildOf(current, tree);
		case 'prev':
		case 'next': {
			const sibs = siblingsOf(current, tree, roots);
			const i = sibs.indexOf(current);
			if (i === -1) return null;
			const j = dir === 'prev' ? i - 1 : i + 1;
			if (j < 0 || j >= sibs.length) return null;
			return sibs[j];
		}
	}
}

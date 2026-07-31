import { describe, it, expect } from 'vitest';
import {
	buildViewTree,
	childrenOf,
	parentOf,
	firstChildOf,
	siblingsOf,
	navigate,
	resolveDragTargetViewId,
	type ViewTree,
	type ViewOccurrence
} from './view-tree.js';
import type { ResolvedView } from '$lib/plugins/types.js';
import type { OverriddenOccurrence } from 'manager';

// Build a ResolvedView whose single kit sets `children` to the given view ids -- N `view`-typed
// tokens sharing the alias in practice, so `viewRefs` is `{viewId, tokenId}[]`, not a bare
// string[]. Each ref's tokenId is deterministic (`${id}-tok-${i}`) so occurrence keys are
// predictable in these fixtures.
function view(id: string, children: string[] = []): ResolvedView {
	return {
		viewId: id,
		viewName: id,
		hints: null,
		resolvedKits: [
			{
				kitId: `${id}-kit`,
				kitName: 'k',
				properties: new Map([
					[
						'children',
						{
							property: 'children',
							viewRefs: children.map((childId, i) => ({
								viewId: childId,
								tokenId: `${id}-tok-${i}`
							}))
						} as never
					]
				])
			} as never
		]
	};
}

// A root occurrence's key is its own viewId (see view-tree.ts's ViewTree doc); a nested
// occurrence's key is the referencing token's own id.
const root = (viewId: string): ViewOccurrence => ({ viewId, occurrenceKey: viewId });
const ref = (viewId: string, occurrenceKey: string): ViewOccurrence => ({ viewId, occurrenceKey });

// A → [B, C]; B → [D]. Roots: [A]. Siblings of B/C: [B, C]. D's parent: B.
// Ref token ids: A's children are A-tok-0 (B), A-tok-1 (C); B's child is B-tok-0 (D).
const views = [view('A', ['B', 'C']), view('B', ['D']), view('C'), view('D')];
const tree: ViewTree = buildViewTree(views, ['children']);
const roots: ViewOccurrence[] = views
	.map((v) => v.viewId)
	.filter((id) => !tree.referencedViewIds.has(id))
	.map(root);

const occB = ref('B', 'A-tok-0');
const occC = ref('C', 'A-tok-1');
const occD = ref('D', 'B-tok-0');
const occA = root('A');

describe('buildViewTree', () => {
	it('maps parent → children (as occurrences) and collects referenced view ids', () => {
		expect(tree.childrenByViewId.get('A')).toEqual([occB, occC]);
		expect(tree.childrenByViewId.get('B')).toEqual([occD]);
		expect([...tree.referencedViewIds].sort()).toEqual(['B', 'C', 'D']);
	});

	it('yields A as the only root', () => {
		expect(roots).toEqual([occA]);
	});

	it('ignores keys not in the composition list', () => {
		const empty = buildViewTree(views, []);
		expect([...empty.referencedViewIds]).toEqual([]);
	});
});

describe('childrenOf', () => {
	it("returns a view's own plain children when no override applies", () => {
		expect(childrenOf(tree, occA)).toEqual([occB, occC]);
		expect(childrenOf(tree, occB)).toEqual([occD]);
		expect(childrenOf(tree, occC)).toEqual([]);
	});

	it("prefers an overridden occurrence's own children over the plain view's", () => {
		// B's occurrence via A (A-tok-0) is overridden to have no children at all, instead of B's
		// own [D] -- an axis override changing which Layer sets `children` for that one reference.
		const overrides: OverriddenOccurrence[] = [
			{ occurrenceKey: 'A-tok-0', viewId: 'B', resolvedKits: [] }
		];
		const overriddenTree = buildViewTree(views, ['children'], overrides);
		expect(childrenOf(overriddenTree, occB)).toEqual([]);
		// A DIFFERENT (non-overridden) occurrence of B would still see B's own children -- not
		// exercised here since B only has one occurrence in this fixture, but the plain
		// childrenByViewId fallback is unaffected by the override above.
		expect(overriddenTree.childrenByViewId.get('B')).toEqual([occD]);
	});
});

describe('parent/child/siblings', () => {
	it('parentOf finds the containing occurrence', () => {
		expect(parentOf(occD, tree)).toEqual(occB);
		expect(parentOf(occB, tree)).toEqual(occA);
		expect(parentOf(occA, tree)).toBeNull();
	});

	it('firstChildOf returns the first child occurrence', () => {
		expect(firstChildOf(occA, tree)).toEqual(occB);
		expect(firstChildOf(occC, tree)).toBeNull();
	});

	it('siblingsOf returns parent children, or roots for a root', () => {
		expect(siblingsOf(occB, tree, roots)).toEqual([occB, occC]);
		expect(siblingsOf(occA, tree, roots)).toEqual([occA]);
	});
});

describe('navigate', () => {
	it('parent / child', () => {
		expect(navigate(occD, 'parent', tree, roots)).toEqual(occB);
		expect(navigate(occA, 'child', tree, roots)).toEqual(occB);
		expect(navigate(occD, 'child', tree, roots)).toBeNull();
		expect(navigate(occA, 'parent', tree, roots)).toBeNull();
	});

	it('prev / next siblings with clamping (no wrap)', () => {
		expect(navigate(occB, 'next', tree, roots)).toEqual(occC);
		expect(navigate(occC, 'prev', tree, roots)).toEqual(occB);
		expect(navigate(occC, 'next', tree, roots)).toBeNull(); // last, clamped
		expect(navigate(occB, 'prev', tree, roots)).toBeNull(); // first, clamped
	});

	it('falls to first root with no current selection', () => {
		expect(navigate(null, 'next', tree, roots)).toEqual(occA);
		expect(navigate(null, 'child', tree, roots)).toEqual(occA);
		expect(navigate(null, 'parent', tree, roots)).toBeNull();
	});
});

describe('multi-parent (DAG): each occurrence resolves to its OWN specific parent', () => {
	// X → [Z] (via token X-tok-0); Y → [Z] (via token Y-tok-0). Z has two independent occurrences,
	// not one -- unlike the pre-occurrence-aware "first parent wins" behavior, parentOf now
	// correctly disambiguates by occurrence key: the Z-via-X occurrence's parent is X, and the
	// Z-via-Y occurrence's parent is Y, never conflated.
	const dag = [view('X', ['Z']), view('Y', ['Z']), view('Z')];
	const t = buildViewTree(dag, ['children']);
	const zViaX = ref('Z', 'X-tok-0');
	const zViaY = ref('Z', 'Y-tok-0');

	it('resolves each occurrence to its own parent', () => {
		expect(parentOf(zViaX, t)).toEqual(root('X'));
		expect(parentOf(zViaY, t)).toEqual(root('Y'));
	});
});

// A separate fixture from the shared `views`/`tree`/`roots` above (matching the DAG block's own
// pattern) so adding a second unrelated root here doesn't perturb the siblingsOf/navigate
// assertions that rely on `roots` being exactly [occA]. Same A → [B, C]; B → [D] shape, plus an
// unrelated second root E with no children of its own.
describe('resolveDragTargetViewId', () => {
	const dragViews = [view('A', ['B', 'C']), view('B', ['D']), view('C'), view('D'), view('E')];
	const dragTree = buildViewTree(dragViews, ['children']);
	const dragRootViewIds = new Set(
		dragViews.map((v) => v.viewId).filter((id) => !dragTree.referencedViewIds.has(id))
	);

	it('targets the active root when hit directly', () => {
		expect(resolveDragTargetViewId(occA, 'A', dragRootViewIds, dragTree)).toBe('A');
	});

	it('targets the active root when the hit is a nested descendant (through covering children)', () => {
		// D is A's grandchild (A -> B -> D) -- e.g. a full-bleed root whose composed children
		// (or its own nested content) leave no point that hit-tests to A's own box directly.
		expect(resolveDragTargetViewId(occD, 'A', dragRootViewIds, dragTree)).toBe('A');
		expect(resolveDragTargetViewId(occC, 'A', dragRootViewIds, dragTree)).toBe('A');
	});

	it('falls back to a direct root hit when the active view is not a root', () => {
		// B is referenced (A's child), so it's never treated as the active-root target even
		// though it's "active" -- only a hit that's itself a root passes through here.
		expect(resolveDragTargetViewId(root('E'), 'B', dragRootViewIds, dragTree)).toBe('E');
		expect(resolveDragTargetViewId(occD, 'B', dragRootViewIds, dragTree)).toBeNull();
	});

	it('falls back to a direct root hit when there is no active view', () => {
		expect(resolveDragTargetViewId(root('E'), null, dragRootViewIds, dragTree)).toBe('E');
	});

	it('does not redirect a hit on an unrelated root to the active root', () => {
		// E is a root but not a descendant of A -- dragging E must still drag E, not A.
		expect(resolveDragTargetViewId(root('E'), 'A', dragRootViewIds, dragTree)).toBe('E');
	});

	it('returns null for a non-root hit that is not within the active root either', () => {
		// No active view, and D (a non-root) is hit directly -- nothing to drag.
		expect(resolveDragTargetViewId(occD, null, dragRootViewIds, dragTree)).toBeNull();
	});
});

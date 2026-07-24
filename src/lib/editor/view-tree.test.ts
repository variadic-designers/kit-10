import { describe, it, expect } from 'vitest';
import {
	buildViewTree,
	parentOf,
	firstChildOf,
	siblingsOf,
	navigate,
	resolveDragTargetViewId,
	type ViewTree
} from './view-tree.js';
import type { ResolvedView } from '$lib/plugins/types.js';

// Build a ResolvedView whose single kit sets `children` to the given view ids (a view-list prop).
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
					['children', { property: 'children', viewRefs: children } as never]
				])
			} as never
		]
	};
}

// A → [B, C]; B → [D]. Roots: [A]. Siblings of B/C: [B, C]. D's parent: B.
const views = [view('A', ['B', 'C']), view('B', ['D']), view('C'), view('D')];
const tree: ViewTree = buildViewTree(views, ['children']);
const roots = views.map((v) => v.viewId).filter((id) => !tree.referencedViewIds.has(id));

describe('buildViewTree', () => {
	it('maps parent → children and collects referenced ids', () => {
		expect(tree.childrenByViewId.get('A')).toEqual(['B', 'C']);
		expect(tree.childrenByViewId.get('B')).toEqual(['D']);
		expect([...tree.referencedViewIds].sort()).toEqual(['B', 'C', 'D']);
	});

	it('yields A as the only root', () => {
		expect(roots).toEqual(['A']);
	});

	it('ignores keys not in the composition list', () => {
		const empty = buildViewTree(views, []);
		expect([...empty.referencedViewIds]).toEqual([]);
	});
});

describe('parent/child/siblings', () => {
	it('parentOf finds the containing view', () => {
		expect(parentOf('D', tree)).toBe('B');
		expect(parentOf('B', tree)).toBe('A');
		expect(parentOf('A', tree)).toBeNull();
	});

	it('firstChildOf returns the first child', () => {
		expect(firstChildOf('A', tree)).toBe('B');
		expect(firstChildOf('C', tree)).toBeNull();
	});

	it('siblingsOf returns parent children, or roots for a root', () => {
		expect(siblingsOf('B', tree, roots)).toEqual(['B', 'C']);
		expect(siblingsOf('A', tree, roots)).toEqual(['A']);
	});
});

describe('navigate', () => {
	it('parent / child', () => {
		expect(navigate('D', 'parent', tree, roots)).toBe('B');
		expect(navigate('A', 'child', tree, roots)).toBe('B');
		expect(navigate('D', 'child', tree, roots)).toBeNull();
		expect(navigate('A', 'parent', tree, roots)).toBeNull();
	});

	it('prev / next siblings with clamping (no wrap)', () => {
		expect(navigate('B', 'next', tree, roots)).toBe('C');
		expect(navigate('C', 'prev', tree, roots)).toBe('B');
		expect(navigate('C', 'next', tree, roots)).toBeNull(); // last, clamped
		expect(navigate('B', 'prev', tree, roots)).toBeNull(); // first, clamped
	});

	it('falls to first root with no current selection', () => {
		expect(navigate(null, 'next', tree, roots)).toBe('A');
		expect(navigate(null, 'child', tree, roots)).toBe('A');
		expect(navigate(null, 'parent', tree, roots)).toBeNull();
	});
});

describe('multi-parent (DAG) uses first parent', () => {
	// X → [Z]; Y → [Z]. Z has two parents; parentOf picks the first in map iteration order.
	const dag = [view('X', ['Z']), view('Y', ['Z']), view('Z')];
	const t = buildViewTree(dag, ['children']);
	it('resolves to a single (first) parent', () => {
		expect(parentOf('Z', t)).toBe('X');
	});
});

// A separate fixture from the shared `views`/`tree`/`roots` above (matching the DAG block's own
// pattern) so adding a second unrelated root here doesn't perturb the siblingsOf/navigate
// assertions that rely on `roots` being exactly ['A']. Same A → [B, C]; B → [D] shape, plus an
// unrelated second root E with no children of its own.
describe('resolveDragTargetViewId', () => {
	const dragViews = [view('A', ['B', 'C']), view('B', ['D']), view('C'), view('D'), view('E')];
	const dragTree = buildViewTree(dragViews, ['children']);
	const dragRoots = new Set(
		dragViews.map((v) => v.viewId).filter((id) => !dragTree.referencedViewIds.has(id))
	);

	it('targets the active root when hit directly', () => {
		expect(resolveDragTargetViewId('A', 'A', dragRoots, dragTree)).toBe('A');
	});

	it('targets the active root when the hit is a nested descendant (through covering children)', () => {
		// D is A's grandchild (A -> B -> D) -- e.g. a full-bleed root whose composed children
		// (or its own nested content) leave no point that hit-tests to A's own box directly.
		expect(resolveDragTargetViewId('D', 'A', dragRoots, dragTree)).toBe('A');
		expect(resolveDragTargetViewId('C', 'A', dragRoots, dragTree)).toBe('A');
	});

	it('falls back to a direct root hit when the active view is not a root', () => {
		// B is referenced (A's child), so it's never treated as the active-root target even
		// though it's "active" -- only a hit that's itself a root passes through here.
		expect(resolveDragTargetViewId('E', 'B', dragRoots, dragTree)).toBe('E');
		expect(resolveDragTargetViewId('D', 'B', dragRoots, dragTree)).toBeNull();
	});

	it('falls back to a direct root hit when there is no active view', () => {
		expect(resolveDragTargetViewId('E', null, dragRoots, dragTree)).toBe('E');
	});

	it('does not redirect a hit on an unrelated root to the active root', () => {
		// E is a root but not a descendant of A -- dragging E must still drag E, not A.
		expect(resolveDragTargetViewId('E', 'A', dragRoots, dragTree)).toBe('E');
	});

	it('returns null for a non-root hit that is not within the active root either', () => {
		// No active view, and D (a non-root) is hit directly -- nothing to drag.
		expect(resolveDragTargetViewId('D', null, dragRoots, dragTree)).toBeNull();
	});
});

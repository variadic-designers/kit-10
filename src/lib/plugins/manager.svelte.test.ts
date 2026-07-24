import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Api } from 'manager';

// Regression coverage for the "drag a view, release, and it visibly snaps back to the old
// position before correcting itself" bug: a hover-triggered on_selection_change call that's
// still in flight when a newer setData (a real DB-backed resolve, e.g. from persisting a
// dropped view's new position) lands used to have its stale result applied anyway, because the
// staleness check only ran BEFORE the WASM call started, never after it came back. See
// makeSelectionChangeRunner in manager.svelte.ts.
//
// @extism/extism is mocked so this test controls exactly when each plugin.call() resolves,
// without a real WASM runtime -- `call()` for a name in `controlledCalls` returns a promise this
// test resolves manually via `resolvePending`; every other call name resolves immediately.
let controlledCalls: Set<string>;
let pending: Map<string, Array<(result: { text: () => string }) => void>>;

function makeResult(json: unknown) {
	return { text: () => JSON.stringify(json) };
}

vi.mock('@extism/extism', () => ({
	default: vi.fn(async () => ({
		call: vi.fn((fn: string, _payload: string) => {
			if (!controlledCalls.has(fn)) return Promise.resolve(makeResult({}));
			return new Promise<{ text: () => string }>((resolve) => {
				const list = pending.get(fn) ?? [];
				list.push(resolve);
				pending.set(fn, list);
			});
		})
	}))
}));

// Resolves the OLDEST still-pending call for `fn` (FIFO -- matches pluginQueue's own ordering).
function resolvePending(fn: string, json: unknown) {
	const list = pending.get(fn);
	const next = list?.shift();
	if (!next) throw new Error(`no pending call for "${fn}"`);
	next(makeResult(json));
}

function hasPending(fn: string): boolean {
	return (pending.get(fn)?.length ?? 0) > 0;
}

// Drains the microtask queue enough for chained promises (pluginQueue's `.then()` chain, the
// mocked async createPlugin factory) to progress up to their next await point. Plain
// `await Promise.resolve()` only advances one microtask tick; a few in a row reliably drains a
// handful of chained `.then()`s without needing fake timers for the 0ms debounces themselves
// (real 0ms setTimeout still fires on the real macrotask queue between ticks).
async function flush() {
	for (let i = 0; i < 10; i++) {
		await new Promise((r) => setTimeout(r, 0));
	}
}

const { createPluginManager } = await import('./manager.svelte.js');

describe('createPluginManager selection-change staleness guard', () => {
	beforeEach(() => {
		controlledCalls = new Set();
		pending = new Map();
	});

	it('discards a stale on_selection_change result that resolves after a newer setData already landed', async () => {
		controlledCalls = new Set(['on_selection_change', 'on_resolve']);
		const manager = createPluginManager({} as Api);

		await manager.loadPlugin({} as never, 'charter');

		// Seed an initial resolve so there's a real baseline (also gives runResolve something to
		// respond to before the race we actually care about).
		manager.setData([], {}, 'view1', [
			{ viewId: 'view1', viewName: 'v', hints: {}, resolvedKits: [] }
		] as never);
		await flush();
		expect(hasPending('on_resolve')).toBe(true);
		resolvePending('on_resolve', { viewport_data: [{ marker: 'initial' }] });
		await flush();
		expect(manager.viewportData).toContain('initial');

		// A hover change (e.g. the cursor settling on the view right before the user grabs it)
		// queues an on_selection_change call -- it starts and is now in flight.
		manager.setHover('view1');
		await flush();
		expect(hasPending('on_selection_change')).toBe(true);

		// The drop happens: a DB write's resolve lands via setData, WHILE the hover call above is
		// still awaiting its WASM response. This is the exact race -- setData bumps selectionGen,
		// but the in-flight on_selection_change call already passed its pre-await gen check.
		// Its own runResolve is enqueued too, but pluginQueue is FIFO/serialized -- it can't even
		// start its WASM call until the still-in-flight on_selection_change ahead of it settles.
		manager.setData([], {}, 'view1', [
			{ viewId: 'view1', viewName: 'v', hints: {}, resolvedKits: [] }
		] as never);
		await flush();
		expect(hasPending('on_resolve')).toBe(false);

		// The stale hover call finally resolves, carrying data computed before the drop. Without
		// the post-await gen check this fix adds, that result would get applied here -- a visible
		// snap back to the pre-drop state -- before the queued runResolve corrects it a moment
		// later. With the fix, it's silently discarded.
		resolvePending('on_selection_change', { viewport_data: [{ marker: 'STALE_PRE_DROP' }] });
		await flush();

		// Must never have been applied -- this is the fix under test.
		expect(manager.viewportData).not.toContain('STALE_PRE_DROP');
		// Discarding the stale result unblocks the queue, so the real resolve's WASM call has now
		// started.
		expect(hasPending('on_resolve')).toBe(true);

		// The real resolve (queued behind the stale call, since pluginQueue is FIFO) still runs
		// and its correct result still lands.
		resolvePending('on_resolve', { viewport_data: [{ marker: 'CORRECT_POST_DROP' }] });
		await flush();
		expect(manager.viewportData).toContain('CORRECT_POST_DROP');
	});

	it('still applies an on_selection_change result when no newer setData raced it', async () => {
		controlledCalls = new Set(['on_selection_change', 'on_resolve']);
		const manager = createPluginManager({} as Api);

		await manager.loadPlugin({} as never, 'charter');
		manager.setData([], {}, 'view1', [
			{ viewId: 'view1', viewName: 'v', hints: {}, resolvedKits: [] }
		] as never);
		await flush();
		resolvePending('on_resolve', { viewport_data: [{ marker: 'initial' }] });
		await flush();

		manager.setHover('view1');
		await flush();
		expect(hasPending('on_selection_change')).toBe(true);

		// No intervening setData this time -- the ordinary, non-racing case.
		resolvePending('on_selection_change', { viewport_data: [{ marker: 'HOVER_RESULT' }] });
		await flush();

		expect(manager.viewportData).toContain('HOVER_RESULT');
	});
});

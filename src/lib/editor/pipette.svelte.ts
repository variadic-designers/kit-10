// The pipette's paint target while you're filling in a layer. The key insight (learned the hard
// way): what you hold is NOT a frozen layer -- it's the *set of axes* you're working across. The
// specific layer follows your live Axes selection, so re-picking Fruit:Apple after starting on
// Fruit:Pineapple moves you onto the Apple layer, exactly as changing your mind should.
//
// Ownership: the Axes panel owns the selection, so it computes `target` (values + label + the
// axis_value_ids for the current selection) from the pinned `keys` whenever either changes, and
// pushes it here. The Styles panel only reads `target` -- it paints by resolve-or-creating the
// layer for `target.axisValueIds` at click time. Module-level shared state, same as dnd.svelte.ts.

export type PaintTarget = {
	keys: string[]; // the pinned axis-id set you're working across
	color: string; // key-set dot color
	label: string; // live label from the current selection, e.g. "apple" or "apple + large"
	axisValueIds: string[]; // current selection's value ids for `keys` (only the resolved ones)
	ready: boolean; // true once every axis in `keys` has a current selected value
};

let keys = $state<string[] | null>(null); // source of truth: painting, and across which axes
let target = $state<PaintTarget | null>(null); // computed by Axes from keys + live selection

/** The pinned axis-id set (Axes reads this to know what to recompute). Null = not painting. */
export function paintKeys(): string[] | null {
	return keys;
}

/** The live paint target (Styles reads this to paint + show the banner). */
export function paintTarget(): PaintTarget | null {
	return target;
}

/** Begin painting across `k` (called on layer create / dot pick-up). Toggles off if same set. */
export function startPaint(k: string[]) {
	const same = keys && keys.length === k.length && k.every((id) => keys!.includes(id));
	if (same) {
		stopPaint();
		return;
	}
	keys = k;
}

/** Axes pushes the recomputed target here whenever the selection or keyset changes. */
export function setPaintTarget(t: PaintTarget | null) {
	target = t;
}

export function stopPaint() {
	keys = null;
	target = null;
}

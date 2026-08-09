// Colors a Layer's combination-dot by the *set* of axes it conditions on (its "key set"),
// not by which specific values were picked. theme:dark;state:hover and theme:dark;state:click
// share a key set ({theme, state}) and so share a hue - they're siblings along the state axis.
// theme:dark;density:compact has a different key set ({theme, density}) and gets a different hue,
// even though both are 2-condition layers.
export function axisSetHue(axisIds: string[]): number {
	const key = [...new Set(axisIds)].sort().join('|');
	let hash = 0;
	for (let i = 0; i < key.length; i++) {
		hash = (hash * 31 + key.charCodeAt(i)) | 0;
	}
	return Math.abs(hash) % 360;
}

export function layerDotColor(axisIds: string[], active: boolean): string {
	// No axes to combine - the null layer, or a plain single-axis rule. Neutral, not a hash hue.
	if (axisIds.length === 0) return 'var(--color-text-muted)';
	const hue = axisSetHue(axisIds);
	const L = active ? 0.72 : 0.6;
	const C = active ? 0.24 : 0.18;
	return `oklch(${L} ${C} ${hue})`;
}

// Describes which Layer a property is sourced from - shared by every Render-panel field row
// (FieldRow.svelte) so a hover tooltip reads identically everywhere. `axisNameById` is optional:
// omitting it (or a miss) falls back to the raw axisId, same as every call site did before this
// was centralized.
export function trackTitle(
	conditions: { axisId: string; value: string }[],
	axisNameById: Record<string, string> = {}
): string {
	if (conditions.length === 0) return 'Base layer · always applies';
	const parts = conditions
		.map((c) => `${axisNameById[c.axisId] ?? c.axisId}: ${c.value}`)
		.join(', ');
	return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
}

// Shape-by-position system used to give each Kit a distinct icon (Styles.svelte, Axes.svelte).
export const SHAPE_ICONS = [
	'fa-circle',
	'fa-square',
	'fa-diamond',
	'fa-star',
	'fa-heart',
	'fa-bolt',
	'fa-gem',
	'fa-crown'
];

export function shapeIcon(index: number): string {
	return index >= SHAPE_ICONS.length ? 'fa-crown' : (SHAPE_ICONS[index] ?? 'fa-circle');
}

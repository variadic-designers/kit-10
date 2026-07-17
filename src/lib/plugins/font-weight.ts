import type { FamilyFacts } from './types.js';

// Mirrors Charter's `resolve_font_weight` (plugins/charter/src/lib.rs) exactly, so the panel's
// idea of "the working weight" for a family never disagrees with what actually renders. Charter
// only ever applies this at render time, per Text node -- it never rewrites the stored kit
// value. This is the same algorithm run client-side, at font-family PICK time, so the panel can
// proactively write a working font-weight instead of silently rendering one weight while
// showing another (or showing no weight selected at all -- see WeightField's `currentWeight`
// match, which has nothing to highlight once the stored value falls outside the new family's
// filtered button set).
export function resolveFontWeight(requested: number, facts: FamilyFacts | undefined): number {
	if (!facts || facts.variants.length === 0) return requested;

	if (facts.variants.some((v) => requested >= v.weightMin && requested <= v.weightMax)) {
		return requested;
	}

	const candidates = [...new Set(facts.variants.map((v) => clamp(requested, v.weightMin, v.weightMax)))].sort(
		(a, b) => a - b
	);

	const below = [...candidates].reverse().find((w) => w < requested);
	const above = candidates.find((w) => w > requested);

	// CSS: <400 prefers lighter first; >500 prefers heavier first; the 400..=500 zone looks up
	// toward 500, then below, then above.
	let pick: number | undefined;
	if (requested < 400) {
		pick = below ?? above;
	} else if (requested > 500) {
		pick = above ?? below;
	} else {
		pick = candidates.find((w) => w >= requested && w <= 500) ?? below ?? above;
	}

	return pick ?? requested;
}

function clamp(n: number, min: number, max: number): number {
	return Math.min(Math.max(n, min), max);
}

// Case-insensitive family lookup -- fontFacts is keyed by however Fontavious cased the family
// name, which may not match the resolved property's casing exactly.
export function factsForFamily(
	fontFacts: Record<string, FamilyFacts> | undefined,
	family: string | null | undefined
): FamilyFacts | undefined {
	if (!fontFacts || !family) return undefined;
	if (fontFacts[family]) return fontFacts[family];
	const lower = family.toLowerCase();
	return Object.entries(fontFacts).find(([f]) => f.toLowerCase() === lower)?.[1];
}

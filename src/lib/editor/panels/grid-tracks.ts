// Pure parse/serialize helpers for `grid-template-columns`/`grid-template-rows` raw CSS text,
// backing GridTracksField's structured track-list builder. Mirrors Charter's own
// parse_track/parse_track_list/track_size_css (plugins/charter/src/lib.rs) so the friendly UI and
// the raw "Custom tracks" text escape hatch stay two views onto the exact same property, never a
// shadow format the two could drift apart on.

export type TrackKind =
	| 'px'
	| 'fr'
	| 'auto'
	| 'min-content'
	| 'max-content'
	| 'percent'
	| 'fit-content'
	| 'auto-fit'
	| 'auto-fill';

export interface Track {
	kind: TrackKind;
	// Meaningful for px/fr/percent/fit-content/auto-fit/auto-fill; ignored (but kept, so toggling
	// kind back and forth doesn't lose the last-typed number) for auto/min-content/max-content.
	value: number;
}

export function defaultValueForKind(kind: TrackKind): number {
	switch (kind) {
		case 'fr':
			return 1;
		case 'percent':
			return 50;
		default:
			return 100;
	}
}

// A track kind's numeric value is meaningful (shown/edited) only for these -- auto/min-content/
// max-content are fixed keywords with nothing to type.
export function kindHasValue(kind: TrackKind): boolean {
	return kind !== 'auto' && kind !== 'min-content' && kind !== 'max-content';
}

// Splits a space-separated track list on whitespace OUTSIDE parentheses -- a single track
// descriptor like `repeat(auto-fit, minmax(160px, 1fr))` contains internal spaces (CSS's own
// comma-separator convention) that must never be treated as track boundaries. Direct port of
// Charter's split_respecting_parens.
function splitRespectingParens(s: string): string[] {
	const tokens: string[] = [];
	let depth = 0;
	let start: number | null = null;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '(') depth++;
		else if (c === ')') depth--;
		if (depth === 0 && /\s/.test(c)) {
			if (start !== null) {
				tokens.push(s.slice(start, i));
				start = null;
			}
		} else if (start === null) {
			start = i;
		}
	}
	if (start !== null) tokens.push(s.slice(start));
	return tokens;
}

function parseOneTrack(raw: string): Track {
	const s = raw.trim();
	if (s === 'auto') return { kind: 'auto', value: defaultValueForKind('auto') };
	if (s === 'min-content') return { kind: 'min-content', value: defaultValueForKind('min-content') };
	if (s === 'max-content') return { kind: 'max-content', value: defaultValueForKind('max-content') };

	const repeatMatch = s.match(/^repeat\(\s*(auto-fit|auto-fill)\s*,\s*minmax\(\s*([\d.]+)px\s*,/);
	if (repeatMatch) {
		const kind = repeatMatch[1] as 'auto-fit' | 'auto-fill';
		return { kind, value: parseFloat(repeatMatch[2]) };
	}
	const fitContentMatch = s.match(/^fit-content\(\s*([\d.]+)px\s*\)$/);
	if (fitContentMatch) {
		return { kind: 'fit-content', value: parseFloat(fitContentMatch[1]) };
	}
	const frMatch = s.match(/^([\d.]+)fr$/);
	if (frMatch) return { kind: 'fr', value: parseFloat(frMatch[1]) };
	const pctMatch = s.match(/^([\d.]+)%$/);
	if (pctMatch) return { kind: 'percent', value: parseFloat(pctMatch[1]) };
	const pxMatch = s.match(/^([\d.]+)(px)?$/);
	if (pxMatch) return { kind: 'px', value: parseFloat(pxMatch[1]) };

	// Unrecognized (a bare minmax()/named line/anything else the friendly builder doesn't model
	// yet) -- falls back to a 0px placeholder rather than dropping the track silently. The raw
	// "Custom tracks" text field underneath is always the honest escape hatch for these.
	return { kind: 'px', value: 0 };
}

export function parseTrackList(raw: string): Track[] {
	if (!raw?.trim()) return [];
	return splitRespectingParens(raw).map(parseOneTrack);
}

function serializeOneTrack(t: Track): string {
	switch (t.kind) {
		case 'px':
			return `${t.value}px`;
		case 'fr':
			return `${t.value}fr`;
		case 'auto':
			return 'auto';
		case 'min-content':
			return 'min-content';
		case 'max-content':
			return 'max-content';
		case 'percent':
			return `${t.value}%`;
		case 'fit-content':
			return `fit-content(${t.value}px)`;
		case 'auto-fit':
			return `repeat(auto-fit, minmax(${t.value}px, 1fr))`;
		case 'auto-fill':
			return `repeat(auto-fill, minmax(${t.value}px, 1fr))`;
	}
}

export function serializeTrackList(tracks: Track[]): string {
	return tracks.map(serializeOneTrack).join(' ');
}

export const TRACK_KIND_META: { kind: TrackKind; label: string; icon: string; tooltip: string }[] = [
	{ kind: 'px', label: 'Fixed', icon: 'fa-solid fa-ruler-horizontal', tooltip: 'A fixed pixel width' },
	{ kind: 'fr', label: 'Fraction', icon: 'fa-solid fa-percent', tooltip: 'A share of the leftover space (fr)' },
	{ kind: 'auto', label: 'Auto', icon: 'fa-solid fa-arrows-left-right', tooltip: 'Sizes to its own content' },
	{ kind: 'percent', label: 'Percent', icon: 'fa-solid fa-percentage', tooltip: 'A percentage of the grid’s own size' },
	{ kind: 'min-content', label: 'Min', icon: 'fa-solid fa-compress', tooltip: 'The smallest the content can shrink to' },
	{ kind: 'max-content', label: 'Max', icon: 'fa-solid fa-expand', tooltip: 'The content’s natural, unwrapped size' },
	{ kind: 'fit-content', label: 'Fit', icon: 'fa-solid fa-arrows-to-dot', tooltip: 'Grows to content, up to a cap' },
	{
		kind: 'auto-fit',
		label: 'Responsive (fit)',
		icon: 'fa-solid fa-table-cells',
		tooltip: 'Repeats to fill the row, collapsing empty tracks (auto-fit)'
	},
	{
		kind: 'auto-fill',
		label: 'Responsive (fill)',
		icon: 'fa-solid fa-table-cells-large',
		tooltip: 'Repeats to fill the row, keeping empty tracks (auto-fill)'
	}
];

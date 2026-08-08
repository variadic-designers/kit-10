import { describe, it, expect } from 'vitest';
import {
	parseAreas,
	serializeAreas,
	paintArea,
	removeArea,
	renameArea,
	areaNamesFromParentMap
} from './grid-areas.js';

describe('parseAreas', () => {
	it('resolves named regions to line coordinates', () => {
		const areas = parseAreas('"header header" "sidebar main" "footer footer"');
		expect(areas).toEqual([
			{ name: 'footer', rowStart: 3, rowEnd: 4, colStart: 1, colEnd: 3 },
			{ name: 'header', rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 3 },
			{ name: 'main', rowStart: 2, rowEnd: 3, colStart: 2, colEnd: 3 },
			{ name: 'sidebar', rowStart: 2, rowEnd: 3, colStart: 1, colEnd: 2 }
		]);
	});

	it('skips the null-cell token', () => {
		const areas = parseAreas('"a . b"');
		expect(areas.map((a) => a.name)).toEqual(['a', 'b']);
	});
});

describe('serializeAreas round-trips through parseAreas', () => {
	it('reproduces the same CSS text for a real layout', () => {
		const original = '"header header" "sidebar main" "footer footer"';
		const areas = parseAreas(original);
		expect(serializeAreas(areas, 3, 2)).toBe(original);
	});

	it('fills a track-list-defined trailing row with nulls if no area covers it', () => {
		const areas = parseAreas('"a a"');
		expect(serializeAreas(areas, 2, 2)).toBe('"a a" ". ."');
	});
});

describe('paintArea', () => {
	it('adds a new non-overlapping area', () => {
		const result = paintArea([], { name: 'a', rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 });
		expect(result).toHaveLength(1);
	});

	it('clears an overlapping existing area entirely', () => {
		const existing = [{ name: 'a', rowStart: 1, rowEnd: 3, colStart: 1, colEnd: 3 }];
		const result = paintArea(existing, { name: 'b', rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 });
		expect(result.map((a) => a.name)).toEqual(['b']);
	});

	it('leaves a non-overlapping existing area untouched', () => {
		const existing = [{ name: 'a', rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 }];
		const result = paintArea(existing, { name: 'b', rowStart: 3, rowEnd: 4, colStart: 1, colEnd: 2 });
		expect(result.map((a) => a.name).sort()).toEqual(['a', 'b']);
	});
});

describe('removeArea / renameArea', () => {
	const areas = [
		{ name: 'a', rowStart: 1, rowEnd: 2, colStart: 1, colEnd: 2 },
		{ name: 'b', rowStart: 2, rowEnd: 3, colStart: 1, colEnd: 2 }
	];

	it('removeArea drops only the named area', () => {
		expect(removeArea(areas, 'a').map((x) => x.name)).toEqual(['b']);
	});

	it('renameArea updates the name in place', () => {
		expect(renameArea(areas, 'a', 'header').map((x) => x.name).sort()).toEqual(['b', 'header']);
	});

	it('renameArea onto an existing name merges (drops the old target)', () => {
		expect(renameArea(areas, 'a', 'b').map((x) => x.name)).toEqual(['b']);
	});
});

describe('areaNamesFromParentMap', () => {
	it('returns null when there is no parent map', () => {
		expect(areaNamesFromParentMap(null)).toBeNull();
	});

	it('returns null when the parent is not arranged as a grid', () => {
		const parentMap = new Map([['arrange', { value: 'stack' }]]);
		expect(areaNamesFromParentMap(parentMap)).toBeNull();
	});

	it('returns an empty list when the parent is a grid with no painted areas', () => {
		const parentMap = new Map([['arrange', { value: 'grid' }]]);
		expect(areaNamesFromParentMap(parentMap)).toEqual([]);
	});

	it('returns the painted area names when the parent is a grid', () => {
		const parentMap = new Map([
			['arrange', { value: 'grid' }],
			['grid-template-areas', { value: '"header header" "sidebar main"' }]
		]);
		expect(areaNamesFromParentMap(parentMap)).toEqual(['header', 'main', 'sidebar']);
	});
});

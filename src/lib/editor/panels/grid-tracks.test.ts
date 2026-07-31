import { describe, it, expect } from 'vitest';
import { parseTrackList, serializeTrackList, type Track } from './grid-tracks.js';

describe('parseTrackList', () => {
	it('parses a mixed list of every basic kind', () => {
		expect(parseTrackList('100px 1fr auto min-content max-content 50%')).toEqual([
			{ kind: 'px', value: 100 },
			{ kind: 'fr', value: 1 },
			{ kind: 'auto', value: 100 },
			{ kind: 'min-content', value: 100 },
			{ kind: 'max-content', value: 100 },
			{ kind: 'percent', value: 50 }
		]);
	});

	it('does not split inside a responsive/fit-content track’s own parentheses', () => {
		expect(parseTrackList('repeat(auto-fit, minmax(160px, 1fr)) fit-content(200px)')).toEqual([
			{ kind: 'auto-fit', value: 160 },
			{ kind: 'fit-content', value: 200 }
		]);
	});

	it('recognizes auto-fill distinctly from auto-fit', () => {
		expect(parseTrackList('repeat(auto-fill, minmax(120px, 1fr))')).toEqual([
			{ kind: 'auto-fill', value: 120 }
		]);
	});

	it('returns an empty list for an empty or unset value', () => {
		expect(parseTrackList('')).toEqual([]);
		expect(parseTrackList('   ')).toEqual([]);
	});
});

describe('serializeTrackList', () => {
	it('round-trips every basic kind back to CSS text', () => {
		const tracks: Track[] = [
			{ kind: 'px', value: 100 },
			{ kind: 'fr', value: 1 },
			{ kind: 'auto', value: 0 },
			{ kind: 'percent', value: 50 },
			{ kind: 'fit-content', value: 220 }
		];
		expect(serializeTrackList(tracks)).toBe('100px 1fr auto 50% fit-content(220px)');
	});

	it('round-trips auto-fit and auto-fill back to their repeat() shape', () => {
		expect(serializeTrackList([{ kind: 'auto-fit', value: 160 }])).toBe(
			'repeat(auto-fit, minmax(160px, 1fr))'
		);
		expect(serializeTrackList([{ kind: 'auto-fill', value: 120 }])).toBe(
			'repeat(auto-fill, minmax(120px, 1fr))'
		);
	});

	it('is the exact inverse of parseTrackList for a real mixed track list', () => {
		const original = '100px 1fr repeat(auto-fit, minmax(160px, 1fr)) 50% fit-content(200px)';
		expect(serializeTrackList(parseTrackList(original))).toBe(original);
	});
});

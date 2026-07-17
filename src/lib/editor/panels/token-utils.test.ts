import { describe, it, expect } from 'vitest';
import {
	tokenIcon,
	tokenStr,
	isColorValue,
	iconFromResolvedScalar,
	isColorScalar
} from './token-utils.js';
import type { TokenValue } from 'manager';

// -- existing TokenValue-typed helpers (Tokens panel) --
describe('tokenIcon', () => {
	it('returns fa-square-binary for view-list tokens', () => {
		const v: TokenValue = { type: 'view-list', view_ids: ['v1', 'v2'] };
		expect(tokenIcon(v)).toBe('fa-square-binary');
	});

	it('returns fa-square-full for color scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '#2563eb' };
		expect(tokenIcon(v)).toBe('fa-square-full');
	});

	it('returns fa-square-full for rgb color scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'rgb(37, 99, 235)' };
		expect(tokenIcon(v)).toBe('fa-square-full');
	});

	it('returns fa-square-full for hsl color scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'hsl(217, 83%, 53%)' };
		expect(tokenIcon(v)).toBe('fa-square-full');
	});

	it('returns fa-square-full for oklch color scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'oklch(70.9% 0.195 47.025)' };
		expect(tokenIcon(v)).toBe('fa-square-full');
	});

	it('returns fa-arrows-left-right-to-line for px spacing scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '16px' };
		expect(tokenIcon(v)).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for rem spacing scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '1.5rem' };
		expect(tokenIcon(v)).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for em spacing scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '0.5em' };
		expect(tokenIcon(v)).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for percent spacing scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '50%' };
		expect(tokenIcon(v)).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-circle for generic string scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'Inter' };
		expect(tokenIcon(v)).toBe('fa-circle');
	});

	it('returns fa-question for null', () => {
		expect(tokenIcon(null)).toBe('fa-question');
	});

	it('returns fa-question for undefined', () => {
		expect(tokenIcon(undefined)).toBe('fa-question');
	});
});

describe('tokenStr', () => {
	it('returns the scalar value', () => {
		const v: TokenValue = { type: 'scalar', value: '#2563eb' };
		expect(tokenStr(v)).toBe('#2563eb');
	});

	it('returns view count for view-list', () => {
		const v: TokenValue = { type: 'view-list', view_ids: ['a', 'b'] };
		expect(tokenStr(v)).toBe('2 views');
	});

	it('returns null for null', () => {
		expect(tokenStr(null)).toBeNull();
	});
});

describe('isColorValue', () => {
	it('returns true for hex scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '#2563eb' };
		expect(isColorValue(v)).toBe(true);
	});

	it('returns true for oklch scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'oklch(70.9% 0.195 47.025)' };
		expect(isColorValue(v)).toBe(true);
	});

	it('returns true for oklab scalars', () => {
		const v: TokenValue = { type: 'scalar', value: 'oklab(0.6 0.1 -0.05)' };
		expect(isColorValue(v)).toBe(true);
	});

	it('returns false for spacing scalars', () => {
		const v: TokenValue = { type: 'scalar', value: '16px' };
		expect(isColorValue(v)).toBe(false);
	});

	it('returns false for null', () => {
		expect(isColorValue(null)).toBe(false);
	});
});

// -- new string-typed helpers (Render panel's StyleField) --
describe('iconFromResolvedScalar', () => {
	it('returns fa-square-full for hex colors', () => {
		expect(iconFromResolvedScalar('#2563eb')).toBe('fa-square-full');
	});

	it('returns fa-square-full for rgb colors', () => {
		expect(iconFromResolvedScalar('rgb(37, 99, 235)')).toBe('fa-square-full');
	});

	it('returns fa-square-full for hsl colors', () => {
		expect(iconFromResolvedScalar('hsl(217, 83%, 53%)')).toBe('fa-square-full');
	});

	it('returns fa-square-full for oklch colors', () => {
		expect(iconFromResolvedScalar('oklch(70.9% 0.195 47.025)')).toBe('fa-square-full');
	});

	it('returns fa-square-full for oklab colors', () => {
		expect(iconFromResolvedScalar('oklab(0.6 0.1 -0.05)')).toBe('fa-square-full');
	});

	it('returns fa-arrows-left-right-to-line for px spacing', () => {
		expect(iconFromResolvedScalar('16px')).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for rem spacing', () => {
		expect(iconFromResolvedScalar('1.5rem')).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for em spacing', () => {
		expect(iconFromResolvedScalar('0.5em')).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-arrows-left-right-to-line for percent', () => {
		expect(iconFromResolvedScalar('50%')).toBe('fa-arrows-left-right-to-line');
	});

	it('returns fa-circle for generic strings', () => {
		expect(iconFromResolvedScalar('Inter')).toBe('fa-circle');
	});

	it('returns fa-question for empty string', () => {
		expect(iconFromResolvedScalar('')).toBe('fa-question');
	});

	it('returns fa-question for null', () => {
		expect(iconFromResolvedScalar(null)).toBe('fa-question');
	});

	it('returns fa-question for undefined', () => {
		expect(iconFromResolvedScalar(undefined)).toBe('fa-question');
	});
});

describe('isColorScalar', () => {
	it('returns true for hex', () => {
		expect(isColorScalar('#2563eb')).toBe(true);
	});

	it('returns true for rgb', () => {
		expect(isColorScalar('rgb(37, 99, 235)')).toBe(true);
	});

	it('returns true for hsl', () => {
		expect(isColorScalar('hsl(217, 83%, 53%)')).toBe(true);
	});

	it('returns true for oklch', () => {
		expect(isColorScalar('oklch(70.9% 0.195 47.025)')).toBe(true);
	});

	it('returns true for oklab', () => {
		expect(isColorScalar('oklab(0.6 0.1 -0.05)')).toBe(true);
	});

	it('returns false for px strings', () => {
		expect(isColorScalar('16px')).toBe(false);
	});

	it('returns false for null', () => {
		expect(isColorScalar(null)).toBe(false);
	});

	it('returns false for undefined', () => {
		expect(isColorScalar(undefined)).toBe(false);
	});

	it('returns false for empty string', () => {
		expect(isColorScalar('')).toBe(false);
	});
});

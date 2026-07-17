import { describe, it, expect } from 'vitest';
import { parseCssColorToOklch, formatOklch, oklchToHex } from './oklch.js';

function approx(a: number, b: number, eps = 1e-3) {
	return Math.abs(a - b) < eps;
}

describe('parseCssColorToOklch', () => {
	it('parses oklch() first-class, bare fraction L', () => {
		const got = parseCssColorToOklch('oklch(0.7 0.15 30)');
		expect(got).not.toBeNull();
		expect(approx(got!.l, 0.7)).toBe(true);
		expect(approx(got!.c, 0.15)).toBe(true);
		expect(approx(got!.h, 30)).toBe(true);
		expect(got!.alpha).toBe(1);
	});

	it('parses oklch() with percent L and slash alpha', () => {
		const got = parseCssColorToOklch('oklch(70% 0.15 30 / 0.5)');
		expect(got).not.toBeNull();
		expect(approx(got!.l, 0.7)).toBe(true);
		expect(got!.alpha).toBe(0.5);
	});

	it('parses oklab() direct cartesian, no conversion', () => {
		const got = parseCssColorToOklch('oklab(0.6 0.1 0)');
		expect(got).not.toBeNull();
		expect(approx(got!.l, 0.6)).toBe(true);
		expect(approx(got!.c, 0.1)).toBe(true);
		expect(approx(got!.h, 0)).toBe(true);
	});

	it('matches the published Oklab reference for pure sRGB red, converted to OKLCH', () => {
		// Same reference used in Vellum/Charter's Rust tests: L=0.627955, a=0.224863, b=0.125846.
		const got = parseCssColorToOklch('#ff0000');
		expect(got).not.toBeNull();
		expect(approx(got!.l, 0.627955)).toBe(true);
		const c = Math.sqrt(0.224863 ** 2 + 0.125846 ** 2);
		expect(approx(got!.c, c)).toBe(true);
	});

	it('rgb() and rgba() are legacy sRGB input', () => {
		const opaque = parseCssColorToOklch('rgb(255, 0, 0)');
		const half = parseCssColorToOklch('rgba(255, 0, 0, 0.5)');
		const hex = parseCssColorToOklch('#ff0000');
		expect(approx(opaque!.l, hex!.l)).toBe(true);
		expect(half!.alpha).toBe(0.5);
	});

	it('hsl() and hsla() are supported, not black', () => {
		const hsl = parseCssColorToOklch('hsl(0, 100%, 50%)');
		const hex = parseCssColorToOklch('#ff0000');
		expect(approx(hsl!.l, hex!.l)).toBe(true);
		const translucent = parseCssColorToOklch('hsla(0, 100%, 50%, 0.25)');
		expect(translucent!.alpha).toBe(0.25);
	});

	it('transparent is zero alpha, not black', () => {
		const got = parseCssColorToOklch('transparent');
		expect(got).toEqual({ l: 0, c: 0, h: 0, alpha: 0 });
	});

	it('returns null for genuinely unparseable input', () => {
		expect(parseCssColorToOklch('not-a-color')).toBeNull();
	});

	it('returns null for empty/nullish input', () => {
		expect(parseCssColorToOklch(null)).toBeNull();
		expect(parseCssColorToOklch(undefined)).toBeNull();
		expect(parseCssColorToOklch('')).toBeNull();
	});
});

describe('formatOklch', () => {
	it('omits the alpha suffix when fully opaque', () => {
		expect(formatOklch(0.7, 0.15, 30, 1)).toBe('oklch(70% 0.15 30)');
	});

	it('includes a slash alpha suffix when translucent', () => {
		expect(formatOklch(0.7, 0.15, 30, 0.5)).toBe('oklch(70% 0.15 30 / 0.5)');
	});

	it('round-trips through parseCssColorToOklch', () => {
		const formatted = formatOklch(0.6, 0.12, 250, 0.8);
		const reparsed = parseCssColorToOklch(formatted);
		expect(approx(reparsed!.l, 0.6)).toBe(true);
		expect(approx(reparsed!.c, 0.12)).toBe(true);
		expect(approx(reparsed!.h, 250)).toBe(true);
		expect(reparsed!.alpha).toBe(0.8);
	});
});

describe('oklchToHex', () => {
	it('converts pure red back to #ff0000', () => {
		const got = parseCssColorToOklch('#ff0000')!;
		expect(oklchToHex(got.l, got.c, got.h)).toBe('#ff0000');
	});

	it('converts white and black correctly', () => {
		expect(oklchToHex(1, 0, 0)).toBe('#ffffff');
		expect(oklchToHex(0, 0, 0)).toBe('#000000');
	});
});

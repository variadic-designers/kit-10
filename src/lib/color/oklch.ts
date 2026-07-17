// Oklab/OKLCH color math for the editor -- a third, small, manually-synced copy of the same
// Ottosson matrices Vellum (`taf_can_do/src/color.rs`) and Charter (`plugins/charter/src/lib.rs`'s
// `parse_color`) already each carry (see resources/oklch.md). This one exists because the editor
// needs to turn *whatever the resolved value currently is* -- hex, oklch(), or another legacy
// format -- into numeric L/C/H/alpha for the color field's sliders; there's no browser API that
// extracts OKLCH components from an arbitrary CSS color string.
//
// `parseCssColorToOklch` is read-only/display-time parsing (driving slider positions and the
// legacy-input escape hatch) -- it never talks to the DB. Every committed value is written back
// via `formatOklch`, always canonical `oklch(...)`, matching "hex/rgb/hsl are legacy input
// formats... no longer author in."

export interface Oklch {
	l: number;
	c: number;
	h: number;
	alpha: number;
}

function srgbToLinear(c: number): number {
	return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c: number): number {
	return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function linearSrgbToOklab(r: number, g: number, b: number): [number, number, number] {
	const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
	const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
	const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

	const l_ = Math.cbrt(l);
	const m_ = Math.cbrt(m);
	const s_ = Math.cbrt(s);

	return [
		0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
		1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
		0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
	];
}

function oklabToLinearSrgb(l: number, a: number, b: number): [number, number, number] {
	const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
	const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
	const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

	const l3 = l_ * l_ * l_;
	const m3 = m_ * m_ * m_;
	const s3 = s_ * s_ * s_;

	return [
		4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
		-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
		-0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3
	];
}

function oklabToOklch(l: number, a: number, b: number): [number, number, number] {
	const c = Math.sqrt(a * a + b * b);
	let h = (Math.atan2(b, a) * 180) / Math.PI;
	if (h < 0) h += 360;
	return [l, c, h];
}

function oklchToOklab(l: number, c: number, hDegrees: number): [number, number, number] {
	const h = (hDegrees * Math.PI) / 180;
	return [l, c * Math.cos(h), c * Math.sin(h)];
}

function srgbToOklch(r: number, g: number, b: number, alpha: number): Oklch {
	const [lr, lg, lb] = [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
	const [l, a, ob] = linearSrgbToOklab(lr, lg, lb);
	const [ol, c, h] = oklabToOklch(l, a, ob);
	return { l: ol, c, h, alpha };
}

function parsePercentOrFraction(s: string): number | null {
	const t = s.trim();
	if (t.endsWith('%')) {
		const n = parseFloat(t.slice(0, -1));
		return Number.isFinite(n) ? n / 100 : null;
	}
	const n = parseFloat(t);
	return Number.isFinite(n) ? n : null;
}

// Splits a functional color's argument list on whitespace and/or commas, and splits off an
// optional `/ alpha` suffix (fraction or percentage).
function splitColorArgs(inner: string): { parts: string[]; alpha: number } {
	const slash = inner.indexOf('/');
	const main = slash === -1 ? inner : inner.slice(0, slash);
	const alphaPart = slash === -1 ? null : inner.slice(slash + 1);
	const parts = main
		.split(/[\s,]+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	const alpha = alphaPart !== null ? (parsePercentOrFraction(alphaPart.trim()) ?? 1) : 1;
	return { parts, alpha };
}

function hslToSrgb(h: number, s: number, l: number): [number, number, number] {
	if (s <= 0) return [l, l, l];
	const hh = (((h % 360) + 360) % 360) / 360;
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	const hueToRgb = (p: number, q: number, t: number): number => {
		let tt = t;
		if (tt < 0) tt += 1;
		if (tt > 1) tt -= 1;
		if (tt < 1 / 6) return p + (q - p) * 6 * tt;
		if (tt < 1 / 2) return q;
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
		return p;
	};
	return [hueToRgb(p, q, hh + 1 / 3), hueToRgb(p, q, hh), hueToRgb(p, q, hh - 1 / 3)];
}

// Parses OKLCH/Oklab first-class, or hex/`rgb()`/`rgba()`/`hsl()`/`hsla()`/`transparent` as
// legacy input (mirrors Charter's `parse_color` exactly -- see plugins/charter/src/lib.rs).
// Returns `null` for anything unparseable (the caller -- ColorField's raw-text escape hatch --
// decides how to surface that, e.g. leaving the sliders at their last valid position).
export function parseCssColorToOklch(input: string | null | undefined): Oklch | null {
	if (!input) return null;
	const s = input.trim();

	const oklchMatch = /^oklch\((.*)\)$/i.exec(s);
	if (oklchMatch) {
		const { parts, alpha } = splitColorArgs(oklchMatch[1]);
		if (parts.length < 3) return null;
		const l = parsePercentOrFraction(parts[0]);
		const c = parseFloat(parts[1]);
		const h = parseFloat(parts[2]);
		if (l === null || !Number.isFinite(c) || !Number.isFinite(h)) return null;
		return { l, c, h, alpha };
	}

	const oklabMatch = /^oklab\((.*)\)$/i.exec(s);
	if (oklabMatch) {
		const { parts, alpha } = splitColorArgs(oklabMatch[1]);
		if (parts.length < 3) return null;
		const l = parsePercentOrFraction(parts[0]);
		const a = parseFloat(parts[1]);
		const b = parseFloat(parts[2]);
		if (l === null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
		const [ol, c, h] = oklabToOklch(l, a, b);
		return { l: ol, c, h, alpha };
	}

	if (s.toLowerCase() === 'transparent') {
		return { l: 0, c: 0, h: 0, alpha: 0 };
	}

	if (s.startsWith('#')) {
		const hex = s.slice(1);
		if (hex.length === 6 || hex.length === 8) {
			const r = parseInt(hex.slice(0, 2), 16) / 255;
			const g = parseInt(hex.slice(2, 4), 16) / 255;
			const b = parseInt(hex.slice(4, 6), 16) / 255;
			const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
			if ([r, g, b].some((v) => Number.isNaN(v))) return null;
			return srgbToOklch(r, g, b, alpha);
		}
		return null;
	}

	const rgbMatch = /^rgba?\((.*)\)$/i.exec(s);
	if (rgbMatch) {
		const { parts, alpha: slashAlpha } = splitColorArgs(rgbMatch[1]);
		if (parts.length < 3) return null;
		const r = parseFloat(parts[0]) / 255;
		const g = parseFloat(parts[1]) / 255;
		const b = parseFloat(parts[2]) / 255;
		if (![r, g, b].every(Number.isFinite)) return null;
		// A 4th comma-separated arg (legacy `rgba(r,g,b,a)`) is already a 0-1 fraction, not a
		// `/ alpha` suffix -- mirrors Charter's parse_color handling of the same ambiguity.
		const alpha = parts.length >= 4 ? (parseFloat(parts[3]) ?? slashAlpha) : slashAlpha;
		return srgbToOklch(r, g, b, alpha);
	}

	const hslMatch = /^hsla?\((.*)\)$/i.exec(s);
	if (hslMatch) {
		const { parts, alpha: slashAlpha } = splitColorArgs(hslMatch[1]);
		if (parts.length < 3) return null;
		const h = parseFloat(parts[0].replace(/deg$/i, ''));
		const sat = parsePercentOrFraction(parts[1]);
		const lig = parsePercentOrFraction(parts[2]);
		if (!Number.isFinite(h) || sat === null || lig === null) return null;
		const [r, g, b] = hslToSrgb(h, sat, lig);
		const alpha = parts.length >= 4 ? (parsePercentOrFraction(parts[3]) ?? slashAlpha) : slashAlpha;
		return srgbToOklch(r, g, b, alpha);
	}

	return null;
}

// Canonical serializer -- every committed value from the color field is written in this form.
// Alpha suffix omitted when fully opaque, matching how a designer would hand-author it.
export function formatOklch(l: number, c: number, h: number, alpha: number): string {
	const lPct = `${round(l * 100, 2)}%`;
	const cStr = round(c, 4).toString();
	const hStr = round(h, 2).toString();
	if (alpha >= 1) return `oklch(${lPct} ${cStr} ${hStr})`;
	return `oklch(${lPct} ${cStr} ${hStr} / ${round(alpha, 3)})`;
}

function round(n: number, digits: number): number {
	const f = Math.pow(10, digits);
	return Math.round(n * f) / f;
}

// Oklab -> legacy sRGB `#rrggbb`(`aa`) -- used for the swatch fallback on browsers/contexts that
// don't render `oklch()` (vanishingly rare today, but cheap insurance), and for round-trip tests.
export function oklchToHex(l: number, c: number, h: number, alpha = 1): string {
	const [, a, b] = oklchToOklab(l, c, h);
	const [lr, lg, lb] = oklabToLinearSrgb(l, a, b);
	const clamp = (v: number) => Math.max(0, Math.min(1, v));
	const toByte = (v: number) => Math.round(clamp(linearToSrgb(v)) * 255);
	const [r, g, bch] = [toByte(lr), toByte(lg), toByte(lb)];
	const hex = (n: number) => n.toString(16).padStart(2, '0');
	const alphaHex = alpha < 1 ? hex(Math.round(clamp(alpha) * 255)) : '';
	return `#${hex(r)}${hex(g)}${hex(bch)}${alphaHex}`;
}

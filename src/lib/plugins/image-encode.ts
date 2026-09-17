// Generic browser-side image encoder, exposed to plugins via the kit10_encode_image host fn.
// The Rust side of the image-export pipeline (the snapshot plugin) encodes PNG/JPEG/lossless
// WebP itself, but LOSSY WebP has no pure-Rust non-copyleft encoder that builds for
// wasm32-unknown-unknown (libwebp is C, zenwebp is AGPL) -- the one format family only browsers
// can produce. Chrome encodes lossy WebP natively; Firefox/Safari do NOT (OffscreenCanvas
// silently falls back to PNG there), so `encodeImageBrowser` reports the mime it ACTUALLY
// encoded and the caller (the plugin) names the file accordingly -- a Firefox user asking for
// lossy WebP gets a .png, never a mislabeled file.
//
// Raw RGBA in (straight alpha -- see view-capture.ts's unpremultiplyRgba), encoded bytes +
// actual mime out. Not plugin-specific: any future consumer that wants a browser-encoded image
// of arbitrary pixels can call the same host fn.

// WebP encode support is a per-BROWSER fact; probe it once (a 1x1 encode) and cache. Never
// trusted per-request: convertToBlob's `type` option is a hint, and the returned Blob's own
// type is the only honest answer.
let webpEncodeSupport: boolean | null = null;

export async function detectWebpEncodeSupport(): Promise<boolean> {
	if (webpEncodeSupport !== null) return webpEncodeSupport;
	try {
		const canvas = new OffscreenCanvas(1, 1);
		const ctx = canvas.getContext('2d');
		ctx?.fillRect(0, 0, 1, 1);
		const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
		webpEncodeSupport = blob.type === 'image/webp';
	} catch {
		webpEncodeSupport = false;
	}
	return webpEncodeSupport;
}

export interface BrowserEncodeInput {
	rgba: Uint8Array;
	width: number;
	height: number;
	// Requested mime: 'image/webp' | 'image/png' | 'image/jpeg'. Anything else is rejected
	// (this host fn exists for the format families the snapshot plugin doesn't encode itself;
	// silently accepting arbitrary types would grow a second format vocabulary nobody declared).
	mime: string;
	// 0..1, applied to lossy encoders only (PNG ignores it). Undefined = encoder default.
	quality?: number;
}

export interface BrowserEncodeResult {
	bytes: Uint8Array;
	// The mime ACTUALLY encoded -- may differ from the request when the browser can't produce
	// the requested family (lossy WebP on Firefox/Safari downgrades to PNG).
	mime: string;
}

const SUPPORTED_MIMES = new Set(['image/webp', 'image/png', 'image/jpeg']);

export async function encodeImageBrowser(input: BrowserEncodeInput): Promise<BrowserEncodeResult> {
	const { rgba, width, height, mime, quality } = input;
	if (!SUPPORTED_MIMES.has(mime)) {
		throw new Error(`unsupported encode mime: ${mime}`);
	}
	if (rgba.length < width * height * 4) {
		throw new Error('rgba payload smaller than width*height*4');
	}
	let targetMime = mime;
	if (mime === 'image/webp' && !(await detectWebpEncodeSupport())) {
		targetMime = 'image/png';
	}
	const canvas = new OffscreenCanvas(width, height);
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
	// ImageData takes a copy of the pixel bytes; Uint8ClampedArray view over the exact slice
	// (the capture bytes may be a larger ArrayBuffer when shared -- slice to the used length).
	ctx.putImageData(
		new ImageData(new Uint8ClampedArray(rgba.slice(0, width * height * 4)), width, height),
		0,
		0
	);
	const blob = await canvas.convertToBlob({
		type: targetMime,
		quality: quality === undefined ? undefined : Math.min(1, Math.max(0, quality))
	});
	return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: blob.type };
}

// Host-side orchestration for one-shot Vellum canvas captures (image export). Vellum owns the
// GPU machinery (begin_canvas_capture arms the next draw; see taf_can_do/src/render/mod.rs's
// draw_capture_frame), this module owns the CALL SEQUENCE around it: save camera -> frame the
// node -> render the armed frame -> poll the readback -> unpremultiply -> restore camera. Kept
// as pure functions over an injected `CaptureVellumApi` (the subset of the wasm-bindgen glue the
// flow touches) so the whole sequence is unit-testable with a fake -- the real glue is
// `typeof import('../vellum/vellum_renderer.js')`, duck-compatible by construction.
//
// Capture semantics (why these steps and not canvas.toDataURL): the capture draw renders
// chrome-free over a TRANSPARENT background into an offscreen COPY_SRC texture, so an export
// carries a real alpha channel and none of the editor's grid/zoom-badge/selection chrome, at
// (physical canvas x scale) resolution -- independent of what's actually on screen at the
// moment. The visible canvas is never touched: the capture draw skips acquire/present, so the
// camera save/restore sandwich is invisible to the user except for one coalesced repaint at the
// end (restore + render below).

// The readback completes only when the browser's GPU task queue has advanced -- never inside
// the same task as the submit. `captureViewImage` polls with a macrotask yield between polls
// until this deadline; a WebGPU stall (device lost, hidden tab throttling) surfaces as a
// timeout error rather than a hang.
const CAPTURE_TIMEOUT_MS = 5_000;

export interface CaptureOptions {
	// Margin around the framed view, in FINAL-OUTPUT pixels (at scale 2 a 16px padding is still
	// 16px in the exported image). Default: none.
	paddingPx?: number;
	// Output-resolution multiplier over the view's own design dimensions: a 200x100 view at
	// scale 2 exports as a 400x200 image (the Figma 1x/2x convention -- the display's dpr does
	// not enter the output size). Rejected with a thrown error when the result would exceed the
	// GPU's max texture dimension. Default 1.
	scale?: number;
}

export interface CaptureResult {
	width: number;
	height: number;
	// Straight (unpremultiplied) RGBA, one byte per channel, row-packed, no stride padding.
	rgba: Uint8Array;
}

export interface CaptureVellumApi {
	get_pan(): [number, number] | Float32Array;
	get_zoom(): number;
	set_pan_absolute(x: number, y: number): void;
	set_zoom(zoom: number): void;
	frame_node_exact(index: number, padding_px: number, scale: number): boolean;
	begin_canvas_capture(): void;
	render(): void;
	canvas_capture_ready(): boolean;
	canvas_capture_meta(): Uint32Array | number[];
	canvas_capture_bytes(): Uint8Array;
}

// In-place: standard src-over blending over transparent black writes PREMULTIPLIED rgb into the
// capture buffer (see the capture fields' doc comment in render/mod.rs), but every downstream
// consumer -- ImageData (which the encode path builds), and the Rust decoders in the snapshot
// plugin alike -- expects STRAIGHT alpha. rgb = rgb * 255/a (clamped; a=0 premultiplied rgb is 0
// by construction and stays 0; a=255 is already exact, so the identity path skips the multiply).
// The multiply-then-divide ordering (v*255)/a, not v*(255/a), matters: 255/a is inexact in f64
// for most a (e.g. 1/100), and the error visibly rounds a channel the other way; v*255 is an
// exact integer for every v<=255.
export function unpremultiplyRgba(data: Uint8Array): void {
	for (let i = 0; i + 3 < data.length; i += 4) {
		const a = data[i + 3]!;
		if (a === 0 || a === 255) continue;
		data[i] = Math.min(255, Math.round((data[i]! * 255) / a));
		data[i + 1] = Math.min(255, Math.round((data[i + 1]! * 255) / a));
		data[i + 2] = Math.min(255, Math.round((data[i + 2]! * 255) / a));
	}
}

// Drives the whole capture sequence for the node at scene `viewIndex` (the ORIGINAL scene-array
// index -- the editor maps viewId -> index via nodeViewIds.indexOf(viewId) before calling, the
// first hit being the view's top-level cell). The exported image is the view's own design
// dimensions x scale (+ padding) -- never the canvas's size, never letterboxed. ALWAYS restores
// the camera before returning or throwing, so a failed capture never leaves the editor framed
// onto the exported view.
export async function captureViewImage(
	vellum: CaptureVellumApi,
	viewIndex: number,
	{ paddingPx = 0, scale = 1 }: CaptureOptions = {}
): Promise<CaptureResult> {
	const pan = vellum.get_pan();
	const zoom = vellum.get_zoom();
	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		vellum.set_pan_absolute(pan[0] ?? 0, pan[1] ?? 0);
		// set_zoom snaps to ZOOM_LEVELS; the editor only ever puts snapped zooms into view_zoom,
		// so the restore is exact in practice.
		vellum.set_zoom(zoom);
		vellum.render();
	};
	try {
		if (!vellum.frame_node_exact(viewIndex, paddingPx, scale)) {
			throw new Error('view has no layout rect to capture');
		}
		vellum.begin_canvas_capture();
		vellum.render();
		const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
		while (!vellum.canvas_capture_ready()) {
			if (Date.now() > deadline) {
				throw new Error('capture readback timed out');
			}
			// setTimeout, not rAF: a hidden tab throttles rAF to zero, which would hang the
			// poll loop instead of letting the GPU queue advance.
			await new Promise((r) => setTimeout(r, 0));
		}
		const meta = vellum.canvas_capture_meta();
		const [w, h] = [meta[0] ?? 0, meta[1] ?? 0];
		if (!w || !h) {
			throw new Error('capture rejected (output exceeds the GPU texture limit at this scale)');
		}
		const bytes = vellum.canvas_capture_bytes();
		if (bytes.length < w * h * 4) {
			throw new Error('capture returned fewer bytes than its reported size');
		}
		unpremultiplyRgba(bytes);
		return { width: w, height: h, rgba: bytes };
	} finally {
		restore();
	}
}

import { describe, it, expect, vi, afterEach } from 'vitest';
import { unpremultiplyRgba, captureViewImage, type CaptureVellumApi } from './view-capture.js';

describe('unpremultiplyRgba', () => {
	it('recovers straight alpha from premultiplied rgb', () => {
		// Premultiplied (128, 64, 32, 128) -> straight (255, 128, 64).
		const data = new Uint8Array([128, 64, 32, 128]);
		unpremultiplyRgba(data);
		expect([...data]).toEqual([255, 128, 64, 128]);
	});

	it('leaves opaque pixels untouched', () => {
		const data = new Uint8Array([200, 100, 50, 255]);
		unpremultiplyRgba(data);
		expect([...data]).toEqual([200, 100, 50, 255]);
	});

	it('leaves fully transparent pixels black', () => {
		const data = new Uint8Array([0, 0, 0, 0]);
		unpremultiplyRgba(data);
		expect([...data]).toEqual([0, 0, 0, 0]);
	});

	it('clamps rounding overflow at 255', () => {
		// 254/254*255 = 255; a value that would round past the clamp: (255/200)*254...
		const data = new Uint8Array([200, 200, 200, 200]);
		unpremultiplyRgba(data);
		// 200 * 255/200 = 255 exactly.
		expect([...data]).toEqual([255, 255, 255, 200]);
	});

	it('handles multiple pixels including mixed alphas', () => {
		const data = new Uint8Array([100, 50, 0, 100, 0, 0, 0, 0, 255, 255, 255, 255]);
		unpremultiplyRgba(data);
		expect([...data]).toEqual([255, 128, 0, 100, 0, 0, 0, 0, 255, 255, 255, 255]);
	});
});

// Minimal scriptable fake of the Vellum glue surface captureViewImage drives. `readyAfter`
// polls before canvas_capture_ready turns true, so the test also exercises the poll loop.
// render() is labeled by CALL ORDER (the real one draws the armed frame when armed, a normal
// frame otherwise; the fake just tags render #1 and #2 so assertions read the sequence).
function fakeVellum(readyAfter = 0) {
	const calls: string[] = [];
	let renders = 0;
	let polls = 0;
	const vellum: CaptureVellumApi & { calls: string[] } = {
		calls,
		get_pan: () => [12.5, -3.25],
		get_zoom: () => 1.5,
		set_pan_absolute: (x, y) => calls.push(`set_pan_absolute:${x}:${y}`),
		set_zoom: (z) => calls.push(`set_zoom:${z}`),
		frame_node_exact: (index, padding_px, scale) => {
			calls.push(`frame_node_exact:${index}:${padding_px}:${scale}`);
			return index === 7;
		},
		begin_canvas_capture: () => calls.push('begin_canvas_capture'),
		render: () => calls.push(`render#${++renders}`),
		canvas_capture_ready: () => {
			calls.push(`capture_ready:${polls}`);
			return ++polls > readyAfter;
		},
		canvas_capture_meta: () => {
			calls.push('capture_meta');
			return [4, 2];
		},
		canvas_capture_bytes: () => {
			calls.push('capture_bytes');
			// 2 rows x 4 px, premultiplied: first px a=128 (needs unpremultiply), second a=0,
			// third a=255, fourth a=200.
			return new Uint8Array([
				100, 0, 0, 128, 0, 0, 0, 0, 10, 20, 30, 255, 60, 120, 180, 200, 0, 0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0
			]);
		}
	};
	return vellum;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe('captureViewImage', () => {
	it('runs frame -> arm -> render -> poll -> readback, then restores the camera and repaints', async () => {
		const vellum = fakeVellum(2);
		const result = await captureViewImage(vellum, 7, { paddingPx: 8, scale: 2 });

		expect(result.width).toBe(4);
		expect(result.height).toBe(2);
		// First pixel unpremultiplied: 100 * 255/128 = 199.2 -> 199; alpha channel untouched.
		expect([...result.rgba.slice(0, 4)]).toEqual([199, 0, 0, 128]);
		// Third pixel (opaque) exact; fourth unpremultiplied: 60*255/200 = 76.5 -> 77.
		expect([...result.rgba.slice(8, 12)]).toEqual([10, 20, 30, 255]);
		expect([...result.rgba.slice(12, 16)]).toEqual([77, 153, 230, 200]);

		expect(vellum.calls).toEqual([
			'frame_node_exact:7:8:2',
			'begin_canvas_capture',
			'render#1',
			'capture_ready:0',
			'capture_ready:1',
			'capture_ready:2',
			'capture_meta',
			'capture_bytes',
			'set_pan_absolute:12.5:-3.25',
			'set_zoom:1.5',
			'render#2'
		]);
	});

	it('defaults padding to 0 and scale to 1', async () => {
		const vellum = fakeVellum(0);
		await captureViewImage(vellum, 7);
		expect(vellum.calls[0]).toBe('frame_node_exact:7:0:1');
		expect(vellum.calls[1]).toBe('begin_canvas_capture');
	});

	it('throws and still restores the camera when the view has no layout rect', async () => {
		const vellum = fakeVellum(0);
		await expect(captureViewImage(vellum, 99)).rejects.toThrow('no layout rect');
		expect(vellum.calls).toEqual([
			'frame_node_exact:99:0:1',
			'set_pan_absolute:12.5:-3.25',
			'set_zoom:1.5',
			'render#1'
		]);
	});

	it('throws when the capture meta is 0-sized (rejected request) and still restores', async () => {
		const vellum = fakeVellum(0);
		vellum.canvas_capture_meta = () => [0, 0];
		await expect(captureViewImage(vellum, 7)).rejects.toThrow('GPU texture limit');
		// restore ran after the failure
		expect(vellum.calls.at(-3)).toBe('set_pan_absolute:12.5:-3.25');
	});

	it('times out instead of hanging when the readback never completes', async () => {
		const vellum = fakeVellum(0);
		vellum.canvas_capture_ready = () => false;
		let fake = 0;
		vi.spyOn(Date, 'now').mockImplementation(() => {
			fake += 1000;
			return fake;
		});
		await expect(captureViewImage(vellum, 7)).rejects.toThrow('timed out');
		// camera restored despite the timeout
		expect(vellum.calls.at(-3)).toBe('set_pan_absolute:12.5:-3.25');
	});
});

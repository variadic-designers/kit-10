<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let vellum: any;

	let canvas: HTMLCanvasElement;
	let rafId: number;
	let initialized = false;
	let resizeObserver: ResizeObserver | null = null;

	let panning = false;
	let lastX = 0;
	let lastY = 0;

	onMount(async () => {
		vellum = await import('../vellum/vellum_renderer.js');
		await vellum.default();
		await vellum.initialize('vellum-canvas', canvas.clientWidth, canvas.clientHeight);
		initialized = true;

		resizeObserver = new ResizeObserver(() => {
			if (!initialized || !canvas || !vellum) return;
			vellum.resize(canvas.clientWidth, canvas.clientHeight);
		});
		resizeObserver.observe(canvas);

		const draw = () => {
			if (vellum) vellum.render();
			rafId = requestAnimationFrame(draw);
		};
		rafId = requestAnimationFrame(draw);
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (resizeObserver) resizeObserver.disconnect();
	});

	function onPointerDown(e: PointerEvent) {
		panning = true;
		lastX = e.clientX;
		lastY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (!panning || !vellum) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		vellum.set_pan(dx, dy);
	}

	function onPointerUp(e: PointerEvent) {
		panning = false;
		canvas.releasePointerCapture(e.pointerId);
	}

	function onWheel(e: WheelEvent) {
		if (!vellum) return;
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		if (e.deltaY < 0) vellum.zoom_in_at(cx, cy);
		else vellum.zoom_out_at(cx, cy);
	}
</script>

<canvas
	id="vellum-canvas"
	bind:this={canvas}
	style="width:100%;height:100%;display:block;touch-action:none;"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onwheel={onWheel}
></canvas>

<style lang="scss">
	@use '_index' as *;
</style>

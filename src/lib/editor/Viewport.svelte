<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { theme, getTheme, type Theme } from '$lib/theming.js';
	import { setVellumInstance, setRenderRequester } from './vellum-instance.js';
	import type { EditorActivity, EditorSelection } from './Editor.svelte';
	import { selectView, deselectView } from './selection.js';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let vellum: any;

	let {
		data = '[]',
		nodeViewIds = [],
		editorActivity = $bindable(),
		selection = $bindable(),
		hoveredViewId = $bindable(null)
	}: {
		data?: string;
		nodeViewIds?: string[];
		editorActivity: EditorActivity;
		selection: EditorSelection;
		hoveredViewId?: string | null;
	} = $props();

	let canvas: HTMLCanvasElement;
	let initialized = false;
	let hasData = $state(false);
	let resizeObserver: ResizeObserver | null = null;

	let panning = false;
	let lastX = 0;
	let lastY = 0;
	// Captured once on pointerdown (unlike lastX/lastY, which move continuously for pan
	// deltas) -- used on pointerup to tell a click apart from a drag-to-pan.
	let downX = 0;
	let downY = 0;
	const CLICK_DRAG_THRESHOLD_PX = 4;

	let hoverRaf = 0;

	// On-demand rendering: only paint a frame when something Vellum-visible actually changed
	// (data, theme, pan, zoom, resize -- see every requestRender() call site below, plus
	// vellum-instance.ts's requestVellumRender for the load_font call sites outside this
	// component), instead of a perpetual requestAnimationFrame loop running at full refresh
	// rate forever regardless of activity. `rafId` doubles as the "a frame is already
	// scheduled" guard, which also makes this naturally coalesce bursts of calls (e.g. rapid
	// pointermove while panning) into a single paint per frame.
	let rafId = 0;
	// Flips the loop back into continuous-every-frame mode -- kept for actual animation work
	// later (something driving continuous visual change frame over frame, e.g. eased pan/zoom
	// or a live token preview), not currently called by anything. Not exposed outside this
	// component yet since nothing needs it yet; wire it through `bind:this` when something does.
	let continuousMode = false;

	function renderFrame() {
		rafId = 0;
		if (vellum) vellum.render();
		if (continuousMode) requestRender();
	}

	function requestRender() {
		// Gated on hasData -- the first real set_data() call, not just "vellum itself finished
		// initializing" -- so nothing ever paints before there's real content to show. Without
		// this, calls that can legitimately fire before that (ResizeObserver's own initial
		// callback, the colors-applied-on-init call) would paint an empty background+grid frame
		// visible through/around the loading logo overlay while PGlite/Charter are still
		// resolving, instead of the single clean reveal once real data lands.
		if (!vellum || rafId || !hasData) return;
		rafId = requestAnimationFrame(renderFrame);
	}

	// Resolves a vellum.get_selection(x, y) hit-test index to the view it belongs to, via
	// Charter's node_view_ids side-map (parallel to the viewport_data array). "" (structural
	// grid scaffolding, no owning view) and an out-of-range index both mean "no view".
	function resolveViewIdAt(x: number, y: number): string | null {
		if (!vellum) return null;
		const index: number | undefined = vellum.get_selection(x, y);
		if (index === undefined) return null;
		const viewId = nodeViewIds[index];
		return viewId ? viewId : null;
	}

	function resolveEffective(t: Theme): 'light' | 'dark' {
		if (t === 'auto') {
			return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
		}
		return t;
	}

	function applyColors(t: Theme) {
		if (!vellum) return;
		const effective = resolveEffective(t);
		if (effective === 'dark') {
			vellum.set_colors(0.0, 0.0, 0.0, 1.0, 0.005, 0.005, 0.005, 1.0);
		} else {
			vellum.set_colors(0.8, 0.8, 0.8, 1.0, 1.0, 1.0, 1.0, 1.0);
		}
		requestRender();
	}

	onMount(async () => {
		vellum = await import('../vellum/vellum_renderer.js');
		await vellum.default();
		const initCanvas = () =>
			new Promise<void>((resolve) => {
				const tryInit = () => {
					const w = canvas.clientWidth;
					const h = canvas.clientHeight;
					if (w > 0 && h > 0) {
						vellum.initialize('vellum-canvas', w, h).then(resolve);
					} else {
						requestAnimationFrame(tryInit);
					}
				};
				tryInit();
			});
		await initCanvas();
		initialized = true;
		setVellumInstance(vellum);
		setRenderRequester(requestRender);
		applyColors(getTheme());

		resizeObserver = new ResizeObserver(() => {
			if (!initialized || !canvas || !vellum) return;
			const w = canvas.clientWidth;
			const h = canvas.clientHeight;
			if (w === 0 || h === 0) return;
			vellum.resize(w, h);
			requestRender();
		});
		resizeObserver.observe(canvas);

		window.addEventListener('keydown', onKeydown);
	});

	// Dev A/B toggle for Tier-1 pixel snapping (crisp snap-to-grid vs. the default smooth SDF-AA
	// look). Shift+P flips it; must request a repaint here since set_pixel_snap only sets a flag
	// the next frame reads (rendering is on-demand).
	let pixelSnap = false;
	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'P' && e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
			pixelSnap = !pixelSnap;
			vellum?.set_pixel_snap(pixelSnap);
			requestRender();
		}
	}

	$effect(() => {
		const t = $theme;
		if (initialized && vellum) applyColors(t ?? 'auto');
	});

	$effect(() => {
		const d = data;
		if (initialized && vellum && d) {
			vellum.set_data(d);
			hasData = true;
			requestRender();
		}
	});

	// Pans the selected view into view when it isn't already visible -- e.g. clicking a row in
	// the Views panel that's off-screen. Fires on every selectedViewPrimary change regardless of
	// origin (Views panel vs. a canvas click), rather than only for panel-originated selection,
	// because that distinction doesn't need to exist here: ensure_index_visible is itself a
	// no-op when the node's already on-screen (see its own doc comment in taf_can_do), which a
	// canvas click's target always is.
	//
	// Guards against re-centering on non-selection updates: nodeViewIds is tracked as an effect
	// dependency (it's a $state read), but changes to it from hover highlighting (which triggers
	// on_selection_change -> build_viewport -> new node_view_ids) should NOT re-pan to the
	// selected view -- that fights the user's manual pan. By tracking which viewId we last panned
	// to (lastPanSelection), and skipping when the selected view hasn't actually changed, hover
	// updates still fire the effect (necessary to re-read nodeViewIds if a DB-write shifted
	// indices) but produce no re-center overshoot.
	let lastPanSelection: string | null = null;

	$effect(() => {
		const viewId = selection.selectedViewPrimary;
		if (!initialized || !vellum || !hasData || !viewId) return;
		if (viewId === lastPanSelection) return;
		lastPanSelection = viewId;
		const ids = nodeViewIds;
		const index = ids.indexOf(viewId);
		if (index === -1) return;
		if (vellum.ensure_index_visible(index)) requestRender();
	});

	onDestroy(() => {
		if (rafId) cancelAnimationFrame(rafId);
		if (resizeObserver) resizeObserver.disconnect();
		// onDestroy runs during SSR too (unlike onMount), where `window` is undefined.
		if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeydown);
	});

	function onPointerDown(e: PointerEvent) {
		panning = true;
		lastX = e.clientX;
		lastY = e.clientY;
		downX = e.clientX;
		downY = e.clientY;
		canvas.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (panning && vellum) {
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			vellum.set_pan(dx, dy);
			requestRender();
			return;
		}

		// Hover hit-test, throttled to once per animation frame -- a canvas pointermove can
		// fire far more often than that, and get_selection's rect scan is wasted work between
		// frames.
		if (!vellum || hoverRaf) return;
		hoverRaf = requestAnimationFrame(() => {
			hoverRaf = 0;
			const rect = canvas.getBoundingClientRect();
			hoveredViewId = resolveViewIdAt(e.clientX - rect.left, e.clientY - rect.top);
		});
	}

	function onPointerUp(e: PointerEvent) {
		panning = false;
		canvas.releasePointerCapture(e.pointerId);

		const movedDistance = Math.hypot(e.clientX - downX, e.clientY - downY);
		if (movedDistance > CLICK_DRAG_THRESHOLD_PX) return; // was a drag-to-pan, not a click

		const rect = canvas.getBoundingClientRect();
		const viewId = resolveViewIdAt(e.clientX - rect.left, e.clientY - rect.top);
		if (viewId) {
			selectView(editorActivity, selection, viewId);
		} else {
			deselectView(editorActivity, selection);
		}
	}

	function onPointerLeave() {
		if (hoverRaf) {
			cancelAnimationFrame(hoverRaf);
			hoverRaf = 0;
		}
		hoveredViewId = null;
	}

	function onWheel(e: WheelEvent) {
		if (!vellum) return;
		e.preventDefault();
		const rect = canvas.getBoundingClientRect();
		const cx = e.clientX - rect.left;
		const cy = e.clientY - rect.top;
		if (e.deltaY < 0) vellum.zoom_in_at(cx, cy);
		else vellum.zoom_out_at(cx, cy);
		requestRender();
	}
</script>

<div class="viewport-wrap">
	<canvas
		id="vellum-canvas"
		bind:this={canvas}
		style="width:100%;height:100%;display:block;touch-action:none;"
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointerleave={onPointerLeave}
		onwheel={onWheel}
	></canvas>

	<div class="logo-overlay" class:ready={hasData}>
		<svg width="0" height="0" style="position:absolute">
			<defs>
				<clipPath id="logoClip" clipPathUnits="objectBoundingBox">
					<path d="M1,0.5c0,0.276-0.171,0.5-0.382,0.5V0.934C0.618,0.694,0.766,0.5,0.95,0.5Z" />
					<path
						d="M0.618,0.934V1c-0.211,0-0.382-0.224-0.382-0.5h0.05C0.469,0.5,0.618,0.694,0.618,0.934Z"
					/>
					<path
						d="M0.618,0V0.065C0.618,0.305,0.469,0.5,0.285,0.5H0.235C0.235,0.224,0.406,0,0.618,0Z"
					/>
					<path d="M1,0.5H0.95C0.766,0.5,0.618,0.305,0.618,0.065V0C0.829,0,1,0.224,1,0.5Z" />
					<path d="M0.236,0V0.691A0.236,0.309,0,0,1,0,1V0.309A0.236,0.309,0,0,1,0.236,0Z" />
				</clipPath>
			</defs>
		</svg>
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	.viewport-wrap {
		position: relative;
		width: 100%;
		height: 100%;
	}

	.logo-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		pointer-events: none;
		opacity: 1;
		transition: opacity 0.4s ease;

		// The transition name lives on ::after, not this inset:0 wrapper -- the View
		// Transitions API morphs between the *captured box geometry* of the old and new
		// elements sharing a name, and the wrapper spans the whole viewport panel while the
		// hero page's .hero-glyph (the other end of this transition) is tightly sized to the
		// glyph itself. Naming the wrapper made the browser scale the shared element up to
		// match the wrapper's much larger box instead of the actual glyph size.
		&::after {
			content: '';
			display: block;
			view-transition-name: kit10-logo;
			clip-path: url(#logoClip);
			width: min(50%, 12rem);
			aspect-ratio: 622.31 / 476;
			background: radial-gradient(circle, #93c5fd 30%, #3b82f6 65%, var(--color-bg) 10%);
			background-size: 200% 200%;
			animation: walk-background 5s ease-in-out infinite;
		}

		&.ready {
			opacity: 0;
		}
	}

	@keyframes walk-background {
		0% {
			background-position: -140% 0%;
		}
		25% {
			background-position: -150% 60%;
		}
		50% {
			background-position: 80% 150%;
		}
		75% {
			background-position: -80% 150%;
		}
		88% {
			background-position: -100% -100%;
		}
		100% {
			background-position: -140% 0%;
		}
	}
</style>

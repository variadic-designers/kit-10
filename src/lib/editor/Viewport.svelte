<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { theme, getTheme, type Theme } from '$lib/theming.js';
	import { setVellumInstance, setRenderRequester } from './vellum-instance.js';
	import type { EditorActivity, EditorSelection } from './Editor.svelte';
	import { selectView, deselectView } from './selection.js';
	import { viewportInput, updateViewportInput } from './viewport-input.js';
	import { keybinds, matchKey, matchMouse, isTextEntryTarget } from './keybinds.js';
	import { buildViewTree, resolveDragTargetViewId } from './view-tree.js';
	import type { Api } from 'manager';
	import type { ResolvedView } from '$lib/plugins/types.js';
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let vellum: any;

	let {
		data = '[]',
		dataBinary = null,
		nodeViewIds = [],
		api = null,
		projectHints = null,
		projectHintsReady = false,
		resolvedViews = [],
		compositionKeys = [],
		beginPendingResolve = () => {},
		editorActivity = $bindable(),
		selection = $bindable(),
		hoveredViewId = $bindable(null)
	}: {
		data?: string;
		dataBinary?: Uint8Array | null;
		nodeViewIds?: string[];
		// Camera pan memory (project.hints.vellum.panned) -- optional so existing callers/tests
		// that don't wire project hints through still work; without `api` the feature is just inert.
		api?: Api | null;
		projectHints?: Record<string, unknown> | null;
		projectHintsReady?: boolean;
		resolvedViews?: ResolvedView[];
		// Charter's composition-field-key list (see view-tree.ts) -- used only to derive
		// rootViewIds, so a pointerdown on a root view can be routed to a node-drag instead of a
		// pan. Not otherwise interpreted here.
		compositionKeys?: string[];
		// Flags "a resolve is coming" on the plugin manager synchronously, before persistViewPosition
		// writes the dropped position -- see beginPendingResolve's doc in manager.svelte.ts. Without
		// this, a hover-triggered on_selection_change call reliably runs to completion (and applies
		// its stale result) before the position write's own resolve even reaches pluginQueue, since
		// that resolve needs a real DB round-trip first while hover only needs one 0ms timer.
		beginPendingResolve?: () => void;
		editorActivity: EditorActivity;
		selection: EditorSelection;
		hoveredViewId?: string | null;
	} = $props();

	// A view is draggable (in this v1 scope) iff it's a root: nobody else's `children` references
	// it. Same graph math the Views panel / [ ] nav already use -- see view-tree.ts.
	const viewTree = $derived(buildViewTree(resolvedViews, compositionKeys));
	const rootViewIds = $derived.by(() => {
		const ids = new Set<string>();
		for (const view of resolvedViews) {
			if (!viewTree.referencedViewIds.has(view.viewId)) ids.add(view.viewId);
		}
		return ids;
	});

	// Resolves a canvas hit to the view + node index a drag should actually move -- see
	// resolveDragTargetViewId's doc in view-tree.ts for why this isn't always just `hit` itself.
	// Always resolves to the target view's own top-level node (nodeViewIds' first occurrence),
	// not necessarily `hit.index` -- even a direct hit on a root's own nested content (not a
	// composed child, just its own internal Text/Box) must still drag from the view's true root,
	// or only that nested subtree would translate instead of the whole view.
	function resolveDragTarget(hit: { index: number; viewId: string }): { viewId: string; index: number } | null {
		const targetViewId = resolveDragTargetViewId(
			hit.viewId,
			editorActivity.activeViewId,
			rootViewIds,
			viewTree
		);
		if (!targetViewId) return null;
		const index = nodeViewIds.indexOf(targetViewId);
		return index === -1 ? null : { viewId: targetViewId, index };
	}

	let canvas: HTMLCanvasElement;
	let initialized = false;
	let hasData = $state(false);
	// Set when the browser's WebGPU is missing/incomplete (see webgpuUsable). Shows the
	// unsupported-browser overlay instead of ever handing the canvas to wgpu (which would abort).
	let webgpuUnsupported = $state(false);
	// Only Firefox gets the about:config tip -- on release Firefox, WebGPU ships present but gated
	// behind dom.webgpu.enabled=false, so enabling it gives the real renderer. Other browsers that
	// fail the preflight are genuinely too old, so they get the "update your browser" message.
	const isFirefox = typeof navigator !== 'undefined' && /firefox/i.test(navigator.userAgent);
	let resizeObserver: ResizeObserver | null = null;

	let panning = false;
	// Tracks Space held down, for the 'space' pan binding (hold-Space + left-drag pans, Figma-style).
	let spaceHeld = false;
	let lastX = 0;
	let lastY = 0;

	// Node-drag (move a root view on the canvas). A pointerdown landing on a draggable root view
	// arms a *candidate* (dragCandidateViewId/Index set, draggingNode still false) instead of
	// immediately committing -- exactly mirroring how canvas.pan itself only commits to being a
	// "drag, not a click" once CLICK_DRAG_THRESHOLD_PX is crossed (see onPointerUp). Only once
	// that threshold is crossed does start_node_drag actually get called and draggingNode flips
	// to true; if it's never crossed, onPointerUp's existing click-selection path runs unchanged.
	let dragCandidateViewId: string | null = null;
	let dragCandidateIndex: number | null = null;
	let draggingNode = false;
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

	// Drives repaints for the short post-drop settle animation (Vellum eases a dropped root
	// view's raw position onto the drag-snap grid -- see end_node_drag/step_settle in
	// taf_can_do). Deliberately its own small, self-terminating rAF loop rather than flipping
	// `continuousMode` on: that flag is for open-ended continuous rendering with no stopping
	// condition, while this has a definite end (`vellum.is_settling()` goes false) that Vellum
	// itself tracks, polled once per frame until then.
	function driveSettleAnimation() {
		if (!vellum) return;
		requestRender();
		if (vellum.is_settling()) requestAnimationFrame(driveSettleAnimation);
	}

	// Resolves a vellum.get_selection(x, y) hit-test index to both the index itself and the view
	// it belongs to, via Charter's node_view_ids side-map (parallel to the viewport_data array).
	// "" (structural grid scaffolding, no owning view) and an out-of-range index both mean "no
	// view". Shared by hover/click resolution (resolveViewIdAt) and node-drag eligibility
	// (onPointerDown), so there's one hit-test call site for both.
	function resolveHitAt(x: number, y: number): { index: number; viewId: string } | null {
		if (!vellum) return null;
		const index: number | undefined = vellum.get_selection(x, y);
		if (index === undefined) return null;
		const viewId = nodeViewIds[index];
		return viewId ? { index, viewId } : null;
	}

	function resolveViewIdAt(x: number, y: number): string | null {
		return resolveHitAt(x, y)?.viewId ?? null;
	}

	// Writes a root view's dragged-to position on drop. Shallow-merges into the existing
	// hints.vellum sub-object (api.updateViewHints replaces that whole sub-object, not just the
	// key being set -- see manager's updateViewHints doc), same pattern schedulePanSave already
	// uses for project.hints.vellum.panned.
	async function persistViewPosition(viewId: string, x: number, y: number) {
		if (!api) return;
		// Synchronous, before the write -- see beginPendingResolve's own doc (manager.svelte.ts)
		// for why this has to happen here rather than once the resolve it's guarding against
		// actually arrives.
		beginPendingResolve();
		const current =
			(resolvedViews.find((v) => v.viewId === viewId)?.hints?.vellum as
				| Record<string, unknown>
				| undefined) ?? {};
		await api.updateViewHints(viewId, { vellum: { ...current, position: [x, y] } });
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
		// set_colors takes legacy sRGB floats (grid rgba, then background rgba) and converts to
		// Oklab internally. The grid line is drawn blended at up to 0.8 alpha over the background,
		// so what matters is the LIGHTNESS CONTRAST between the two. Post the OKLCH/linear-blend
		// migration the old values lost that contrast: grid black on a near-black bg was invisible
		// in dark mode, and an 0.8 grid on white read too dark in light mode. These grays keep a
		// deliberate, subtle-but-visible delta against each background (dark needs a higher raw
		// value than light because perception compresses hard near black).
		if (effective === 'dark') {
			vellum.set_colors(0.25, 0.25, 0.25, 1.0, 0.005, 0.005, 0.005, 1.0);
		} else {
			vellum.set_colors(0.88, 0.88, 0.88, 1.0, 1.0, 1.0, 1.0, 1.0);
		}
		requestRender();
	}

	// Capability preflight that mirrors wgpu's own surface-creation check (its webgpu backend does
	// `canvas.getContext("webgpu")` then a strict `instanceof GPUCanvasContext`). A recent, complete
	// WebGPU (current Firefox/Chrome/Edge) passes; an older/partial one -- notably older Firefox,
	// which returns a context that fails that instanceof -- does not. wgpu hard-`expect()`s on that
	// mismatch, which aborts the wasm (panic=abort, uncatchable) and hangs init forever. So we detect
	// the same condition up front on a throwaway canvas and degrade to a message rather than let the
	// real canvas reach wgpu. Using the same instanceof means we reject exactly the browsers wgpu
	// would panic on, and only those.
	function webgpuUsable(): boolean {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if (typeof navigator === 'undefined' || !(navigator as any).gpu) return false;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const Ctor = (globalThis as any).GPUCanvasContext;
		if (typeof Ctor !== 'function') return false;
		try {
			const probe = document.createElement('canvas');
			return probe.getContext('webgpu') instanceof Ctor;
		} catch {
			return false;
		}
	}

	onMount(async () => {
		if (!webgpuUsable()) {
			webgpuUnsupported = true;
			return;
		}
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
		vellum.set_show_box_model($viewportInput.showBoxModel);

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
		window.addEventListener('keyup', onKeyup);
	});

	// Dev A/B toggle for Tier-1 pixel snapping (crisp snap-to-grid vs. the default smooth SDF-AA
	// look). The `canvas.pixelSnap` keybind flips it; must request a repaint here since
	// set_pixel_snap only sets a flag the next frame reads (rendering is on-demand).
	let pixelSnap = false;

	// True when the pan keybind is a mouse gesture that uses the held-Space modifier -- only then does
	// a Space keydown need to arm `spaceHeld` (and swallow page scroll).
	const panUsesSpace = $derived($keybinds['canvas.pan'].source === 'mouse' && $keybinds['canvas.pan'].space);

	function onKeydown(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		if (matchKey(e, $keybinds['canvas.pixelSnap'])) {
			pixelSnap = !pixelSnap;
			vellum?.set_pixel_snap(pixelSnap);
			requestRender();
			return;
		}
		if (matchKey(e, $keybinds['canvas.toggleBoxModel'])) {
			updateViewportInput({ showBoxModel: !$viewportInput.showBoxModel });
			e.preventDefault();
			return;
		}
		if (e.code === 'Space' && panUsesSpace) {
			spaceHeld = true;
			// Stop the page from scrolling while Space is held as a pan modifier.
			e.preventDefault();
		}
	}

	function onKeyup(e: KeyboardEvent) {
		if (e.code === 'Space') spaceHeld = false;
	}

	$effect(() => {
		const t = $theme;
		if (initialized && vellum) applyColors(t ?? 'auto');
	});

	// Toggle Vellum's padding/gap (box-model) hatch overlay. set_show_box_model only sets a flag the
	// next frame reads, so request a repaint (rendering is on-demand).
	$effect(() => {
		const show = $viewportInput.showBoxModel;
		if (initialized && vellum) {
			vellum.set_show_box_model(show);
			requestRender();
		}
	});

	// Live root-view drag snap grid (Settings > Canvas & Input > Drag snap grid). Only takes
	// effect on the next update_node_drag call mid-drag -- no repaint needed here on its own,
	// nothing changes on screen until a drag actually moves.
	$effect(() => {
		const snapPx = $viewportInput.dragSnapPx;
		if (initialized && vellum) {
			vellum.set_position_snap_px(snapPx);
		}
	});

	$effect(() => {
		const d = dataBinary ?? data;
		if (initialized && vellum && d) {
			if (d instanceof Uint8Array) {
				vellum.set_data_binary(d);
			} else {
				vellum.set_data(d);
			}
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
	//
	// `lastPanSelection` is only set once `ensure_index_visible` is actually CALLED (index found),
	// never on a failed attempt -- a freshly created-then-selected view (Views.svelte's clone/
	// add-child ops call `selectView(newId, ...)` immediately after the DB write, before the next
	// live-query resolve has run) isn't in `nodeViewIds` yet on the first pass, so `index === -1`.
	// Marking it "handled" anyway (the previous behavior) meant the guard on line 2 below would
	// then silently swallow every later re-run too -- including the one where `nodeViewIds` finally
	// DOES contain it once resolve catches up -- so the camera never panned to the new view at all,
	// with no visual signal it was ever created. Leaving `lastPanSelection` untouched on a failed
	// attempt lets the effect keep retrying (still gated on `nodeViewIds` actually changing, so it's
	// not a busy-loop) until the view resolves or the user selects something else.
	let lastPanSelection: string | null = null;

	$effect(() => {
		const viewId = selection.selectedViewPrimary;
		if (!initialized || !vellum || !hasData || !viewId) return;
		if (viewId === lastPanSelection) return;
		const ids = nodeViewIds;
		const index = ids.indexOf(viewId);
		if (index === -1) return;
		lastPanSelection = viewId;
		if (vellum.ensure_index_visible(index)) requestRender();
	});

	// Per-project camera pan memory (project.hints.vellum.panned -- a Vellum-owned concept, same
	// namespace as the per-view hints.vellum.position, never hints.charter: Charter has no opinion
	// on camera position). Restored once per project switch, guarded by lastRestoredProjectId
	// (same "track what we last acted on" shape as lastPanSelection above), and only once
	// projectHintsReady flips true -- that distinguishes "this project has never been panned" from
	// "the hints row just hasn't loaded yet", so a fresh live-query subscription on project switch
	// never gets misread as a fresh project and clobbers a real saved position with the landing
	// default.
	let lastRestoredProjectId: string | null = null;

	$effect(() => {
		const projectId = editorActivity.activeProjectId;
		if (!initialized || !vellum || !projectId || !projectHintsReady) return;
		if (projectId === lastRestoredProjectId) return;
		lastRestoredProjectId = projectId;

		const vellumHints = projectHints?.vellum as { panned?: [number, number] } | undefined;
		const panned = vellumHints?.panned;
		if (panned) {
			vellum.set_pan_absolute(panned[0], panned[1]);
			requestRender();
			return;
		}

		// Never-panned project: point roughly at the seed's "Landing Page" view instead of
		// Vellum's arbitrary default origin. A best-effort estimate (assumes the untouched default
		// 100% zoom -- there's no get_zoom to check against) meant to land the view on screen, not
		// to be pixel-exact.
		const landing = resolvedViews.find((v) => v.viewName === 'Landing Page');
		const landingHints = landing?.hints as { vellum?: { position?: [number, number] } } | null;
		const pos = landingHints?.vellum?.position;
		if (pos && canvas) {
			vellum.set_pan_absolute(pos[0] - canvas.clientWidth / 2, pos[1] - canvas.clientHeight / 2);
			requestRender();
		}
	});

	// Debounced write-back of the current camera position, fired after a pan drag or a wheel
	// zoom (which also moves view_offset -- zoom-toward-cursor). Same coalescing shape as
	// scheduleReResolve in the live-query loop: cancel-and-reschedule on repeated activity, so a
	// drag or a burst of wheel notches produces one write, not one per pointermove/frame.
	let panSaveTimer: ReturnType<typeof setTimeout> | null = null;
	const PAN_SAVE_DEBOUNCE_MS = 600;

	function schedulePanSave() {
		const projectId = editorActivity.activeProjectId;
		if (!api || !vellum || !projectId) return;
		if (panSaveTimer) clearTimeout(panSaveTimer);
		panSaveTimer = setTimeout(() => {
			panSaveTimer = null;
			if (!vellum) return;
			const [x, y] = vellum.get_pan();
			const currentVellumHints = (projectHints?.vellum as Record<string, unknown> | undefined) ?? {};
			api?.updateProjectHints(projectId, { vellum: { ...currentVellumHints, panned: [x, y] } });
		}, PAN_SAVE_DEBOUNCE_MS);
	}

	onDestroy(() => {
		if (panSaveTimer) clearTimeout(panSaveTimer);
		if (rafId) cancelAnimationFrame(rafId);
		if (resizeObserver) resizeObserver.disconnect();
		// onDestroy runs during SSR too (unlike onMount), where `window` is undefined.
		if (typeof window !== 'undefined') {
			window.removeEventListener('keydown', onKeydown);
			window.removeEventListener('keyup', onKeyup);
		}
	});

	// Does this pointerdown start a pan, given the user's configured `canvas.pan` keybind (a mouse
	// gesture: a button + modifiers, optionally the held-Space modifier)?
	function gestureStartsPan(e: PointerEvent): boolean {
		return matchMouse(e, $keybinds['canvas.pan'], spaceHeld);
	}

	function onPointerDown(e: PointerEvent) {
		// Always record the down point so onPointerUp can tell a click (select) from a drag,
		// even when this gesture isn't a pan under the current binding.
		downX = e.clientX;
		downY = e.clientY;

		// A pointerdown landing on a draggable root view takes priority over panning -- arm a
		// *candidate* rather than committing to a drag immediately, so a plain click still
		// selects (see onPointerMove/onPointerUp for where the candidate either commits past the
		// click/drag threshold or falls through to the normal click-selection path unchanged).
		if (vellum && matchMouse(e, $keybinds['view.drag'], spaceHeld)) {
			const rect = canvas.getBoundingClientRect();
			const hit = resolveHitAt(e.clientX - rect.left, e.clientY - rect.top);
			const target = hit && resolveDragTarget(hit);
			if (target) {
				dragCandidateViewId = target.viewId;
				dragCandidateIndex = target.index;
				canvas.setPointerCapture(e.pointerId);
				return;
			}
		}

		panning = gestureStartsPan(e);
		if (panning) {
			// Middle-button drags otherwise trigger the browser's autoscroll affordance.
			if (e.button === 1) e.preventDefault();
			lastX = e.clientX;
			lastY = e.clientY;
		}
		canvas.setPointerCapture(e.pointerId);
	}

	function onPointerMove(e: PointerEvent) {
		if (dragCandidateViewId !== null && vellum) {
			if (!draggingNode) {
				const movedDistance = Math.hypot(e.clientX - downX, e.clientY - downY);
				if (movedDistance <= CLICK_DRAG_THRESHOLD_PX) return; // still just a candidate
			}
			const rect = canvas.getBoundingClientRect();
			const x = e.clientX - rect.left;
			const y = e.clientY - rect.top;
			if (!draggingNode) {
				const started = vellum.start_node_drag(dragCandidateIndex ?? -1, x, y);
				if (!started) {
					// Shouldn't happen (the node was hit-testable a moment ago) -- don't get stuck
					// treating every subsequent move as a drag candidate.
					dragCandidateViewId = null;
					dragCandidateIndex = null;
					return;
				}
				draggingNode = true;
			}
			vellum.update_node_drag(x, y);
			requestRender();
			return;
		}

		if (panning && vellum) {
			const dx = e.clientX - lastX;
			const dy = e.clientY - lastY;
			lastX = e.clientX;
			lastY = e.clientY;
			vellum.set_pan(dx, dy);
			requestRender();
			schedulePanSave();
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

		if (draggingNode && vellum) {
			// The SNAPPED position (end_node_drag may start a settle animation easing the raw
			// drop point onto it) -- this is what gets persisted, not wherever the cursor
			// literally released.
			const result = vellum.end_node_drag(); // Float32Array; empty if none was active
			draggingNode = false;
			const viewId = dragCandidateViewId;
			dragCandidateViewId = null;
			dragCandidateIndex = null;
			if (viewId && result.length === 2) {
				void persistViewPosition(viewId, result[0], result[1]);
			}
			driveSettleAnimation();
			return; // a completed drag never also fires click-selection
		}
		// Never crossed the drag threshold -- fall through to the normal click-selection path
		// below exactly as if this candidate had never been armed.
		dragCandidateViewId = null;
		dragCandidateIndex = null;

		// Only the primary button selects -- a middle-button release (used for middle-drag pan)
		// must never fall through into selection when the pan binding is 'middle'.
		if (e.button !== 0) return;

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
		// deltaY<0 is wheel-up = zoom in by default; zoomInvert swaps it.
		const zoomIn = $viewportInput.zoomInvert ? e.deltaY > 0 : e.deltaY < 0;
		if (zoomIn) vellum.zoom_in_at(cx, cy);
		else vellum.zoom_out_at(cx, cy);
		requestRender();
		schedulePanSave();
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

	{#if webgpuUnsupported}
		<div class="unsupported-overlay">
			<div class="unsupported-card">
				<h2>WebGPU needs to be enabled</h2>
				{#if isFirefox}
					<p>This editor renders with WebGPU. Firefox supports it, but it's switched off by default.</p>
					<details class="fix" open>
						<summary>Turn it on — about 20 seconds</summary>
						<ol>
							<li>Open a new tab and visit <code>about:config</code>.</li>
							<li>If Firefox shows a warning, choose <strong>Accept the Risk and Continue</strong>.</li>
							<li>Search for <code>dom.webgpu.enabled</code>.</li>
							<li>Click the toggle so its value becomes <code>true</code>.</li>
							<li>Return to this tab and reload the page.</li>
						</ol>
					</details>
				{:else}
					<p>
						This editor renders with WebGPU, which your browser doesn't support. Please update to the
						latest Firefox, Chrome, or Edge, then reload.
					</p>
				{/if}
			</div>
		</div>
	{/if}

	<div class="logo-overlay" class:ready={hasData || webgpuUnsupported}>
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

	.unsupported-overlay {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 2rem;
		background: var(--color-bg);
		z-index: 1;
	}

	.unsupported-card {
		max-width: 32rem;
		text-align: center;
		padding: 2rem;
		border: 1px solid var(--color-border);
		border-radius: 0.75rem;
		background: var(--color-surface);

		h2 {
			margin: 0 0 0.75rem;
			color: var(--color-heading);
			font-size: 1.125rem;
		}

		p {
			margin: 0;
			color: var(--color-text-muted);
			line-height: 1.5;
		}

		.fix {
			margin-top: 1.25rem;
			text-align: left;
			border-top: 1px solid var(--color-border);
			padding-top: 1.25rem;

			summary {
				cursor: pointer;
				color: var(--color-text);
				font-weight: 600;
				text-align: center;
			}

			&[open] summary {
				margin-bottom: 0.85rem;
			}

			ol {
				margin: 0;
				padding-left: 1.35rem;
				color: var(--color-text-muted);

				li {
					line-height: 1.5;

					& + li {
						margin-top: 0.4rem;
					}
				}
			}

			strong {
				color: var(--color-text);
				font-weight: 600;
			}

			code {
				padding: 0.05em 0.35em;
				border-radius: 0.3rem;
				background: var(--color-surface-alt);
				color: var(--color-text);
				font-family: ui-monospace, monospace;
				font-size: 0.9em;
				white-space: nowrap;
			}
		}
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
			background: radial-gradient(circle, oklch(80.9% 0.0956 251.8) 30%, oklch(62.3% 0.188 259.8) 65%, var(--color-bg) 10%);
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

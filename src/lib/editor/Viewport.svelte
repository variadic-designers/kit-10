<script lang="ts">
	import { type Writable, writable } from 'svelte/store';
	import type { ComponentFlat, ComponentView, ComponentViewRoot } from './Component.svelte';
	import KitView from './Component.svelte';

	type ViewportProps = {
		offsetX: Writable<number>;
		offsetY: Writable<number>;
		kits: ComponentFlat[];
		kitViews: ComponentViewRoot[];
	};

	const { offsetX, offsetY, kits = $bindable(), kitViews = $bindable() }: ViewportProps = $props();

	import { contextMenu } from './contextMenu';

	// canvas
	let scale = writable(1); // zoom level
	let transformOrigin = writable({ x: 50, y: 50 });

	$effect(() => {
		const viewport = document.getElementById('canvas');

		if (viewport) {
			offsetX.set(viewport.clientWidth / 2);
			offsetY.set(viewport.clientHeight / 2);
		}
	});

	let isPanning = $state(false);
	let startX = $state(0);
	let startY = $state(0);
	let startOffsetX = $state(0);
	let startOffsetY = $state(0);

	function touchControls(node: HTMLElement) {
		let lastTouchDist = 0;
		let initialScale = 1;
		let lastX = 0;
		let lastY = 0;

		const getDistance = (t1: Touch, t2: Touch) =>
			Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

		const onTouchStart = (e: TouchEvent) => {
			if (e.touches.length === 1) {
				// start panning
				lastX = e.touches[0].clientX;
				lastY = e.touches[0].clientY;
			}

			if (e.touches.length === 2) {
				// start pinch zoom
				e.preventDefault();
				lastTouchDist = getDistance(e.touches[0], e.touches[1]);
				initialScale = $scale;
			}
		};

		const onTouchMove = (e: TouchEvent) => {
			if (e.touches.length === 1) {
				// Pan
				const t = e.touches[0];
				const dx = t.clientX - lastX;
				const dy = t.clientY - lastY;

				lastX = t.clientX;
				lastY = t.clientY;

				offsetX.update((x) => x + dx / $scale);
				offsetY.update((y) => y + dy / $scale);
			}

			if (e.touches.length === 2) {
				// Pinch zoom
				e.preventDefault();
				const dist = getDistance(e.touches[0], e.touches[1]);
				const ratio = dist / lastTouchDist;
				let next = initialScale * ratio;

				if (next < 0.2) next = 0.2;
				if (next > 3.0) next = 3.0;

				scale.set(next);
			}
		};

		node.addEventListener('touchstart', onTouchStart, { passive: false });
		node.addEventListener('touchmove', onTouchMove, { passive: false });

		return {
			destroy() {
				node.removeEventListener('touchstart', onTouchStart);
				node.removeEventListener('touchmove', onTouchMove);
			}
		};
	}

	function lerp(a: number, b: number, t: number) {
		return a + (b - a) * t;
	}

	// cursor aware zoom
	function zoom(node: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			if (!(e.ctrlKey && e.altKey)) return;

			e.preventDefault();

			// Set transform-origin to mouse position
			const rect = node.getBoundingClientRect();
			const targetX = ((e.clientX - rect.left) / rect.width) * 100;
			const targetY = ((e.clientY - rect.top) / rect.height) * 100;

			transformOrigin.update((current) => ({
				x: lerp(current.x, targetX, 0.1),
				y: lerp(current.y, targetY, 0.1)
			}));

			scale.update((s) => {
				const factor = 1.15;
				let next = e.deltaY < 0 ? s * factor : s / factor;

				// Hard clamp: do nothing if outside range
				if (next < 0.2 || next > 3.0) return s;

				return next;
			});
		};

		node.addEventListener('wheel', onWheel, { passive: false });

		return {
			destroy() {
				node.removeEventListener('wheel', onWheel);
			}
		};
	}

	function scroll(node: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			// Let zoom() handle its own stuff
			if (e.ctrlKey && e.altKey) return;

			e.preventDefault();

			const dy = -e.deltaY;
			const dx = -e.deltaX;

			// SHIFT = horizontal scroll using vertical wheel
			if (e.shiftKey) {
				offsetX.update((x) => x + dy / $scale);
			} else {
				// Normal vertical scroll
				offsetY.update((y) => y + dy / $scale);
			}
		};

		node.addEventListener('wheel', onWheel, { passive: false });

		return {
			destroy() {
				node.removeEventListener('wheel', onWheel);
			}
		};
	}

	// directive/action for panning
	function pan(node: HTMLElement) {
		const onMouseDown = (e: MouseEvent) => {
			if (e.button !== 1) return; // only middle mouse button
			e.preventDefault();
			isPanning = true;
			startX = e.clientX;
			startY = e.clientY;
			offsetX.subscribe((v) => (startOffsetX = v))();
			offsetY.subscribe((v) => (startOffsetY = v))();
			window.addEventListener('mousemove', onMouseMove);
			window.addEventListener('mouseup', onMouseUp);
		};

		const onMouseMove = (e: MouseEvent) => {
			if (!isPanning) return;
			const dx = e.clientX - startX;
			const dy = e.clientY - startY;
			offsetX.set(startOffsetX + dx / $scale);
			offsetY.set(startOffsetY + dy / $scale);
		};

		const onMouseUp = () => {
			isPanning = false;
			window.removeEventListener('mousemove', onMouseMove);
			window.removeEventListener('mouseup', onMouseUp);
		};

		node.addEventListener('mousedown', onMouseDown);

		return {
			destroy() {
				node.removeEventListener('mousedown', onMouseDown);
			}
		};
	}

	let menu = [
		{
			name: 'add',
			displayText: 'Undo',
			icon: 'fa-solid fa-rotate-right',
			onClick: () => console.log('Add')
		},
		'hr',
		{
			name: 'add',
			displayText: 'Details',
			icon: 'fa-solid fa-question',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'New View',
			icon: 'fa-solid fa-diamond',
			onClick: () => console.log('Add')
		},

		{
			name: 'trash',
			displayText: 'Clone',
			icon: 'fa-solid fa-clone',
			onClick: () => console.log('Remove')
		},
		'hr',
		{
			name: 'trash',
			displayText: 'Enumerate Views',
			icon: 'fa-solid fa-layer-group',
			onClick: () => console.log('Remove')
		},
		{
			name: 'zoom',
			displayText: 'Show Mappings',
			icon: 'fa-solid fa-sliders',
			onClick: () => console.log('Zoom')
		},
		'hr',
		{
			name: 'trash',
			displayText: 'Delete View',
			icon: 'fa-solid fa-trash-can',
			onClick: () => console.log('Remove')
		}
	];

	function selectComponent(target: ComponentView) {
		// deselect everything
		const deselectAll = (list: ComponentView[]) => {
			for (const c of list) {
				delete c.selected;
				if (c.children) deselectAll(c.children);
			}
		};
		deselectAll(kitViews);
		target.selected = 'primary';
	}

	import { type KitProps } from './/Component.svelte';
</script>

<main
	class="canvas-container"
	style="--offsetX: {$offsetX}px;--offsetY: {$offsetY}px; --zoom-level: 'Zoom Level: {Number(
		$scale.toFixed(1)
	)}' ;--scale-factor: {Number(
		$scale.toFixed(1)
	)}; --transform-origin-x: {$transformOrigin.x}%; --transform-origin-y: {$transformOrigin.y}%;"
	use:pan
	use:zoom
	use:scroll
	use:touchControls
	use:contextMenu={menu}
>
	<div id="canvas" class="canvas">
		{#snippet kitView(v: ComponentView, isRoot: boolean)}
			<KitView
				name={v.name ?? kits[v.source_index].name ?? 'Source missing'}
				sets={kits[v.source_index].sets ?? { layers: [], axisRank: [] }}
				selected={v.selected}
				params={v.params}
				hide={v.hide}
				{...isRoot ? { rootPosition: v.rootPosition } : {}}
			>
				{#if v.children}
					{#each v.children as viewChild}
						{@render kitView(viewChild, false)}
					{/each}
				{/if}
			</KitView>
		{/snippet}

		{#each kitViews as view}
			<div
				class="select"
				onclick={() => {
					selectComponent(view);
				}}
				use:contextMenu={menu}
			>
				{@render kitView(view, true)}
			</div>
		{/each}
	</div>
	<!-- <Tools /> -->

	{#if $scale.toFixed(1) !== '1.0'}
		<div class="zoom-level">
			<i class="fa-solid fa-magnifying-glass"></i>
			{$scale.toFixed(1)}
		</div>
	{/if}
</main>

<style lang="scss">
	@use '_index' as *;

	.canvas-container {
		overflow: hidden;
		position: relative;
		background-color: var(--color-bg);

		/*
		background-image:
			repeating-linear-gradient(
				45deg,
				var(--color-bg) 25%,
				transparent 25%,
				transparent 75%,
				var(--color-bg) 75%,
				var(--color-bg)
			),
			repeating-linear-gradient(
				0deg,
				var(--color-bg) 25%,
				var(--color-bg) 25%,
				var(--color-surface) 75%,
				var(--color-bg) 75%,
				var(--color-bg)
			);
		background-position:
			0 0,
			10px 10px;
		background-size: 1.2rem 1.2rem;
    */

		.zoom-level {
			position: absolute;
			top: $x-space-sm;
			right: $x-space-md;
			color: $x-white;
			mix-blend-mode: exclusion;
			font-weight: 600;
			@include fonts-stack('Satoshi-Mono', sans);
		}

		@include layout-respond-max('lg') {
			grid-area: 2 / 1 / 3 / 3;
		}

		@include layout-respond('lg') {
			grid-area: 2 / 2 / 3 / 3;
		}
	}

	.canvas {
		// width: 100%;
		// height: 100%;
		scale: var(--scale-factor);
		transition:
			scale 100ms linear,
			transform-origin 100ms linear;
		transform-origin: var(--transform-origin-x, 50%) var(--transform-origin-y, 50%);
		position: relative;
	}
</style>

<script lang="ts">
	import { tick, type Snippet } from 'svelte';
	import { clampToViewport } from './contextMenuStore.js';

	let {
		rawPos,
		boxRef = $bindable(),
		children
	}: {
		rawPos: { x: number; y: number };
		boxRef?: HTMLElement;
		children: Snippet;
	} = $props();

	// Rendered position, distinct from rawPos (the ideal spot -- a click point for the root
	// menu, or "beside the trigger item" for a submenu). Defaults to rawPos so the common case
	// (box fits on screen) paints correctly on the first frame with no visible correction; only
	// overridden below once the box's real size is known and it would actually overflow.
	let renderPos = $state({ x: 0, y: 0 });

	$effect(() => {
		const pos = rawPos;
		renderPos = pos;

		// Wait for the DOM to reflect this render's content before measuring -- size depends
		// on the option list, which differs between the root menu and every submenu.
		tick().then(() => {
			if (!boxRef) return;
			const rect = boxRef.getBoundingClientRect();
			renderPos = clampToViewport(pos.x, pos.y, rect.width, rect.height);
		});
	});
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="context-menu" bind:this={boxRef} style="top: {renderPos.y}px; left: {renderPos.x}px" role="menu" tabindex="-1">
	{@render children()}
</div>

<style lang="scss">
	@use '_index' as *;

	.context-menu {
		// fixed, not absolute -- see ContextMenu.svelte for why (viewport-coordinate anchors,
		// and avoiding an absolutely-positioned overflow inflating a scrolling ancestor).
		position: fixed;
		background: var(--color-pure);
		border: 1px solid var(--color-surface);
		border-radius: 0 $x-space-xs $x-space-xs $x-space-xs;
		box-shadow: 0px 0px $x-space-xs var(--color-bg);
		z-index: 9999;
		padding: 2px;
		min-width: $x-space-xxxl;
		max-width: calc(100vw - $x-space-xs * 2);
		max-height: calc(100vh - $x-space-xs * 2);
		overflow-y: auto;
	}
</style>

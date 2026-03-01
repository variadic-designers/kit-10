<script lang="ts">
	import type { Action } from '@sveltejs/kit';
	import type { Snippet } from 'svelte';
	import { contextMenu } from './contextMenu.ts';
	import { type ContextMenuContent, type ContextMenuContentGenerator } from './contextMenuStore.ts';
	import { collapse } from './panelStore.ts';

	type PanelSection = {
		title: string;
		content: Snippet;
		icon?: string;
	};

	type PanelProps = {
		name: string;
		tooltip: string;
		contextMenuContent: ContextMenuContentGenerator;
		collapsed?: boolean;
		toolbar?: Snippet;
		content: Snippet;
	};

	let {
		name,
		collapsed = $bindable(true),
		tooltip,
		contextMenuContent,
		toolbar,
		content
	}: PanelProps = $props();
</script>

<div class="panel" class:panel--collapsed={$collapse}>
	<header class="panel__header">
		<h2 title={tooltip} use:contextMenu={contextMenuContent}>
			{name}
		</h2>
		<button
			onclick={() => (collapsed = !true)}
			class="drag"
			aria-label="drag-handle for {name} panel"><i class="fa-solid fa-grip-lines"></i></button
		>
	</header>

	{#if toolbar}
		<div class="panel__toolbar">
			{@render toolbar()}
		</div>
	{/if}

	<div class="panel__content">
		{@render content()}
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	.panel {
		position: relative;

		outline-offset: $x-space-xs;
		outline-offset: 1px;

		&__header {
			display: flex;
			align-items: center;
			background: var(--color-panel-header-fill);

			user-select: none;
		}

		.drag {
			font-size: $x-font-size-md;
			aspect-ratio: 1;
			cursor: grab;
			border: unset;
			background: transparent;
			color: var(--color-text-muted);
			padding-right: $x-space-xs;

			&:active {
				cursor: grabbing;
				color: var(--color-text);
			}
		}

		h2 {
			display: inline-block;
			@include fonts-stack('Satoshi-Black', sans);
			text-transform: uppercase;
			color: var(--color-text-muted);
			flex-grow: 1;
			padding-block: $x-space-xs;
			padding-left: $x-space-xs;

			@include layout-respond-max('lg') {
				font-size: $x-font-size-sm;
			}

			@include layout-respond('lg') {
				font-size: $x-font-size-sm;
				padding-left: $x-space-sm;
			}
		}

		&:has(.drag:active) .panel__content,
		&--collapsed .panel__content {
			overflow-y: hidden;
			max-height: 0;
			background: var(--color-bg);
		}

		&__content {
			max-height: 100rem;
			transition: max-height 200ms ease-out;

			@include layout-respond('lg') {
				font-size: $x-font-size-md;
			}

			@include layout-respond-max('lg') {
				font-size: $x-font-size-xs;
				scrollbar-width: none;
			}
		}
	}
</style>

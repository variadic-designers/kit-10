<script lang="ts" module>
	export type ComponentPrimitive =
		| { kind: 'text'; text: string }
		| { kind: 'image'; src: string; alt?: string; resolutions?: string[] }
		| { kind: 'svg'; content: Snippet } // or however you represent SVGs
		| { kind: 'container'; children: string[] };

	// Component definition
	export interface ComponentFlat {
		name: string;
		discriminator: number;
		sets: AxesManager;
	}

	export interface ComponentRoot {
		rootPosition?: { x: number; y: number };
	}

	// A separate set of Axes exposed to the end
	export interface ComponentViewExport {
		exportParams?: AxesSet;
	}

	export interface ViewResolve {
		// For finding the kit
		source_uuid: string;
		// an its respective params
		params: AxesSet;
	}

	// Instance of a Component / Kit
	export interface ComponentView extends ComponentViewExport, ComponentRoot, ComponentViewRuntime {
		name: string;
		discriminator: number;
		// Update of Kits
		resolve: ViewResolve[];
		hide?: boolean;
		lock?: boolean;
		primitive: ComponentPrimitive;
	}

	export interface ComponentViewRuntime {
		selectedResolver?: number;
		selected?: 'primary' | 'secondary';
	}

	// A View on the Project Root
	export interface ComponentViewRoot extends ComponentView, ComponentRoot {}
</script>

<script lang="ts">
	import { resolveMany, type AxesManager, type AxesSet } from '../cascadeAxesMap.ts';
	import { type Snippet } from 'svelte';
	// Cursed but works for our use
	import Component from './Component.svelte';

	const {
		discriminator,
		// Update of Kits
		resolve,
		// Alias of Component
		name,
		selected,
		hide,
		lock,
		primitive,
		// root
		rootPosition,
		// kit Definitions
		kitsPool,
		viewsPool
	}: ComponentView & {
		kitsPool: Record<string, ComponentFlat>;
		viewsPool: Record<string, ComponentView>;
	} = $props();

	const { finalStyle, trace } = $derived.by(() => {
		return resolveMany(
			resolve.map((r) => {
				return kitsPool[r.source_uuid].sets;
			}),
			resolve.map((r) => r.params)
		);
	});

	const rootVariables = $derived.by(() => {
		if (rootPosition) {
			return `--root-position-x: ${rootPosition.x}px; --root-position-y: ${rootPosition.y}px`;
		}
	});

	const cssVariables: string = $derived.by(() => {
		const styles = [
			['--width', finalStyle.width],
			['--height', finalStyle.height],
			['--border', finalStyle.border],
			['--background', finalStyle.background],
			['--border-radius', finalStyle['border-radius']],
			['--color', finalStyle.color],
			['--padding', finalStyle.padding],
			// No Margins. a bit opinionated but reduces guesswork
			// ['--margin', finalStyle.margin],
			['--font-size', finalStyle['font-size']],
			['--text-decoration', finalStyle['text-decoration']],
			['--text-align', finalStyle['text-align']],
			['--overflow-y', finalStyle['overflow-y'] ?? 'initial'],
			['--overflow-x', finalStyle['overflow-x'] ?? 'initial'],

			['--position', finalStyle['position']],
			['--top', finalStyle['top']]
		];

		return styles
			.filter(([, value]) => value !== undefined)
			.map(([key, value]) => `${key}: ${value};`)
			.join('');
	});
</script>

<!-- <button class="canvas__component__move" aria-label="Resize bottom and right" -->
<!-- 	><i class="fa-solid fa-grip-lines"></i></button -->
<!-- > -->
<!---->
<!-- <div contenteditable="true" spellcheck="false" class="canvas__component__raw__text"> -->
<!-- 	Sample Text -->
<!-- </div> -->

<svelte:element
	this={primitive?.kind === 'text' ? 'span' : 'div'}
	style="{rootVariables}; {cssVariables}"
	class="canvas__component"
	class:canvas__component--selected={selected !== undefined}
	class:canvas__component--root={!!rootPosition}
	class:canvas__component--hide={!!hide}
	contenteditable="false"
>
	{#if primitive?.kind === 'container'}
		{#each primitive.children as child}
			{@const viewFound = viewsPool[child]}

			{#if viewFound}
				<Component {...viewFound} rootPosition={undefined} {kitsPool} {viewsPool} />
			{/if}
		{/each}
	{/if}

	{#if primitive?.kind === 'text'}
		{primitive.text}
	{/if}
</svelte:element>

<style lang="scss">
	@use '_index' as *;
	// Global is required to bypass vite's omitted styles -->
	// allowing `.canvas__component > *` selector to take effect -->
	:global(.canvas__component > *) {
		--width: initial;
		--height: initial;
		--border: initial;
		--background: initial;
		--background-color: initial;
		--border-radius: initial;
		--color: initial;
		--padding: initial;
		--margin: initial;
		--font-size: initial;
		--text-decoration: initial;
		--text-align: initial;
		--overflow-y: initial;
		--overflow-x: initial;
		--position: initial;
		--top: initial;
	}

	.canvas__component {
		cursor: pointer;
		width: var(--width);
		height: var(--height);
		box-sizing: border-box;

		position: var(--position);
		top: var(--top);

		background-color: var(--background);
		border: var(--border);
		border-radius: var(--border-radius);
		color: var(--color);
		padding: var(--padding);

		overflow-y: var(--overflow-y, initial);
		overflow-x: var(--overflow-x, hidden);

		@include fonts-stack('Satoshi-Regular', sans);
		@include fonts-alternate-style();
		font-size: var(--font-size);
		text-decoration: var(--text-decoration);
		text-align: var(--text-align);

		&--hide {
			display: none;
		}

		&--root {
			translate: calc(var(--root-position-x) + var(--offsetX))
				calc(var(--root-position-y) + var(--offsetY));
			// transition: translate 150ms ease-out;
			position: absolute;
		}

		// TODO: Replace with SVG
		/*
		&--selected {
			// box-shadow: 0 0 1px calc(2px / var(--scale-factor)) var(--color-primary);
			border-radius: var(--border-radius);
			border: 2px solid var(--color-primary);

			&:hover {
				box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-primary);
				border-radius: var(--border-radius);
			}
		}
    */
	}
</style>

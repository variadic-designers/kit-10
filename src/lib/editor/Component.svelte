<script lang="ts" module>
	export type ComponentPrimitive =
		| { kind: 'text'; text: string }
		| { kind: 'image'; src: string; alt?: string; resolutions?: string[] }
		| { kind: 'svg'; content: Snippet } // or however you represent SVGs
		| { kind: 'container'; children: ComponentView[] };

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
		source_index: number;
		// an its respective params
		params: AxesSet;
	}

	// Instance of a Component / Kit
	export interface ComponentView extends ComponentViewExport, ComponentRoot {
		source_index: number;
		params: AxesSet;
		discriminator: number;
		// Update of Kits
		resolve: ViewResolve[];
		// Alias of Component
		name: string;
		selected?: 'primary' | 'secondary';
		children?: ComponentView[];
		hide?: boolean;
		lock?: boolean;
		primitive: ComponentPrimitive;
	}

	// A View on the Project Root
	export interface ComponentViewRoot extends ComponentView, ComponentRoot {}

	export type KitProps = {
		name: string;
		sets: AxesManager;
		params: AxesSet;
		hide?: boolean;
		rootPosition?: { x: number; y: number };
		selected?: 'primary' | 'secondary';
		children?: Snippet;
	};
</script>

<script lang="ts">
	import { resolveMany, type AxesManager, type AxesSet } from '../cascadeAxesMap.ts';
	import { type Snippet } from 'svelte';
	import Component from './Component.svelte';

	const {
		source_index,
		params,
		// discriminator,
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
		kits
	}: ComponentView & { kits: ComponentFlat[] } = $props();

	const { finalStyle, trace } = $derived.by(() => {
		// return resolve((kits[source_index] ?? { layers: [], axisRank: [] }).sets, params);
		return resolveMany(
			resolve.map((r) => kits[r.source_index].sets),
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
			// ['--margin', finalStyle.margin],
			['--font-size', finalStyle['font-size']],
			['--text-decoration', finalStyle['text-decoration']],
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
			<Component {...child} rootPosition={undefined} {kits} />
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
		--border-radius: initial;
		--color: initial;
		--padding: initial;
		--margin: initial;
		--font-size: initial;
		--text-decoration: initial;
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

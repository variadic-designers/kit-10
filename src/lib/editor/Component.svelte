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

	// Instance of a Component / Kit
	export interface ComponentView extends ComponentViewExport {
		source_index: number;
    sources_index?: number[];
		params: AxesSet;
		discriminator: number;
		// Alias of Component
		name: string;
		selected?: 'primary' | 'secondary';
		children?: ComponentView[];
		hide?: boolean;
		lock?: boolean;
		// primitive: ComponentPrimitive
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
	import { resolve, type AxesManager, type AxesSet } from '../cascadeAxesMap.ts';
	import { type Snippet } from 'svelte';

	const { name, sets, params, hide, rootPosition, selected, children }: KitProps = $props();

	const { finalStyle, trace } = $derived.by(() => {
		return resolve(sets, params);
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

	let dragging = $state(false);
</script>

<!-- style="--calculated-width: '{offsetX}px ↔'; --calculated-height: '{offsetY}px ↕'; --x: {newPositionX}px; --y: {newPositionY}px;" -->
<div
	style="{rootVariables}; {cssVariables}"
	class="canvas__component"
	class:canvas__component--selected={selected !== undefined}
	class:canvas__component--root={!!rootPosition}
	class:canvas__component--hide={!!hide}
>
	<div class="canvas__component__meta name">
		{name}
	</div>
	<!-- <button class="canvas__component__meta width" aria-label="Always display width" -->
	<!-- 	>{offsetX}px ↔</button -->
	<!-- > -->
	<!-- <button class="canvas__component__meta height" aria-label="Always display height" -->
	<!-- 	>{offsetY}px ↕</button -->
	<!-- > -->

	<!-- <button class="canvas__component__drag top left" aria-label="Resize top and left"></button> -->
	<!-- <button class="canvas__component__drag top right" aria-label="Resize top and right"></button> -->
	<!-- <button class="canvas__component__drag bottom left" aria-label="Resize bottom and left"></button> -->
	<!-- <button class="canvas__component__drag bottom right" aria-label="Resize bottom and right" -->
	<!-- ></button> -->

	<button class="canvas__component__move" aria-label="Resize bottom and right"
		><i class="fa-solid fa-grip-lines"></i></button
	>

	<div style={cssVariables} class="canvas__component__raw">
		<!-- spellcheck is disabled so squiggly lines disappear -->
		<div contenteditable="true" spellcheck="false" class="canvas__component__raw__text">
			Sample Text
		</div>
		{#if children}
			{@render children()}
		{/if}
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	.canvas__component {
		cursor: pointer;
		width: var(--width);
		height: var(--height);
		// margin: var(--margin);

		// Necessary for labels
		position: relative;

		position: var(--position);
		top: var(--top);

		// grid-area: 1 / 1 / 2 / 2;

		&--root {
			translate: calc(var(--root-position-x) + var(--offsetX))
				calc(var(--root-position-y) + var(--offsetY));
			// transition: translate 150ms ease-out;
			position: absolute;
		}

		&__meta {
			$f-size: $x-font-size-sm;

			font-size: calc($f-size * var(--scale-factor));
			@include fonts-stack('Satoshi-Bold', sans);
			color: var(--color-text);
			color: white;
			mix-blend-mode: exclusion;
			border: unset;
			padding: 2px;
			border-radius: 2px;
			cursor: pointer;
			position: absolute;
			background: inherit;
			display: none;
			min-width: 200%;

			&.name {
				content: var(--name);
				top: calc($f-size * -2.5 / var(--scale-factor));
				left: 0;
				color: var(--color-primary);

				@include fonts-stack('Satoshi-Bold', sans);
				font-size: calc($x-font-size-md / var(--scale-factor));
			}

			/*
			&.width {
				top: 120%;
				left: calc(40% * var(--scale-factor) * 0.8);
			}

			&.height {
				top: calc(40% * var(--scale-factor) * 0.8);
				left: calc(-65% * 1 / var(--scale-factor));
			}
      */
		}

		&__drag {
			display: none;
		}

		&:hover {
			box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-text-muted);

			/*
			.canvas__component__drag {
				box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-text-muted);
				background: var(--color-bg);
			}

			.canvas__component__meta,
			.canvas__component__drag,
			&::after,
			&::before {
				display: block;
			}
      */
		}

		&--selected {
			// box-shadow: 1 0 0 calc(2px / var(--scale-factor)) var(--color-primary);

			.canvas__component__drag {
				box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-primary);
				background: var(--color-primary);
			}

			.canvas__component__move {
				display: grid;
			}
			.canvas__component__meta,
			.canvas__component__drag,
			&::after,
			&::before {
				display: block;
			}

			// weird override but aight
			&:hover {
				box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-primary);

				.canvas__component__drag {
					box-shadow: 0 0 0 calc(2px / var(--scale-factor)) var(--color-primary);
					background: var(--color-primary-hover);

					&:hover {
						background: white;
					}
				}
			}
		}

		&__move {
			i {
				font-size: calc($x-font-size-md / var(--scale-factor));
			}

			width: max-content;
			height: max-content;
			top: calc($x-font-size-sm * -1.8 / var(--scale-factor));
			right: 0;

			cursor: grab;
			background: unset;
			outline: unset;
			color: var(--color-primary);

			display: none;
			position: absolute;
			border: unset;

			place-items: center;

			&:active {
				cursor: grabbing;
			}
		}

		&__drag {
			position: absolute;
			border: unset;
			border-radius: calc($x-space-xs / var(--scale-factor) / 9);

			--size: #{$x-space-md};
			width: calc(var(--size) / var(--scale-factor) / 2);
			height: calc(var(--size) / var(--scale-factor) / 2);

			--offset: calc(var(--size) / -8);

			/* Top-left corner centering logic */
			&.top.left {
				top: calc(-0.6 * var(--size) / var(--scale-factor) / 2);
				left: calc(-0.6 * var(--size) / var(--scale-factor) / 2);

				cursor: nw-resize;
			}

			&.top.right {
				top: calc(-0.6 * var(--size) / var(--scale-factor) / 2);
				right: calc(-0.6 * var(--size) / var(--scale-factor) / 2);

				cursor: ne-resize;
			}

			&.bottom.left {
				bottom: calc(-0.6 * var(--size) / var(--scale-factor) / 2);
				left: calc(-0.6 * var(--size) / var(--scale-factor) / 2);

				cursor: sw-resize;
			}

			&.bottom.right {
				bottom: calc(-0.6 * var(--size) / var(--scale-factor) / 2);
				right: calc(-0.6 * var(--size) / var(--scale-factor) / 2);

				cursor: se-resize;
			}
		}

		&__raw {
			background-color: var(--background);
			border: var(--border);
			border-radius: var(--border-radius);
			color: var(--color);
			padding: var(--padding);

			width: 100%;
			height: 100%;

			overflow-y: var(--overflow-y, initial);
			overflow-x: var(--overflow-x, hidden);

			/*
      display: grid;
      grid-template-columns: 1fr;
      grid-template-rows: 1fr;
      place-items: center;
      */

			&__text {
				// display: inline;
				//all: unset;
				border: unset;
				outline: unset;

				@include fonts-stack('Satoshi-Regular', sans);
				@include fonts-alternate-style();
				font-size: var(--font-size);
				cursor: text;
				text-decoration: var(--text-decoration);

				font-weight: 800;

				&:focus {
					backdrop-filter: brightness(0.8);
				}
			}
		}

		&--hide {
			display: none;
		}

		> * {
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
	}
</style>

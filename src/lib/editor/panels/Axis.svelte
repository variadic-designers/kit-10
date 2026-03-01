<script lang="ts" module>
	export type HSV = { h: number; s: number; v: number };

	export const stringSetToHSV = (() => {
		const cache = new Map<string, HSV>();

		const hash = (str: string): number => {
			let h = 0;
			for (let i = 0; i < str.length; i++) {
				h = (h * 131 + str.charCodeAt(i)) >>> 0;
			}
			return h;
		};

		return function (parts: string[]): HSV {
			// Normalize + canonicalize
			const cleaned = Array.from(
				new Set(parts.map((s) => s.trim()).filter((s) => s.length > 0))
			).sort();

			const key = cleaned.join(';'); // canonical memo key

			if (cache.has(key)) return cache.get(key)!;

			// Hash whole set for hue
			const hWhole = hash(key);

			// Hash each element for value variation
			let elementHashTotal = 0;
			for (const p of cleaned) elementHashTotal += hash(p);

			const len = cleaned.length;

			// Saturation: specificity-based (smooth 50–100)
			const s = 50 + Math.tanh(len / 3) * 50;

			// Value: 40–100 based on hashed composition
			const v = 60 + ((elementHashTotal % 1000) / 1000) * 40;

			// Hue: 0–360
			const h = hWhole % 360;

			const result = { h, s, v };
			cache.set(key, result);
			return result;
		};
	})();
</script>

<script lang="ts">
	import type { AxisDefinition, TrackedVariant } from '../../axesBuiltIn.ts';
	import type { ComponentView, ComponentFlat } from '../Component.svelte';
	import { contextMenu } from '../contextMenu.ts';

	type AxisProps = {
		axis: AxisDefinition;
		selection: EditorSelection;
		/*
		layers: any;
		layerWidgets: any;
    */

		kits: string[];
		views: string[];
		viewsPool: Record<string, ComponentView>;
	};

	let {
		axis,
		selection,
		/*
		layers,
		layerWidgets,
    */
		kits = $bindable(),
		views = $bindable(),
		viewsPool = $bindable()
	}: AxisProps = $props();

	export const recalcParams = (axis: string, value: string) => {
		return () => {
			if (!selection.selectedViewPrimary || selection.selectedKitIndex === null) {
				console.warn(`Attempted to recalc ${axis}:${value} `);
				console.warn(`${!selection.selectedViewPrimary} ${!selection.selectedKitIndex}`);
				return;
			}

			const view = viewsPool[selection.selectedViewPrimary];

			const resolution = view.resolve[selection.selectedKitIndex];
			if (resolution.params[axis] === value) {
				resolution.params[axis] = undefined;
			} else {
				resolution.params[axis] = value;
			}
		};
	};

	function shallowEqual(a: Record<string, any>, b: Record<string, any>): boolean {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);

		if (aKeys.length !== bKeys.length) return false;

		return aKeys.every((key) => a[key] === b[key]);
	}

	import type {
		Axis,
		AxisVariantLayerTrace,
		CascadeResult,
		MultiCascadeResult
	} from '../../cascadeAxesMap.ts';
	import type { EditorSelection } from '../Editor.svelte';

	/*
	// Decider for what color to display on the layer indicator
	const layerColorDecider: (
		axisVariant: string
	) => ({ color: string; activated: boolean } | undefined)[] = (axisVariant) => {
		const layerEntries = layers[axisVariant];

		if (layerEntries) {
			let layerOrdering = layerWidgets.flat();
			let layerColours = layerOrdering.map((layerShape, i) => {
				let found = layerEntries.layers.find((l) => shallowEqual(layerShape, l));

				if (found && selection.selectedViewCascadeResult) {
					const hsv = stringSetToHSV(found);
					const color = `hsl(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`;

					const activated = selection.selectedViewCascadeResult.trace.find((t) => {
						if (Object.keys(t.source).length === 0) {
							return false;
						}

						let currents = layerEntries.variants.filter(
							(v: Partial<{ [axisName: string]: Axis }>) => {
								return shallowEqual(found, Object.keys(v));
							}
						);

						const activation = currents.find((currentVariant) => {
							return shallowEqual(t.source, currentVariant);
						});

						return activation;
					});

					return { color, activated };
				} else {
					return undefined;
				}
			});

			return layerColours;
		} else {
			return layerWidgets.flat().map(() => undefined);
		}
	};
  */

	const axisContextMenu = [
		{
			name: 'custom axis',
			description: 'Connect state',
			displayText: 'Connect',
			icon: 'fa-solid fa-upload',
			onClick: () => {}
		},
		'hr',

		{
			name: 'custom axis',
			description: 'Mark as export',
			displayText: 'Expose',
			icon: 'fa-solid fa-tower-broadcast',
			onClick: () => {}
		}
	];

	const value = $derived(
		axis.variants.find((v) => {
			if (selection.selectedViewPrimary && selection.selectedKitIndex !== null) {
				return (
					viewsPool[selection.selectedViewPrimary].resolve[selection.selectedKitIndex].params[
						axis.id
					] === (v.id ?? v.name.toLowerCase().replace(' ', '-'))
				);
			}
			return false;
		})
	);
</script>

<!-- focused?: boolean, -->
<!-- layered?: ({ color: string; activated: boolean } | undefined)[] -->

<!-- A collapsible widget for axis variant tracking and selection for the axes set parameter -->
{#snippet axisField(
	axis: AxisDefinition,
	id: string,
	name: string,
	value: TrackedVariant | undefined
)}
	<div class="axis-field">
		<!-- Activated axis variant -->
		<label class="axis-field__name" title={axis.description}>
			<span>{name}</span>
			<input
				class="axis-field__radio"
				type="radio"
				onclick={recalcParams(axis.id, id)}
				name="{selection.selectedViewPrimary}-{axis.id?.toLowerCase() ?? axis.name.toLowerCase()}"
				checked={id === (value?.id ?? value?.name.toLowerCase())}
			/>
		</label>

		<span class="layers">
			<!-- Layer of axis variant -->
			<!-- {#if layered} -->
			<!-- 	{#each layered as layers, i} -->
			<!-- 		<div -->
			<!-- 			class="axis-field-container" -->
			<!-- 			class:axis-field-container--last={layered.length - 1 === i} -->
			<!-- 		> -->
			<!-- 			<button -->
			<!-- 				class="axis-field__layer" -->
			<!-- 				class:axis-field__layer--focused={focused} -->
			<!-- 				class:axis-field__layer--ticked={layers?.activated} -->
			<!-- 				class:axis-field__layer--undefined={!!!layers} -->
			<!-- 				style={layers ? '--axis-field__layer-color: ' + layers.color : ''} -->
			<!-- 				disabled={!focused || !layered} -->
			<!-- 				aria-label="Add variant to params" -->
			<!-- 				title={JSON.stringify(layered, null, 2)} -->
			<!-- 			> -->
			<!-- 				<i class="fa-solid fa-diamond"></i> -->
			<!-- 			</button> -->
			<!-- 		</div> -->
			<!-- 	{/each} -->
			<!-- {/if} -->
		</span>
	</div>
{/snippet}

<details class="axis">
	<summary title={axis.description} class="axis__name" use:contextMenu={axisContextMenu}>
		<h3>
			{axis.name}
		</h3>

		<div class="axis__name__value" class:axis__name__value--unset={!!!value}>
			{value ? value.name : 'Not set'}
		</div>

		<i class="fa-solid fa-angle-down axis__name__collapse-icon"></i>
	</summary>

	<ul class="axis__variants">
		{#each axis.variants as variant, i}
			{@const variantId = variant.id ?? variant.name.toLowerCase().replace(' ', '-')}

			<!-- Get this man a layer finder -->
			<!-- {@const layered = layerColorDecider(axis.id + ':' + variantId)} -->

			<li>
				<!-- {JSON.stringify(layered)} -->
				{#key value}
					{@render axisField(axis, variantId, variant.name, value)}
				{/key}
			</li>
		{/each}
	</ul>
</details>

<style lang="scss">
	@use '_index' as *;

	.axis {
		position: relative;
		user-select: none;

		&[open] {
			.axis__name__collapse-icon {
				rotate: -180deg;
			}

			.axis__name__value {
				opacity: 0;
			}
		}

		&:not([open]) {
			.axis__name:hover {
				background: var(--color-surface-alt);
			}
		}

		&__name {
			display: grid;
			grid-template-rows: 1fr;
			grid-template-columns: 1fr 1fr max-content;
			justify-content: space-between;
			align-items: center;
			padding-inline: $x-space-sm;
			cursor: pointer;
			font-size: $x-font-size-xs;
			gap: $x-space-sm;
			color: var(--color-pure-alt);

			h3 {
				grid-area: 1 / 1 / 1 / 2;
				text-transform: uppercase;
				@include fonts-stack('Satoshi-Bold', sans);
				padding-block: calc($x-space-xs / 2);
			}

			&__value {
				padding-inline: $x-space-sm;
				grid-area: 1 / 2 / 1 / 3;
				min-width: 2rem;
				font-size: $x-font-size-md;
				font-weight: 800;
				@include fonts-stack('Satoshi-Regular', sans);
				color: var(--color-primary);
				border: 1px solid var(--color-surface-alt);
				background: var(--color-surface-alt);
				text-transform: capitalize;
				border-radius: calc($x-space-xs / 2);

				&--unset {
					color: var(--color-text-muted);
					border: 1px solid var(--color-panel-header-fill);
					background: var(--color-panel-header-fill);
				}
			}

			&__collapse-icon {
				transition: rotate 200ms ease-out;
				rotate: -360deg;
			}
		}

		&__variants {
			list-style-type: none;
			@include layout-flex-column();
		}
	}

	.axis-field {
		display: flex;
		flex-direction: row;
		gap: $x-space-xs;
		font-weight: 600;
		padding-block: calc($x-space-xs / 4);
		padding-inline: $x-space-md;

		&:has(&__name:hover) {
			.axis-field__name {
				color: var(--color-primary);
			}
		}

		&:has(&__radio:checked) {
			background: var(--color-surface-alt);

			.axis-field__name {
				color: var(--color-primary);
			}

			&:has(input[type='radio']:checked):hover {
				.axis-field__name {
					color: var(--color-primary-hover);
				}
			}
		}

		&__name {
			flex-grow: 1;
			cursor: pointer;

			input[type='radio'] {
				opacity: 0;
			}
		}

		.layers {
			display: flex;

			&:not(&:has(.axis-field__layer)) {
				scale: 0.6 1.2;
			}
		}

		&-container {
			border-right: 2px solid var(--color-panel-header);
			border-left: 2px solid transparent;

			&--last {
				border-right-color: var(--color-surface);

				// makes border invisible on selected variant
				&:has(.axis-field__layer--focused) {
					border-right-color: var(--color-surface-alt);
				}
			}
		}

		// Diamond layer tracker
		&__layer {
			width: $x-space-md;
			font-size: $x-font-size-md;
			border: unset;
			background: unset;
			cursor: pointer;
			position: relative;
			color: var(--axis-field__layer-color, --color-surface);
			-webkit-text-stroke-width: 2px;
			-webkit-text-stroke-color: black;

			&:disabled {
				cursor: default;
			}

			rotate: 45deg;
			opacity: 0.8;
			filter: saturate(0.9) brightness(0.7);
			transition: rotate 100ms ease-out;
			transform-origin: center center;

			&--focused {
				// rotate: 0deg;
				filter: initial;
			}

			&--ticked {
				rotate: 0deg;
				translate: 0.45px 0;
				opacity: 1;
			}

			&:focus {
				color: var(--color-text);
			}

			&--undefined {
				opacity: 0;
				color: var(--color-surface-alt);
				-webkit-text-stroke-color: var(--color-surface-alt);

				&:hover {
					opacity: 0.5;
				}
			}
		}
	}
</style>

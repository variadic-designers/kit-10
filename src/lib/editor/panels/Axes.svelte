<script lang="ts" module>
	export type Layer = AxesSet;

	export interface LayerWidget {
		priority: number;
		layer: Layer;
		rank: AxisDefinition[];
	}
</script>

<script lang="ts">
	import type { ComponentFlat, ComponentView } from '../Component.svelte';
	import Panel from '../Panel.svelte';
	import { stringSetToHSV } from './Axis.svelte';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';

	type AxesPanel = {
		selection: EditorSelection;
		views: string[];
		kits: string[];
		viewsPool: Record<string, ComponentView>;
		kitsPool: Record<string, ComponentFlat>;
    api: Api;
	};

	let {
		selection,
		kits,
		views,
		kitsPool = $bindable(),
		viewsPool = $bindable(),

    api,
	}: AxesPanel = $props();

	const detailCollapse = (collapse: boolean) => {
		return () => {
			const axesDetail = document.querySelectorAll<HTMLDetailsElement>('details.axis');
			axesDetail.forEach((detail) => (detail.open = !collapse));
		};
	};

	const addAxisContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'custom axis',
				description: 'Add custom axis',
				displayText: 'Custom Axis',
				icon: 'fa-solid fa-plus',
				onClick: () => {}
			},

			'hr',
			{
				name: 'custom axis',
				description: 'Collapse all Axes',
				displayText: 'Collapse',
				icon: 'fa-solid fa-angles-up',
				onClick: detailCollapse(true)
			},
			{
				name: 'custom axis',
				description: 'Expand all Axes',
				displayText: 'Expand',
				icon: 'fa-solid fa-angles-down',
				onClick: detailCollapse(false)
			},
			'hr'
			/*
			...builtinAxes.map((axis) => {
				if (axis) {
					let disabled = false;

					if (selectedKit && selectedKit.selectedResolver) {
						const axisExistsAlready = kits[
							selectedKit.resolve[selectedKit.selectedResolver].source_index
						].sets.axisRank.some((a) => {
							const aKey = a.id ?? a.name?.toLowerCase();
							return aKey === axis.id;
						});

						disabled = axisExistsAlready;
					}

					return {
						name: axis.name,
						description: axis.description,
						displayText: axis.name,
						icon: `fa-solid ${axis.category === 'Static' ? 'fa-box-open' : 'fa-dice-d6'}`,
						onClick: addAxis(axis),
						disabled: disabled
					};
				} else {
					return 'hr';
				}
			})*/
		];
	};

	function addAxis(axis: AxisDefinition) {
		return () => {
			if (selectedKit && selectedKit.selectedResolver) {
				// select the target
				const source = kits[selectedKit.resolve[selectedKit.selectedResolver]?.source_index];

				if (source) {
					source.sets.axisRank.push(axis);

					add(source.sets, selectedKit.resolve[selectedKit.selectedResolver].params, {});

					/*
					recalcParams(
						axis.id ?? axis.name.toLowerCase(),
						axis.variants[0].id ?? axis.variants[0].name
					)
          */
				}
			}
		};
	}

	import {
		type TrackerExclusiveVariant,
		type AxisDefinition,
		builtinAxes
	} from '../../axesBuiltIn.ts';
	import type { ContextMenuContent } from '../contextMenuStore.ts';
	import Axis from './Axis.svelte';
	import { type AxesSet, type AxisVariantLayerTrace } from '../../cascadeAxesMap.ts';
	import type { EditorSelection } from '../Editor.svelte';
	import type { Api } from 'manager';

	// Basically backtracks kit Definitions to find respective
	// Layers for each axis variant
	/*
	const layers: AxisVariantLayerTrace | undefined = $derived.by(() => {
		if (
			!selection.selectedViewPrimary ||
			selection.selectedKitIndex === null ||
			!viewsPool[selection.selectedViewPrimary] ||
      !viewsPool[selection.selectedViewPrimary].resolve ||
			!viewsPool[selection.selectedViewPrimary].resolve[selection.selectedKitIndex].source_uuid ||
			!kitsPool[
				viewsPool[selection.selectedViewPrimary].resolve[selection.selectedKitIndex].source_uuid
			]
		) {
			// select the target
			const view = viewsPool[selection.selectedViewPrimary];
			const source_uuid = view.resolve[selection.selectedKitIndex].source_uuid;
			const source = kitsPool[source_uuid];

			if (source) {
				// Start iterating per axis
				let thing = source.sets.axisRank.map((item) => {
					// Then per axis variant
					return item.variants.map((v: TrackerExclusiveVariant) => {
						// Filter if the variant exists in the set
						let layers = source.sets.layers.filter((l) => {
							return Object.values(l.axes).find((a) => a === (v.id ?? v.name.toLowerCase()));
						});

						return {
							axis: `${item.id}:${v.id ?? v.name.toLowerCase()}`,
							layers: layers.map((l) => l.axes)
						};
					});
				});

				// Exclude unfounded layers
				return thing
					.flat(1)
					.filter((l) => l.layers.length > 0)
					.reduce((acc, item) => {
						function uniqueKeySets(input: Record<string, any>[]): string[][] {
							const seen = new Map<string, string[]>();

							for (const obj of input) {
								const keys = Object.keys(obj).sort(); // canonical order
								const signature = keys.join('|'); // stable identity

								if (!seen.has(signature)) {
									seen.set(signature, keys);
								}
							}

							return [...seen.values()];
						}

						const layers = uniqueKeySets(item.layers);

						acc[item.axis] = { layers: layers, variants: item.layers };
						return acc;
					}, {});
			}
		}
	});

	const layersCollapsed = $derived.by(() => {
		function extractUniqueLayers(data): string[][] {
			const seen = new Set<string>();
			const result: string[][] = [];

			for (const key in data) {
				const { layers } = data[key];

				for (const layer of layers) {
					const signature = layer.join('|'); // canonical string for dedup
					if (!seen.has(signature)) {
						seen.add(signature);
						result.push(layer);
					}
				}
			}

			return result;
		}

		return extractUniqueLayers(layers);
	});

	let layerEditing: { ephemeral?: string[]; activeLayer?: [] } = $state({ activeLayer: [] });

	const layerWidgets = $derived.by(() => {
		if (layersCollapsed) {
			// Step 1: get key arrays, sorted
			const keyArrays = layersCollapsed.map((layer) => layer.sort());

			// Step 2: group by length and remove duplicates
			const grouped = keyArrays.reduce((acc: { [name: string]: {} }, keys) => {
				const len = keys.length;
				const serialized = keys.join(',');
				acc[len] = acc[len] || new Set();
				acc[len].add(serialized);
				return acc;
			}, {});

			// Step 3: convert sets back to array of arrays
			const axisShapes = Object.values(grouped).map((set) =>
				Array.from(set).map((s) => s.split(','))
			);

			return axisShapes;
		}
	});


	$effect(() => {
		console.log('Selected layer: ' + JSON.stringify(layers, null, 2));
		console.log('Selected layer unique: ' + JSON.stringify(layersCollapsed, null, 2));
	});
  */
</script>

<Panel contextMenuContent={addAxisContextMenu} name="Axes" tooltip="Adjust the axes set">
	{#snippet content()}
			BRO
		{#if !selection.selectedViewPrimary || selection.selectedKitIndex === null || !selection.selectedViewCascadeResult}
			<!-- <p>{!selection.selectedViewPrimary}</p> -->
			<!-- <p>{!selection.selectedKitIndex !== null}</p> -->
			<!-- <p>{!selection.selectedViewCascadeResult}</p> -->
		{:else}
			{@const currentView = viewsPool[selection.selectedViewPrimary]}
			{@const currentKitIndex = currentView.resolve[selection.selectedKitIndex]}
			{@const currentKit = kitsPool[currentKitIndex.source_uuid]}

			<!-- Add Axis to Selected Kit -->
			{#if currentKit.sets.axisRank.length === 0}
				<p>
					<i class="fa-solid fa-up-long"></i> Add Axis to
					<strong>{currentKit.name}</strong>
				</p>
			{/if}

			<!-- Use key to rerender selected variant properly -->
			{#each currentKit.sets.axisRank as axis}
				<!-- <p>{JSON.stringify(axis.id, null, 2)}</p> -->
				<Axis {selection} {axis} {kits} {views} bind:viewsPool />
			{/each}
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.tools {
		padding-inline: $x-space-xs;
		display: flex;
		gap: $x-space-xs;

		button {
			background: var(--color-pure);
			border: unset;
			border: 2px solid var(--color-surface-alt);
			color: var(--color-pure-alt);
			font-size: $x-font-size-md;
			padding: 4px;
			padding-inline: $x-space-xs;
		}
	}

	input[type='text'] {
		border-radius: $x-space-lg;
		text-align: center;
	}

	.layer__specificity {
		@include layout-flex-column();
		gap: $x-space-xs;
		padding-block: $x-space-xs;
	}

	.layers {
		display: flex;
		display: none;
		gap: $x-space-xs;
		overflow-x: auto;
		user-select: none;
		padding-inline: $x-space-xs;

		.layer {
			font-size: $x-font-size-md;
			border-radius: 2px;
			padding-inline: $x-space-xs;
			background: var(--color-pure);

			@include layout-respond-max('lg') {
				font-size: $x-font-size-sm;
				padding: 0 calc($x-space-xs / 2);
			}

			-webkit-text-stroke-width: 2px;
			height: max-content;

			i.fa-diamond {
				rotate: 45deg;
			}

			@keyframes rainbow {
				0%,
				100% {
					--colour: rgb(220, 150, 150);
				} /* soft dark red */
				10% {
					--colour: rgb(220, 165, 140);
				} /* soft dark orange */
				20% {
					--colour: rgb(160, 200, 160);
				} /* muted darker green */
				35% {
					--colour: rgb(160, 200, 200);
				} /* muted cyan */
				50% {
					--colour: rgb(160, 175, 210);
				} /* muted sky */
				60% {
					--colour: rgb(150, 150, 210);
				} /* muted blue */
				75% {
					--colour: rgb(185, 160, 210);
				} /* softened violet */
				85% {
					--colour: rgb(220, 160, 220);
				} /* muted magenta */
				95% {
					--colour: rgb(220, 160, 180);
				} /* muted rose */
			}

			&--valued {
				border: 2px dashed var(--color-surface-alt);
				// box-shadow: 0rem 0.3rem var(--color-surface-alt);
				color: var(--colour);
				-webkit-text-stroke-color: black;

				&:hover {
					background: var(--color-bg);
				}
			}

			&--new {
				box-shadow: 0rem 0.25rem var(--colour);
				border: 2px solid var(--colour);
				color: var(--colour);

				animation: rainbow 5s linear;
				animation-iteration-count: infinite;

				-webkit-text-stroke-width: unset;
			}

			// hide the radios
			input[type='radio'] {
				position: absolute;
				opacity: 0;
			}

			&:has(input[type='radio']:checked) {
				translate: 0 calc($x-space-xs * -0.25);
				box-shadow: 0 0.15rem var(--color-surface-alt);
				translate: 0 calc($x-space-xs * 0.55);
				border: 2px solid var(--colour, --color-primary);
				background: var(--color-surface-alt);
				filter: brightness(1.1) saturate(1.1);
			}

			&:has(input[type='radio']:disabled) {
				border: 2px solid var(--color-bg);
				background: var(--color-bg);
				// color: var(--color-surface);
				-webkit-text-stroke-color: var(--color-text);
			}
		}
	}

	.axis {
		position: relative;
		user-select: none;

		&[open] .axis__heading__collapse-icon {
			rotate: -180deg;
		}

		&__heading {
			display: flex;
			justify-content: space-between;
			align-items: center;
			padding-right: $x-space-md;
			cursor: pointer;
			border-radius: $x-space-xs;
			padding-block: $x-space-xs;
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			@include fonts-stack('Satoshi-Bold', sans);
			gap: $x-space-md;

			& h3 {
				flex-grow: 1;
			}

			&__collapse-icon {
				transition: rotate 200ms ease-out;
				rotate: -360deg;
			}
		}

		&__content {
			// padding-inline: $x-space-xs;
			transition:
				max-height 100ms ease-out,
				translate 200ms ease-out;
		}
	}

	.tracker {
		display: flex;
		flex-direction: column;

		--gap: $x-space-md;
	}

	.tracker__element {
		display: flex;
		flex-grow: 1;
		cursor: pointer;
		// border-left: 2px solid var(--color-surface);
		padding-left: $x-space-xs;
		flex-direction: row-reverse;
		align-items: center;
		border-radius: $x-space-md;

		gap: $x-space-xs;

		label {
			cursor: pointer;
			display: flex;
			flex-grow: 1;
			padding-inline: $x-space-xs;
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-md;
			font-weight: 600;

			&:hover {
				color: var(--color-primary);
			}

			// TODO: rewrite this illegal written
			&:has(input[type='radio']:checked) + * {
				color: var(--color-warning);
				-webkit-text-stroke-color: black;
			}
		}

		&__track {
			width: $x-space-md;
			font-size: $x-font-size-md;
			border: unset;
			background: unset;
			cursor: pointer;
			position: relative;
			color: var(--color-surface);
			-webkit-text-stroke-width: 2px;
			-webkit-text-stroke-color: var(--color-text);

			&:focus {
				color: var(--color-text);
			}
		}

		&:has(input[type='radio']:checked) {
			// border-left: 2px solid var(--color-primary);
			background-color: var(--color-surface-alt);

			label {
				color: var(--color-primary);
			}
		}

		&__input {
			opacity: 0;
		}
	}

	.option124 {
		display: flex;
		justify-content: space-between;
		// gap: $x-space-md;

		@include layout-respond('2xl') {
			// gap: $x-space-lg;
		}

		&__label {
			font-size: $x-font-size-md;
		}

		&__input {
			&--text {
				width: $x-space-xxl;

				font-size: $x-font-size-lg;

				@include layout-respond('2xl') {
					width: $x-space-xxxl;
					font-size: $x-font-size-2xl;
				}
			}

			&--expand {
				width: $x-space-md;
				font-size: $x-font-size-lg;

				@include layout-respond('2xl') {
					width: $x-space-lg;
					// font-size: $x-font-size-xl;
				}
			}
		}
	}

	.ranged-list {
		@include layout-flex-column();
		gap: $x-space-xs;
		list-style: none;

		&__element {
			position: relative;

			&__button {
				position: absolute;
				color: var(--color-text);
				text-align: center;
				vertical-align: middle;

				border-style: none;
				right: calc($x-space-md * 1.35);
				@include fonts-stack('Satoshi-Regular', sans);
				@include fonts-alternate-style();
				border-style: none;
				right: calc($x-space-md * 1.35);

				width: $x-space-md;
				height: $x-space-lg;
				overflow: hidden;

				color: var(--color-text-muted);
				font-size: $x-font-size-xs;

				background: unset;
				cursor: pointer;

				&.active {
					background: var(--color-bg);

					&.first,
					&.last {
						border-radius: 50%;
						width: $x-space-lg;
						height: $x-space-lg;
						color: var(--color-text);
						@include fonts-stack('Satoshi-Black', sans);
						@include fonts-alternate-style();

						right: $x-space-md;
						// font-size: $x-font-size-lg;
						background-color: var(--color-bg);
					}
				}
			}
		}
	}
</style>

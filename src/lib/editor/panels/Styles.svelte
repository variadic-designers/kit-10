<script lang="ts">
	import type { ComponentFlat, ComponentView } from '../Component.svelte';
	import Panel from '../Panel.svelte';
	import StyleField from './StyleField.svelte';
	import {
		resolve,
		type CascadeResult,
		type AxesSet,
		type TraceEntry,
		type ManagerTraceEntry
	} from '../../cascadeAxesMap.ts';
	import { stringSetToHSV } from './Axis.svelte';
	import type { EditorSelection } from '../Editor.svelte';
	import type { TokenLibrary } from './Variables.svelte';

	type StylesPanel = {
		selection: EditorSelection;
		views: string[];
		viewsPool: Record<string, ComponentView>;
		kits: string[];
		kitsPool: Record<string, ComponentFlat>;
		tokens: TokenLibrary;
	};

	const { selection, views, viewsPool, kitsPool, kits, tokens }: StylesPanel = $props();

	const stylesContextMenu = () => {
		return [
			{
				name: 'custom rule',
				description: 'Add custom style rule',
				displayText: 'Custom Style Rule',
				icon: 'fa-solid fa-plus'
			}
		];
	};

	const { finalStyle, trace } = $derived.by((): CascadeResult => {
		if (selection.selectedViewCascadeResult) {
			return selection.selectedViewCascadeResult;
		}
		return { finalStyle: {}, trace: [] };
	});

	const contentField = $derived.by(() => {
		if (selection.selectedViewPrimary) {
			return viewsPool[selection.selectedViewPrimary].primitive.kind === 'text'
				? { key: 'text', displayText: 'Text' }
				: { key: 'children', displayText: 'Children' };
		}
	});

	// backtracks trace to find source layer then transform to color
	const track = (key: string): { set?: AxesSet; color: string; stack: number } => {
		// guarantees css key `t` exists somewhere
		if (finalStyle[key]) {
			let t: (TraceEntry & ManagerTraceEntry) | undefined;

			// reverse find()
			for (let i = trace.length - 1; i >= -1; i--) {
				const entry = trace[i];

				if (Object.keys(entry.applied).includes(key)) {
					t = { ...entry, managerIndex: i };

					console.log(`Found Source: ${JSON.stringify(t?.source)}`);

					if (t) {
						const hsv = stringSetToHSV(Object.keys(t.source));
						console.log(`HSV: ${JSON.stringify(hsv)}`);
						if (Object.keys(t.source).length === 0) {
							// tracked on no axes set
							return { set: {}, color: 'var(--color-diamond-color-tracked--empty)', stack: 0 };
						}
						return {
							set: t.source,
							color: `hsl(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
							stack: t.managerIndex
						};
					}

					// break; // stop at the first match from the end
				}
			}
		}

		// does not have an entry
		return { color: 'var(--color-bg)', stack: 0 };
	};
</script>

<Panel
	contextMenuContent={stylesContextMenu}
	name="Render"
	tooltip="Applied styles on the current Axes set"
>
	{#snippet content()}
		<!-- <pre>{JSON.stringify(trace, null, 2)}</pre> -->
		{#if selection.selectedViewPrimary}
			<div style="display:contents">
				{#snippet styleSection(
					category: string,
					fields: { key: string; displayText?: string }[],
					kitsPool: Record<string, ComponentFlat>
				)}
					<details class="style-section" open>
						<summary class="style-section__heading">
							<h3>{category}</h3>
							<i class="fa-solid fa-angle-down style-section__collapse-icon"></i>
						</summary>

						<div class="style-section__content">
							{#each fields as field, i}
								<StyleField
									{kitsPool}
									{viewsPool}
									{selection}
									displayText={field.displayText ?? field.key}
									{...track(field.key)}
									key={field.key}
									value={finalStyle[field.key]}
									{tokens}
									position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
								/>
							{/each}
						</div>
					</details>
				{/snippet}

				{@render styleSection(
					'layout',
					[{ key: 'padding', displayText: 'Pad' }, { key: 'width' }, { key: 'height' }],
					kitsPool
				)}

				{@render styleSection(
					'box',
					[
						{ key: 'background', displayText: 'Fill' },
						{ key: 'border' },
						{ key: 'border-radius', displayText: 'Radius' },
						{ key: 'outline' }
					],
					kitsPool
				)}

				{@render styleSection(
					'text',
					[
						{ key: 'color', displayText: 'Fill' },
						{ key: 'font-size', displayText: 'Size' },
						{ key: 'font-weight', displayText: 'Weight' },
						{ key: 'text-align', displayText: 'Align' },
						{ key: 'text-decoration', displayText: 'Decor' }
					],
					kitsPool
				)}

				<!-- {@render styleSection( -->
				<!-- 	'content', -->
				<!-- 	[ -->
				<!-- 		kitsPool[viewsPool[selection.selectedViewPrimary].resolve[selection.selectedKitIndex].source_uuid].primitive?.kind === 'text' -->
				<!-- 			? { key: 'text', displayText: 'Text' } -->
				<!-- 			: { key: 'children', displayText: 'Children' } -->
				<!-- 	], -->
				<!-- 	kitsPool -->
				<!-- )} -->
			</div>
		{/if}
	{/snippet}
</Panel>

<!-- For style fields that may require 1 | 2 | 4 values -->
{#snippet option124(
	name: string,
	options2?: { scalar1: string; scalar2: string },
	options4?: { scalar1: string; scalar2: string; scalar3: string; scalar4: string }
)}
	<label class="option124">
		<span class="option124__label">
			<button
				class="option124__input--track"
				aria-label="Adds the style into the axes set"
				title="Track {name} on Axes set"
				type="button"
				onclick={() => {
					console.log('Tried to add style to set');
				}}
			>
				<i class="fa-solid fa-diamond"></i>
			</button>
			{name}</span
		>

		<span class="option124__input">
			<input
				title="Attach Variable"
				class="option124__input--text"
				type="button"
				value="+"
				onclick={() => {
					console.log('Tried token to style');
				}}
			/>
			<!-- <input class="option124__input--expand" type="button" value="›" /> -->
		</span>
	</label>
{/snippet}

<style lang="scss">
	@use '_index' as *;

	input[type='text'] {
		border-radius: $x-space-lg;
		text-align: center;
	}

	.style-section {
		user-select: none;

		&__collapse-icon {
			transition: rotate 200ms ease-out;
		}

		&[open] .style-section__collapse-icon {
			rotate: 180deg;
		}

		&__heading {
			list-style: none;

			cursor: pointer;
			padding-left: $x-space-sm;
			padding-block: $x-space-xs;
			position: relative;
			display: flex;
			align-items: center;
			justify-content: space-between;

			&:hover {
				background: var(--color-surface-alt);
			}

			i {
				position: relative;
				right: $x-space-sm;
			}

			font-size: $x-font-size-xs;
			text-transform: uppercase;
			@include fonts-stack('Satoshi-Bold', sans-serif);
			color: var(--color-text);
		}

		&__content {
			@include layout-respond('xl') {
				padding-bottom: $x-space-xs;
				// padding-left: $x-space-xs;
			}
		}
	}
</style>

<script lang="ts">
	import type { ComponentFlat, ComponentView } from '../Component.svelte';
	import Panel from '../Panel.svelte';
	import StyleField from './StyleField.svelte';
	import {
		resolve,
		type CascadeResult,
		type AxesSet,
		type TraceEntry
	} from '../../cascadeAxesMap.ts';
	import { stringSetToHSV } from './Axis.svelte';

	type StylesPanel = {
		selectedKit?: ComponentView;
		selectedKitCascadeResult?: CascadeResult;
		kitViews: ComponentView[];
		kits: ComponentFlat[];
	};

	const {
		selectedKit,
		selectedKitCascadeResult,
		kitViews = $bindable(),
		kits = $bindable()
	}: StylesPanel = $props();

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
		if (selectedKitCascadeResult) {
			return selectedKitCascadeResult;
		}
		return { finalStyle: {}, trace: [] };
	});

	const contentField = $derived.by(() => {
		if (selectedKit) {
			return selectedKit.primitive.kind === 'text'
				? { key: 'text', displayText: 'Text' }
				: { key: 'children', displayText: 'Children' };
		}
	});

	// backtracks trace to find source layer then transform to color
	const track = (key: string): { set?: AxesSet; color: string } => {
		// guarantees css key `t` exists somewhere
		if (finalStyle[key]) {
			let t: TraceEntry | undefined;

			// reverse find()
			for (let i = trace.length - 1; i >= 0; i--) {
				const entry = trace[i];

				if (Object.keys(entry.applied).includes(key)) {
					t = entry;
					break; // stop at the first match from the end
				}
			}

			console.log(`Found Source: ${JSON.stringify(t.source)}`);
			if (Object.keys(t.source).length === 0) {
				// tracked on no axes set
				return { set: {}, color: 'var(--color-diamond-color-tracked--empty)' };
			}
			if (t) {
				const hsv = stringSetToHSV(Object.keys(t.source));
				console.log(`HSV: ${JSON.stringify(hsv)}`);
				return { set: t.source, color: `hsl(${hsv.h}, ${hsv.s}%, ${hsv.v}%)` };
			}
		}

		// does not have an entry
		return { color: 'var(--color-bg)' };
	};
</script>

<Panel
	contextMenuContent={stylesContextMenu}
	name="Render"
	tooltip="Applied styles on the current Axes set"
>
	{#snippet content()}
		<!-- <pre>{JSON.stringify(trace, null, 2)}</pre> -->
		{#if selectedKit}
			<div style="display:contents">
				{#snippet styleSection(
					category: string,
					fields: { key: string; displayText?: string }[],
					kits: ComponentFlat[]
				)}
					<details class="style-section" open>
						<summary class="style-section__heading">
							<h3>{category}</h3>
							<i class="fa-solid fa-angle-down style-section__collapse-icon"></i>
						</summary>

						<div class="style-section__content">
							{#each fields as field, i}
								<StyleField
									{kits}
									{selectedKit}
									displayText={field.displayText ?? field.key}
									{...track(field.key)}
									key={field.key}
									value={finalStyle[field.key]}
									position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
								/>
							{/each}
						</div>
					</details>
				{/snippet}

				{@render styleSection(
					'layout',
					[{ key: 'padding', displayText: 'Pad' }, { key: 'width' }, { key: 'height' }],
					kits
				)}

				{@render styleSection(
					'box',
					[
						{ key: 'background', displayText: 'Fill' },
						{ key: 'border' },
						{ key: 'border-radius', displayText: 'Radius' },
						{ key: 'outline' }
					],
					kits
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
					kits
				)}

				{@render styleSection(
					'content',
					[
						selectedKit.primitive?.kind === 'text'
							? { key: 'text', displayText: 'Text' }
							: { key: 'children', displayText: 'Children' }
					],
					kits
				)}
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

<script lang="ts">
	import Panel from '../Panel.svelte';
	import StyleField from './StyleField.svelte';
	import { flattenKitResults, type ResolvedKit, type ResolvedProperty } from 'manager';
	import type { EditorSelection } from '../Editor.svelte';
	import type { FieldCategory, FieldUpdate } from '$lib/plugins/types.js';
	import { shapeIcon } from './layer-color.ts';

	type StylesPanel = {
		selection: EditorSelection;
		resolvedKits: ResolvedKit[] | null;
		fieldCategories?: FieldCategory[];
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	const { selection, resolvedKits, fieldCategories, onFieldUpdate }: StylesPanel = $props();

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

	const resolvedMap = $derived(
		resolvedKits ? flattenKitResults(resolvedKits) : new Map<string, ResolvedProperty>()
	);

	const kitIconMap = $derived.by(() => {
		const map = new Map<string, string>();
		if (!resolvedKits) return map;
		for (let i = 0; i < resolvedKits.length; i++) {
			map.set(resolvedKits[i]!.kitId, shapeIcon(i));
		}
		return map;
	});

	function track(key: string): {
		sourceLayerId: string | null;
		kitId: string | null;
		kitIcon: string;
		conditionCount: number;
		keys: string[];
		isToken: boolean;
		tokenAlias: string | null;
	} {
		const prop = resolvedMap.get(key);
		if (prop) {
			return {
				sourceLayerId: prop.sourceLayerId,
				kitId: prop.kitId,
				kitIcon:
					prop.conditionCount === 0 ? 'fa-circle-dot' : (kitIconMap.get(prop.kitId) ?? 'fa-circle'),
				conditionCount: prop.conditionCount,
				keys: prop.keys,
				isToken: prop.isToken,
				tokenAlias: prop.tokenAlias
			};
		}
		return {
			sourceLayerId: null,
			kitId: null,
			kitIcon: 'fa-circle',
			conditionCount: 0,
			keys: [],
			isToken: false,
			tokenAlias: null
		};
	}
</script>

<Panel
	contextMenuContent={stylesContextMenu}
	name="Render"
	tooltip="Applied styles on the current Axes set"
>
	{#snippet content()}
		{#if resolvedKits}
			<div style="display:contents">
				{#snippet styleSection(category: string, fields: { key: string; displayText?: string }[])}
					<details class="style-section" open>
						<summary class="style-section__heading">
							<h3>{category}</h3>
							<i class="fa-solid fa-angle-down style-section__collapse-icon"></i>
						</summary>

						<div class="style-section__content">
							{#each fields as field, i}
								<StyleField
									{...track(field.key)}
									displayText={field.displayText ?? field.key}
									key={field.key}
									value={resolvedMap.get(field.key)?.value}
									position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
									{onFieldUpdate}
								/>
							{/each}
						</div>
					</details>
				{/snippet}

				{#if fieldCategories && fieldCategories.length > 0}
					{#each fieldCategories as cat}
						{@render styleSection(cat.name, cat.fields)}
					{/each}
				{:else}
					{@render styleSection('layout', [
						{ key: 'padding', displayText: 'Padding' },
						{ key: 'width' },
						{ key: 'height' }
					])}

					{@render styleSection('box', [
						{ key: 'background', displayText: 'Fill' },
						{ key: 'border' },
						{ key: 'border-radius', displayText: 'Radius' },
						{ key: 'outline' }
					])}

					{@render styleSection('text', [
						{ key: 'color', displayText: 'Fill' },
						{ key: 'font-size', displayText: 'Size' },
						{ key: 'font-weight', displayText: 'Weight' },
						{ key: 'text-align', displayText: 'Align' },
						{ key: 'text-decoration', displayText: 'Decor' }
					])}
				{/if}
			</div>
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

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
			@include fonts-stack('Satoshi-Bold', sans);
			color: var(--color-text);
		}

		&__content {
			@include layout-respond('xl') {
				padding-bottom: $x-space-xs;
			}
		}
	}
</style>

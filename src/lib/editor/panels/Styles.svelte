<script lang="ts">
	import Panel from '../Panel.svelte';
	import StyleField from './StyleField.svelte';
	import ChildViewField, { type ChildViewCandidate } from './ChildViewField.svelte';
	import ArrangeField from './ArrangeField.svelte';
	import ResizeField from './ResizeField.svelte';
	import { flattenKitResults, type Api, type ResolvedKit, type ResolvedProperty } from 'manager';
	import type { EditorSelection } from '../Editor.svelte';
	import type { FieldCategory, FieldDef, FieldUpdate } from '$lib/plugins/types.js';
	import { resolveSuggestionSource } from '$lib/plugins/suggestion-providers.js';
	import { shapeIcon } from './layer-color.ts';

	type StylesPanel = {
		api: Api;
		selection: EditorSelection;
		resolvedKits: ResolvedKit[] | null;
		fieldCategories?: FieldCategory[];
		activeProjectId?: string | null;
		onFieldUpdate?: (update: FieldUpdate) => void;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
		onSelectView?: (viewId: string) => void;
	};

	const {
		api,
		selection,
		resolvedKits,
		fieldCategories,
		activeProjectId,
		onFieldUpdate,
		callUtilityPlugin,
		onSelectView
	}: StylesPanel = $props();

	// Candidates for the "children" field's view picker -- every other view in the project
	// (never the one currently being edited). Whether a candidate ends up rendered top-level or
	// only as someone's child is derived by Charter from the composition graph itself (is this
	// view's id referenced in any box's children?) -- not a flag set here. Refetched whenever
	// the project or the active view changes.
	let projectViewRows = $state<{ viewId: string; viewName: string }[]>([]);

	$effect(() => {
		const projectId = activeProjectId;
		if (!projectId) {
			projectViewRows = [];
			return;
		}
		api
			.getViewsByProjectId(projectId)
			.execute()
			.then((rows) => {
				projectViewRows = rows;
			});
	});

	const candidateViews = $derived.by((): ChildViewCandidate[] => {
		const editingViewId = selection.selectedViewPrimary;
		return projectViewRows.filter((row) => row.viewId !== editingViewId);
	});

	// Axis names for the winning Layer's key-set, so StyleField can show "Theme + Density · 2
	// conditions" in its tooltip instead of just a color. Refetched whenever the involved kits change.
	let axisNameById = $state<Record<string, string>>({});

	$effect(() => {
		const kitIds = [...new Set((resolvedKits ?? []).map((k) => k.kitId))];
		if (kitIds.length === 0) {
			axisNameById = {};
			return;
		}

		const loadAxisNames = async () => {
			const map: Record<string, string> = {};
			for (const kitId of kitIds) {
				const axes = await api.getConsumedAxesByKitId(kitId).execute();
				for (const axis of axes) {
					map[axis.axisId] = axis.axisName ?? axis.axisId;
				}
			}
			axisNameById = map;
		};

		loadAxisNames();
	});

	// Which kit a brand-new (never-before-set) property should be written to. Matches Compose
	// panel's kit selection when the user has picked one; otherwise falls back to the
	// highest-priority kit (last in composition order -- same as flattenKitResults' own
	// later-kit-wins rule) so a property still lands somewhere sensible by default.
	const activeKitId = $derived.by(() => {
		if (!resolvedKits || resolvedKits.length === 0) return null;
		const idx = selection.selectedKitIndex;
		if (idx != null && resolvedKits[idx]) return resolvedKits[idx]!.kitId;
		return resolvedKits[resolvedKits.length - 1]!.kitId;
	});

	// The active kit's null (unconditional) layer -- the fallback write target for a property
	// that has never been given a value on any layer, so it doesn't appear in `resolvedMap` at
	// all. Refetched whenever the active kit changes.
	let nullLayerId = $state<string | null>(null);

	$effect(() => {
		const kitId = activeKitId;
		if (!kitId) {
			nullLayerId = null;
			return;
		}
		api.getNullLayerId(kitId).then((id) => {
			nullLayerId = id ?? null;
		});
	});

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
		conditionValues: { axisId: string; value: string }[];
		isToken: boolean;
		tokenAlias: string | null;
		tokenId: string | null;
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
				conditionValues: prop.conditionValues,
				isToken: prop.isToken,
				tokenAlias: prop.tokenAlias,
				tokenId: prop.tokenId
			};
		}
		return {
			sourceLayerId: nullLayerId,
			kitId: activeKitId,
			kitIcon: 'fa-circle-dot',
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			isToken: false,
			tokenAlias: null,
			tokenId: null
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
				{#snippet styleSection(category: string, fields: FieldDef[])}
					<details class="style-section" open>
						<summary class="style-section__heading">
							<h3>{category}</h3>
							<i class="fa-solid fa-angle-down style-section__collapse-icon"></i>
						</summary>

						<div class="style-section__content">
							{#each fields as field, i}
								{#if field.inputType === 'children'}
									<ChildViewField
										{...track(field.key)}
										displayText={field.displayText ?? field.key}
										key={field.key}
										childViewIds={resolvedMap.get(field.key)?.viewRefs ?? []}
										{candidateViews}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{axisNameById}
										{api}
										projectId={activeProjectId}
										viewId={selection.selectedViewPrimary}
										{onFieldUpdate}
										{onSelectView}
									/>
								{:else if field.inputType === 'arrange'}
									<ArrangeField
										{field}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{axisNameById}
										{track}
										{resolvedMap}
										{api}
										projectId={activeProjectId}
										{onFieldUpdate}
										{callUtilityPlugin}
									/>
								{:else if field.inputType === 'resize' && field.resizeKeys}
									<ResizeField
										{field}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{axisNameById}
										{track}
										{resolvedMap}
										{api}
										projectId={activeProjectId}
										{onFieldUpdate}
										{callUtilityPlugin}
									/>
								{:else}
									<StyleField
										{...track(field.key)}
										displayText={field.displayText ?? field.key}
										key={field.key}
										value={resolvedMap.get(field.key)?.value}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{axisNameById}
										inputType={field.inputType}
										spacingMode={field.spacingMode}
										suggestionsFrom={resolveSuggestionSource(
											field.inputType,
											field.suggestionsFrom
										)}
										{api}
										projectId={activeProjectId}
										{onFieldUpdate}
										{callUtilityPlugin}
									/>
								{/if}
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
						{ key: 'font-family', displayText: 'Family' },
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

<script lang="ts">
	import Panel from '../Panel.svelte';
	import StyleField from './StyleField.svelte';
	import ChildViewField, { type ChildViewCandidate } from './ChildViewField.svelte';
	import ArrangeField from './ArrangeField.svelte';
	import ResizeField from './ResizeField.svelte';
	import WeightField from './WeightField.svelte';
	import ColorField from './ColorField.svelte';
	import { flattenKitResults, type Api, type ResolvedKit, type ResolvedProperty } from 'manager';
	import type { EditorSelection } from '../Editor.svelte';
	import type {
		FamilyFacts,
		FieldCategory,
		FieldDef,
		FieldUpdate,
		FontLoadStatus
	} from '$lib/plugins/types.js';
	import { resolveSuggestionSource } from '$lib/plugins/suggestion-providers.js';
	import { shapeIcon } from './layer-color.ts';
	import { paintTarget, stopPaint } from '../pipette.svelte.ts';
	import { keybinds, matchMouse, matchKey } from '../keybinds.js';

	type StylesPanel = {
		api: Api;
		selection: EditorSelection;
		resolvedKits: ResolvedKit[] | null;
		fieldCategories?: FieldCategory[];
		activeProjectId?: string | null;
		fontFacts?: Record<string, FamilyFacts>;
		fontStatus?: Record<string, FontLoadStatus>;
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
		fontFacts,
		fontStatus,
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

	// Pipette: while a paint target is active (set up in the Axes panel), each property row becomes a
	// paint target. The target is the layer for the CURRENT axis selection across the pinned axes --
	// re-pick a value in Axes and this follows. Clicking a property resolve-or-creates that layer and
	// copies the property's current value/token onto it, so the override starts from what's on screen.
	const held = $derived(paintTarget());

	async function pipetteDrop(key: string) {
		const h = paintTarget();
		const kitId = activeKitId;
		if (!h || !h.ready || !kitId || !onFieldUpdate) return;
		const layer = await api.createLayerWithConditions(kitId, h.axisValueIds);
		if (!layer) return;
		const prop = resolvedMap.get(key);
		if (prop?.isToken && prop.tokenId) {
			onFieldUpdate({ layerId: layer.layerId, property: key, tokenId: prop.tokenId });
		} else {
			// Copy the current value; if the property is unset, seed an empty entry so it still lands
			// on the layer (it shows up there, ready to edit) rather than the click doing nothing.
			onFieldUpdate({ layerId: layer.layerId, property: key, value: prop?.value ?? '' });
		}
	}

	// Alt-click any property row removes it from the layer it's sourced from (and GCs that layer if
	// it's left empty). Otherwise, while a layer is held, clicking a property's layer-indicator shape
	// (the same track dot the render rows use to show which layer a value comes from) paints it onto
	// the current target. Delegated + capture-phase so one handler covers every field component's own
	// track without editing each; a plain click with nothing held falls through to normal editing.
	const TRACK_SELECTOR = '.option124__track, .weight-field__track, .color-field__track';
	function fieldClick(e: MouseEvent) {
		const el = e.target as HTMLElement;
		const slot = el.closest('.field-slot') as HTMLElement | null;
		const key = slot?.dataset.propKey;
		if (!key) return;

		if (matchMouse(e, $keybinds['property.remove'], false)) {
			e.preventDefault();
			e.stopPropagation();
			removeProperty(key);
			return;
		}

		if (!held || !held.ready) return;
		if (!el.closest(TRACK_SELECTOR)) return;
		e.preventDefault();
		e.stopPropagation();
		pipetteDrop(key);
	}

	async function removeProperty(key: string) {
		const src = track(key).sourceLayerId;
		if (!src) return;
		await api.removePropertyFromLayer(src, key);
	}

	function onPipetteKey(e: KeyboardEvent) {
		if (held && matchKey(e, $keybinds['edit.cancel'])) {
			e.preventDefault();
			stopPaint();
		}
	}
</script>

<svelte:window onkeydown={onPipetteKey} />

<Panel
	contextMenuContent={stylesContextMenu}
	name="Render"
	tooltip="Applied styles on the current Axes set"
>
	{#snippet content()}
		{#if held}
			<div class="pipette-bar" style="--held: {held.color}">
				<i class="fa-solid fa-eye-dropper"></i>
				<span class="pipette-bar__text">
					{#if held.ready}
						Painting onto <strong>{held.label}</strong> · click a property
					{:else}
						Pick a value in Axes to paint onto
					{/if}
				</span>
				<button class="pipette-bar__btn" onclick={() => stopPaint()}>Done</button>
			</div>
		{/if}
		{#if resolvedKits}
			<div style="display:contents">
				{#snippet styleSection(category: string, fields: FieldDef[])}
					<details class="style-section" open>
						<summary class="style-section__heading">
							<h3>{category}</h3>
							<i class="fa-solid fa-angle-down style-section__collapse-icon"></i>
						</summary>

						<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
						<div class="style-section__content" onclickcapture={fieldClick}>
							{#each fields as field, i}
								<div
									class="field-slot"
									class:field-slot--paintable={!!held && held.ready}
									data-prop-key={field.key}
									style={held ? `--held: ${held.color}` : undefined}
								>
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
								{:else if field.inputType === 'weight'}
									<WeightField
										{field}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{track}
										{resolvedMap}
										{fontFacts}
										{onFieldUpdate}
									/>
								{:else if field.inputType === 'color'}
									<ColorField
										{field}
										position={i === 0 ? 'top' : i === fields.length - 1 ? 'bottom' : 'mid'}
										{track}
										{resolvedMap}
										{onFieldUpdate}
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
										{fontStatus}
										{api}
										projectId={activeProjectId}
										{onFieldUpdate}
										{callUtilityPlugin}
									/>
								{/if}
								</div>
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

	.pipette-bar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		padding: $x-space-xs $x-space-sm;
		font-size: $x-font-size-sm;
		color: var(--color-pure-alt);
		background: color-mix(in oklch, var(--held) 14%, var(--color-surface-alt));
		border-left: 3px solid var(--held);

		i {
			color: var(--held);
		}

		&__text {
			flex-grow: 1;

			strong {
				text-transform: capitalize;
				color: var(--held);
			}
		}

		&__btn {
			flex-shrink: 0;
			border: none;
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2) $x-space-sm;
			font-size: $x-font-size-xs;
			font-weight: 700;
			cursor: pointer;
			background: var(--held);
			color: var(--color-bg, oklch(15% 0 0));
		}
	}

	.field-slot {
		position: relative;

		// While a layer is held, the property's track shape becomes the paint target: it glows in the
		// held layer's color and takes a crosshair, so the same dot that indicates a value's source
		// layer is what you click to move the value onto the held one. Track classes live inside child
		// field components, hence :global().
		&--paintable :global(:is(.option124__track, .weight-field__track, .color-field__track)) {
			cursor: crosshair;
			outline: 2px solid color-mix(in oklch, var(--held) 55%, transparent);
			outline-offset: 1px;
			border-radius: 50%;
			transition: scale 120ms ease-out;
		}

		&--paintable :global(:is(.option124__track, .weight-field__track, .color-field__track)):hover {
			outline-color: var(--held);
			background: color-mix(in oklch, var(--held) 22%, transparent);
			scale: 1.2;
		}
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

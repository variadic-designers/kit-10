<script lang="ts">
	import StyleField from './StyleField.svelte';
	import { layerDotColor } from './layer-color.ts';
	import { resolveSuggestionSource } from '$lib/plugins/suggestion-providers.js';
	import type { Api, ResolvedProperty } from 'manager';
	import type { ArrangeKeys, FieldDef, FieldUpdate } from '$lib/plugins/types.js';

	// The shape Styles.svelte's own `track()` helper returns -- passed down as a function so this
	// component can resolve the correct source layer/kit/keys for its OWN key ("arrange") as well
	// as every companion key (direction, gap, cell-min, and each Advanced/Custom-tracks escape
	// hatch) independently, exactly like Styles.svelte's main field loop already does per field.
	type TrackInfo = {
		sourceLayerId: string | null;
		kitId: string | null;
		kitIcon: string;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		isToken: boolean;
		tokenAlias: string | null;
		tokenId: string | null;
	};

	type ArrangeFieldProps = {
		field: FieldDef; // must carry a populated arrangeKeys (see box_categories' arrange field)
		position?: 'top' | 'bottom' | 'mid';
		axisNameById?: Record<string, string>;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		projectId?: string | null;
		onFieldUpdate?: (update: FieldUpdate) => void;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
	};

	let {
		field,
		position = 'mid',
		axisNameById = {},
		track,
		resolvedMap,
		api,
		projectId,
		onFieldUpdate,
		callUtilityPlugin
	}: ArrangeFieldProps = $props();

	const arrangeKeys = $derived(field.arrangeKeys as ArrangeKeys);

	type ArrangeKind = 'stack' | 'cluster' | 'split' | 'center' | 'grid';
	const TABS: { kind: ArrangeKind; label: string; icon: string; tooltip: string }[] = [
		{
			kind: 'stack',
			label: 'Stack',
			icon: 'fa-solid fa-bars',
			tooltip: 'Flow children in one direction with a gap — forms, lists, the default box shape'
		},
		{
			kind: 'cluster',
			label: 'Cluster',
			icon: 'fa-solid fa-grip',
			tooltip: 'Wrap children in a row, packed to the start — chip rows, toolbars, button groups'
		},
		{
			kind: 'split',
			label: 'Split',
			icon: 'fa-solid fa-arrows-left-right',
			tooltip: 'Push children to opposite ends, centered on the cross axis — headers, nav bars'
		},
		{
			kind: 'center',
			label: 'Center',
			icon: 'fa-solid fa-align-center',
			tooltip: 'Center a child on both axes — hero sections, empty states, badges'
		},
		{
			kind: 'grid',
			label: 'Grid',
			icon: 'fa-solid fa-table-cells',
			tooltip:
				'Equal-size responsive cells that wrap automatically — galleries, card grids, dashboards'
		}
	];

	// "stack", absent, or unrecognized all read as Stack -- mirrors Charter's parse_arrange
	// default-hard fallback exactly, so the UI's idea of "active tab" never disagrees with what
	// compile_arrange actually compiled.
	const activeKind = $derived.by<ArrangeKind>(() => {
		const v = resolvedMap.get(field.key)?.value;
		return v === 'cluster' || v === 'split' || v === 'center' || v === 'grid' ? v : 'stack';
	});

	function trackColor(axisIds: string[]): string {
		return layerDotColor(axisIds, true);
	}

	function trackTitle(conditions: { axisId: string; value: string }[]): string {
		if (conditions.length === 0) return 'Base layer · always applies';
		const parts = conditions
			.map((c) => `${axisNameById[c.axisId] ?? c.axisId}: ${c.value}`)
			.join(', ');
		return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
	}

	function selectTab(kind: ArrangeKind) {
		if (kind === activeKind) return;
		const t = track(field.key);
		if (!onFieldUpdate || !t.sourceLayerId) return;
		onFieldUpdate({ layerId: t.sourceLayerId, property: field.key, value: kind });
	}

	// Raw "flex-direction" value, unresolved -- absent reads as each active tab's own default
	// (Cluster/Split -> Row, everything else -> Column), same fallback compile_arrange applies.
	const rawDirection = $derived(resolvedMap.get(arrangeKeys.directionKey)?.value);
	const directionIsRow = $derived(
		rawDirection === 'row' || (rawDirection == null && activeKind === 'split')
	);

	function writeDirection(v: 'row' | 'column') {
		const t = track(arrangeKeys.directionKey);
		if (!onFieldUpdate || !t.sourceLayerId) return;
		if (rawDirection === v) return;
		onFieldUpdate({ layerId: t.sourceLayerId, property: arrangeKeys.directionKey, value: v });
	}

	function anyFieldHasValue(fields: FieldDef[]): boolean {
		return fields.some((fd) => !!resolvedMap.get(fd.key)?.value);
	}

	// Stack and Split already expose a friendly Direction/Axis control for arrangeKeys.directionKey
	// above -- showing its raw FieldDef again under "Advanced flex" would be the exact same
	// property in two visible widgets at once, with the raw one adding nothing the friendly one
	// can't already do. Drop it only for the tabs that actually offer that friendly control;
	// Cluster/Center have no direction follow-on, so it stays their only way to touch it. Filtered
	// by directionKey (Charter-declared data), never by the literal string "flex-direction".
	const advancedFields = $derived(
		activeKind === 'stack' || activeKind === 'split'
			? arrangeKeys.advanced.filter((fd) => fd.key !== arrangeKeys.directionKey)
			: arrangeKeys.advanced
	);
</script>

{#snippet fieldRow(fd: FieldDef, tooltip?: string)}
	<StyleField
		{...track(fd.key)}
		displayText={fd.displayText ?? fd.key}
		key={fd.key}
		value={resolvedMap.get(fd.key)?.value}
		{axisNameById}
		inputType={fd.inputType}
		spacingMode={fd.spacingMode}
		labelTooltip={tooltip}
		suggestionsFrom={resolveSuggestionSource(fd.inputType, fd.suggestionsFrom)}
		{api}
		{projectId}
		{onFieldUpdate}
		{callUtilityPlugin}
	/>
{/snippet}

<div
	class="arrange-field"
	class:arrange-field--top={position === 'top'}
	class:arrange-field--bottom={position === 'bottom'}
>
	<div class="arrange-field__header">
		<button
			class="arrange-field__track"
			style="--track-color: {trackColor(track(field.key).keys)}"
			aria-label="Arrangement source"
			title={trackTitle(track(field.key).conditionValues)}
			type="button"
		>
			<i class="fa-solid {track(field.key).kitIcon}"></i>
		</button>
		<span class="arrange-field__label">{field.displayText ?? field.key}</span>
	</div>

	<div class="arrange-field__tabs" role="tablist" aria-label="Arrangement pattern">
		{#each TABS as tab (tab.kind)}
			<button
				type="button"
				role="tab"
				aria-selected={activeKind === tab.kind}
				class="arrange-field__tab"
				class:arrange-field__tab--sel={activeKind === tab.kind}
				class:arrange-field__tab--big={tab.kind === 'grid'}
				style="grid-area: {tab.kind}"
				title={tab.tooltip}
				onclick={() => selectTab(tab.kind)}
			>
				{#if tab.kind === 'grid'}
					<!-- Only the double-size cell has room for its icon; the 1fr cells stay
					     label-only so "Cluster"/"Center" never truncate at panel width. -->
					<i class={tab.icon}></i>
				{/if}
				<span>{tab.label}</span>
			</button>
		{/each}
	</div>

	<div class="arrange-field__submenu">
		{#if activeKind === 'stack'}
			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="Which way children flow, one after another"
					>Direction</span
				>
				<div class="arrange-seg" role="group" aria-label="Direction">
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={!directionIsRow}
						title="Stack downward — a column"
						onclick={() => writeDirection('column')}
					>
						<i class="fa-solid fa-arrow-down"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={directionIsRow}
						title="Stack rightward — a row"
						onclick={() => writeDirection('row')}
					>
						<i class="fa-solid fa-arrow-right"></i>
					</button>
				</div>
			</div>
			{@render fieldRow(arrangeKeys.gap, 'Space between children')}
		{:else if activeKind === 'cluster'}
			{@render fieldRow(arrangeKeys.gap, 'Space between children')}
		{:else if activeKind === 'split'}
			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="Which axis the two ends push apart along"
					>Axis</span
				>
				<div class="arrange-seg" role="group" aria-label="Axis">
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={directionIsRow}
						title="Split left/right — a row"
						onclick={() => writeDirection('row')}
					>
						<i class="fa-solid fa-arrows-left-right"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={!directionIsRow}
						title="Split top/bottom — a column"
						onclick={() => writeDirection('column')}
					>
						<i class="fa-solid fa-arrows-up-down"></i>
					</button>
				</div>
			</div>
		{:else if activeKind === 'grid'}
			{@render fieldRow(
				arrangeKeys.cellMin,
				'The smallest a column is allowed to get before wrapping to the next row'
			)}
			{@render fieldRow(arrangeKeys.gap, 'Space between cells')}
		{/if}

		{#if activeKind !== 'grid'}
			<details
				class="arrange-disclosure"
				title="Raw flex properties {activeKind} doesn't expose directly — still real, still editable"
			>
				<summary class="arrange-disclosure__summary">
					<span>Advanced flex</span>
					{#if anyFieldHasValue(advancedFields)}
						<i
							class="fa-solid fa-circle arrange-disclosure__badge"
							title="One or more advanced fields have a value set"
						></i>
					{/if}
					<i class="fa-solid fa-angle-down arrange-disclosure__caret"></i>
				</summary>
				<div class="arrange-disclosure__content">
					{#each advancedFields as fd (fd.key)}
						{@render fieldRow(fd)}
					{/each}
				</div>
			</details>
		{:else}
			<details
				class="arrange-disclosure"
				title="Explicit CSS Grid track definitions, for layouts Cell Min + Gap can't express"
			>
				<summary class="arrange-disclosure__summary">
					<span>Custom tracks</span>
					{#if anyFieldHasValue(arrangeKeys.gridAdvanced)}
						<i
							class="fa-solid fa-circle arrange-disclosure__badge"
							title="One or more custom tracks are set"
						></i>
					{/if}
					<i class="fa-solid fa-angle-down arrange-disclosure__caret"></i>
				</summary>
				<div class="arrange-disclosure__content">
					{#each arrangeKeys.gridAdvanced as fd (fd.key)}
						{@render fieldRow(fd)}
					{/each}
				</div>
			</details>
		{/if}
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.arrange-field {
		display: flex;
		flex-direction: column;
		user-select: none;
		padding-block: calc($x-space-xs / 2);

		@include layout-respond('md') {
			font-size: $x-font-size-sm;
			letter-spacing: 1px;
		}

		&__header {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			padding-inline: $x-space-sm;
			font-weight: 600;
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-sm;
			color: var(--track-color, var(--color-text));
			flex: 0 0 auto;
		}

		&__label {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			text-transform: capitalize;
		}

		// A deliberate grid, not a wrapping row: four 1fr pattern cells in a 2x2 block, with
		// Grid itself as one 2fr-wide cell spanning both rows on the right -- so the tab that
		// MAKES grids visually IS one big grid cell, and nothing rag-wraps at panel width.
		&__tabs {
			display: grid;
			grid-template-columns: 1fr 1fr 2fr;
			grid-template-areas:
				'stack cluster grid'
				'split center grid';
			gap: 2px;
			padding-inline: $x-space-sm;
			margin-top: calc($x-space-xs / 2);
		}

		&__tab {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: calc($x-space-xs / 2);
			min-width: 0;
			padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
			border-radius: 2px;
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);
			cursor: pointer;
			background: var(--color-panel-header-fill);

			span {
				overflow: hidden;
				text-overflow: ellipsis;
				white-space: nowrap;
			}

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}

			&--sel,
			&--sel:hover {
				background: var(--color-primary);
				color: var(--color-pure);
			}

			// The 2x2 Grid cell: icon above label, roomier icon -- it has two rows of height.
			&--big {
				flex-direction: column;
				gap: calc($x-space-xs / 2);

				i {
					font-size: $x-font-size-md;
				}
			}
		}

		// Fixed slot directly beneath the tab row -- inline panel content, never a popover/menu.
		&__submenu {
			display: flex;
			flex-direction: column;
			gap: 1px;
			margin-top: calc($x-space-xs / 2);
		}

		&__row {
			display: flex;
			align-items: center;
			justify-content: space-between;
			padding-inline: $x-space-sm;
			padding-block: calc($x-space-xs / 2);
			font-size: $x-font-size-sm;
		}

		&__row-label {
			opacity: 0.75;
		}
	}

	.arrange-seg {
		display: inline-flex;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-panel-header-fill);
	}

	.arrange-seg__btn {
		cursor: pointer;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: calc($x-space-xs / 2) $x-space-xs;
		font-size: $x-font-size-xs;
		color: var(--color-add-var-text);

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}

		&--sel,
		&--sel:hover {
			background: var(--color-primary);
			color: var(--color-pure);
		}
	}

	// Same disclosure grammar as Styles.svelte's whole-category <details>, scoped down to one
	// control's escape hatches -- the plan's "two levels, hard cap" (tab -> submenu -> Advanced).
	.arrange-disclosure {
		margin-top: calc($x-space-xs / 2);

		&__summary {
			list-style: none;
			cursor: pointer;
			padding-inline: $x-space-sm;
			padding-block: calc($x-space-xs / 2);
			display: flex;
			align-items: center;
			gap: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			opacity: 0.75;

			&:hover {
				background: var(--color-surface-alt);
				opacity: 1;
			}

			span {
				flex: 1;
			}
		}

		&__badge {
			font-size: 0.4em;
			color: var(--color-primary);
		}

		&__caret {
			transition: rotate 200ms ease-out;
		}

		&[open] &__caret {
			rotate: 180deg;
		}

		&__content {
			display: flex;
			flex-direction: column;
			gap: 1px;
		}
	}
</style>

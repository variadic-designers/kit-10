<script lang="ts">
	import FieldRow from './FieldRow.svelte';
	import StyleField from './StyleField.svelte';
	import GridSizePicker from './GridSizePicker.svelte';
	import GridTracksField from './GridTracksField.svelte';
	import GridAreaPainter from './GridAreaPainter.svelte';
	import { resolveSuggestionSource } from '$lib/plugins/suggestion-providers.js';
	import { commitFieldValue, clearFieldValue } from './field-commit.ts';
	import { parseTrackList } from './grid-tracks.ts';
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
		axisNameById?: Record<string, string>;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		projectId?: string | null;
		onFieldUpdate?: (update: FieldUpdate) => void;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
		// Named areas the ACTIVE selection's PARENT occurrence offers (null = parent isn't a Grid,
		// or there is no parent). Drives "Position in parent" below - deliberately independent of
		// activeKind (this box's OWN arrangement), since a Stack/Cluster/Split/Center child can sit
		// inside a Grid parent just as easily as a Grid child can.
		parentGridAreaNames?: string[] | null;
	};

	let {
		field,
		axisNameById = {},
		track,
		resolvedMap,
		api,
		projectId,
		onFieldUpdate,
		callUtilityPlugin,
		parentGridAreaNames = null
	}: ArrangeFieldProps = $props();

	const arrangeKeys = $derived(field.arrangeKeys as ArrangeKeys);

	type ArrangeKind = 'stack' | 'cluster' | 'split' | 'center' | 'grid';
	const TABS: { kind: ArrangeKind; label: string; icon: string; tooltip: string }[] = [
		{
			kind: 'stack',
			label: 'Stack',
			icon: 'fa-solid fa-bars',
			tooltip: 'Flow children in one direction with a gap - forms, lists, the default box shape'
		},
		{
			kind: 'cluster',
			label: 'Cluster',
			icon: 'fa-solid fa-grip',
			tooltip: 'Wrap children in a row, packed to the start - chip rows, toolbars, button groups'
		},
		{
			kind: 'split',
			label: 'Split',
			icon: 'fa-solid fa-arrows-left-right',
			tooltip: 'Push children to opposite ends, centered on the cross axis - headers, nav bars'
		},
		{
			kind: 'center',
			label: 'Center',
			icon: 'fa-solid fa-align-center',
			tooltip: 'Center a child on both axes - hero sections, empty states, badges'
		},
		{
			kind: 'grid',
			label: 'Grid',
			icon: 'fa-solid fa-table-cells',
			tooltip:
				'Equal-size responsive cells that wrap automatically - galleries, card grids, dashboards'
		}
	];

	// "stack", absent, or unrecognized all read as Stack -- mirrors Charter's parse_arrange
	// default-hard fallback exactly, so the UI's idea of "active tab" never disagrees with what
	// compile_arrange actually compiled.
	const activeKind = $derived.by<ArrangeKind>(() => {
		const v = resolvedMap.get(field.key)?.value;
		return v === 'cluster' || v === 'split' || v === 'center' || v === 'grid' ? v : 'stack';
	});

	const info = $derived(track(field.key));
	const activeTab = $derived(TABS.find((t) => t.kind === activeKind)!);

	function selectTab(kind: ArrangeKind) {
		if (kind === activeKind) return;
		commitFieldValue(track(field.key), field.key, kind, { onFieldUpdate, api });
	}

	// Raw "flex-direction" value, unresolved -- absent reads as each active tab's own default
	// (Cluster/Split -> Row, everything else -> Column), same fallback compile_arrange applies.
	const rawDirection = $derived(resolvedMap.get(arrangeKeys.directionKey)?.value);
	const directionIsRow = $derived(
		rawDirection === 'row' || (rawDirection == null && activeKind === 'split')
	);

	function writeDirection(v: 'row' | 'column') {
		if (rawDirection === v) return;
		commitFieldValue(track(arrangeKeys.directionKey), arrangeKeys.directionKey, v, {
			onFieldUpdate,
			api
		});
	}

	// Stack's own friendly Justify/Wrap controls - same "selector, not free text" grammar as
	// Direction above, promoted out of the raw "Advanced flex" disclosure so the two most-reached-
	// for flex properties after direction/gap are one click away, not two. Icon set reuses the
	// exact align-left/center/right/justify vocabulary StyleField's own inputType:"align" control
	// already established, rather than inventing a second one for the same shape of choice.
	const STACK_JUSTIFY_OPTIONS: { v: string; icon: string; title: string }[] = [
		{ v: 'flex-start', icon: 'fa-align-left', title: 'Start' },
		{ v: 'center', icon: 'fa-align-center', title: 'Center' },
		{ v: 'flex-end', icon: 'fa-align-right', title: 'End' },
		{ v: 'space-between', icon: 'fa-align-justify', title: 'Space between' }
	];
	const rawJustify = $derived(resolvedMap.get('justify-content')?.value ?? 'flex-start');

	function writeJustify(v: string) {
		if (rawJustify === v) return;
		commitFieldValue(track('justify-content'), 'justify-content', v, { onFieldUpdate, api });
	}

	const rawWrap = $derived(resolvedMap.get('flex-wrap')?.value);
	const wrapsToNextLine = $derived(rawWrap === 'wrap' || rawWrap === 'wrap-reverse');

	function writeWrap(wrap: boolean) {
		const v = wrap ? 'wrap' : 'nowrap';
		if ((rawWrap ?? 'nowrap') === v) return;
		commitFieldValue(track('flex-wrap'), 'flex-wrap', v, { onFieldUpdate, api });
	}

	function anyFieldHasValue(fields: FieldDef[]): boolean {
		return fields.some((fd) => !!resolvedMap.get(fd.key)?.value);
	}

	// Stack and Split already expose a friendly Direction/Axis control for arrangeKeys.directionKey
	// above -- showing its raw FieldDef again under "Advanced flex" would be the exact same
	// property in two visible widgets at once, with the raw one adding nothing the friendly one
	// can't already do. Drop it only for the tabs that actually offer that friendly control;
	// Cluster/Center have no direction follow-on, so it stays their only way to touch it. Filtered
	// by directionKey (Charter-declared data), never by the literal string "flex-direction". Stack
	// additionally drops justify-content/flex-wrap now that it has its own friendly controls too.
	const advancedFields = $derived.by(() => {
		if (activeKind === 'stack') {
			return arrangeKeys.advanced.filter(
				(fd) =>
					fd.key !== arrangeKeys.directionKey &&
					fd.key !== 'justify-content' &&
					fd.key !== 'flex-wrap'
			);
		}
		if (activeKind === 'split') {
			return arrangeKeys.advanced.filter((fd) => fd.key !== arrangeKeys.directionKey);
		}
		return arrangeKeys.advanced;
	});

	// Grid's own track counts, for the area painter's grid to always match what's actually defined.
	const columnCount = $derived(
		parseTrackList(resolvedMap.get(arrangeKeys.gridColumns.key)?.value ?? '').length
	);
	const rowCount = $derived(
		parseTrackList(resolvedMap.get(arrangeKeys.gridRows.key)?.value ?? '').length
	);

	const rawAutoFlow = $derived(resolvedMap.get(arrangeKeys.gridAutoFlow.key)?.value);
	const autoFlowIsColumn = $derived(rawAutoFlow?.startsWith('column') ?? false);
	const autoFlowIsDense = $derived(rawAutoFlow?.endsWith('dense') ?? false);

	function writeAutoFlow(column: boolean, dense: boolean) {
		const v = `${column ? 'column' : 'row'}${dense ? ' dense' : ''}`;
		commitFieldValue(track(arrangeKeys.gridAutoFlow.key), arrangeKeys.gridAutoFlow.key, v, {
			onFieldUpdate,
			api
		});
	}

	const ALIGN_OPTIONS = ['start', 'end', 'flex-start', 'flex-end', 'center', 'stretch'];
	const JUSTIFY_OPTIONS = [...ALIGN_OPTIONS, 'space-between', 'space-evenly', 'space-around'];

	// `place` is a CHILD placement property - meaningful based on the PARENT's arrangement,
	// entirely independent of this box's own activeKind. Surfaced ONLY here, in an always-visible
	// "Position in parent" dropdown - deliberately a bare name, never a raw line/span escape
	// hatch (Charter doesn't even declare `place` as a FieldDef; see resources/
	// grid-child-placement-plan.md and resolve_place's own doc comment in lib.rs).
	const currentPlace = $derived(resolvedMap.get('place')?.value ?? '');

	function writePlace(name: string) {
		if (name) {
			commitFieldValue(track('place'), 'place', name, { onFieldUpdate, api });
		} else {
			// "(auto-placed)" must fully clear the property, not write an empty string -
			// resolve_place checks `place` by presence, and an empty-but-present value would
			// (pre-hardening) or could still confusingly linger as a real render entry.
			void clearFieldValue(track('place'), 'place', api);
		}
	}
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

<FieldRow
	label={field.displayText ?? field.key}
	track={{ kitIcon: info.kitIcon, keys: info.keys, conditionValues: info.conditionValues }}
	{axisNameById}
	trackAriaLabel="Arrangement source"
>
	{#snippet valueSlot()}
		<span class="arrange-field__current">
			<i class={activeTab.icon}></i>
			{activeTab.label}
		</span>
	{/snippet}

	{#snippet body()}
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
				<i class={tab.icon}></i>
				<span>{tab.label}</span>
			</button>
		{/each}
	</div>

	{#if parentGridAreaNames !== null}
		<div class="arrange-field__parent-position">
			<div class="arrange-field__row">
				<span
					class="arrange-field__row-label"
					title="Which named area of the PARENT grid this child occupies - shown regardless of this box's own arrangement"
					>Position in parent</span
				>
				<select
					class="arrange-field__select"
					value={currentPlace}
					onchange={(e) => writePlace((e.currentTarget as HTMLSelectElement).value)}
				>
					<option value="">(auto-placed)</option>
					{#each parentGridAreaNames as name (name)}
						<option value={name}>{name}</option>
					{/each}
				</select>
			</div>
		</div>
	{/if}

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
						title="Stack downward - a column"
						onclick={() => writeDirection('column')}
					>
						<i class="fa-solid fa-arrow-down"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={directionIsRow}
						title="Stack rightward - a row"
						onclick={() => writeDirection('row')}
					>
						<i class="fa-solid fa-arrow-right"></i>
					</button>
				</div>
			</div>
			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="How children distribute along the main axis"
					>Justify</span
				>
				<div class="arrange-seg" role="group" aria-label="Justify">
					{#each STACK_JUSTIFY_OPTIONS as opt (opt.v)}
						<button
							type="button"
							class="arrange-seg__btn"
							class:arrange-seg__btn--sel={rawJustify === opt.v}
							title={opt.title}
							onclick={() => writeJustify(opt.v)}
						>
							<i class="fa-solid {opt.icon}"></i>
						</button>
					{/each}
				</div>
			</div>
			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="Whether overflowing children wrap onto a new line"
					>Wrap</span
				>
				<div class="arrange-seg" role="group" aria-label="Wrap">
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={!wrapsToNextLine}
						title="No wrap - stays on one line"
						onclick={() => writeWrap(false)}
					>
						<i class="fa-solid fa-minus"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={wrapsToNextLine}
						title="Wrap - overflow moves to a new line"
						onclick={() => writeWrap(true)}
					>
						<i class="fa-solid fa-grip-lines"></i>
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
						title="Split left/right - a row"
						onclick={() => writeDirection('row')}
					>
						<i class="fa-solid fa-arrows-left-right"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={!directionIsRow}
						title="Split top/bottom - a column"
						onclick={() => writeDirection('column')}
					>
						<i class="fa-solid fa-arrows-up-down"></i>
					</button>
				</div>
			</div>
		{:else if activeKind === 'grid'}
			{@render fieldRow(
				arrangeKeys.cellMin,
				'The smallest a column is allowed to get before wrapping to the next row (used only when no explicit columns are defined below)'
			)}
			{@render fieldRow(arrangeKeys.gap, 'Space between cells')}

			<GridSizePicker
				columnsField={arrangeKeys.gridColumns}
				rowsField={arrangeKeys.gridRows}
				{track}
				{resolvedMap}
				{api}
				{onFieldUpdate}
			/>
			<GridTracksField field={arrangeKeys.gridColumns} label="Columns" {track} {resolvedMap} {api} {onFieldUpdate} />
			<GridTracksField field={arrangeKeys.gridRows} label="Rows" {track} {resolvedMap} {api} {onFieldUpdate} />

			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="How auto-placed children fill the grid"
					>Auto flow</span
				>
				<div class="arrange-seg" role="group" aria-label="Auto flow">
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={!autoFlowIsColumn}
						title="Fill rows first"
						onclick={() => writeAutoFlow(false, autoFlowIsDense)}
					>
						<i class="fa-solid fa-arrow-right"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={autoFlowIsColumn}
						title="Fill columns first"
						onclick={() => writeAutoFlow(true, autoFlowIsDense)}
					>
						<i class="fa-solid fa-arrow-down"></i>
					</button>
					<button
						type="button"
						class="arrange-seg__btn"
						class:arrange-seg__btn--sel={autoFlowIsDense}
						title="Dense - backfill earlier gaps left by larger items"
						onclick={() => writeAutoFlow(autoFlowIsColumn, !autoFlowIsDense)}
					>
						<i class="fa-solid fa-layer-group"></i>
					</button>
				</div>
			</div>

			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="Default inline-axis alignment for items">
					Justify items
				</span>
				<select
					class="arrange-field__select"
					value={resolvedMap.get(arrangeKeys.gridJustifyItems.key)?.value ?? ''}
					onchange={(e) =>
						commitFieldValue(
							track(arrangeKeys.gridJustifyItems.key),
							arrangeKeys.gridJustifyItems.key,
							(e.currentTarget as HTMLSelectElement).value,
							{ onFieldUpdate, api }
						)}
				>
					<option value="">(default)</option>
					{#each ALIGN_OPTIONS as opt (opt)}
						<option value={opt}>{opt}</option>
					{/each}
				</select>
			</div>

			<div class="arrange-field__row">
				<span class="arrange-field__row-label" title="Distribution of extra space among tracks">
					Align content
				</span>
				<select
					class="arrange-field__select"
					value={resolvedMap.get(arrangeKeys.gridAlignContent.key)?.value ?? ''}
					onchange={(e) =>
						commitFieldValue(
							track(arrangeKeys.gridAlignContent.key),
							arrangeKeys.gridAlignContent.key,
							(e.currentTarget as HTMLSelectElement).value,
							{ onFieldUpdate, api }
						)}
				>
					<option value="">(default)</option>
					{#each JUSTIFY_OPTIONS as opt (opt)}
						<option value={opt}>{opt}</option>
					{/each}
				</select>
			</div>

			<details class="arrange-disclosure" title="Paint named regions to place children by area instead of by line number">
				<summary class="arrange-disclosure__summary">
					<span>Areas</span>
					{#if resolvedMap.get(arrangeKeys.gridAreas.key)?.value}
						<i
							class="fa-solid fa-circle arrange-disclosure__badge"
							title="Areas are defined"
						></i>
					{/if}
					<i class="fa-solid fa-angle-down arrange-disclosure__caret"></i>
				</summary>
				<div class="arrange-disclosure__content">
					<GridAreaPainter
						field={arrangeKeys.gridAreas}
						colCount={columnCount}
						{rowCount}
						{track}
						{resolvedMap}
						{api}
						{onFieldUpdate}
					/>
				</div>
			</details>
		{/if}

		{#if activeKind !== 'grid'}
			<details
				class="arrange-disclosure"
				title="Raw flex properties {activeKind} doesn't expose directly - still real, still editable"
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
	{/snippet}
</FieldRow>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.arrange-field__current {
		display: inline-flex;
		align-items: center;
		gap: calc($x-space-xs / 2);
		font-size: $x-font-size-sm;
		color: var(--color-add-var-text);
	}

	// A deliberate grid, not a wrapping row: three equal columns -- every pattern cell as
	// wide as the Grid cell -- with the 2x2 block (Stack/Cluster over Split/Center) on the
	// left and Grid itself spanning both rows on the right, so the tab that MAKES grids
	// visually IS one big grid cell, and nothing rag-wraps at panel width.
	.arrange-field__tabs {
		display: grid;
		grid-template-columns: 2fr 2fr 2fr;
		grid-template-areas:
			'stack cluster grid'
			'split center grid';
		gap: 2px;
	}

	.arrange-field__tab {
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
	.arrange-field__submenu {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-top: calc($x-space-xs / 2);
	}

	// Sits between the tabs and the activeKind submenu, not inside either - visually set off
	// with a divider so it reads as "about the PARENT", not another tab-specific option.
	.arrange-field__parent-position {
		display: flex;
		flex-direction: column;
		gap: 1px;
		margin-top: calc($x-space-xs / 2);
		padding-top: calc($x-space-xs / 2);
		border-top: 1px solid var(--color-panel-header-border);
	}

	.arrange-field__row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-block: calc($x-space-xs / 2);
		font-size: $x-font-size-sm;
	}

	.arrange-field__row-label {
		opacity: 0.75;
	}

	.arrange-field__select {
		background: var(--color-panel-header-fill);
		border: none;
		border-radius: 2px;
		color: var(--color-text);
		font-size: $x-font-size-xs;
		padding: calc($x-space-xs / 2) $x-space-xs;
		cursor: pointer;
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

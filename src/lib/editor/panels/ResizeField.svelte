<script lang="ts">
	import StyleField from './StyleField.svelte';
	import { resolveSuggestionSource } from '$lib/plugins/suggestion-providers.js';
	import type { Api, ResolvedProperty } from 'manager';
	import type { FieldDef, FieldUpdate, ResizeKeys } from '$lib/plugins/types.js';

	// Same shape ArrangeField takes -- Styles.svelte's `track()` passed down as a function so this
	// component can resolve the source layer/kit/keys for its own dimension key AND each limit
	// follow-on (min/max) independently.
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

	type ResizeFieldProps = {
		field: FieldDef; // must carry a populated resizeKeys (see box_categories' width/height fields)
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
	}: ResizeFieldProps = $props();

	const resizeKeys = $derived(field.resizeKeys as ResizeKeys);

	// Limits only matter when the dimension can actually vary with context: Fill (shares free
	// space) or a fixed % of the parent (see CLAUDE.md's min_width percent-floor note). A fixed
	// px/hug dimension IS its own limit, so the pair stays hidden then -- revealed exactly when
	// meaningful, the same "the selector is the revealer" grammar as Arrangement's tabs.
	const value = $derived(resolvedMap.get(field.key)?.value);
	const limitsApply = $derived(
		value === 'fill' || (!!value && value !== 'hug' && value !== 'auto' && value.endsWith('%'))
	);

	// Hidden is inert and preserved -- but a limit is never inert (Vellum clamps whenever one is
	// set), so an already-set min/max must stay visible and editable even after the dimension
	// switches back to Hug/Fixed-px. Only genuinely empty limits collapse away.
	const anyLimitSet = $derived(
		!!resolvedMap.get(resizeKeys.min.key)?.value || !!resolvedMap.get(resizeKeys.max.key)?.value
	);
	const showLimits = $derived(limitsApply || anyLimitSet);
</script>

{#snippet fieldRow(fd: FieldDef, tooltip: string)}
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

<div class="resize-field">
	<StyleField
		{...track(field.key)}
		displayText={field.displayText ?? field.key}
		key={field.key}
		value={resolvedMap.get(field.key)?.value}
		{position}
		{axisNameById}
		inputType={field.inputType}
		spacingMode={field.spacingMode}
		suggestionsFrom={resolveSuggestionSource(field.inputType, field.suggestionsFrom)}
		{api}
		{projectId}
		{onFieldUpdate}
		{callUtilityPlugin}
	/>

	{#if showLimits}
		<div class="resize-field__limits">
			{@render fieldRow(resizeKeys.min, `Won't shrink below this — the floor for a fill/% size`)}
			{@render fieldRow(resizeKeys.max, `Won't grow past this — the ceiling for a fill/% size`)}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	.resize-field {
		display: flex;
		flex-direction: column;
	}

	// Inline follow-ons directly beneath their dimension's row -- same fixed-slot grammar as
	// ArrangeField's submenu, never a popover/disclosure. The inset marks the pair as belonging
	// to the row above, since two dimensions' limits can be revealed at once.
	.resize-field__limits {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding-left: $x-space-sm;
	}
</style>

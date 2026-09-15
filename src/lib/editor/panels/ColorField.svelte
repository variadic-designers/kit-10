<script lang="ts">
	import FieldRow from './FieldRow.svelte';
	import ColorSwatch from './ColorSwatch.svelte';
	import ColorPicker from './ColorPicker.svelte';
	import { commitFieldValue, attachToken, detachToken } from './field-commit.ts';
	import type { FieldDef, FieldUpdate } from '$lib/plugins/types.js';
	import type { Api, ResolvedProperty } from 'manager';

	// Same shape WeightField/ArrangeField/ResizeField take -- Styles.svelte's `track()` passed
	// down so this component can resolve the source layer/kit/keys for its own key.
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

	type ColorFieldProps = {
		field: FieldDef;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, track, resolvedMap, api, onFieldUpdate }: ColorFieldProps = $props();

	// Token/layer facts for this field's key, re-derived reactively. Drives both the write path
	// (edit the shared token vs. write a literal) and the token badge.
	const info = $derived(track(field.key));

	const currentRaw = $derived(resolvedMap.get(field.key)?.value ?? null);

	// "No color set" is a distinct state from a real gray: the property has no render entry at all,
	// so the picker below sits at its neutral starting point purely as a starting point, not
	// because gray was authored. Surface it (dashed "+" swatch + muted picker) instead of
	// rendering an indistinguishable gray. A token-backed color always resolves to a value, so
	// this is only ever true for literal, value-less colors -- never collides with the token
	// badge. transparent / alpha-0 is a real value (non-null currentRaw), so it is NOT unset.
	const isUnset = $derived(currentRaw === null);

	function commitColor(raw: string) {
		// Token-aware: if this color is token-backed, editing the picker edits the shared token
		// (propagates to every use) rather than silently detaching to a one-off literal.
		commitFieldValue(track(field.key), field.key, raw, { onFieldUpdate, api });
	}

	function canDropColorToken(payload: { kind: string; valueType?: string }): boolean {
		return (
			payload.kind === 'token' &&
			payload.valueType !== 'view' &&
			!!info.sourceLayerId &&
			!!onFieldUpdate
		);
	}

	function handleColorTokenDrop(payload: { kind: string; tokenId?: string }) {
		if (payload.kind !== 'token' || !payload.tokenId) return;
		attachToken(track(field.key), field.key, payload.tokenId, onFieldUpdate);
	}

	function detach() {
		// Explicit: freeze the token's current resolved value onto this property as a literal.
		detachToken(track(field.key), field.key, currentRaw ?? '', onFieldUpdate);
	}
</script>

<FieldRow
	label={field.displayText ?? field.key}
	track={{ kitIcon: info.kitIcon, keys: info.keys, conditionValues: info.conditionValues }}
	trackAriaLabel="Color source"
	isToken={info.isToken}
	tokenAlias={info.tokenAlias}
	tokenValue={currentRaw}
	onDetachToken={detach}
	canDropToken={canDropColorToken}
	onDropToken={handleColorTokenDrop}
	expanded={false}
>
	{#snippet valueSlot()}
		<!-- FieldRow's own value box IS the disclosure trigger now - this swatch is a passive
		     visual, not a nested button. -->
		{#if isUnset}
			<span class="color-field__swatch color-field__swatch--unset" aria-label="No color set">+</span
			>
		{:else}
			<ColorSwatch value={currentRaw} />
		{/if}
	{/snippet}

	{#snippet body()}
		<!-- The plane/rails/raw-text picker itself is the shared ColorPicker component (also the
		     Tokens panel's expanded color-token row editor); only the unset muting is local. -->
		<ColorPicker value={currentRaw} muted={isUnset} onCommit={commitColor} />
	{/snippet}
</FieldRow>

<style lang="scss">
	@use '_index' as *;

	// Sized like a normal Render-panel value control (FieldRow's value slot is flex-basis: 40%),
	// not a small icon box. The filled swatch itself is the shared ColorSwatch component (also
	// used by the Tokens panel's color tokens); only the "no color set" state is styled here.
	.color-field__swatch {
		display: flex;
		width: 100%;
		min-width: 2.4em;
		height: 1.3em;
		border-radius: 3px;

		// "No color set": no fill, dashed outline + a muted "+" -- the panel's own "add value"
		// idiom, so an unset color never masquerades as a deliberately-authored gray.
		&--unset {
			align-items: center;
			justify-content: center;
			background: transparent;
			border: 1px dashed var(--color-panel-header-border);
			color: var(--color-add-var-text);
			font-size: 0.8em;
		}
	}
</style>

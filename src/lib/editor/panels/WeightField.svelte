<script lang="ts">
	import { layerDotColor } from './layer-color.ts';
	import { factsForFamily, resolveFontWeight } from '$lib/plugins/font-weight.js';
	import { dropZone } from '../dnd.svelte.ts';
	import { commitFieldValue, attachToken, detachToken } from './field-commit.ts';
	import TokenBadge from './TokenBadge.svelte';
	import type { FamilyFacts, FieldDef, FieldUpdate } from '$lib/plugins/types.js';
	import type { Api, ResolvedProperty } from 'manager';

	// Same shape ArrangeField/ResizeField take -- Styles.svelte's `track()` passed down so this
	// component can resolve the source layer/kit/keys for its own key ("font-weight").
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

	type WeightFieldProps = {
		field: FieldDef;
		position?: 'top' | 'bottom' | 'mid';
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		// family -> weight ranges, from Editor.svelte's font-facts channel (see CLAUDE.md's
		// weight-snapping note). Absent/uncatalogued family means no filtering opinion -- same
		// "no facts, no opinion" rule Charter's resolve_font_weight applies to rendering.
		fontFacts?: Record<string, FamilyFacts>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let {
		field,
		position = 'mid',
		track,
		resolvedMap,
		fontFacts = {},
		api,
		onFieldUpdate
	}: WeightFieldProps = $props();

	const info = $derived(track(field.key));

	const STANDARD_WEIGHTS: { weight: number; label: string }[] = [
		{ weight: 100, label: 'Thin' },
		{ weight: 200, label: 'Extra Light' },
		{ weight: 300, label: 'Light' },
		{ weight: 400, label: 'Regular' },
		{ weight: 500, label: 'Medium' },
		{ weight: 600, label: 'SemiBold' },
		{ weight: 700, label: 'Bold' },
		{ weight: 800, label: 'Extra Bold' },
		{ weight: 900, label: 'Black' }
	];

	const currentFamily = $derived(resolvedMap.get('font-family')?.value ?? null);
	// Absent/unparseable reads as 400, mirroring Charter's own font-weight default.
	const currentWeight = $derived.by(() => {
		const raw = resolvedMap.get(field.key)?.value;
		const n = raw ? parseInt(raw, 10) : NaN;
		return Number.isFinite(n) && n > 0 ? n : 400;
	});

	const currentFacts = $derived(factsForFamily(fontFacts, currentFamily));

	// The weight actually on screen. Charter's resolve_font_weight snaps a requested weight the
	// family can't ship (Lato 600) to the nearest real one (700) at RENDER time WITHOUT rewriting
	// the stored value -- that's the deliberate design (substitution is a render decision, see
	// CLAUDE.md). So the panel must highlight what renders, not the raw stored value: otherwise a
	// stored 600 against a [400,700] family highlights nothing (600 isn't a button), which reads
	// as "the weight control is broken / nothing selected." Mirroring the exact snap here keeps
	// the selected button in lock-step with the glyphs on the canvas -- and because the stored
	// value stays untouched, switching back to a variable font that CAN do 600 shows 600 again,
	// instead of a pick-time write burning 700 in permanently.
	const displayWeight = $derived(resolveFontWeight(currentWeight, currentFacts));

	// Which named weights the resolved family can actually render, from the font-facts channel
	// (text-affordances Phase 1/2) -- "pick from what exists," not free-typed numbers Lato has
	// no file for. No facts for this family (uncatalogued, or not fetched yet) -> the full
	// standard set, unfiltered, exactly Charter's own "no facts, no opinion" fallback.
	const availableWeights = $derived.by(() => {
		if (!currentFacts || currentFacts.variants.length === 0) return STANDARD_WEIGHTS;
		return STANDARD_WEIGHTS.filter((w) =>
			currentFacts.variants.some((v) => w.weight >= v.weightMin && w.weight <= v.weightMax)
		);
	});

	function trackColor(axisIds: string[]): string {
		return layerDotColor(axisIds, true);
	}

	function trackTitle(conditions: { axisId: string; value: string }[]): string {
		if (conditions.length === 0) return 'Base layer · always applies';
		const parts = conditions.map((c) => `${c.axisId}: ${c.value}`).join(', ');
		return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
	}

	function selectWeight(weight: number) {
		// Compare against what's on screen: clicking the already-rendered weight is a no-op even
		// when the raw stored value differs (e.g. stored 600 rendering as 700 -- clicking 700
		// shouldn't rewrite). Clicking any OTHER button writes that weight -- token-aware, so a
		// token-backed weight edits the shared token rather than detaching to a literal.
		if (weight === displayWeight) return;
		commitFieldValue(track(field.key), field.key, String(weight), { onFieldUpdate, api });
	}

	function canDropWeightToken(payload: { kind: string; valueType?: string }): boolean {
		return (
			payload.kind === 'token' &&
			payload.valueType !== 'view-list' &&
			!!info.sourceLayerId &&
			!!onFieldUpdate
		);
	}

	function handleWeightTokenDrop(payload: { kind: string; tokenId?: string }) {
		if (payload.kind !== 'token' || !payload.tokenId) return;
		attachToken(track(field.key), field.key, payload.tokenId, onFieldUpdate);
	}

	function detach() {
		detachToken(track(field.key), field.key, resolvedMap.get(field.key)?.value ?? '', onFieldUpdate);
	}
</script>

<div
	class="weight-field"
	class:weight-field--top={position === 'top'}
	class:weight-field--bottom={position === 'bottom'}
>
	<div
		class="weight-field__header"
		use:dropZone={{ accepts: 'token', canDrop: canDropWeightToken, onDrop: handleWeightTokenDrop }}
	>
		<span class="weight-field__label">{field.displayText ?? field.key}</span>
		{#if info.isToken}
			<TokenBadge alias={info.tokenAlias} value={resolvedMap.get(field.key)?.value ?? null} onDetach={detach} />
		{/if}
		<button
			class="weight-field__track"
			style="--track-color: {trackColor(track(field.key).keys)}"
			aria-label="Weight source"
			title={trackTitle(track(field.key).conditionValues)}
			type="button"
		>
			<i class="fa-solid {track(field.key).kitIcon}"></i>
		</button>
	</div>

	<div class="weight-field__options" role="group" aria-label="Font weight">
		{#each availableWeights as opt (opt.weight)}
			<button
				type="button"
				class="weight-field__btn"
				class:weight-field__btn--sel={displayWeight === opt.weight}
				title={displayWeight === opt.weight && currentWeight !== opt.weight
					? `${opt.label} (${opt.weight}) — ${currentFamily} has no ${currentWeight}, showing nearest`
					: `${opt.label} (${opt.weight})`}
				onclick={() => selectWeight(opt.weight)}
			>
				{opt.weight}
			</button>
		{/each}
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.weight-field {
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

			&:global(.dnd-over) {
				outline: 1px dashed var(--color-primary);
				outline-offset: -1px;
			}
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

		// A wrapping row, not a fixed grid -- the option count varies with the resolved family's
		// facts (a static two-weight family shows 2 buttons, a full variable family shows 9).
		&__options {
			display: flex;
			flex-wrap: wrap;
			gap: 2px;
			padding-inline: $x-space-sm;
			margin-top: calc($x-space-xs / 2);
		}

		&__btn {
			cursor: pointer;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			min-width: 2.4em;
			padding: calc($x-space-xs / 2) $x-space-xs;
			border-radius: 2px;
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);
			background: var(--color-panel-header-fill);

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
	}
</style>

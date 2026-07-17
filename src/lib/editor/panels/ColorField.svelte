<script lang="ts">
	import { layerDotColor } from './layer-color.ts';
	import { parseCssColorToOklch, formatOklch } from '$lib/color/oklch.js';
	import type { FieldDef, FieldUpdate } from '$lib/plugins/types.js';
	import type { ResolvedProperty } from 'manager';

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
		position?: 'top' | 'bottom' | 'mid';
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, position = 'mid', track, resolvedMap, onFieldUpdate }: ColorFieldProps = $props();

	// Phase 1 (see resources/oklch.md): real L/C/H/alpha sliders + a live swatch + a collapsible
	// raw-text escape hatch for pasting a legacy hex/rgb/hsl value. Every commit writes back
	// canonical `oklch(...)` -- editing a legacy value through this widget upgrades it on first
	// touch (hex/rgb/hsl are accepted input, never re-authored). Gamut-mapping/fallback-visibility
	// (Phase 2), oklch.com-style 2D graphs (Phase 3), and P3 awareness (Phase 4) are deliberately
	// not built yet.

	const currentRaw = $derived(resolvedMap.get(field.key)?.value ?? null);

	// A neutral, mid-lightness starting point when nothing is set yet or the stored value is
	// unparseable -- lets a designer start dragging immediately rather than hitting a dead end.
	const FALLBACK = { l: 0.5, c: 0, h: 0, alpha: 1 };

	let l = $state(FALLBACK.l);
	let c = $state(FALLBACK.c);
	let h = $state(FALLBACK.h);
	let alpha = $state(FALLBACK.alpha);
	let rawText = $state('');
	let rawInvalid = $state(false);

	// Resync local slider state whenever the resolved value changes underneath us (a different
	// layer/axis selection, an external write, or the initial mount) -- never while the user is
	// actively dragging a slider, since that's local-only until committed on `change`.
	let lastSyncedRaw: string | null | undefined = undefined;
	$effect(() => {
		if (currentRaw === lastSyncedRaw) return;
		lastSyncedRaw = currentRaw;
		const parsed = parseCssColorToOklch(currentRaw) ?? FALLBACK;
		l = parsed.l;
		c = parsed.c;
		h = parsed.h;
		alpha = parsed.alpha;
		rawText = currentRaw ?? '';
		rawInvalid = false;
	});

	const swatch = $derived(formatOklch(l, c, h, alpha));

	function commit() {
		const t = track(field.key);
		if (!onFieldUpdate || !t.sourceLayerId) return;
		onFieldUpdate({ layerId: t.sourceLayerId, property: field.key, value: formatOklch(l, c, h, alpha) });
	}

	function commitRaw() {
		const parsed = parseCssColorToOklch(rawText);
		if (!parsed) {
			rawInvalid = true;
			return;
		}
		rawInvalid = false;
		l = parsed.l;
		c = parsed.c;
		h = parsed.h;
		alpha = parsed.alpha;
		commit();
	}

	function trackColor(axisIds: string[]): string {
		return layerDotColor(axisIds, true);
	}

	function trackTitle(conditions: { axisId: string; value: string }[]): string {
		if (conditions.length === 0) return 'Base layer · always applies';
		const parts = conditions.map((c) => `${c.axisId}: ${c.value}`).join(', ');
		return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
	}
</script>

<div
	class="color-field"
	class:color-field--top={position === 'top'}
	class:color-field--bottom={position === 'bottom'}
>
	<div class="color-field__header">
		<button
			class="color-field__track"
			style="--track-color: {trackColor(track(field.key).keys)}"
			aria-label="Color source"
			title={trackTitle(track(field.key).conditionValues)}
			type="button"
		>
			<i class="fa-solid {track(field.key).kitIcon}"></i>
		</button>
		<span class="color-field__label">{field.displayText ?? field.key}</span>
		<span class="color-field__swatch" style="background: {swatch}" aria-hidden="true"></span>
	</div>

	<div class="color-field__sliders">
		<label class="color-field__row">
			<span class="color-field__row-label">L</span>
			<input
				type="range"
				min="0"
				max="1"
				step="0.001"
				bind:value={l}
				onchange={commit}
				aria-label="Lightness"
			/>
			<span class="color-field__row-value">{Math.round(l * 100)}%</span>
		</label>
		<label class="color-field__row">
			<span class="color-field__row-label">C</span>
			<input
				type="range"
				min="0"
				max="0.37"
				step="0.001"
				bind:value={c}
				onchange={commit}
				aria-label="Chroma"
			/>
			<span class="color-field__row-value">{c.toFixed(3)}</span>
		</label>
		<label class="color-field__row">
			<span class="color-field__row-label">H</span>
			<input
				type="range"
				min="0"
				max="360"
				step="0.5"
				bind:value={h}
				onchange={commit}
				aria-label="Hue"
			/>
			<span class="color-field__row-value">{Math.round(h)}°</span>
		</label>
		<label class="color-field__row">
			<span class="color-field__row-label">A</span>
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				bind:value={alpha}
				onchange={commit}
				aria-label="Alpha"
			/>
			<span class="color-field__row-value">{Math.round(alpha * 100)}%</span>
		</label>
	</div>

	<details class="color-field__raw">
		<summary>Raw value</summary>
		<input
			type="text"
			class="color-field__raw-input"
			class:color-field__raw-input--invalid={rawInvalid}
			bind:value={rawText}
			placeholder="oklch(70% 0.15 30), #3b82f6, rgb(…), …"
			onblur={commitRaw}
			onkeydown={(e) => {
				if (e.key === 'Enter') commitRaw();
			}}
		/>
	</details>
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.color-field {
		display: flex;
		flex-direction: column;
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

		&__swatch {
			flex: 0 0 auto;
			width: 1.1em;
			height: 1.1em;
			border-radius: 3px;
			border: 1px solid var(--color-panel-header-border);
		}

		&__sliders {
			display: flex;
			flex-direction: column;
			gap: 2px;
			padding-inline: $x-space-sm;
			margin-top: calc($x-space-xs / 2);
		}

		&__row {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
		}

		&__row-label {
			flex: 0 0 auto;
			width: 1em;
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);
			text-transform: uppercase;
		}

		&__row-value {
			flex: 0 0 auto;
			min-width: 3em;
			text-align: right;
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);
			font-variant-numeric: tabular-nums;
		}

		input[type='range'] {
			flex: 1;
			min-width: 0;
		}

		&__raw {
			padding-inline: $x-space-sm;
			margin-top: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;

			summary {
				cursor: pointer;
				color: var(--color-add-var-text);

				&:hover {
					color: var(--color-text);
				}
			}
		}

		&__raw-input {
			all: unset;
			display: block;
			width: 100%;
			margin-top: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2) $x-space-xs;
			border-radius: 2px;
			background: var(--color-panel-header-fill);
			color: var(--color-text);
			box-sizing: border-box;

			&--invalid {
				outline: 1px solid var(--color-danger);
			}
		}
	}
</style>

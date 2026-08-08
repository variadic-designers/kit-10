<script lang="ts">
	import { commitFieldValue } from './field-commit.ts';
	import { layerDotColor } from './layer-color.ts';
	import type { Api, ResolvedProperty } from 'manager';
	import type { FieldDef, FieldUpdate, PositionKeys } from '$lib/plugins/types.js';

	// Same shape ArrangeField/ResizeField/RadiusField take -- passed down as a function so this
	// component can resolve source layer/kit/keys independently for its own key (position) AND the
	// companion offset key, rather than the caller resolving just one.
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

	type PositionFieldProps = {
		field: FieldDef; // must carry a populated positionKeys (see box_categories' position field)
		position?: 'top' | 'bottom' | 'mid';
		axisNameById?: Record<string, string>;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, axisNameById = {}, track, resolvedMap, api, onFieldUpdate }: PositionFieldProps =
		$props();

	const positionKeys = $derived(field.positionKeys as PositionKeys);

	// Mirrors Charter's own parse_node_position default: absent/unrecognized reads as "relative".
	type PositionMode = 'relative' | 'nudge' | 'anchor';
	const mode = $derived<PositionMode>(
		resolvedMap.get(field.key)?.value === 'nudge'
			? 'nudge'
			: resolvedMap.get(field.key)?.value === 'anchor'
				? 'anchor'
				: 'relative'
	);

	// The offset is only ever read by Charter when the mode is Nudge/Anchor (parse_node_position
	// discards it under Relative) -- unlike ResizeField's min/max, there's no "already set, keep
	// visible" carry-over case: an offset left behind after switching back to Relative is fully
	// inert, so hiding it is correct, not lossy-looking.
	const showOffset = $derived(mode !== 'relative');

	const offsetRaw = $derived(resolvedMap.get(positionKeys?.offset.key ?? '')?.value ?? '');
	const offsetParts = $derived(
		offsetRaw
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((n) => parseFloat(n) || 0)
	);
	const dx = $derived(offsetParts[0] ?? 0);
	const dy = $derived(offsetParts[1] ?? 0);

	const OFFSET_STEP = 4;

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

	function writeMode(next: PositionMode) {
		commitFieldValue(track(field.key), field.key, next, { onFieldUpdate, api });
	}

	function writeOffset(nextDx: number, nextDy: number) {
		const key = positionKeys.offset.key;
		commitFieldValue(track(key), key, `${nextDx} ${nextDy}`, { onFieldUpdate, api });
	}

	function nudgeOffset(axis: 'dx' | 'dy', delta: number) {
		if (axis === 'dx') writeOffset(dx + delta, dy);
		else writeOffset(dx, dy + delta);
	}

	let editingAxis = $state<'dx' | 'dy' | null>(null);
	let editContent = $state('');

	function startEditingAxis(axis: 'dx' | 'dy') {
		editingAxis = axis;
		editContent = String(axis === 'dx' ? dx : dy);
	}

	function cancelEditingAxis() {
		editingAxis = null;
		editContent = '';
	}

	function confirmEditingAxis() {
		const axis = editingAxis;
		editingAxis = null;
		const num = parseFloat(editContent) || 0;
		editContent = '';
		if (axis === 'dx') writeOffset(num, dy);
		else if (axis === 'dy') writeOffset(dx, num);
	}
</script>

{#snippet offsetStepper(axis: 'dx' | 'dy', label: string, val: number)}
	<div class="position-stepper">
		<span class="position-stepper__label">{label}</span>
		<button
			type="button"
			class="position-stepper__btn"
			title="Decrease"
			onclick={() => nudgeOffset(axis, -OFFSET_STEP)}
		>
			<i class="fa-solid fa-minus"></i>
		</button>
		{#if editingAxis === axis}
			<input
				type="text"
				inputmode="numeric"
				bind:value={editContent}
				class="position-stepper__value position-stepper__value--edit"
				onblur={() => confirmEditingAxis()}
				onkeydown={(e: KeyboardEvent) => {
					if (e.key === 'Enter') confirmEditingAxis();
					else if (e.key === 'Escape') cancelEditingAxis();
				}}
			/>
		{:else}
			<button
				type="button"
				class="position-stepper__value"
				onclick={() => startEditingAxis(axis)}
			>
				{val}
			</button>
		{/if}
		<button
			type="button"
			class="position-stepper__btn"
			title="Increase"
			onclick={() => nudgeOffset(axis, OFFSET_STEP)}
		>
			<i class="fa-solid fa-plus"></i>
		</button>
	</div>
{/snippet}

<div class="position-field">
	<div class="position-field__header">
		<span class="position-field__label">{field.displayText ?? field.key}</span>
		<button
			class="position-field__track"
			style="--track-color: {trackColor(track(field.key).keys)}"
			aria-label="Position source"
			title={trackTitle(track(field.key).conditionValues)}
			type="button"
		>
			<i class="fa-solid {track(field.key).kitIcon}"></i>
		</button>
	</div>

	<div class="position-field__row">
		<div class="seg-control" role="group" aria-label="Position mode">
			<button
				type="button"
				class="seg-control__btn"
				class:seg-control__btn--sel={mode === 'relative'}
				title="Flow (default)"
				onclick={() => writeMode('relative')}
			>
				<i class="fa-solid fa-arrows-up-down-left-right"></i>
			</button>
			<button
				type="button"
				class="seg-control__btn"
				class:seg-control__btn--sel={mode === 'nudge'}
				title="Nudge - paint-time offset, still in flow"
				onclick={() => writeMode('nudge')}
			>
				<i class="fa-solid fa-up-down-left-right"></i>
			</button>
			<button
				type="button"
				class="seg-control__btn"
				class:seg-control__btn--sel={mode === 'anchor'}
				title="Anchor - pinned to the parent's own box, out of flow"
				onclick={() => writeMode('anchor')}
			>
				<i class="fa-solid fa-thumbtack"></i>
			</button>
		</div>
	</div>

	{#if showOffset}
		<div class="position-field__offsets">
			{@render offsetStepper('dx', 'X', dx)}
			{@render offsetStepper('dy', 'Y', dy)}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button,
	input {
		all: unset;
		cursor: pointer;
	}

	.position-field {
		display: flex;
		flex-direction: column;
		gap: calc($x-space-xs / 2);
		padding-block: calc($x-space-xs / 2);

		&__header {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			padding-inline: $x-space-sm;
			font-weight: 600;
		}

		&__label {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			text-transform: capitalize;
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-sm;
			color: var(--track-color, var(--color-text));
			flex: 0 0 auto;
		}

		&__row {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			padding-inline: $x-space-sm;
		}

		// Inline follow-on directly beneath the mode row -- same fixed-slot grammar as
		// ResizeField's limits, inset to mark it as belonging to the row above.
		&__offsets {
			display: flex;
			flex-direction: column;
			gap: 1px;
			padding-inline-start: calc($x-space-sm * 2);
		}
	}

	.seg-control {
		display: inline-flex;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-panel-header-fill);
	}

	.seg-control__btn {
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

	.position-stepper {
		display: inline-flex;
		align-items: center;
		gap: calc($x-space-xs / 2);

		&__label {
			font-size: $x-font-size-xs;
			opacity: 0.6;
			min-width: 0.8em;
		}

		&__btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);
			border-radius: 2px;
			background: var(--color-panel-header-fill);

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}
		}

		&__value {
			min-width: 2.4em;
			text-align: center;
			padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
			font-size: $x-font-size-sm;
			color: var(--color-text);
			background: var(--color-panel-header-fill);
			border-radius: 2px;

			&--edit {
				background: var(--color-pure);
				color: var(--color-primary);
			}
		}
	}
</style>

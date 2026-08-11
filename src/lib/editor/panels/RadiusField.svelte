<script lang="ts">
	import FieldRow from './FieldRow.svelte';
	import { commitFieldValue } from './field-commit.ts';
	import type { Api, ResolvedProperty } from 'manager';
	import type { FieldDef, FieldUpdate, RadiusKeys } from '$lib/plugins/types.js';

	// Same shape ArrangeField/ResizeField take -- passed down as a function so this component can
	// resolve source layer/kit/keys independently for its own key (border-radius) AND the
	// companion squircle-mode key, rather than the caller resolving just one.
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

	type RadiusFieldProps = {
		field: FieldDef; // must carry a populated radiusKeys (see box_categories' border-radius field)
		axisNameById?: Record<string, string>;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, axisNameById = {}, track, resolvedMap, api, onFieldUpdate }: RadiusFieldProps =
		$props();

	const info = $derived(track(field.key));
	const radiusKeys = $derived(field.radiusKeys as RadiusKeys);
	const RADIUS_STEP = 2;

	const radiusValue = $derived(parseFloat(resolvedMap.get(field.key)?.value ?? '0') || 0);
	const isSquircle = $derived(resolvedMap.get(radiusKeys.squircle.key)?.value === '1');
	// Absent on Text/Img's own radius field (see RadiusKeys.overflow's own doc, types.ts) -- no
	// children to clip there, so the toggle just doesn't render.
	const overflowField = $derived(radiusKeys.overflow);
	const isOverflowHidden = $derived(
		overflowField != null && resolvedMap.get(overflowField.key)?.value === 'hidden'
	);

	function nudgeRadius(delta: number) {
		const next = Math.max(0, radiusValue + delta);
		commitFieldValue(track(field.key), field.key, `${next}px`, { onFieldUpdate, api });
	}

	function toggleSquircle() {
		commitFieldValue(
			track(radiusKeys.squircle.key),
			radiusKeys.squircle.key,
			isSquircle ? '' : '1',
			{ onFieldUpdate, api }
		);
	}

	function toggleOverflow() {
		const key = overflowField?.key;
		if (!key) return;
		commitFieldValue(track(key), key, isOverflowHidden ? '' : 'hidden', { onFieldUpdate, api });
	}
</script>

<FieldRow
	label={field.displayText ?? field.key}
	track={{ kitIcon: info.kitIcon, keys: info.keys, conditionValues: info.conditionValues }}
	{axisNameById}
	trackAriaLabel="Radius source"
>
	{#snippet valueSlot()}
		<span class="radius-field__current">
			{radiusValue}px
			<i class="fa-solid {isSquircle ? 'fa-shapes' : 'fa-square-full'}" title={isSquircle ? 'Squircle' : 'Circular'}
			></i>
			{#if overflowField && isOverflowHidden}
				<i class="fa-solid fa-eye-slash" title="Clips children (overflow: hidden)"></i>
			{/if}
		</span>
	{/snippet}

	{#snippet body()}
		<div class="radius-field__row">
			<div class="radius-stepper">
				<button
					type="button"
					class="radius-stepper__btn"
					title="Decrease"
					onclick={() => nudgeRadius(-RADIUS_STEP)}
				>
					<i class="fa-solid fa-minus"></i>
				</button>
				<span class="radius-stepper__value">{radiusValue}</span>
				<button
					type="button"
					class="radius-stepper__btn"
					title="Increase"
					onclick={() => nudgeRadius(RADIUS_STEP)}
				>
					<i class="fa-solid fa-plus"></i>
				</button>
			</div>

			<button
				type="button"
				class="radius-toggle"
				class:radius-toggle--sel={isSquircle}
				title={isSquircle ? 'Squircle corners (click for circular)' : 'Circular corners (click for squircle)'}
				aria-pressed={isSquircle}
				onclick={toggleSquircle}
			>
				<i class="fa-solid {isSquircle ? 'fa-shapes' : 'fa-square-full'}"></i>
			</button>

			{#if overflowField}
				<button
					type="button"
					class="radius-toggle"
					class:radius-toggle--sel={isOverflowHidden}
					title={isOverflowHidden
						? 'Clips children to this shape (click to let them overflow)'
						: 'Children can overflow this shape (click to clip them)'}
					aria-pressed={isOverflowHidden}
					onclick={toggleOverflow}
				>
					<i class="fa-solid {isOverflowHidden ? 'fa-eye-slash' : 'fa-eye'}"></i>
				</button>
			{/if}
		</div>
	{/snippet}
</FieldRow>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
		cursor: pointer;
	}

	.radius-field__current {
		display: inline-flex;
		align-items: center;
		gap: calc($x-space-xs / 2);
		font-size: $x-font-size-sm;
		color: var(--color-add-var-text);
	}

	.radius-field__row {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		padding-block: $x-space-xs;
	}

	.radius-stepper {
		display: inline-flex;
		align-items: stretch;
		flex-shrink: 0;
		border-radius: 2px;
		overflow: hidden;
		background: var(--color-panel-header-fill);

		&__btn {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
			color: var(--color-add-var-text);

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}
		}

		&__value {
			min-width: 1.6em;
			text-align: center;
			padding: calc($x-space-xs / 2) calc($x-space-xs / 2);
			font-size: $x-font-size-sm;
			color: var(--color-text);
		}
	}

	.radius-toggle {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: 0 0 auto;
		padding: calc($x-space-xs / 2) $x-space-xs;
		border-radius: 2px;
		font-size: $x-font-size-sm;
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
</style>

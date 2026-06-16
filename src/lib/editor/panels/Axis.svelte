<script lang="ts" module>
	export type AxisMode = 'categorical' | 'range' | 'discrete';

	export type AxisArgValue =
		| { type: 'literal'; value: string }
		| { type: 'range'; min: number | null; max: number | null };

	export type AxisValueOption =
		| { type: 'literal'; value: string }
		| { type: 'range'; operator: string; threshold: number; threshold_high?: number }
		| { type: 'discrete'; value: string };

	export type AxisProps = {
		axisId: string;
		axisName: string;
		axisDescription?: string;
		kind: AxisMode;
		values: AxisValueOption[];
		currentArg: AxisArgValue | null;
		disabled?: boolean;
		onArgChange: (arg: AxisArgValue | null) => void;
	};
</script>

<script lang="ts">
	import RangeSlider from '$lib/components/RangeSlider.svelte';
	import { contextMenu } from '$lib/components/contextMenu';

	let {
		axisId,
		axisName,
		axisDescription,
		kind = 'categorical',
		values = [],
		currentArg,
		disabled = false,
		onArgChange
	}: AxisProps = $props();

	const axisContextMenu = [
		{
			name: 'custom axis',
			description: 'Connect state',
			displayText: 'Connect',
			icon: 'fa-solid fa-upload',
			onClick: () => {}
		},
		'hr',
		{
			name: 'custom axis',
			description: 'Mark as export',
			displayText: 'Expose',
			icon: 'fa-solid fa-tower-broadcast',
			onClick: () => {}
		}
	];

	function selectVariant(variantId: string) {
		if (disabled) return;
		if (currentArg?.type === 'literal' && currentArg.value === variantId) {
			onArgChange(null);
		} else {
			onArgChange({ type: 'literal', value: variantId });
		}
	}

	function handleRangeChange(min: number | null, max: number | null) {
		if (disabled) return;
		onArgChange({ type: 'range', min, max });
	}

	function handleDiscreteInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (value === '') {
			onArgChange(null);
		} else {
			onArgChange({ type: 'literal', value });
		}
	}

	let rangeThresholds = $derived(
		values
			.filter((v): v is { type: 'range'; operator: string; threshold: number; threshold_high?: number } => v.type === 'range')
			.map((v) => ({ value: v.threshold, label: `${v.operator} ${v.threshold}` }))
	);

	let rangeMin = $derived(
		currentArg?.type === 'range' ? currentArg.min : null
	);

	let rangeMax = $derived(
		currentArg?.type === 'range' ? currentArg.max : null
	);

	let displayValue = $derived.by(() => {
		if (!currentArg) return 'Not set';
		if (currentArg.type === 'literal') return currentArg.value;
		if (currentArg.type === 'range') {
			const min = currentArg.min == null ? '-∞' : String(currentArg.min);
			const max = currentArg.max == null ? '+∞' : String(currentArg.max);
			return `${min} ↔ ${max}`;
		}
		return 'Not set';
	});

	let isSet = $derived(currentArg !== null);

	let categoricalValues = $derived(
		values.filter((v): v is { type: 'literal'; value: string } => v.type === 'literal')
	);
</script>

<details class="axis">
	<summary title={axisDescription} class="axis__name" use:contextMenu={axisContextMenu}>
		<h3>{axisName}</h3>
		<div class="axis__name__value" class:axis__name__value--unset={!isSet}>
			{displayValue}
		</div>
		<i class="fa-solid fa-angle-down axis__name__collapse-icon"></i>
	</summary>

	<div class="axis__content">
		{#if kind === 'categorical'}
			<ul class="axis__variants">
				{#each categoricalValues as variant}
					{@const variantId = variant.value}
					<li>
						<label
							class="axis-field"
							class:axis-field--selected={currentArg?.type === 'literal' && currentArg.value === variantId}
						>
							<input
								class="axis-field__radio"
								type="radio"
								name="axis-{axisId}"
								value={variantId}
								checked={currentArg?.type === 'literal' && currentArg.value === variantId}
								onchange={() => selectVariant(variantId)}
								{disabled}
							/>
							<span class="axis-field__name">{variant.value}</span>
						</label>
					</li>
				{/each}
			</ul>
		{:else if kind === 'range'}
			<div class="axis__range">
				<RangeSlider
					min={rangeMin}
					max={rangeMax}
					thresholds={rangeThresholds}
					{disabled}
					onChange={handleRangeChange}
				/>
			</div>
		{:else if kind === 'discrete'}
			<div class="axis__discrete">
				<input
					class="axis__discrete-input"
					type="text"
					placeholder="Enter value…"
					value={currentArg?.type === 'literal' ? currentArg.value : ''}
					oninput={handleDiscreteInput}
					{disabled}
				/>
			</div>
		{/if}
	</div>
</details>

<style lang="scss">
	@use '_index' as *;

	.axis {
		position: relative;
		user-select: none;

		&[open] {
			.axis__name__collapse-icon {
				rotate: -180deg;
			}

			.axis__name__value {
				opacity: 0;
			}
		}

		&:not([open]) {
			.axis__name:hover {
				background: var(--color-surface-alt);
			}
		}

		&__name {
			display: grid;
			grid-template-rows: 1fr;
			grid-template-columns: 1fr 1fr max-content;
			justify-content: space-between;
			align-items: center;
			padding-inline: $x-space-sm;
			cursor: pointer;
			font-size: $x-font-size-xs;
			gap: $x-space-sm;
			color: var(--color-pure-alt);

			h3 {
				grid-area: 1 / 1 / 1 / 2;
				text-transform: uppercase;
				@include fonts-stack('Satoshi-Bold', sans);
				padding-block: calc($x-space-xs / 2);
			}

			&__value {
				padding-inline: $x-space-sm;
				grid-area: 1 / 2 / 1 / 3;
				min-width: 2rem;
				font-size: $x-font-size-md;
				font-weight: 800;
				@include fonts-stack('Satoshi-Regular', sans);
				color: var(--color-primary);
				border: 1px solid var(--color-surface-alt);
				background: var(--color-surface-alt);
				text-transform: capitalize;
				border-radius: calc($x-space-xs / 2);

				&--unset {
					color: var(--color-text-muted);
					border: 1px solid var(--color-panel-header-fill);
					background: var(--color-panel-header-fill);
				}
			}

			&__collapse-icon {
				transition: rotate 200ms ease-out;
				rotate: -360deg;
			}
		}

		&__content {
			padding-inline: $x-space-sm;
		}

		&__variants {
			list-style-type: none;
			@include layout-flex-column();
		}

		&__range {
			padding: $x-space-xs 0;
		}

		&__discrete {
			padding: $x-space-xs 0;

			&-input {
				width: 100%;
				padding: $x-space-xs $x-space-sm;
				border: 1px solid var(--color-surface-alt);
				border-radius: calc($x-space-xs / 2);
				background: var(--color-bg);
				color: var(--color-text);
				font-size: $x-font-size-md;
				@include fonts-stack('Satoshi-Regular', sans);

				&:focus {
					border-color: var(--color-primary);
					outline: none;
				}
			}
		}
	}

	.axis-field {
		display: flex;
		flex-direction: row;
		gap: $x-space-xs;
		font-weight: 600;
		padding-block: calc($x-space-xs / 4);
		padding-inline: $x-space-md;
		cursor: pointer;
		border-radius: calc($x-space-xs / 2);

		&:hover {
			background: var(--color-surface-alt);
		}

		&--selected {
			background: var(--color-surface-alt);

			.axis-field__name {
				color: var(--color-primary);
			}
		}

		&__radio {
			opacity: 0;
			position: absolute;
		}

		&__name {
			flex-grow: 1;
			padding-inline: $x-space-xs;
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-md;
			font-weight: 600;
			text-transform: capitalize;
			cursor: pointer;

			&:hover {
				color: var(--color-primary);
			}
		}
	}
</style>
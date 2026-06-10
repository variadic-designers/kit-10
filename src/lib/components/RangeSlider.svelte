<script lang="ts">
	type RangeSliderProps = {
		min?: number | null;
		max?: number | null;
		thresholds?: { value: number; label?: string }[];
		onChange?: (min: number | null, max: number | null) => void;
		disabled?: boolean;
	};

	let {
		min = null,
		max = null,
		thresholds = [],
		onChange,
		disabled = false
	}: RangeSliderProps = $props();

	let trackEl: HTMLElement | undefined = $state();

	let minVal = $state(min);
	let maxVal = $state(max);
	let dragging: 'min' | 'max' | null = $state(null);

	$effect(() => {
		if (!dragging) {
			minVal = min;
			maxVal = max;
		}
	});

	function allThresholds(): number[] {
		const ts = thresholds.map((t) => t.value);
		if (minVal != null) ts.push(minVal);
		if (maxVal != null) ts.push(maxVal);
		return ts;
	}

	let rangeMin = $derived(Math.min(...allThresholds(), 0));
	let rangeMax = $derived(Math.max(...allThresholds(), 100));

	let minPercent = $derived(
		minVal == null ? 0 : ((minVal - rangeMin) / (rangeMax - rangeMin)) * 100
	);
	let maxPercent = $derived(
		maxVal == null ? 100 : ((maxVal - rangeMin) / (rangeMax - rangeMin)) * 100
	);

	function handlePointerDown(thumb: 'min' | 'max', e: PointerEvent) {
		if (disabled) return;
		dragging = thumb;
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
	}

	function handlePointerMove(e: PointerEvent) {
		if (!dragging || !trackEl) return;
		const rect = trackEl.getBoundingClientRect();
		const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
		const raw = rangeMin + percent * (rangeMax - rangeMin);
		const snapped = snap(raw);

		if (dragging === 'min') {
			const newMin = maxVal != null ? Math.min(snapped, maxVal) : snapped;
			minVal = newMin;
		} else {
			const newMax = minVal != null ? Math.max(snapped, minVal) : snapped;
			maxVal = newMax;
		}
	}

	function handlePointerUp() {
		if (dragging) {
			onChange?.(minVal, maxVal);
			dragging = null;
		}
	}

	function snap(value: number): number {
		if (thresholds.length === 0) return Math.round(value);
		let closest = value;
		let minDist = Infinity;
		for (const t of thresholds) {
			const d = Math.abs(value - t.value);
			if (d < minDist) {
				minDist = d;
				closest = t.value;
			}
		}
		return minDist < (rangeMax - rangeMin) * 0.05 ? closest : Math.round(value);
	}

	function resetMin() {
		if (disabled) return;
		minVal = null;
		onChange?.(minVal, maxVal);
	}

	function resetMax() {
		if (disabled) return;
		maxVal = null;
		onChange?.(minVal, maxVal);
	}

	function formatVal(v: number | null): string {
		if (v == null) return '∞';
		return Number.isInteger(v) ? v.toString() : v.toFixed(1);
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="range-slider" class:disabled>
	<div
		class="range-slider__track"
		bind:this={trackEl}
		onpointermove={handlePointerMove}
		onpointerup={handlePointerUp}
		role="group"
		aria-label="Range slider"
	>
		<div class="range-slider__fill" style="left: {minPercent}%; right: {100 - maxPercent}%"></div>

		{#each thresholds as t}
			<div
				class="range-slider__tick"
				style="left: {((t.value - rangeMin) / (rangeMax - rangeMin)) * 100}%"
				title={t.label ?? String(t.value)}
			></div>
		{/each}

		<!-- Min thumb -->
		<div
			class="range-slider__thumb range-slider__thumb--min"
			class:range-slider__thumb--active={dragging === 'min'}
			class:range-slider__thumb--infinity={minVal == null}
			style="left: {minPercent}%"
			onpointerdown={(e) => handlePointerDown('min', e)}
			role="slider"
			aria-label="Minimum"
			aria-valuemin={rangeMin}
			aria-valuemax={rangeMax}
			aria-valuenow={minVal ?? rangeMin}
			tabindex={disabled ? -1 : 0}
		>
			<span class="range-slider__label">{formatVal(minVal)}</span>
		</div>

		<!-- Max thumb -->
		<div
			class="range-slider__thumb range-slider__thumb--max"
			class:range-slider__thumb--active={dragging === 'max'}
			class:range-slider__thumb--infinity={maxVal == null}
			style="left: {maxPercent}%"
			onpointerdown={(e) => handlePointerDown('max', e)}
			role="slider"
			aria-label="Maximum"
			aria-valuemin={rangeMin}
			aria-valuemax={rangeMax}
			aria-valuenow={maxVal ?? rangeMax}
			tabindex={disabled ? -1 : 0}
		>
			<span class="range-slider__label">{formatVal(maxVal)}</span>
		</div>
	</div>

	<div class="range-slider__controls">
		<button class="range-slider__reset" onclick={resetMin} disabled={disabled} title="Reset min to -∞">
			Min: {formatVal(minVal)}
		</button>
		<button class="range-slider__reset" onclick={resetMax} disabled={disabled} title="Reset max to +∞">
			Max: {formatVal(maxVal)}
		</button>
	</div>
</div>

<style lang="scss">
	.range-slider {
		position: relative;
		user-select: none;
		padding: 1rem 0 0.5rem;

		&.disabled {
			opacity: 0.5;
			pointer-events: none;
		}

		&__track {
			position: relative;
			height: 6px;
			background: var(--color-surface-alt, #e5e5e5);
			border-radius: 3px;
			cursor: pointer;
		}

		&__fill {
			position: absolute;
			top: 0;
			bottom: 0;
			background: var(--color-primary, #3b82f6);
			border-radius: 3px;
		}

		&__tick {
			position: absolute;
			top: -2px;
			width: 2px;
			height: 10px;
			background: var(--color-text-muted, #999);
			transform: translateX(-1px);
		}

		&__thumb {
			position: absolute;
			top: 50%;
			width: 18px;
			height: 18px;
			border-radius: 50%;
			background: var(--color-primary, #3b82f6);
			border: 2px solid var(--color-bg, #fff);
			transform: translate(-50%, -50%);
			cursor: grab;
			transition: box-shadow 100ms ease;
			touch-action: none;

			&:focus-visible {
				box-shadow: 0 0 0 3px var(--color-primary-hover, #60a5fa);
				outline: none;
			}

			&--active {
				cursor: grabbing;
				box-shadow: 0 0 0 3px var(--color-primary-hover, #60a5fa);
			}

			&--infinity {
				background: var(--color-text-muted, #999);
				border-style: dashed;
			}
		}

		&__label {
			position: absolute;
			top: -1.4rem;
			left: 50%;
			transform: translateX(-50%);
			font-size: 0.7rem;
			font-weight: 600;
			color: var(--color-text, #333);
			white-space: nowrap;
			pointer-events: none;
		}

		&__controls {
			display: flex;
			justify-content: space-between;
			margin-top: 0.25rem;
		}

		&__reset {
			font-size: 0.65rem;
			padding: 2px 6px;
			border: 1px solid var(--color-surface-alt, #e5e5e5);
			border-radius: 3px;
			background: var(--color-bg, #fff);
			color: var(--color-text-muted, #999);
			cursor: pointer;

			&:hover {
				border-color: var(--color-primary, #3b82f6);
				color: var(--color-primary, #3b82f6);
			}

			&:disabled {
				opacity: 0.5;
				cursor: default;
			}
		}
	}
</style>
<script lang="ts">
	// The one shared color swatch: left half the true color at full opacity, right half the color
	// exactly as authored (with its real alpha) over a checkerboard, so transparency reads at a
	// glance without opening a picker. Used by the Render panel's ColorField (collapsed picker
	// state) and the Tokens panel's color-token value box, so a color reads identically in both.
	import { parseCssColorToOklch, formatOklch } from '$lib/color/oklch.js';

	type ColorSwatchProps = {
		// The raw CSS color string (any form parseCssColorToOklch accepts: oklch/oklab/hex/rgb/hsl).
		value: string | null;
	};

	let { value }: ColorSwatchProps = $props();

	// Unparseable input falls back to mid-gray rather than an empty box -- same neutral the
	// ColorField picker itself starts from.
	const FALLBACK = { l: 0.5, c: 0, h: 0, alpha: 1 };

	const parsed = $derived(parseCssColorToOklch(value) ?? FALLBACK);
	const opaque = $derived(formatOklch(parsed.l, parsed.c, parsed.h, 1));
	const authored = $derived(formatOklch(parsed.l, parsed.c, parsed.h, parsed.alpha));
</script>

<span class="color-swatch" aria-hidden="true">
	<span class="color-swatch__half" style="background: {opaque}"></span>
	<span class="color-swatch__half color-swatch__half--checker">
		<span class="color-swatch__fill" style="background: {authored}"></span>
	</span>
</span>

<style lang="scss">
	@use '_index' as *;

	.color-swatch {
		display: flex;
		width: 100%;
		min-width: 2.4em;
		height: 1.3em;
		border-radius: 3px;
		overflow: hidden;
		border: 1px solid var(--color-panel-header-border);
	}

	.color-swatch__half {
		position: relative;
		flex: 1;
		height: 100%;

		&--checker {
			background-image:
				linear-gradient(45deg, var(--color-panel-header-border) 25%, transparent 25%),
				linear-gradient(-45deg, var(--color-panel-header-border) 25%, transparent 25%),
				linear-gradient(45deg, transparent 75%, var(--color-panel-header-border) 75%),
				linear-gradient(-45deg, transparent 75%, var(--color-panel-header-border) 75%);
			background-size: 8px 8px;
			background-position:
				0 0,
				0 4px,
				4px -4px,
				-4px 0;
		}
	}

	.color-swatch__fill {
		position: absolute;
		inset: 0;
	}
</style>

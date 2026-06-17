<script lang="ts">
	import { type Theme, theme, updateTheme } from '../theming.ts';
	import type { AriaChecked } from '../types/aria.ts';

	import { page } from '$app/state';

	type ThreeStateProps = {
		onTrue?: () => void;
		onFalse?: () => void;
		onMixed?: () => void;
		decideMode?: (ariaChecked: AriaChecked) => AriaChecked;
		ariaChecked?: AriaChecked;
	};

	const defaultDecideMode = (ariaChecked: AriaChecked): AriaChecked => {
		if (ariaChecked === 'true') {
			return 'false';
		} else if (ariaChecked === 'false') {
			return 'mixed';
		} else {
			return 'true';
		}
	};
	function getAriaChecked(theme: string | null): AriaChecked {
		switch (theme) {
			case null:
				return 'mixed';
			case 'dark':
				return 'true';
			case 'light':
				return 'false';
			case 'mixed':
			default:
				return 'mixed';
		}
	}

	const ariaChecked = $derived.by(() => getAriaChecked($theme));

	const {
		onTrue = () => {
			updateTheme('dark');
		},
		onMixed = () => {
			updateTheme();
		},
		onFalse = () => {
			updateTheme('light');
		},
		decideMode = defaultDecideMode
	}: ThreeStateProps = $props();

	const onclick = () => {
		const newChecked = decideMode(ariaChecked);

		if (newChecked === 'true') {
			onFalse?.();
		} else if (newChecked === 'false') {
			onMixed?.();
		} else {
			onTrue?.();
		}
	};

	let dataNoJs = $state(true);

	$effect(() => {
		dataNoJs = false;
	});

	const disabledJavascriptNotice = 'Your Javascript may be disabled. Enable JS for functionality';
</script>

<button
	class="darkmode"
	role="switch"
	aria-label="label"
	aria-disabled="false"
	aria-checked={ariaChecked}
	data-no-js={dataNoJs}
	title={dataNoJs ? disabledJavascriptNotice : undefined}
	{onclick}
>
	<i
		class="fa-solid fa-{ariaChecked === 'mixed'
			? 'circle-half-stroke'
			: ariaChecked === 'true'
				? 'moon'
				: 'sun'}"
	></i>
</button>

<style lang="scss">
	@use '_index' as *;

	.darkmode {
		// height: $x-space-xl;
		aspect-ratio: 1;
		background: transparent;
		border: unset;

		i {
			font-size: $x-font-size-xl;
			color: var(--color-text);
		}

		/*
		&[aria-checked='mixed'] {
			@include theming-colored-svg-mask('/auto.svg', var(--color-text), $x-font-size-2xl);
		}
		&[aria-checked='true'] {
			@include theming-colored-svg-mask('/dark_mode.svg', var(--color-text), $x-font-size-2xl);
		}
		&[aria-checked='false'] {
			@include theming-colored-svg-mask('/bright.svg', var(--color-text), $x-font-size-2xl);
		}
    */
	}
</style>

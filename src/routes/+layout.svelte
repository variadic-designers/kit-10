<script>
	import { page } from '$app/state';

	import { initializeTheme, getTheme } from '../lib/theming.ts';
	import { initializeReducedMotion } from '../lib/reduced-motion.ts';

	let { children } = $props();

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
	});

	/* Default font */
	import '$fonts/Satoshi/Satoshi.css';
</script>

{#key getTheme()}
	{@render children()}
{/key}

<style lang="scss" global>
	@use '_index' as i;
	@use 'zero' as *;

	@include i.input-links();
</style>

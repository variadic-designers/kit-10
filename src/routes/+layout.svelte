<script>
	import { page } from '$app/state';
	import { locales, localizeHref } from '$lib/paraglide/runtime';

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
	<!-- {#each locales as locale} -->
	<!-- 	<a href={localizeHref(page.url.pathname, { locale })}> -->
	<!-- 		{locale} -->
	<!-- 	</a> -->
	<!-- {/each} -->
{/key}

<style lang="scss" global>
	@use '_index' as i;
	@use 'zero' as *;

	@include i.input-links();
</style>

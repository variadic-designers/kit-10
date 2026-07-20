<script>
	import { onNavigate } from '$app/navigation';
	import { page } from '$app/state';

	import { initializeTheme, getTheme } from '../lib/theming.ts';
	import { initializeReducedMotion, getReducedMotion } from '../lib/reduced-motion.ts';

	let { children } = $props();

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
	});

	onNavigate((navigation) => {
		if (!document.startViewTransition) return;

		const reduced = getReducedMotion();
		if (reduced === 'reduce') return;
		if (reduced === 'auto' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		return new Promise((resolve) => {
			document.startViewTransition(async () => {
				resolve();
				await navigation.complete;
			});
		});
	});

	/* Default font */
	import '$fonts/Satoshi/Satoshi.css';

	/* Font Awesome, self-hosted (was cdnjs.cloudflare.com). Imported here in the root layout so
	   Vite bundles the CSS + its webfonts same-origin and SvelteKit hoists the stylesheet into the
	   SSR'd <head> on every route -- present before first paint on both full loads and client-side
	   navigations, which is the late-icon problem the old app.html <link> was placed to avoid. */
	import '@fortawesome/fontawesome-free/css/all.min.css';
</script>

{#key getTheme()}
	{@render children()}
{/key}

<style lang="scss" global>
	@use '_index' as i;
	@use 'zero' as *;

	@include i.input-links();
</style>

<script lang="ts">
	import { onMount, type Component } from 'svelte';
	import { getTheme } from '$lib/theming.js';

	// Dynamic + onMount-gated so the editor's client-only stack (PGlite, Vellum WASM,
	// Charter WASM) never enters the server's static module graph -- a top-level import
	// here gets bundled into the server chunk regardless of the route's `ssr` setting.
	let EditorComponent: Component | undefined = $state();

	onMount(async () => {
		EditorComponent = (await import('$lib/editor/Editor.svelte')).default;
	});
</script>

{#if EditorComponent}
	<EditorComponent />
{:else}
	<!-- Themed placeholder for the gap between navigating here and the dynamic import above
	     resolving. Without this, the route renders nothing at all for that gap -- and since
	     `onNavigate`'s view transition (root +layout.svelte) captures its "new page" snapshot
	     right after SvelteKit's own navigation settles (not after this component's onMount
	     finishes), that blank gap is exactly what got captured: a flash of nothing, with no
	     `kit10-logo`-named element present yet for the landing hero glyph to morph into. This
	     mirrors Viewport.svelte's own `.logo-overlay::after` glyph (same clip-path + gradient),
	     tagged with the same view-transition-name, so first paint here already has the correct
	     themed background and the transition has a real target the instant it starts.

	     `--color-*` custom properties (_theming.scss) only exist inside an element carrying
	     `data-prefers-color-scheme` (+ `data-compel-color-scheme` for the SSR-cookie-resolved,
	     no-flicker path -- see theming.ts) - Layout.svelte's #kit10, +page.svelte's #landing,
	     store/+page.svelte's #store all set this. This placeholder renders *before* any of
	     those exist (Layout.svelte is nested inside the not-yet-loaded EditorComponent), so it
	     needs the same two attributes itself or `var(--color-bg)` below resolves to nothing. -->
	<div class="edit-loading" data-prefers-color-scheme data-compel-color-scheme={getTheme()}>
		<svg width="0" height="0" style="position:absolute">
			<defs>
				<clipPath id="logoClip" clipPathUnits="objectBoundingBox">
					<path d="M1,0.5c0,0.276-0.171,0.5-0.382,0.5V0.934C0.618,0.694,0.766,0.5,0.95,0.5Z" />
					<path
						d="M0.618,0.934V1c-0.211,0-0.382-0.224-0.382-0.5h0.05C0.469,0.5,0.618,0.694,0.618,0.934Z"
					/>
					<path
						d="M0.618,0V0.065C0.618,0.305,0.469,0.5,0.285,0.5H0.235C0.235,0.224,0.406,0,0.618,0Z"
					/>
					<path d="M1,0.5H0.95C0.766,0.5,0.618,0.305,0.618,0.065V0C0.829,0,1,0.224,1,0.5Z" />
					<path d="M0.236,0V0.691A0.236,0.309,0,0,1,0,1V0.309A0.236,0.309,0,0,1,0.236,0Z" />
				</clipPath>
			</defs>
		</svg>
		<div class="edit-loading__glyph"></div>
	</div>
{/if}

<style lang="scss">
	.edit-loading {
		position: fixed;
		inset: 0;
		display: grid;
		place-items: center;
		background: var(--color-bg);
	}

	.edit-loading__glyph {
		view-transition-name: kit10-logo;
		clip-path: url(#logoClip);
		width: min(50%, 12rem);
		aspect-ratio: 622.31 / 476;
		background: radial-gradient(circle, oklch(80.9% 0.0956 251.8) 30%, oklch(62.3% 0.188 259.8) 65%, var(--color-bg) 10%);
		background-size: 200% 200%;
		animation: walk-background 5s ease-in-out infinite;
	}

	@keyframes walk-background {
		0% {
			background-position: -140% 0%;
		}
		25% {
			background-position: -150% 60%;
		}
		50% {
			background-position: 80% 150%;
		}
		75% {
			background-position: -80% 150%;
		}
		88% {
			background-position: -100% -100%;
		}
		100% {
			background-position: -140% 0%;
		}
	}
</style>

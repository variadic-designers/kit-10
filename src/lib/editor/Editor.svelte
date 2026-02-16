<script lang="ts">
	import ContextMenu from '$lib/editor/ContextMenu.svelte';

	import { writable } from 'svelte/store';

	import { getTheme } from '$lib/theming.ts';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import { contextMenu } from '$lib/components/contextMenu.ts';
	import type { Kit10ProjectEditor } from '$lib/types.ts';

	import type { ComponentView } from '$lib/editor/Component.svelte';

	const project: Kit10ProjectEditor = $props();

	let { title, description, kits, kitViews, tokens, tokenLibraries, selectedLayer, viewPortFocus } =
		$state(project);

	let offsetX = writable(viewPortFocus?.x ?? 0);
	let offsetY = writable(viewPortFocus?.y ?? 0);

	$effect(() => {
		const viewport = document.getElementById('canvas');

		if (viewport && !viewPortFocus) {
			offsetX.set(viewport.clientWidth / 2);
			offsetY.set(viewport.clientHeight / 2);
		}
	});

	const selectedKit: ComponentView | undefined = $derived.by(() => {
		// Recursive helper to find a ComponentView with selected = 'primary'
		function findPrimary(view: ComponentView): ComponentView | null {
			if (view.selected === 'primary') return view;

			if (view.primitive?.kind === 'container') {
				for (const child of view.primitive.children) {
					const found = findPrimary(child);
					if (found) return found;
				}
			}

			return null;
		}

		for (const view of kitViews) {
			const found = findPrimary(view);
			if (found) return found;
		}
	});

	const selectedKitCascadeResult: MultiCascadeResult | undefined = $derived.by(() => {
		if (selectedKit) {
			// return resolve(kits[selectedKit.source_index].sets, selectedKit.params);
			return resolveMany(
				selectedKit.resolve.map((r) => kits[r.source_index].sets),
				selectedKit.resolve.map((r) => r.params)
			);
		}
	});

	import Viewport from './Viewport.svelte';

	const navContextMenu = [
		{
			name: 'donation',
			displayText: 'Donate',
			icon: 'fa-solid fa-gift',
			onClick: () => ({
				link: 'https://ko-fi.com/yorqat',
				tab: '_blank'
			})
		}
	];

	import ViewsPanel from './panels/Views.svelte';
	import StylesPanel from './panels/Styles.svelte';
	import TokensPanel from './panels/Variables.svelte';
	import AxesPanel from './panels/Axes.svelte';
	import ProjectPanel from './panels/Project.svelte';
	import ComposePanel from './panels/Compose.svelte';
	import { resolveMany, type MultiCascadeResult } from '$lib/cascadeAxesMap.ts';
	// import { resolve, type CascadeResult } from '$lib/cascadeAxesMap.ts';
</script>

<svelte:head>
	<title>{title} — Kit10</title>
	<meta name="description" content="A Goated Web Design Editor" />

	<link
		rel="stylesheet"
		href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css"
	/>
</svelte:head>

<div id="ui-kitten" data-prefers-color-scheme data-compel-color-scheme={getTheme()}>
	<ContextMenu />

	<div id="nav" use:contextMenu={navContextMenu}>
		<heading>
			<a class="branding" href="#s">
				<!-- {@render logo()} -->
				<!-- KIT•10 -->
				<img src="/favicon.svg" alt="kit10 logo" />
			</a>
		</heading>

		<div class="quick-preferences">
			<DarkModeToggle />
			<div class="pfp">
				<img src="https://cataas.com/cat/closeup" alt="user profile" />
			</div>
		</div>
	</div>

	<Viewport {offsetX} {offsetY} bind:kits bind:kitViews />

	<aside class="management scroll-scheme">
		<ViewsPanel bind:kits bind:kitViews {selectedKit} />
		<ComposePanel bind:kits {selectedKit} />
		<AxesPanel bind:kits bind:kitViews {selectedKit} {selectedKitCascadeResult} />
	</aside>

	<aside class="logical-mapper scroll-scheme"></aside>

	<aside class="configurable scroll-scheme">
		<ProjectPanel />
		<StylesPanel bind:kits bind:kitViews {selectedKit} {selectedKitCascadeResult} />
		<TokensPanel bind:kits bind:kitViews {selectedKit} bind:tokens bind:tokenLibraries />
	</aside>
</div>

{#snippet logo()}
	<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 646 474">
		<defs>
			<style>
				.cls-1 {
					fill: var(--color-pure-alt);
				}

				.cls-2 {
					fill: var(--color-text-muted);
				}
			</style>
		</defs>
		<g id="Layer_2" data-name="Layer 2">
			<g id="Light_Mode_Lite" data-name="Light Mode Lite">
				<path
					class="cls-1"
					d="M384.71,0H401a0,0,0,0,1,0,0V40.44A204.56,204.56,0,0,1,196.44,245H156a0,0,0,0,1,0,0V228.71A228.71,228.71,0,0,1,384.71,0Z"
				/>
				<path
					class="cls-1"
					d="M156,0h0a0,0,0,0,1,0,0V318A156,156,0,0,1,0,474H0a0,0,0,0,1,0,0V156A156,156,0,0,1,156,0Z"
				/>
				<path
					class="cls-1"
					d="M156,245.29h40.44A204.56,204.56,0,0,1,401,449.85V474a0,0,0,0,1,0,0H384.71A228.71,228.71,0,0,1,156,245.29v0A0,0,0,0,1,156,245.29Z"
				/>
				<path
					class="cls-2"
					d="M401,0h40.44A204.56,204.56,0,0,1,646,204.56V245a0,0,0,0,1,0,0H629.71A228.71,228.71,0,0,1,401,16.29V0A0,0,0,0,1,401,0Z"
					transform="translate(1047 245) rotate(180)"
				/>
				<path
					class="cls-2"
					d="M629.71,245.29H646a0,0,0,0,1,0,0v24.15A204.56,204.56,0,0,1,441.44,474H401a0,0,0,0,1,0,0v0A228.71,228.71,0,0,1,629.71,245.29Z"
					transform="translate(1047 719.29) rotate(-180)"
				/>
			</g>
		</g>
	</svg>
{/snippet}

{#snippet styleD()}
	<style lang="scss">
		@use '_index' as *;
		@use 'style' as *;

		$light: (
			pure: '#FFF',
			pure-alt: '#000',
			bg: '#ddd',
			text: '#3f3a3a',
			text-muted: '#606a78',
			surface: '#f1f1f1',
			surface-alt: '#dedede',

			add-var-bg: '#f1f1f1',
			add-var-border: 1px solid #dedede,
			add-var-text: '#3f3a3a',

			diamond-border--tracked: '#3f3a3a',
			diamond-border--tracked--empty: '#3f3a3a',
			diamond-color--tracked--empty: '#f1f1f1',

			diamond-border--untracked: '#3f3a3a',
			diamond-color--untracked: '#dedede',

			panel-header-border: '#E5E5E5',
			panel-header-fill: '#FAFAFA'
		);

		$dark: (
			pure: '#000',
			pure-alt: '#FFF',
			bg: '#121212',
			surface: '#1f1f1f',
			surface-alt: '#2f2f2f',
			text: '#dcdcdc',

			add-var-bg: '#111',
			add-var-border: 1px solid #000,
			add-var-text: '#f1f1f1',

			panel-header-border: '#000',
			panel-header-fill: '#0f0f0f',

			diamond-border--tracked: '#000',
			diamond-color--tracked--empty: '#f1f1f1',
			diamond-border--tracked--empty: '#2f2f2f',

			diamond-border--untracked: '#f1f1f1',
			diamond-color--untracked: '#3f3a3a'
		);

		@include theming-declare-schemes-basic($light, $dark);
		@include theming-impose-schemes-basic();
		@include theming-impose-scroll-scheme();

		#ui-kitten {
			/*
		cursor:
			url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 24 24'>\
<path fill='lightskyblue' stroke='%23000' stroke-width='1.4' \
d='M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85L6.35 2.85a.5.5 0 0 0-.85.35Z'/>\
</svg>")
				6 6,
			auto;
      */

			.pfp {
				height: $x-font-size-2xl;
				aspect-ratio: 1;
				position: relative;

				&::after {
					background: var(--color-success);
					content: '';
					height: $x-space-sm;
					aspect-ratio: 1;
					position: absolute;
					bottom: -4px;
					border-radius: 100%;
					border: 3px solid var(--color-pure);
					right: -8px;
				}

				img {
					// border: 2px solid var(--color-pure-alt);
					border-radius: 50%;
					width: 100%;
					height: 100%;
					object-fit: cover;
					background: var(--color-pure);
					background:
						radial-gradient(closest-side, var(--color-surface-alt) 90%, transparent 100%) 0 0/ 3px
							3px,
						var(--color-pure); /* Base color */
				}
			}

			@include layout-viewport-full-height-lockdown();
			/*
    :not(.canvas-container) {
      transition: 
      background 1500ms ease-out,
      color 1200ms ease-out,
      border-color 800ms ease-out,
      ;
    }
    */
			color: var(--color-text);

			@include layout-respond-max('lg') {
				display: grid;
				grid-template-columns: 1fr 0;
				grid-template-rows: max-content 3fr 3fr;

				.logical-mapper {
					display: none;
				}
			}

			@include layout-respond('lg') {
				display: grid;
				grid-template-columns: 1fr 3fr 1fr;
				grid-template-rows: 1fr 16fr $x-space-md;
				grid-column-gap: 0px;
				grid-row-gap: 0px;
				// padding: $x-space-sm;
			}

			@include layout-respond('xl') {
				grid-template-columns: 1.2fr 3fr 1.2fr;
			}
		}

		#nav {
			background-color: var(--color-panel-header-fill);
			/*
			background:
				radial-gradient(closest-side, var(--color-panel-header) 90%, transparent 100%) 0 0/ 3px 3px,
				var(--color-surface);
      */
			border-bottom: 1px solid var(--color-surface);

			display: flex;
			align-items: center;
			justify-content: space-between;

			.branding {
				display: flex;
				gap: $x-space-sm;
				padding-inline: $x-space-sm;
				align-items: center;

				aspect-ratio: 1;

				img {
					height: $x-font-size-xl;
				}

				@include layout-respond-max('lg') {
					font-size: $x-font-size-md;
					padding-left: $x-font-size-md;
				}
			}

			.quick-preferences {
				display: flex;
				align-items: center;
				gap: $x-space-sm;
				height: 100%;
				padding-inline: $x-space-md;
			}

			@include layout-respond-max('lg') {
				grid-area: 1 / 1 / 2 / 3;
			}

			@include layout-respond('lg') {
				grid-area: 1 / 1 / 2 / 4;
			}
		}

		.logical-mapper,
		.management,
		.configurable {
			overflow-y: auto;
			scrollbar-width: none;
			background-color: var(--color-bg);
			@include fonts-stack('Satoshi-Regular', sans);
			@include fonts-alternate-style();
			letter-spacing: 0.5px;

			background-color: var(--color-surface);
		}

		.management,
		.configurable {
			@include layout-flex-column();
			@include layout-respond('lg') {
				// gap: $x-space-xs;
			}

			@include layout-respond-max('lg') {
				gap: calc($x-space-xs / 2);
			}
		}

		.configurable {
			overflow-y: scroll;
		}

		.logical-mapper {
			@include layout-respond('lg') {
				grid-area: 3 / 2 / 3 / 3;
			}

			border-top: 2px solid var(--color-bg);
			border-left: 2px solid var(--color-bg);
			border-right: 2px solid var(--color-bg);
		}

		.management {
			@include layout-respond-max('lg') {
				grid-area: 3 / 1 / 4 / 2;
			}

			@include layout-respond('lg') {
				grid-area: 2 / 1 / 4 / 2;
			}
		}

		.configurable {
			@include layout-respond-max('lg') {
				grid-area: 3 / 2 / 4 / 3;
			}

			@include layout-respond('lg') {
				grid-area: 2 / 3 / 4 / 4;
			}
		}

		.attribute:has(input[type='checkbox']),
		.attribute:has(input[type='text']) {
			flex-direction: row;
			justify-content: space-between;
		}
	</style>
{/snippet}

{@render styleD()}

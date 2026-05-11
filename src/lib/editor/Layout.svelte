<script lang="ts" generics="T extends Record<string, any>">
	import { getTheme } from '$lib/theming.js';
	import { contextMenu } from '$lib/components/contextMenu.js';
	import ContextMenu from './ContextMenu.svelte';
	import type { ContextMenuContentGenerator } from './contextMenuStore.js';

	const navContextMenu: ContextMenuContentGenerator = () => {
		return [
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
	};

	import type { Snippet } from 'svelte';

	interface LayoutProps {
		state: T | undefined;
		management: Snippet<[T]>;
		unloadedDash: Snippet;
		dash: Snippet<[T]>;
		console: Snippet<[T]>;
		nav: Snippet<[T | undefined]>;
		configurable: Snippet<[T]>;
	}

	const {
		state,
		management,
		configurable,
		unloadedDash,
		dash,
		console,
		nav
	}: Partial<LayoutProps> = $props();
</script>

<svelte:head>
	<link
		rel="stylesheet"
		href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css"
	/>
</svelte:head>

<div id="kit10" data-prefers-color-scheme data-compel-color-scheme={getTheme()}>
	<ContextMenu />

	<div id="nav" use:contextMenu={navContextMenu}>
		{@render nav?.(state)}
	</div>

	<main class="dash">
		{#if state}
			{@render dash?.(state)}
		{:else}
			{@render unloadedDash?.()}
		{/if}
	</main>

	<aside class="management scroll-scheme" class:loaded={!!state}>
		{#if state}
			{@render management?.(state)}
		{/if}
	</aside>

	<aside class="console scroll-scheme" class:loaded={!!state}>
		{#if state}
			{@render console?.(state)}
		{/if}
	</aside>

	<aside class="configurable scroll-scheme" class:loaded={!!state}>
		{#if state}
			{@render configurable?.(state)}
		{/if}
	</aside>
</div>

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

		#kit10 {
			user-select: none;
			background-color: var(--color-bg);
			/*
		cursor:
			url("data:image/svg+xml;utf8,\
<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewbox='0 0 24 24'>\
<path fill='lightskyblue' stroke='%23000' stroke-width='1.4' \
d='m5.5 3.21v20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87a.5.5 0 0 0 .35-.85l6.35 2.85a.5.5 0 0 0-.85.35z'/>\
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
						var(--color-pure); /* base color */
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

		.console,
		.management,
		.configurable {
			overflow-y: auto;
			scrollbar-width: none;
			@include fonts-stack('Satoshi-Regular', sans);
			@include fonts-alternate-style();
			letter-spacing: 0.5px;

			&:is(.loaded) {
				background-color: var(--color-surface);
			}
		}

		.management,
		.configurable {
			@include layout-flex-column();
			@include layout-respond('lg') {
				// gap:
			}

			@include layout-respond-max('lg') {
				gap: calc($x-space-xs / 2);
			}
		}

		.configurable {
			overflow-y: scroll;
		}

		.console {
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

		.unloadedDash {
			display: grid;
			place-items: center;
		}
	</style>
{/snippet}

{@render styleD()}

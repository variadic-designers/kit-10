<script lang="ts">
	import { getTheme } from '$lib/theming';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';

	import '$lib/fonts/Satoshi/Satoshi.css';

	let currentTheme = $state<string>('auto');

	import { initializeTheme } from '$lib/theming';
	import { initializeReducedMotion } from '$lib/reduced-motion';
	import { page } from '$app/state';

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
		currentTheme = getTheme();
	});
</script>

<svelte:head>
	<title>KIT•10 — Design System Framework</title>
	<link
		rel="stylesheet"
		href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css"
	/>
	<meta name="description" content="Yor Designs Editor Superpowered" />
</svelte:head>

<div id="landing" data-prefers-color-scheme data-compel-color-scheme={currentTheme}>
	<nav>
		<a href="/" class="branding">
			<img src="/favicon.svg" alt="KIT•10" />
		</a>
		<div class="nav-actions">
			<DarkModeToggle />
			<a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener" class="btn-donate"
				><i class="fa-solid fa-heart"></i> Donate</a
			>
			<a href="/edit" class="btn-primary">Open Editor</a>
		</div>
	</nav>

	<main>
		<section class="hero">
			<div class="hero-content">
				<h1>
					Design intent,<br />
					<span class="hero-accent">resolved</span>
				</h1>
				<p class="hero-sub">
					KIT•10 is a design system framework that turns intent into style outputs, reliably and
					predictably. Define the rules once. Every variant follows.
				</p>
				<div class="hero-cta">
					<a href="/edit" class="btn-primary btn-lg">Get Started</a>
					<a href="#concepts" class="btn-outline btn-lg">How it Works</a>
				</div>
			</div>
			<div class="hero-visual">
				<svg
					class="hero-glyph"
					viewBox="0 0 622.31 476"
					xmlns="http://www.w3.org/2000/svg"
					aria-hidden="true"
				>
					<path
						d="M622.31,238c0,131.44-106.56,238-238,238V444.82C384.31,330.6,476.91,238,591.13,238Z"
						fill="#93c5fd"
					/>
					<path
						d="M384.31,444.82V476c-131.44,0-238-106.56-238-238h31.18C291.71,238,384.31,330.6,384.31,444.82Z"
						fill="#3b82f6"
					/>
					<path
						d="M384.31,0V31.18C384.31,145.4,291.71,238,177.49,238H146.31C146.31,106.56,252.87,0,384.31,0Z"
						fill="#3b82f6"
					/>
					<path
						d="M622.31,238H591.13c-114.22,0-206.82-92.6-206.82-206.82V0C515.75,0,622.31,106.56,622.31,238Z"
						fill="#93c5fd"
					/>
					<path
						d="M147.1,0h0a0,0,0,0,1,0,0V328.9A147.1,147.1,0,0,1,0,476H0a0,0,0,0,1,0,0V147.1A147.1,147.1,0,0,1,147.1,0Z"
						fill="#3b82f6"
					/>
				</svg>
			</div>
		</section>

		<section id="compare" class="section">
			<div class="section-text">
				<h2>One component. Every variant.</h2>
				<p>
					Write the rule once. The engine resolves every combination. Your design system scales
					linearly, the output grows with every axis.
				</p>
			</div>
			<div class="section-graphic section-graphic--desktop-first">
				<div class="g-compare">
					<div class="g-compare__side g-compare__side--old">
						<h3>Without KIT•10</h3>
						<div class="g-compare__grid">
							<span>light</span><span>dark</span>
							<span>compact</span><span>dark+compact</span>
							<span>wide</span><span>dark+wide</span>
							<span>compact+wide</span><span>dark+compact+wide</span>
						</div>
						<p>8 components. Add one more axis? Make it 16.</p>
					</div>
					<div class="g-compare__vs"><i class="fa-solid fa-xmark"></i></div>
					<div class="g-compare__side g-compare__side--new">
						<h3>With KIT•10</h3>
						<div class="g-compare__stack">
							<span>1 component</span>
							<span>+ 4 rules</span>
						</div>
						<p>Same variants. Zero duplication.</p>
					</div>
				</div>
			</div>
		</section>

		<section id="specificity" class="section section--alt">
			<div class="section-text">
				<h2>More specific always wins</h2>
				<p>
					Two conditions beat one. Kit priority beats axis count. Overrides are surgical — nothing
					is ever lost.
				</p>
			</div>
			<div class="section-graphic">
				<div class="g-specificity">
					<div class="g-spec" style="--h: 30; --c: var(--color-text-muted)">
						<span class="g-spec__count">0 conditions</span>
						<span class="g-spec__val">baseline</span>
					</div>
					<div class="g-spec" style="--h: 55; --c: var(--color-primary)">
						<span class="g-spec__count">1 condition</span>
						<span class="g-spec__val">{'{dark}'}</span>
					</div>
					<div class="g-spec" style="--h: 80; --c: var(--color-primary-hover)">
						<span class="g-spec__count">2 conditions</span>
						<span class="g-spec__val">{'{dark, compact}'}</span>
					</div>
					<div class="g-spec" style="--h: 100; --c: var(--color-focus-ring)">
						<span class="g-spec__count">3+ conditions</span>
						<span class="g-spec__val">{'{dark, compact, wide}'}</span>
					</div>
				</div>
			</div>
		</section>

		<section id="pipeline" class="section">
			<div class="section-text">
				<h2>Design intent flows through four layers</h2>
				<p>
					Axes define the variables. Layers set the rules. Kits group them into components. Views
					compose them into outcomes.
				</p>
			</div>
			<div class="section-graphic section-graphic--desktop-first">
				<div class="g-pipeline">
					<div class="g-pipe" style="--i: 0">
						<span class="g-pipe__label">Axes</span><span class="g-pipe__ex"
							>theme, density, viewport</span
						>
					</div>
					<div class="g-pipe__arrow"><i class="fa-solid fa-arrow-down"></i></div>
					<div class="g-pipe" style="--i: 1">
						<span class="g-pipe__label">Layers</span><span class="g-pipe__ex"
							>if-this-then-that rules</span
						>
					</div>
					<div class="g-pipe__arrow"><i class="fa-solid fa-arrow-down"></i></div>
					<div class="g-pipe" style="--i: 2">
						<span class="g-pipe__label">Kits</span><span class="g-pipe__ex">Button, Card, Form</span
						>
					</div>
					<div class="g-pipe__arrow"><i class="fa-solid fa-arrow-down"></i></div>
					<div class="g-pipe" style="--i: 3">
						<span class="g-pipe__label">Views</span><span class="g-pipe__ex"
							>Dark Dashboard, Light Editor</span
						>
					</div>
				</div>
			</div>
		</section>

		<section class="cta-section">
			<h2>Ready to resolve?</h2>
			<p>Stop maintaining variants. Start defining intent.</p>
			<a href="/edit" class="btn-primary btn-lg">Open Editor</a>
		</section>
	</main>
</div>

<style lang="scss" global>
	@use '_index' as *;

	$light: (
		pure: '#FFF',
		pure-alt: '#000',
		bg: '#f8fafc',
		surface: '#ffffff',
		surface-alt: '#f1f5f9',
		text: '#1e293b',
		text-muted: '#64748b',
		primary: '#3b82f6',
		primary-hover: '#2563eb',
		focus-ring: '#93c5fd',
		border: '#e2e8f0',
		heading: '#0f172a',
		donate-text: '#e11d48',
		donate-border: '#fecdd3',
		donate-icon: '#fb7185',
		donate-hover-bg: '#fff1f2',
		donate-hover-border: '#fda4af',
		donate-hover-text: '#be123c'
	);

	$dark: (
		pure: '#0a0f1c',
		pure-alt: '#f8fafc',
		bg: '#0a0f1c',
		surface: '#1e293b',
		surface-alt: '#334155',
		text: '#e2e8f0',
		text-muted: '#94a3b8',
		primary: '#60a5fa',
		primary-hover: '#93c5fd',
		focus-ring: '#1d4ed8',
		border: '#475569',
		heading: '#f8fafc',
		donate-text: '#f43f5e',
		donate-border: '#9f1239',
		donate-icon: '#fb7185',
		donate-hover-bg: '#881337',
		donate-hover-border: '#e11d48',
		donate-hover-text: '#fda4af'
	);

	@include theming-declare-schemes-basic($light, $dark);

	#landing {
		color: var(--color-text);

		a,
		button {
			color: inherit;
			background-color: transparent;
			font-family: inherit;
		}

		p,
		li,
		h2,
		h3 {
			@include fonts-stack('Satoshi-Regular', sans);
		}
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: $x-space-3 $x-space-6;
		border-bottom: 1px solid var(--color-border);
		position: sticky;
		top: 0;
		z-index: 10;
		background-color: var(--color-bg);

		.branding {
			display: flex;
			align-items: center;
			gap: $x-space-3;
			text-decoration: none;
			color: var(--color-heading);

			img {
				height: $x-font-size-2xl;
			}
		}

		.nav-actions {
			display: flex;
			align-items: center;
			gap: $x-space-3;
		}
	}

	.hero {
		display: grid;
		place-items: center;
		min-height: calc(100vh - 80px);
		min-height: calc(100dvh - 80px);
		padding: $x-space-12 $x-space-6;
		gap: $x-space-12;
		background-color: var(--color-bg);

		@include layout-respond('lg') {
			grid-template-columns: 1fr 1fr;
			text-align: left;
		}

		@include layout-respond-max('md') {
			text-align: center;
			padding: $x-space-8 $x-space-4;
		}

		&-content {
			max-width: 36rem;
		}

		h1 {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-6xl;
			line-height: 1.1;
			color: var(--color-heading);
			margin-bottom: $x-space-6;

			@include layout-respond-max('md') {
				font-size: $x-font-size-4xl;
			}
		}

		&-accent {
			@include fonts-stack('Satoshi-Light', sans);
			background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
			-webkit-background-clip: text;
			background-clip: text;
			-webkit-text-fill-color: transparent;
		}

		&-sub {
			font-size: $x-font-size-lg;
			color: var(--color-text-muted);
			line-height: 1.6;
			margin-bottom: $x-space-8;
			max-width: 32rem;

			@include layout-respond-max('md') {
				margin-inline: auto;
			}
		}

		&-cta {
			display: flex;
			gap: $x-space-4;
			flex-wrap: wrap;

			@include layout-respond-max('md') {
				justify-content: center;
			}
		}

		&-visual {
			display: flex;
			justify-content: center;
			align-items: center;
		}

		.hero-glyph {
			width: 100%;
			max-width: 20rem;
			height: auto;
			view-transition-name: kit10-logo;
			color: var(--color-primary);
		}
	}

	.section {
		min-height: 100vh;
		min-height: 100dvh;
		display: grid;
		align-content: center;
		padding: $x-space-6;
		background-color: var(--color-bg);
		gap: $x-space-4;

		@include layout-respond('lg') {
			grid-template-columns: 1fr 1fr;
			padding: $x-space-8 $x-space-10;
			gap: $x-space-8;
			justify-items: center;
		}

		&--alt {
			background-color: var(--color-surface);
		}

		&-graphic {
			display: flex;
			justify-content: center;
			align-items: center;
			min-height: 16rem;

			&--desktop-first {
				@include layout-respond('lg') {
					order: -1;
				}
			}
		}

		&-text {
			max-width: 28rem;

			h2 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-3xl;
				color: var(--color-heading);
				margin-bottom: $x-space-4;
			}

			p {
				color: var(--color-text-muted);
				font-size: $x-font-size-lg;
				line-height: 1.6;
			}
		}
	}

	.g-pipeline {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: $x-space-1;
		width: 100%;
		max-width: 20rem;

		.g-pipe {
			width: 100%;
			padding: $x-space-3 $x-space-5;
			border-radius: $x-space-2;
			background: var(--color-surface-alt);
			border: 1px solid var(--color-border);
			display: flex;
			justify-content: space-between;
			align-items: center;

			&__label {
				@include fonts-stack('Satoshi-Bold', sans);
				color: var(--color-heading);
				font-size: $x-font-size-lg;
			}

			&__ex {
				color: var(--color-text-muted);
				font-size: $x-font-size-sm;
			}
		}

		.g-pipe__arrow {
			color: var(--color-primary);
			font-size: $x-font-size-lg;
		}
	}

	.g-specificity {
		display: flex;
		align-items: end;
		gap: $x-space-3;
		height: 18rem;
		padding: $x-space-4;

		.g-spec {
			width: 6rem;
			height: calc(var(--h) * 1% * 14rem);
			background: var(--c);
			border-radius: $x-space-2 $x-space-2 0 0;
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: end;
			padding: $x-space-2;
			gap: $x-space-1;

			&__count {
				font-size: $x-font-size-xs;
				color: white;
				opacity: 0.8;
			}

			&__val {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-sm;
				color: white;
				text-align: center;
			}
		}
	}

	.g-compare {
		display: flex;
		align-items: center;
		gap: $x-space-4;

		&-side {
			padding: $x-space-5;
			border-radius: $x-space-2;
			min-width: 12rem;

			h3 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-sm;
				margin-bottom: $x-space-3;
				text-transform: uppercase;
				letter-spacing: 1px;
				color: var(--color-text-muted);
			}

			p {
				font-size: $x-font-size-sm;
				margin-top: $x-space-3;
			}

			&--old {
				background: var(--color-surface-alt);
				border: 1px solid var(--color-border);
				color: var(--color-text);
			}

			&--new {
				background: var(--color-primary);
				border: 2px solid var(--color-primary);
				color: var(--color-pure);
			}
		}

		&__grid {
			display: grid;
			grid-template-columns: 1fr 1fr;
			gap: 3px;

			span {
				font-size: $x-font-size-xs;
				padding: 3px 6px;
				border-radius: 3px;
				background: var(--color-bg);
				text-align: center;
			}
		}

		&__stack {
			display: flex;
			flex-direction: column;
			gap: $x-space-2;

			span {
				font-size: $x-font-size-lg;
				@include fonts-stack('Satoshi-Bold', sans);
			}
		}

		&-vs {
			font-size: $x-font-size-3xl;
			color: var(--color-text-muted);
		}
	}

	.cta-section {
		text-align: center;
		padding: $x-space-16 $x-space-6;
		background-color: var(--color-surface);
		border-top: 1px solid var(--color-border);

		h2 {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-3xl;
			color: var(--color-heading);
			margin-bottom: $x-space-3;
		}

		p {
			color: var(--color-text-muted);
			font-size: $x-font-size-lg;
			margin-bottom: $x-space-6;
		}
	}

	#landing {
		.btn-primary {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: $x-space-2;
			padding: $x-space-2 $x-space-5;
			background-color: var(--color-primary);
			color: white;
			border: none;
			border-radius: $x-space-1;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;
			cursor: pointer;
			transition:
				background-color $x-duration-ui $x-timing-ui,
				box-shadow $x-duration-ui $x-timing-ui;

			&:hover {
				background-color: var(--color-primary-hover);
				box-shadow: $x-bs-sketch-soft;
				color: white;
			}

			&.btn-lg {
				padding: $x-space-3 $x-space-6;
				font-size: $x-font-size-lg;
			}
		}

		.btn-outline {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: $x-space-2;
			padding: $x-space-2 $x-space-5;
			background: transparent;
			color: var(--color-text);
			border: 1px solid var(--color-border);
			border-radius: $x-space-1;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;
			cursor: pointer;
			transition:
				border-color $x-duration-ui $x-timing-ui,
				background-color $x-duration-ui $x-timing-ui;

			&:hover {
				border-color: var(--color-primary);
				background-color: var(--color-surface-alt);
			}

			&.btn-lg {
				padding: $x-space-3 $x-space-6;
				font-size: $x-font-size-lg;
			}
		}

		.btn-donate {
			margin-left: $x-space-4;
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: $x-space-1;
			padding: $x-space-2 $x-space-4;
			background: transparent;
			color: var(--color-donate-text);
			border: 1px solid var(--color-donate-border);
			border-radius: $x-space-3;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;
			cursor: pointer;
			transition:
				border-color $x-duration-ui $x-timing-ui,
				background-color $x-duration-ui $x-timing-ui,
				color $x-duration-ui $x-timing-ui;

			i {
				color: var(--color-donate-icon);
				font-size: $x-font-size-lg;
			}

			&:hover {
				background-color: var(--color-donate-hover-bg);
				border-color: var(--color-donate-hover-border);
				color: var(--color-donate-hover-text);
			}
		}
	}
</style>

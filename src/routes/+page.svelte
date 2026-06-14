<script lang="ts">
	import { initializeTheme, getTheme, updateTheme, themeOptions } from '$lib/theming';
	import { initializeReducedMotion } from '$lib/reduced-motion';
	import { page } from '$app/state';

	import '$lib/fonts/Satoshi/Satoshi.css';

	let currentTheme = $state<string>('auto');

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
		currentTheme = getTheme();
	});

	function cycleTheme() {
		const idx = themeOptions.indexOf(currentTheme as any);
		const next = themeOptions[(idx + 1) % themeOptions.length];
		updateTheme(next);
		currentTheme = next;
	}
</script>

<svelte:head>
	<title>KIT•10 — Design System Framework</title>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css" />
	<meta name="description" content="Yor Designs Editor Superpowered" />
</svelte:head>

<div id="landing" data-prefers-color-scheme>
	<nav>
		<a href="/" class="branding">
			<img src="/logo.svg" alt="KIT•10" />
			<span class="branding-text">KIT•10</span>
		</a>
		<div class="nav-actions">
			<button class="btn-ghost" onclick={cycleTheme} title="Toggle theme">
				<i class="fa-solid fa-circle-half-stroke"></i>
			</button>
			<a href="/edit" class="btn-primary">Open Editor</a>
			<button class="btn-outline">Log in</button>
		</div>
	</nav>

	<section class="hero">
		<div class="hero-content">
			<h1>
				Design intent,<br />
				<span class="hero-accent">resolved.</span>
			</h1>
			<p class="hero-sub">
				KIT•10 is a design system framework where Views, Kits, Axes, Layers, and Tokens
				flow through a specificity cascade to produce deterministic style outputs.
			</p>
			<div class="hero-cta">
				<a href="/edit" class="btn-primary btn-lg">Get Started</a>
				<a href="#about" class="btn-outline btn-lg">Learn More</a>
			</div>
		</div>
		<div class="hero-visual">
			<div class="hero-glyph" aria-hidden="true">
				<svg viewBox="0 0 622.31 476" fill="none" xmlns="http://www.w3.org/2000/svg">
					<path d="M622.31,238c0,131.5-106.8,238-238.31,238V420.58c100.9,0,182.89-81.74,182.89-182.58S484.9,55.42,384,55.42C283.11,55.42,201.11,137.16,201.11,238H145.71C145.71,106.5,252.49,0,384,0S622.31,106.5,622.31,238Z" fill="var(--color-primary)" />
					<path d="M417.14,420.58V476C285.63,476,178.86,369.5,178.86,238h55.4C234.26,338.84,316.25,420.58,417.14,420.58Z" fill="var(--color-primary-hover)" />
					<path d="M417.14,0V55.42C316.25,55.42,234.26,137.16,201.11,238H145.71C145.71,106.5,252.49,0,417.14,0Z" fill="var(--color-primary)" />
					<path d="M622.31,238H566.89C566.89,338.84,484.9,420.58,384,420.58V476C515.51,476,622.31,369.5,622.31,238Z" fill="var(--color-primary-hover)" />
					<path d="M145.71,0V476H0V0Z" fill="var(--color-primary)" />
				</svg>
			</div>
		</div>
	</section>

	<section id="about" class="about">
		<h2>About</h2>
		<div class="about-grid">
			<div class="about-card">
				<i class="fa-solid fa-layer-group"></i>
				<h3>Specificity Cascade</h3>
				<p>Three-tier resolution: axis count, compounded order, and kit priority. Deterministic, every time.</p>
			</div>
			<div class="about-card">
				<i class="fa-solid fa-diagram-project"></i>
				<h3>Scoped Tokens</h3>
				<p>Tokens live at project, kit, or view scope. Higher scopes override lower ones for the same alias.</p>
			</div>
			<div class="about-card">
				<i class="fa-solid fa-puzzle-piece"></i>
				<h3>Composable Kits</h3>
				<p>Independent style kits resolve against shared view conditions. Stack them, reorder them, override them.</p>
			</div>
		</div>
		<div class="about-footer">
			<p>
				Built with care by <a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener">Yor Designs</a>.
				KIT•10 is early-stage and evolving rapidly.
			</p>
		</div>
	</section>
</div>

<style lang="scss">
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
		heading: '#0f172a'
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
		heading: '#f8fafc'
	);

	@include theming-declare-schemes-basic($light, $dark);
	@include theming-impose-schemes-basic();

	#landing {
		min-height: 100vh;
		min-height: 100dvh;
		background-color: var(--color-bg);
		color: var(--color-text);
		@include fonts-stack('Satoshi-Regular', sans);
		letter-spacing: 0.3px;
	}

	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: $x-space-3 $x-space-6;
		border-bottom: 1px solid var(--color-border);

		.branding {
			display: flex;
			align-items: center;
			gap: $x-space-3;
			text-decoration: none;
			color: var(--color-heading);

			img {
				height: $x-font-size-2xl;
			}

			&-text {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-xl;
				letter-spacing: 1px;
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

			svg {
				width: 100%;
				max-width: 320px;
				height: auto;
			}
		}

		&-glyph {
			animation: glyph-pulse 4s ease-in-out infinite;
		}
	}

	@keyframes glyph-pulse {
		0%,
		100% {
			opacity: 0.85;
			transform: scale(1);
		}
		50% {
			opacity: 1;
			transform: scale(1.03);
		}
	}

	.about {
		padding: $x-space-16 $x-space-6;
		background-color: var(--color-surface);
		border-top: 1px solid var(--color-border);

		h2 {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-3xl;
			text-align: center;
			color: var(--color-heading);
			margin-bottom: $x-space-12;
		}

		&-grid {
			display: grid;
			gap: $x-space-6;

			@include layout-respond('md') {
				grid-template-columns: repeat(3, 1fr);
			}
		}

		&-card {
			background-color: var(--color-surface-alt);
			border: 1px solid var(--color-border);
			border-radius: $x-space-2;
			padding: $x-space-8 $x-space-6;
			transition: border-color $x-duration-ui $x-timing-ui, box-shadow $x-duration-ui $x-timing-ui;

			&:hover {
				border-color: var(--color-primary);
				box-shadow: $x-bs-sketch-falloff;
			}

			i {
				font-size: $x-font-size-3xl;
				color: var(--color-primary);
				margin-bottom: $x-space-4;
				display: block;
			}

			h3 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-lg;
				color: var(--color-heading);
				margin-bottom: $x-space-3;
			}

			p {
				color: var(--color-text-muted);
				line-height: 1.6;
			}
		}

		&-footer {
			text-align: center;
			margin-top: $x-space-12;
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;

			a {
				color: var(--color-primary);
				text-decoration: none;

				&:hover {
					text-decoration: underline;
				}
			}
		}
	}

	.btn-primary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: $x-space-2;
		padding: $x-space-2 $x-space-5;
		background-color: var(--color-primary);
		color: var(--color-pure);
		border: none;
		border-radius: $x-space-1;
		@include fonts-stack('Satoshi-Medium', sans);
		font-size: $x-font-size-md;
		text-decoration: none;
		cursor: pointer;
		transition: background-color $x-duration-ui $x-timing-ui, box-shadow $x-duration-ui $x-timing-ui;

		&:hover {
			background-color: var(--color-primary-hover);
			box-shadow: $x-bs-sketch-soft;
			color: var(--color-pure);
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
		transition: border-color $x-duration-ui $x-timing-ui, background-color $x-duration-ui $x-timing-ui;

		&:hover {
			border-color: var(--color-primary);
			background-color: var(--color-surface-alt);
		}

		&.btn-lg {
			padding: $x-space-3 $x-space-6;
			font-size: $x-font-size-lg;
		}
	}

	.btn-ghost {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: $x-space-2;
		background: transparent;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		font-size: $x-font-size-lg;
		transition: color $x-duration-ui $x-timing-ui;

		&:hover {
			color: var(--color-primary);
		}
	}
</style>
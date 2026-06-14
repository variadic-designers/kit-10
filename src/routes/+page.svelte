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
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css" />
	<meta name="description" content="Yor Designs Editor Superpowered" />
</svelte:head>

<div id="landing" data-prefers-color-scheme data-compel-color-scheme={currentTheme}>
	<nav>
		<a href="/" class="branding">
			<img src="/favicon.svg" alt="KIT•10" />
			
		</a>
		<div class="nav-actions">
			<DarkModeToggle />
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
				KIT•10 is a design system framework that turns design intent into resolved style outputs, reliably and predictably.
			</p>
			<div class="hero-cta">
				<a href="/edit" class="btn-primary btn-lg">Get Started</a>
				<a href="#about" class="btn-outline btn-lg">Learn More</a>
			</div>
		</div>
		<div class="hero-visual">
			<svg class="hero-glyph" viewBox="0 0 622.31 476" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
				<path d="M622.31,238c0,131.44-106.56,238-238,238V444.82C384.31,330.6,476.91,238,591.13,238Z" fill="#93c5fd" />
				<path d="M384.31,444.82V476c-131.44,0-238-106.56-238-238h31.18C291.71,238,384.31,330.6,384.31,444.82Z" fill="#3b82f6" />
				<path d="M384.31,0V31.18C384.31,145.4,291.71,238,177.49,238H146.31C146.31,106.56,252.87,0,384.31,0Z" fill="#3b82f6" />
				<path d="M622.31,238H591.13c-114.22,0-206.82-92.6-206.82-206.82V0C515.75,0,622.31,106.56,622.31,238Z" fill="#93c5fd" />
				<path d="M147.1,0h0a0,0,0,0,1,0,0V328.9A147.1,147.1,0,0,1,0,476H0a0,0,0,0,1,0,0V147.1A147.1,147.1,0,0,1,147.1,0Z" fill="#3b82f6" />
			</svg>
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
			<a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener" class="btn-primary btn-donate">
				<i class="fa-solid fa-gift"></i> Support KIT•10
			</a>
		</div>
	</section>
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
		}

		.hero-glyph {
			width: 100%;
			max-width: 20rem;
			height: auto;
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
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: $x-space-6;

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

	.btn-donate {
		background-color: var(--color-primary);
		color: var(--color-pure);
		text-decoration: none;
		border-radius: $x-space-3;
		padding: $x-space-3 $x-space-8;
		font-size: $x-font-size-md;
		@include fonts-stack('Satoshi-Medium', sans);
		transition: background-color $x-duration-ui $x-timing-ui, box-shadow $x-duration-ui $x-timing-ui;

		&:hover {
			background-color: var(--color-primary-hover);
			box-shadow: $x-bs-sketch-soft;
			color: var(--color-pure);
		}

		i {
			margin-right: $x-space-2;
		}
	}
</style>
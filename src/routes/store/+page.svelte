<script lang="ts">
	import { getTheme, initializeTheme } from '$lib/theming.js';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';

	import '$lib/fonts/Satoshi/Satoshi.css';

	import { initializeReducedMotion } from '$lib/reduced-motion.js';
	import { page } from '$app/state';

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
	});

	// ── Static store data ────────────────────────────────────────────────────
	// DEFINITIVE, NOT FUNCTIONAL: this page renders the intended store UX over a
	// hardcoded catalogue. No install/registry wiring yet — Install buttons are
	// inert on purpose. When the store goes live this array is replaced by the
	// remote index + `listPlugins()` (installed set); the card shape below mirrors
	// the plugin descriptor proposed in resources/plugin-store-research.md §5.1.

	type Kind = 'interpreter' | 'utility' | 'renderer';
	type Status = 'installed' | 'available' | 'soon';
	type Capability =
		| 'network'
		| 'reads-design'
		| 'writes-design'
		| 'reads-project'
		| 'creates-project'
		| 'drives-canvas'
		| 'drives-panels';

	interface StorePlugin {
		id: string;
		name: string;
		author: string;
		kind: Kind;
		icon: string; // Font Awesome class
		tagline: string;
		provides: string[]; // what capabilities/roles it declares (badges)
		capabilities: Capability[]; // host powers it requests
		version: string;
		status: Status;
		firstParty: boolean;
	}

	const CAP_META: Record<Capability, { label: string; icon: string; danger: boolean }> = {
		network: { label: 'Network access', icon: 'fa-solid fa-globe', danger: true },
		'reads-design': { label: 'Reads design data', icon: 'fa-solid fa-eye', danger: false },
		'writes-design': { label: 'Writes design data', icon: 'fa-solid fa-pen', danger: true },
		'reads-project': { label: 'Reads whole project', icon: 'fa-solid fa-folder-open', danger: false },
		'creates-project': { label: 'Creates projects', icon: 'fa-solid fa-folder-plus', danger: true },
		'drives-canvas': { label: 'Drives the canvas', icon: 'fa-solid fa-display', danger: false },
		'drives-panels': { label: 'Drives panels', icon: 'fa-solid fa-table-columns', danger: false }
	};

	const KIND_META: Record<Kind, { label: string; icon: string }> = {
		interpreter: { label: 'Interpreter', icon: 'fa-solid fa-diagram-project' },
		utility: { label: 'Utility', icon: 'fa-solid fa-plug' },
		renderer: { label: 'Renderer', icon: 'fa-solid fa-cube' }
	};

	const plugins: StorePlugin[] = [
		{
			id: 'charter',
			name: 'Charter',
			author: 'KIT•10',
			kind: 'interpreter',
			icon: 'fa-solid fa-diagram-project',
			tagline: 'Translates resolved kits into a flat render tree — the default viewport interpreter.',
			provides: ['Viewport', 'Render fields', 'Layout opinions'],
			capabilities: ['reads-design', 'writes-design', 'drives-canvas', 'drives-panels'],
			version: '0.1.0',
			status: 'installed',
			firstParty: true
		},
		{
			id: 'fontavious',
			name: 'Fontavious',
			author: 'KIT•10',
			kind: 'utility',
			icon: 'fa-solid fa-font',
			tagline: 'Font catalogue + fetch. Serves the font picker and streams WOFF2 to the renderer.',
			provides: ['Suggestions: font'],
			capabilities: ['network'],
			version: '0.1.0',
			status: 'installed',
			firstParty: true
		},
		{
			id: 'tenner',
			name: 'Tenner',
			author: 'KIT•10',
			kind: 'utility',
			icon: 'fa-solid fa-file-arrow-down',
			tagline: 'Raw project serialization — export and import a whole project as YAML.',
			provides: ['Export: YAML', 'Import: YAML'],
			capabilities: ['reads-project', 'creates-project'],
			version: '0.1.0',
			status: 'installed',
			firstParty: true
		},
		{
			id: 'glyphet',
			name: 'Glyphet',
			author: 'Community',
			kind: 'utility',
			icon: 'fa-solid fa-icons',
			tagline: 'Icon-set catalogue. Adds an "icon" field type with search across popular open sets.',
			provides: ['Suggestions: icon'],
			capabilities: ['network'],
			version: '0.2.0',
			status: 'available',
			firstParty: false
		},
		{
			id: 'weftcss',
			name: 'Weft',
			author: 'Community',
			kind: 'utility',
			icon: 'fa-brands fa-css3-shield',
			tagline: 'Export a view as production HTML + SCSS, with a live-vite stream to a dev server.',
			provides: ['Export: HTML/SCSS', 'Export: live-vite'],
			capabilities: ['reads-project'],
			version: '0.4.1',
			status: 'available',
			firstParty: false
		},
		{
			id: 'bridgeport',
			name: 'Bridgeport',
			author: 'Community',
			kind: 'utility',
			icon: 'fa-solid fa-right-left',
			tagline: 'Import from Figma & Penpot files, mapping frames and variants onto kits and axes.',
			provides: ['Import: .fig', 'Import: .penpot'],
			capabilities: ['creates-project'],
			version: '0.3.0',
			status: 'soon',
			firstParty: false
		},
		{
			id: 'loomweave',
			name: 'Loomweave',
			author: 'Community',
			kind: 'interpreter',
			icon: 'fa-solid fa-code',
			tagline: 'Alternative interpreter that emits a DOM-shaped tree instead of Charter primitives.',
			provides: ['Viewport', 'Render fields'],
			capabilities: ['reads-design', 'writes-design', 'drives-canvas', 'drives-panels'],
			version: '0.1.0-beta',
			status: 'soon',
			firstParty: false
		},
		{
			id: 'splatter',
			name: 'Splatter',
			author: 'Community',
			kind: 'renderer',
			icon: 'fa-solid fa-cubes',
			tagline: 'Experimental Gaussian-splatting renderer surface — a peek at a replaceable core.',
			provides: ['Renderer'],
			capabilities: ['drives-canvas'],
			version: '0.0.3',
			status: 'soon',
			firstParty: false
		}
	];

	// ── Client-only filtering (visual; no backend) ───────────────────────────
	const categories = [
		{ id: 'all', label: 'All' },
		{ id: 'interpreter', label: 'Interpreters' },
		{ id: 'utility', label: 'Utilities' },
		{ id: 'renderer', label: 'Renderers' },
		{ id: 'installed', label: 'Installed' }
	] as const;

	let activeCategory = $state<string>('all');
	let query = $state('');

	const filtered = $derived(
		plugins.filter((p) => {
			const inCat =
				activeCategory === 'all'
					? true
					: activeCategory === 'installed'
						? p.status === 'installed'
						: p.kind === activeCategory;
			const q = query.trim().toLowerCase();
			const inQuery =
				q === '' ||
				p.name.toLowerCase().includes(q) ||
				p.tagline.toLowerCase().includes(q) ||
				p.provides.some((x) => x.toLowerCase().includes(q));
			return inCat && inQuery;
		})
	);

	const installedCount = plugins.filter((p) => p.status === 'installed').length;
</script>

<svelte:head>
	<title>KIT•10 — Plugin Store</title>
	<meta name="description" content="Browse and install KIT•10 plugins — interpreters, utilities, and renderers." />
</svelte:head>

<div id="store" data-prefers-color-scheme data-compel-color-scheme={getTheme()}>
	<nav>
		<a href="/" class="branding">
			<img src="/favicon.svg" alt="KIT•10" />
		</a>
		<div class="nav-actions">
			<a href="/" class="nav-link">Home</a>
			<a href="/store" class="nav-link nav-link--active" aria-current="page">Store</a>
			<DarkModeToggle />
			<a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener" class="btn-donate"
				><i class="fa-solid fa-heart"></i> Donate</a
			>
			<a href="/edit" class="btn-primary">Open Editor</a>
		</div>
	</nav>

	<main>
		<header class="store-hero">
			<span class="store-eyebrow"><i class="fa-solid fa-store"></i> Plugin Store · Preview</span>
			<h1>Extend <span class="store-accent">everything</span></h1>
			<p class="store-sub">
				Interpreters translate your resolved data. Utilities add fields, fonts, icons, and export
				targets. Renderers draw the pixels. Every layer of KIT•10 is a plugin — swap one, run
				two, or write your own.
			</p>
			<div class="store-note">
				<i class="fa-solid fa-circle-info"></i>
				<span>This is a design preview — installing isn't wired up yet.</span>
			</div>
		</header>

		<div class="store-toolbar">
			<div class="store-search">
				<i class="fa-solid fa-magnifying-glass"></i>
				<input type="text" placeholder="Search plugins…" bind:value={query} spellcheck="false" />
			</div>
			<div class="store-filters" role="tablist" aria-label="Plugin categories">
				{#each categories as cat (cat.id)}
					<button
						type="button"
						role="tab"
						aria-selected={activeCategory === cat.id}
						class="store-chip"
						class:store-chip--active={activeCategory === cat.id}
						onclick={() => (activeCategory = cat.id)}
					>
						{cat.label}
						{#if cat.id === 'installed'}<span class="store-chip__count">{installedCount}</span>{/if}
					</button>
				{/each}
			</div>
		</div>

		<section class="store-grid" aria-label="Plugins">
			{#each filtered as plugin (plugin.id)}
				<article class="p-card" class:p-card--soon={plugin.status === 'soon'}>
					<div class="p-card__top">
						<div class="p-card__icon p-card__icon--{plugin.kind}">
							<i class={plugin.icon}></i>
						</div>
						<div class="p-card__id">
							<h3>{plugin.name}</h3>
							<span class="p-card__author">
								{plugin.author}
								{#if plugin.firstParty}<i
										class="fa-solid fa-circle-check p-card__verified"
										title="First-party plugin"
									></i>{/if}
							</span>
						</div>
						<span class="p-card__kind"
							><i class={KIND_META[plugin.kind].icon}></i> {KIND_META[plugin.kind].label}</span
						>
					</div>

					<p class="p-card__tagline">{plugin.tagline}</p>

					<div class="p-card__provides">
						{#each plugin.provides as tag (tag)}
							<span class="p-tag">{tag}</span>
						{/each}
					</div>

					<div class="p-card__caps">
						{#each plugin.capabilities as cap (cap)}
							<span
								class="p-cap"
								class:p-cap--danger={CAP_META[cap].danger}
								title={CAP_META[cap].label}
							>
								<i class={CAP_META[cap].icon}></i>
								{CAP_META[cap].label}
							</span>
						{/each}
					</div>

					<div class="p-card__foot">
						<span class="p-card__version">v{plugin.version}</span>
						{#if plugin.status === 'installed'}
							<button type="button" class="p-btn p-btn--installed" disabled>
								<i class="fa-solid fa-check"></i> Installed
							</button>
						{:else if plugin.status === 'soon'}
							<button type="button" class="p-btn p-btn--soon" disabled>Coming soon</button>
						{:else}
							<button type="button" class="p-btn p-btn--install" disabled title="Store isn't live yet">
								<i class="fa-solid fa-download"></i> Install
							</button>
						{/if}
					</div>
				</article>
			{/each}

			{#if filtered.length === 0}
				<div class="store-empty">
					<i class="fa-solid fa-plug-circle-xmark"></i>
					<p>No plugins match “{query}”.</p>
				</div>
			{/if}
		</section>

		<section class="store-legend">
			<h2>Capabilities, up front</h2>
			<p>
				Every plugin declares the host powers it needs. When installs go live you'll grant these at
				install time — a font utility asking for network is expected; a picker asking to create
				projects is worth a second look.
			</p>
			<div class="legend-grid">
				{#each Object.entries(CAP_META) as [cap, meta] (cap)}
					<div class="legend-item" class:legend-item--danger={meta.danger}>
						<i class={meta.icon}></i>
						<span>{meta.label}</span>
					</div>
				{/each}
			</div>
		</section>

		<section class="store-cta">
			<h2>Build your own</h2>
			<p>Any language with an Extism PDK. Declare a field kind, an export target, or a whole interpreter.</p>
			<div class="store-cta__actions">
				<a href="/edit" class="btn-primary btn-lg">Open Editor</a>
				<a href="/" class="btn-outline btn-lg">Back Home</a>
			</div>
		</section>
	</main>
</div>

<style lang="scss" global>
	@use '_index' as *;

	$light: (
		pure: 'oklch(100% 0 0)',
		pure-alt: 'oklch(0% 0 0)',
		bg: 'oklch(98.4% 0.0034 247.9)',
		surface: 'oklch(100% 0 0)',
		surface-alt: 'oklch(96.8% 0.0069 247.9)',
		text: 'oklch(27.9% 0.0368 260)',
		text-muted: 'oklch(55.4% 0.0407 257.4)',
		primary: 'oklch(62.3% 0.188 259.8)',
		primary-hover: 'oklch(54.6% 0.2152 262.9)',
		focus-ring: 'oklch(80.9% 0.0956 251.8)',
		border: 'oklch(92.9% 0.0126 255.5)',
		heading: 'oklch(20.8% 0.0398 265.8)',
		danger: 'oklch(58.6% 0.222 17.6)',
		danger-soft: 'oklch(96.9% 0.0152 12.4)',
		donate-text: 'oklch(58.6% 0.222 17.6)',
		donate-border: 'oklch(89.2% 0.0559 10)',
		donate-icon: 'oklch(71.9% 0.169 13.4)',
		donate-hover-bg: 'oklch(96.9% 0.0152 12.4)',
		donate-hover-border: 'oklch(81% 0.1061 11.6)',
		donate-hover-text: 'oklch(51.4% 0.1978 16.9)'
	);

	$dark: (
		pure: 'oklch(17.1% 0.0284 267.4)',
		pure-alt: 'oklch(98.4% 0.0034 247.9)',
		bg: 'oklch(17.1% 0.0284 267.4)',
		surface: 'oklch(27.9% 0.0368 260)',
		surface-alt: 'oklch(37.2% 0.0392 257.3)',
		text: 'oklch(92.9% 0.0126 255.5)',
		text-muted: 'oklch(71.1% 0.0351 256.8)',
		primary: 'oklch(71.4% 0.1434 254.6)',
		primary-hover: 'oklch(80.9% 0.0956 251.8)',
		focus-ring: 'oklch(48.8% 0.2172 264.4)',
		border: 'oklch(44.6% 0.0374 257.3)',
		heading: 'oklch(98.4% 0.0034 247.9)',
		danger: 'oklch(64.5% 0.2154 16.4)',
		danger-soft: 'oklch(41% 0.1502 10.3)',
		donate-text: 'oklch(64.5% 0.2154 16.4)',
		donate-border: 'oklch(45.5% 0.1713 13.7)',
		donate-icon: 'oklch(71.9% 0.169 13.4)',
		donate-hover-bg: 'oklch(41% 0.1502 10.3)',
		donate-hover-border: 'oklch(58.6% 0.222 17.6)',
		donate-hover-text: 'oklch(81% 0.1061 11.6)'
	);

	@include theming-declare-schemes-basic($light, $dark);

	#store {
		color: var(--color-text);
		background-color: var(--color-bg);
		min-height: 100vh;
		min-height: 100dvh;

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

		input {
			font-family: inherit;
		}
	}

	#store nav {
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

		.nav-link {
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;
			color: var(--color-text-muted);
			padding: $x-space-1 $x-space-2;
			border-radius: $x-space-1;

			&:hover {
				color: var(--color-text);
			}

			&--active {
				color: var(--color-primary);
			}

			@include layout-respond-max('md') {
				display: none;
			}
		}
	}

	#store main {
		max-width: 76rem;
		margin-inline: auto;
		padding: $x-space-10 $x-space-6 $x-space-16;

		@include layout-respond-max('md') {
			padding: $x-space-8 $x-space-4 $x-space-12;
		}
	}

	.store-hero {
		text-align: center;
		max-width: 44rem;
		margin: $x-space-8 auto $x-space-12;

		.store-eyebrow {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-sm;
			text-transform: uppercase;
			letter-spacing: 1.5px;
			color: var(--color-primary);
			margin-bottom: $x-space-4;
		}

		h1 {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-6xl;
			line-height: 1.1;
			color: var(--color-heading);
			margin-bottom: $x-space-4;

			@include layout-respond-max('md') {
				font-size: $x-font-size-4xl;
			}
		}

		.store-accent {
			@include fonts-stack('Satoshi-Light', sans);
			background: linear-gradient(135deg, var(--color-primary), var(--color-primary-hover));
			-webkit-background-clip: text;
			background-clip: text;
			-webkit-text-fill-color: transparent;
		}

		.store-sub {
			font-size: $x-font-size-lg;
			color: var(--color-text-muted);
			line-height: 1.6;
			margin-inline: auto;
		}

		.store-note {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			margin-top: $x-space-6;
			padding: $x-space-2 $x-space-4;
			border-radius: $x-space-3;
			background: var(--color-surface-alt);
			border: 1px solid var(--color-border);
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);

			i {
				color: var(--color-primary);
			}
		}
	}

	.store-toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: $x-space-4;
		margin-bottom: $x-space-8;
	}

	.store-search {
		display: flex;
		align-items: center;
		gap: $x-space-2;
		padding: $x-space-2 $x-space-4;
		border-radius: $x-space-2;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		flex: 1;
		min-width: 14rem;
		max-width: 22rem;

		i {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
		}

		input {
			border: none;
			outline: none;
			background: transparent;
			color: var(--color-text);
			font-size: $x-font-size-md;
			width: 100%;

			&::placeholder {
				color: var(--color-text-muted);
			}
		}
	}

	.store-filters {
		display: flex;
		flex-wrap: wrap;
		gap: $x-space-2;
	}

	.store-chip {
		display: inline-flex;
		align-items: center;
		gap: $x-space-2;
		padding: $x-space-2 $x-space-4;
		border-radius: 999px;
		border: 1px solid var(--color-border);
		background: var(--color-surface);
		color: var(--color-text-muted);
		@include fonts-stack('Satoshi-Medium', sans);
		font-size: $x-font-size-sm;
		cursor: pointer;
		transition:
			border-color $x-duration-ui $x-timing-ui,
			color $x-duration-ui $x-timing-ui,
			background-color $x-duration-ui $x-timing-ui;

		&:hover {
			color: var(--color-text);
			border-color: var(--color-primary);
		}

		&--active {
			background: var(--color-primary);
			border-color: var(--color-primary);
			color: var(--color-pure);
		}

		&__count {
			font-size: $x-font-size-xs;
			background: color-mix(in oklab, currentColor 20%, transparent);
			border-radius: 999px;
			padding: 0 $x-space-2;
		}
	}

	.store-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
		gap: $x-space-5;
	}

	.p-card {
		display: flex;
		flex-direction: column;
		gap: $x-space-3;
		padding: $x-space-5;
		border-radius: $x-space-3;
		background: var(--color-surface);
		border: 1px solid var(--color-border);
		transition:
			border-color $x-duration-ui $x-timing-ui,
			box-shadow $x-duration-ui $x-timing-ui,
			transform $x-duration-ui $x-timing-ui;

		&:hover {
			border-color: var(--color-primary);
			box-shadow: $x-bs-sketch-soft;
			transform: translateY(-2px);
		}

		&--soon {
			opacity: 0.72;
		}

		&__top {
			display: flex;
			align-items: flex-start;
			gap: $x-space-3;
		}

		&__icon {
			flex: 0 0 auto;
			width: 2.75rem;
			height: 2.75rem;
			border-radius: $x-space-2;
			display: grid;
			place-items: center;
			font-size: $x-font-size-lg;
			color: var(--color-pure);
			background: var(--color-primary);

			&--utility {
				background: oklch(70% 0.13 200);
			}

			&--renderer {
				background: oklch(66% 0.19 300);
			}
		}

		&__id {
			flex: 1;
			min-width: 0;

			h3 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-lg;
				color: var(--color-heading);
				line-height: 1.2;
			}
		}

		&__author {
			display: inline-flex;
			align-items: center;
			gap: $x-space-1;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}

		&__verified {
			color: var(--color-primary);
			font-size: $x-font-size-xs;
		}

		&__kind {
			display: inline-flex;
			align-items: center;
			gap: $x-space-1;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			border: 1px solid var(--color-border);
			border-radius: 999px;
			padding: 2px $x-space-2;
			white-space: nowrap;
		}

		&__tagline {
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			line-height: 1.5;
			flex: 1;
		}

		&__provides {
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-1;
		}

		&__caps {
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-1;
			padding-top: $x-space-1;
		}

		&__foot {
			display: flex;
			align-items: center;
			justify-content: space-between;
			margin-top: $x-space-2;
			padding-top: $x-space-3;
			border-top: 1px solid var(--color-border);
		}

		&__version {
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			font-family: $x-font-family-mono;
		}
	}

	.p-tag {
		font-size: $x-font-size-xs;
		padding: 2px $x-space-2;
		border-radius: $x-space-1;
		background: color-mix(in oklab, var(--color-primary) 14%, transparent);
		color: var(--color-primary);
		@include fonts-stack('Satoshi-Medium', sans);
	}

	.p-cap {
		display: inline-flex;
		align-items: center;
		gap: $x-space-1;
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);

		i {
			font-size: 0.7em;
			opacity: 0.85;
		}

		&--danger {
			color: var(--color-danger);
		}
	}

	.p-btn {
		display: inline-flex;
		align-items: center;
		gap: $x-space-2;
		padding: $x-space-2 $x-space-4;
		border-radius: $x-space-1;
		@include fonts-stack('Satoshi-Medium', sans);
		font-size: $x-font-size-sm;
		border: 1px solid transparent;
		cursor: not-allowed;

		&--install {
			background: var(--color-primary);
			color: var(--color-pure);
		}

		&--installed {
			background: transparent;
			border-color: var(--color-border);
			color: var(--color-text-muted);
		}

		&--soon {
			background: transparent;
			border-color: var(--color-border);
			color: var(--color-text-muted);
		}
	}

	.store-empty {
		grid-column: 1 / -1;
		text-align: center;
		padding: $x-space-16 $x-space-4;
		color: var(--color-text-muted);

		i {
			font-size: $x-font-size-4xl;
			margin-bottom: $x-space-3;
			opacity: 0.5;
		}
	}

	.store-legend {
		margin-top: $x-space-16;
		padding: $x-space-8;
		border-radius: $x-space-3;
		background: var(--color-surface);
		border: 1px solid var(--color-border);

		h2 {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-2xl;
			color: var(--color-heading);
			margin-bottom: $x-space-2;
		}

		> p {
			color: var(--color-text-muted);
			font-size: $x-font-size-md;
			line-height: 1.6;
			max-width: 44rem;
			margin-bottom: $x-space-6;
		}
	}

	.legend-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr));
		gap: $x-space-3;

		.legend-item {
			display: flex;
			align-items: center;
			gap: $x-space-2;
			font-size: $x-font-size-sm;
			color: var(--color-text);

			i {
				width: 1.25rem;
				text-align: center;
				color: var(--color-text-muted);
			}

			&--danger i {
				color: var(--color-danger);
			}
		}
	}

	.store-cta {
		text-align: center;
		margin-top: $x-space-16;

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

		&__actions {
			display: flex;
			gap: $x-space-4;
			justify-content: center;
			flex-wrap: wrap;
		}
	}

	// Shared button styles (mirror the landing page's, scoped to #store).
	#store {
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
			margin-left: $x-space-2;
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

			@include layout-respond-max('md') {
				display: none;
			}
		}
	}
</style>

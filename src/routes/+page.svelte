<script lang="ts">
	import { getTheme, initializeTheme } from '$lib/theming';
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';

	import '$lib/fonts/Satoshi/Satoshi.css';

	import { initializeReducedMotion } from '$lib/reduced-motion';
	import { page } from '$app/state';

	$effect(() => {
		initializeTheme(page.data.theme);
		initializeReducedMotion(page.data.reducedMotion);
	});

	const year = new Date().getFullYear();

	// ── Live resolve demo ──────────────────────────────────────────────────────
	// One Kit ("Button") resolving across Emphasis + State. Emphasis is the star
	// axis (primary/secondary/tertiary/disabled) — a change users actually notice.
	// Flip an axis and the winning value per property is recomputed by specificity
	// (condition count). Faithful to CONCEPTS.md: Kits, Layers, Axes, Tokens,
	// per-property override, more-specific-wins.

	type Args = {
		emphasis: 'primary' | 'secondary' | 'tertiary' | 'disabled';
		state: 'default' | 'hover';
	};
	let args = $state<Args>({ emphasis: 'primary', state: 'default' });

	const axes = [
		{ id: 'emphasis', label: 'Emphasis', options: ['primary', 'secondary', 'tertiary', 'disabled'] },
		{ id: 'state', label: 'State', options: ['default', 'hover'] }
	] as const;

	// Tokens: named values a Layer references (CONCEPTS.md §Tokens). Tonal/translucent
	// values so they read on either theme's stage; primary stays a solid brand blue.
	const tokens: Record<string, string> = {
		primary: 'oklch(62.3% 0.188 259.8)',
		'primary.hover': 'oklch(54.6% 0.2152 262.9)',
		secondary: 'oklch(62.3% 0.188 259.8 / 0.16)',
		'secondary.hover': 'oklch(62.3% 0.188 259.8 / 0.28)',
		tertiary: 'transparent',
		'tertiary.hover': 'oklch(62.3% 0.188 259.8 / 0.12)',
		disabled: 'oklch(60% 0.01 260 / 0.16)',
		'text.onPrimary': 'oklch(100% 0 0)',
		'text.brand': 'oklch(62.3% 0.188 259.8)',
		'text.disabled': 'oklch(55% 0.02 260 / 0.55)',
		'pad.cozy': '0.8rem 1.6rem',
		'radius.md': '0.6rem'
	};

	// Layers: condition-set → property declarations. Per-emphasis hover layers carry
	// two conditions, so they beat the single-condition emphasis rule for background
	// — and disabled has no hover layer, so it correctly ignores hover.
	type Layer = { when: Partial<Args>; set: Record<string, string> };
	const layers: Layer[] = [
		{ when: {}, set: { background: 'primary', color: 'text.onPrimary', padding: 'pad.cozy', radius: 'radius.md' } },
		{ when: { emphasis: 'secondary' }, set: { background: 'secondary', color: 'text.brand' } },
		{ when: { emphasis: 'tertiary' }, set: { background: 'tertiary', color: 'text.brand' } },
		{ when: { emphasis: 'disabled' }, set: { background: 'disabled', color: 'text.disabled' } },
		{ when: { emphasis: 'primary', state: 'hover' }, set: { background: 'primary.hover' } },
		{ when: { emphasis: 'secondary', state: 'hover' }, set: { background: 'secondary.hover' } },
		{ when: { emphasis: 'tertiary', state: 'hover' }, set: { background: 'tertiary.hover' } }
	];

	const ORDER = ['background', 'color', 'padding', 'radius'] as const;

	const resolved = $derived.by(() => {
		const out: Record<string, { token: string; from: string[]; spec: number }> = {};
		for (const layer of layers) {
			const conds = Object.entries(layer.when);
			if (!conds.every(([k, v]) => (args as Record<string, string>)[k] === v)) continue;
			const from = conds.map(([k, v]) => `${k}: ${v}`);
			const spec = conds.length;
			for (const [prop, token] of Object.entries(layer.set)) {
				const cur = out[prop];
				if (!cur || spec >= cur.spec) out[prop] = { token, from, spec };
			}
		}
		return out;
	});

	const val = (t: string | undefined) => (t ? (tokens[t] ?? t) : '');
	const previewStyle = $derived(
		`background:${val(resolved.background?.token)}; color:${val(resolved.color?.token)};` +
			`padding:${val(resolved.padding?.token)}; border-radius:${val(resolved.radius?.token)};`
	);
	const isColor = (prop: string) => prop === 'background' || prop === 'color';
</script>

<svelte:head>
	<title>KIT•10 — Design System Framework</title>
	<link
		rel="stylesheet"
		href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/7.0.1/css/all.min.css"
	/>
	<meta
		name="description"
		content="KIT•10 is the shared model beneath design and code. Declare intent once; every variant resolves; the code exports to match."
	/>
</svelte:head>

<div id="landing" data-prefers-color-scheme data-compel-color-scheme={getTheme()}>
	<nav>
		<a href="/" class="branding">
			<img src="/favicon.svg" alt="KIT•10" />
		</a>
		<div class="nav-actions">
			<a href="/store" class="nav-link">Store</a>
			<DarkModeToggle />
			<a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener" class="btn-donate"
				><i class="fa-solid fa-heart"></i> Donate</a
			>
			<a href="/edit" class="btn-primary">Open Editor</a>
		</div>
	</nav>

	<main>
		<!-- 0 · Hero -->
		<section class="hero">
			<div class="hero-content">
				<h1>
					Design and Code<br />
					are the <span class="hero-accent">Same Idea</span>
				</h1>
				<p class="hero-sub">
					Design says it one way, code says it another, and keeping the two in sync is somebody’s
					forever-headache. KIT•10 makes them the same thing — set the rules once, and every variant
					(and the code) just follows.
				</p>
				<div class="hero-cta">
					<a href="/edit" class="btn-primary btn-lg">Get Started</a>
					<a href="#resolve" class="btn-outline btn-lg">See it resolve</a>
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
						fill="oklch(80.9% 0.0956 251.8)"
					/>
					<path
						d="M384.31,444.82V476c-131.44,0-238-106.56-238-238h31.18C291.71,238,384.31,330.6,384.31,444.82Z"
						fill="oklch(62.3% 0.188 259.8)"
					/>
					<path
						d="M384.31,0V31.18C384.31,145.4,291.71,238,177.49,238H146.31C146.31,106.56,252.87,0,384.31,0Z"
						fill="oklch(62.3% 0.188 259.8)"
					/>
					<path
						d="M622.31,238H591.13c-114.22,0-206.82-92.6-206.82-206.82V0C515.75,0,622.31,106.56,622.31,238Z"
						fill="oklch(80.9% 0.0956 251.8)"
					/>
					<path
						d="M147.1,0h0a0,0,0,0,1,0,0V328.9A147.1,147.1,0,0,1,0,476H0a0,0,0,0,1,0,0V147.1A147.1,147.1,0,0,1,147.1,0Z"
						fill="oklch(62.3% 0.188 259.8)"
					/>
				</svg>
			</div>
		</section>

		<!-- 1 · Handoff -->
		<section class="section">
			<div class="section-text">
				<h2>Handoff hell, gone</h2>
				<p class="lead">One idea, described twice — with nothing keeping the two in sync.</p>
				<ul class="ticks">
					<li><i class="fa-solid fa-xmark"></i> Design says one thing. Code says it again, differently.</li>
					<li><i class="fa-solid fa-xmark"></i> Every change is re-translated by hand — the <strong>handoff</strong> tax.</li>
					<li><i class="fa-solid fa-check"></i> KIT•10 gives both sides one model. The conditions <em>are</em> the code.</li>
				</ul>
			</div>
			<div class="section-graphic">
				<div class="g-bridge">
					<div class="g-bridge__card g-bridge__card--design">
						<span class="g-bridge__role"><i class="fa-solid fa-pen-nib"></i> Designer draws</span>
						<div class="g-bridge__chips">
							<span class="chip">primary</span><span class="chip">hovered</span>
						</div>
					</div>
					<div class="g-bridge__link">
						<span class="g-bridge__node">same conditions</span>
						<i class="fa-solid fa-arrows-up-down"></i>
					</div>
					<div class="g-bridge__card g-bridge__card--code">
						<span class="g-bridge__role"><i class="fa-solid fa-code"></i> Developer writes</span>
						<pre><code>if (emphasis === <span class="tok-str">'primary'</span>
 && state === <span class="tok-str">'hover'</span>)</code></pre>
					</div>
				</div>
			</div>
		</section>

		<!-- 2 · Resolve demo -->
		<section id="resolve" class="section section--alt section--wide">
			<div class="section-text section-text--center">
				<h2>Change a condition. Watch it resolve.</h2>
				<p class="lead">
					One Kit, a handful of rules. Flip an axis — the winning value is recomputed <em>per
						property</em>. No variant was ever drawn by hand.
				</p>
			</div>

			<div class="demo">
				<div class="demo__stage-wrap">
					<div class="demo__stage">
						<button type="button" class="demo__preview" style={previewStyle} tabindex="-1"
							>Button</button
						>
					</div>
					<div class="demo__axes">
						{#each axes as axis (axis.id)}
							<div class="demo__axis">
								<span class="demo__axis-label">{axis.label}</span>
								<div class="seg">
									{#each axis.options as opt (opt)}
										<button
											type="button"
											class="seg__btn"
											class:seg__btn--on={args[axis.id] === opt}
											onclick={() => (args[axis.id] = opt as never)}>{opt}</button
										>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<div class="demo__code">
					<div class="demo__code-head">
						<span class="demo__dot"></span><span class="demo__dot"></span><span class="demo__dot"
						></span>
						<span class="demo__code-title">Button — resolved</span>
					</div>
					<div class="demo__code-body">
						<div class="code-line code-line--brace">Button {'{'}</div>
						{#each ORDER as prop (prop)}
							{@const r = resolved[prop]}
							<div class="code-line" class:code-line--specific={(r?.spec ?? 0) >= 2}>
								<span class="code-prop">{prop}</span><span class="code-punc">:</span>
								{#if isColor(prop)}<span class="code-swatch" style={`background:${val(r?.token)}`}
									></span>{/if}
								<span class="code-val">{r?.token ?? '—'}</span>
								<span class="code-from"
									>{#if r && r.from.length}// {r.from.join(' ∧ ')}{:else}// base{/if}</span
								>
							</div>
						{/each}
						<div class="code-line code-line--brace">{'}'}</div>
					</div>
				</div>
			</div>
			<p class="demo__caption">
				<i class="fa-solid fa-circle-check"></i>
				More specific wins — a two-condition rule beats a one-condition rule, per property. Try
				<strong>disabled + hover</strong>: it ignores the hover, because no rule matches both.
			</p>
		</section>

		<!-- 3 · The parts — a concrete build-up using the Button example -->
		<section class="section section--block">
			<div class="section-text section-text--center">
				<h2>Five parts, built up</h2>
				<p class="lead">Follow one Button from a choice to a screen — each piece builds on the last.</p>
			</div>
			<div class="anatomy">
				<div class="anatomy__step">
					<div class="anatomy__head"><span class="anatomy__num">1</span><h3>Axes</h3></div>
					<p class="anatomy__def">The choices a design can vary by.</p>
					<div class="anatomy__ex">
						<div class="ex-axis">
							<span class="ex-axis__label">Emphasis</span>
							<span class="ex-chips"><b>primary</b><i>secondary</i><i>tertiary</i></span>
						</div>
						<div class="ex-axis">
							<span class="ex-axis__label">State</span>
							<span class="ex-chips"><b>default</b><i>hover</i></span>
						</div>
					</div>
				</div>

				<i class="fa-solid fa-arrow-down anatomy__arrow"></i>

				<div class="anatomy__step">
					<div class="anatomy__head"><span class="anatomy__num">2</span><h3>Tokens</h3></div>
					<p class="anatomy__def">Named values the rules reuse — set once, and every rule follows.</p>
					<div class="anatomy__ex ex-tokens">
						<span class="ex-token"
							><span class="ex-dot" style="background:oklch(62.3% 0.188 259.8)"></span>brand</span
						>
						<span class="ex-token"
							><span class="ex-dot" style="background:oklch(54.6% 0.2152 262.9)"></span
							>brand-strong</span
						>
					</div>
				</div>

				<i class="fa-solid fa-arrow-down anatomy__arrow"></i>

				<div class="anatomy__step">
					<div class="anatomy__head"><span class="anatomy__num">3</span><h3>Layers</h3></div>
					<p class="anatomy__def">
						A rule: <em>when</em> these conditions hold, <em>set</em> these values.
					</p>
					<div class="anatomy__ex">
						<code class="ex-rule">
							<span class="ex-kw">when</span> {'{ }'} <span class="ex-arrow">→</span> background =
							<span class="ex-tok">brand</span>
						</code>
						<code class="ex-rule ex-rule--win">
							<span class="ex-kw">when</span> {'{ primary + hover }'}
							<span class="ex-arrow">→</span> background = <span class="ex-tok">brand-strong</span>
							<span class="ex-win">wins</span>
						</code>
						<span class="ex-note">more conditions = more specific = wins</span>
					</div>
				</div>

				<i class="fa-solid fa-arrow-down anatomy__arrow"></i>

				<div class="anatomy__step">
					<div class="anatomy__head"><span class="anatomy__num">4</span><h3>Kits</h3></div>
					<p class="anatomy__def">
						One thing’s axes + rules, bundled and reusable — a spec, not a component.
					</p>
					<div class="anatomy__ex">
						<div class="ex-kit">
							<span class="ex-kit__title"><i class="fa-solid fa-cube"></i> Kit · Button</span>
							<span class="ex-kit__line">Axes — Emphasis, State</span>
							<span class="ex-kit__line">Layers — 3 rules</span>
						</div>
					</div>
				</div>

				<i class="fa-solid fa-arrow-down anatomy__arrow"></i>

				<div class="anatomy__step">
					<div class="anatomy__head"><span class="anatomy__num">5</span><h3>Views</h3></div>
					<p class="anatomy__def">Kits placed together into an actual screen. Views can nest Views.</p>
					<div class="anatomy__ex">
						<div class="ex-view">
							<span class="ex-view__bar"><i></i><i></i><i></i></span>
							<div class="ex-view__body">
								<span class="ex-view__line"></span>
								<button type="button" class="ex-view__btn" tabindex="-1">Button</button>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>

		<!-- 4 · Specificity: theory + a concrete result -->
		<section class="section section--alt section--block">
			<div class="section-text section-text--center">
				<h2>More specific always wins — and only one thing wins</h2>
				<p class="lead">
					Three tiers settle every contest. No lower tier ever beats a higher one, so every axis
					state has exactly one winner per property — always traceable to the rule that set it.
				</p>
			</div>
			<div class="g-spec-pair">
				<div class="g-tiers">
					<div class="g-tier" style="--rank: 3">
						<span class="g-tier__rank">1</span>
						<div class="g-tier__body">
							<span class="g-tier__name">Kit priority</span>
							<span class="g-tier__ex">higher-priority Kit wins</span>
						</div>
					</div>
					<div class="g-tier" style="--rank: 2">
						<span class="g-tier__rank">2</span>
						<div class="g-tier__body">
							<span class="g-tier__name">Condition count</span>
							<span class="g-tier__ex">two conditions beat one</span>
						</div>
					</div>
					<div class="g-tier" style="--rank: 1">
						<span class="g-tier__rank">3</span>
						<div class="g-tier__body">
							<span class="g-tier__name">Axis order</span>
							<span class="g-tier__ex">later axis breaks the tie</span>
						</div>
					</div>
					<div class="g-tiers__note"><i class="fa-solid fa-check-double"></i> exactly one winner</div>
				</div>

				<div class="g-why">
					<span class="g-why__label">This button looks like this because —</span>
					<div class="g-why__stage">
						<button
							type="button"
							class="demo__preview"
							style="background:oklch(54.6% 0.2152 262.9); color:oklch(100% 0 0); padding:0.8rem 1.6rem; border-radius:0.6rem;"
							tabindex="-1">Button</button
						>
					</div>
					<ul class="g-why__stack">
						<li class="g-why__won">
							<span class="g-why__cond">emphasis ∧ hover</span>
							<span class="g-why__prop">background</span>
							<i class="fa-solid fa-trophy"></i>
						</li>
						<li class="g-why__lost">
							<span class="g-why__cond">emphasis</span>
							<span class="g-why__prop">background</span>
							<span class="g-why__x">overridden</span>
						</li>
						<li>
							<span class="g-why__cond">emphasis</span>
							<span class="g-why__prop">color</span>
						</li>
						<li>
							<span class="g-why__cond">base</span>
							<span class="g-why__prop">padding · radius</span>
						</li>
					</ul>
				</div>
			</div>
		</section>

		<!-- 5 · Plugins around the core (radial graph) -->
		<section class="section">
			<div class="section-text">
				<h2>Plugins around a tiny core</h2>
				<p class="lead">The core only resolves intent into properties. Everything else is a plugin.</p>
				<ul class="ticks">
					<li><i class="fa-solid fa-circle-nodes"></i> Interpreters translate. Renderers draw. Utilities add fonts, icons, export.</li>
					<li><i class="fa-solid fa-shuffle"></i> Swap one, run two side by side, or write your own.</li>
				</ul>
				<a href="/store" class="section-link">Browse the plugin store <i class="fa-solid fa-arrow-right"></i></a>
			</div>
			<div class="section-graphic">
				<svg class="g-graph" viewBox="0 0 360 300" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
					<!-- edges -->
					<g stroke="var(--color-border)" stroke-width="2">
						<line x1="180" y1="150" x2="180" y2="52" />
						<line x1="180" y1="150" x2="280" y2="118" />
						<line x1="180" y1="150" x2="242" y2="235" />
						<line x1="180" y1="150" x2="118" y2="235" />
						<line x1="180" y1="150" x2="80" y2="118" />
					</g>
					<!-- satellites -->
					<g class="g-graph__sat">
						<rect x="134" y="37" width="92" height="30" rx="15" />
						<text x="180" y="56">Charter</text>
					</g>
					<g class="g-graph__sat">
						<rect x="236" y="103" width="88" height="30" rx="15" />
						<text x="280" y="122">Vellum</text>
					</g>
					<g class="g-graph__sat">
						<rect x="192" y="220" width="100" height="30" rx="15" />
						<text x="242" y="239">Fontavious</text>
					</g>
					<g class="g-graph__sat">
						<rect x="76" y="220" width="84" height="30" rx="15" />
						<text x="118" y="239">Tenner</text>
					</g>
					<g class="g-graph__sat g-graph__sat--you">
						<rect x="34" y="103" width="92" height="30" rx="15" />
						<text x="80" y="122">Your plugin</text>
					</g>
					<!-- core -->
					<g class="g-graph__core">
						<circle cx="180" cy="150" r="34" />
						<text x="180" y="147">Core</text>
						<text x="180" y="160" class="g-graph__sub">resolver</text>
					</g>
				</svg>
			</div>
		</section>

		<!-- 6 · Import in, own everything out -->
		<section class="section section--block">
			<div class="section-text section-text--center">
				<h2>Bring designs in. Own everything you ship out.</h2>
				<p class="lead">
					Import existing work, refine it as rules, and export code that’s <em>yours</em> — no
					lock-in, no attribution, nothing phoning home.
				</p>
			</div>
			<div class="g-flow">
				<div class="g-flow__col">
					<span class="g-flow__head">Bring in</span>
					<span class="g-flow__item"><i class="fa-brands fa-figma"></i> Figma</span>
					<span class="g-flow__item"><i class="fa-solid fa-bezier-curve"></i> Penpot</span>
					<span class="g-flow__item"><i class="fa-brands fa-html5"></i> Existing code</span>
				</div>
				<i class="fa-solid fa-arrow-right g-flow__arrow"></i>
				<div class="g-flow__core">
					<i class="fa-solid fa-diagram-project"></i>
					<span>Refine as Kits</span>
					<small>explicit, shareable rules</small>
				</div>
				<i class="fa-solid fa-arrow-right g-flow__arrow"></i>
				<div class="g-flow__col g-flow__col--out">
					<span class="g-flow__head">Ship out</span>
					<span class="g-flow__item"><i class="fa-brands fa-html5"></i> HTML</span>
					<span class="g-flow__item"><i class="fa-brands fa-css3-alt"></i> SCSS</span>
					<span class="g-flow__item"><i class="fa-solid fa-bolt"></i> live-vite</span>
					<span class="g-flow__own"><i class="fa-solid fa-shield-halved"></i> 100% yours</span>
				</div>
			</div>
			<p class="section-kicker section-kicker--center">
				The rules belong to the commons. The output belongs to you.
			</p>
		</section>

		<section class="cta-section">
			<h2>Declare intent. Let it resolve.</h2>
			<p>Stop maintaining variants by hand. Start with a single rule.</p>
			<a href="/edit" class="btn-primary btn-lg">Open Editor</a>
		</section>
	</main>

	<footer class="footer">
		<div class="footer__left">
			<div class="footer__brand">
				<img src="/favicon.svg" alt="KIT•10" />
				<span>KIT•10</span>
			</div>
			<p class="footer__made">
				Made with a passionate hate of bad workflows<br />
				and the love of design.
			</p>
			<span class="footer__copy">© {year} KIT•10</span>
		</div>

		<div class="footer__team">
			<h3 class="footer__team-title">The Team</h3>
			<a
				href="https://github.com/yorqat"
				target="_blank"
				rel="noopener"
				class="footer__member"
			>
				<img
					class="footer__avatar"
					src="https://github.com/yorqat.png?size=96"
					alt="yorqat"
					loading="lazy"
					width="32"
					height="32"
				/>
				<span>yorqat</span>
				<i class="fa-brands fa-github"></i>
			</a>
			<a href="https://ko-fi.com/yorqat" target="_blank" rel="noopener" class="btn-kofi">
				<i class="fa-solid fa-mug-hot"></i> Support on Ko-fi
			</a>
		</div>
	</footer>
</div>

<style lang="scss" global>
	@use '_index' as *;

	$light: (
		pure: 'oklch(100% 0 0)',
		pure-alt: 'oklch(0% 0 0)',
		bg: 'oklch(98.4% 0.0034 247.9)',
		surface: 'oklch(100% 0 0)',
		surface-alt: 'oklch(96.8% 0.0069 247.9)',
		code-bg: 'oklch(96.8% 0.0069 247.9)',
		text: 'oklch(27.9% 0.0368 260)',
		text-muted: 'oklch(55.4% 0.0407 257.4)',
		primary: 'oklch(62.3% 0.188 259.8)',
		primary-hover: 'oklch(54.6% 0.2152 262.9)',
		primary-soft: 'oklch(93.5% 0.035 255)',
		focus-ring: 'oklch(80.9% 0.0956 251.8)',
		border: 'oklch(92.9% 0.0126 255.5)',
		heading: 'oklch(20.8% 0.0398 265.8)',
		success: 'oklch(58% 0.13 155)',
		danger: 'oklch(58.6% 0.222 17.6)',
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
		code-bg: 'oklch(22% 0.03 267)',
		text: 'oklch(92.9% 0.0126 255.5)',
		text-muted: 'oklch(71.1% 0.0351 256.8)',
		primary: 'oklch(71.4% 0.1434 254.6)',
		primary-hover: 'oklch(80.9% 0.0956 251.8)',
		primary-soft: 'oklch(33% 0.06 260)',
		focus-ring: 'oklch(48.8% 0.2172 264.4)',
		border: 'oklch(44.6% 0.0374 257.3)',
		heading: 'oklch(98.4% 0.0034 247.9)',
		success: 'oklch(72% 0.15 155)',
		danger: 'oklch(64.5% 0.2154 16.4)',
		donate-text: 'oklch(64.5% 0.2154 16.4)',
		donate-border: 'oklch(45.5% 0.1713 13.7)',
		donate-icon: 'oklch(71.9% 0.169 13.4)',
		donate-hover-bg: 'oklch(41% 0.1502 10.3)',
		donate-hover-border: 'oklch(58.6% 0.222 17.6)',
		donate-hover-text: 'oklch(81% 0.1061 11.6)'
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

		code,
		pre {
			font-family: $x-font-family-mono;
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
			grid-template-columns: 1.1fr 0.9fr;
			text-align: left;
		}

		@include layout-respond-max('md') {
			text-align: center;
			padding: $x-space-8 $x-space-4;
		}

		&-content {
			max-width: 38rem;
		}

		h1 {
			@include fonts-stack('Satoshi-Bold', sans);
			// Fluid: ~40px on phones up to ~60px on wide screens — a confident hero without the
			// oversized 76px two-line block the fixed 6xl produced.
			font-size: clamp(2.5rem, 5vw, 3.75rem);
			line-height: 1.1;
			color: var(--color-heading);
			margin-bottom: $x-space-6;
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
			max-width: 34rem;

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
		padding: $x-space-8 $x-space-6;
		background-color: var(--color-bg);
		gap: $x-space-6;

		@include layout-respond('lg') {
			grid-template-columns: 1fr 1fr;
			padding: $x-space-10 $x-space-12;
			gap: $x-space-10;
			justify-items: center;
		}

		&--alt {
			background-color: var(--color-surface);
		}

		&--wide,
		&--block {
			@include layout-respond('lg') {
				grid-template-columns: 1fr;
				justify-items: stretch;
			}
		}

		&-graphic {
			display: flex;
			justify-content: center;
			align-items: center;
			width: 100%;
			min-height: 16rem;
		}

		&-text {
			max-width: 32rem;

			&--center {
				max-width: 46rem;
				margin-inline: auto;
				text-align: center;
			}

			h2 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-3xl;
				color: var(--color-heading);
				margin-bottom: $x-space-3;
				line-height: 1.15;
			}

			.lead {
				color: var(--color-text-muted);
				font-size: $x-font-size-lg;
				line-height: 1.55;
			}

			em {
				color: var(--color-text);
				font-style: normal;
				@include fonts-stack('Satoshi-Medium', sans);
			}
		}

		// Skimmable tick lists — the prose lives here, one line each.
		.ticks {
			list-style: none;
			padding: 0;
			margin: $x-space-5 0 0;
			display: flex;
			flex-direction: column;
			gap: $x-space-3;

			li {
				display: flex;
				align-items: baseline;
				gap: $x-space-3;
				font-size: $x-font-size-md;
				color: var(--color-text-muted);
				line-height: 1.45;

				strong {
					color: var(--color-primary);
					@include fonts-stack('Satoshi-Bold', sans);
				}
				em {
					color: var(--color-text);
					font-style: normal;
					@include fonts-stack('Satoshi-Medium', sans);
				}

				i {
					flex: 0 0 auto;
					color: var(--color-text-muted);
					font-size: $x-font-size-sm;
				}
				.fa-check,
				.fa-circle-nodes,
				.fa-shuffle {
					color: var(--color-primary);
				}
				.fa-xmark {
					color: var(--color-danger);
				}
			}
		}

		&-kicker {
			margin-top: $x-space-5;
			color: var(--color-primary);
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-lg;

			&--center {
				text-align: center;
			}
		}

		&-link {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			margin-top: $x-space-5;
			color: var(--color-primary);
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;

			i {
				transition: transform $x-duration-ui $x-timing-ui;
			}
			&:hover i {
				transform: translateX(3px);
			}
		}
	}

	// ── 1 · Bridge ─────────────────────────────────────────────────────────────
	.g-bridge {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: $x-space-3;
		width: 100%;
		max-width: 22rem;

		&__card {
			padding: $x-space-4 $x-space-5;
			border-radius: $x-space-2;
			border: 1px solid var(--color-border);
			background: var(--color-surface);

			&--code {
				background: var(--color-code-bg);
			}
		}

		&__role {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			letter-spacing: 1px;
			color: var(--color-text-muted);
			margin-bottom: $x-space-3;
		}

		&__chips {
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-2;
		}

		&__link {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: $x-space-3;
			color: var(--color-primary);

			i {
				font-size: $x-font-size-lg;
			}
		}

		&__node {
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-sm;
			padding: $x-space-1 $x-space-3;
			border-radius: 999px;
			background: var(--color-primary-soft);
			color: var(--color-primary);
		}

		pre {
			margin: 0;
			font-size: $x-font-size-sm;
			line-height: 1.5;
			color: var(--color-text);
			white-space: pre-wrap;
		}
		.tok-str {
			color: var(--color-primary);
		}
	}

	.chip {
		font-size: $x-font-size-sm;
		padding: $x-space-1 $x-space-3;
		border-radius: 999px;
		background: var(--color-primary-soft);
		color: var(--color-primary);
		@include fonts-stack('Satoshi-Medium', sans);
	}

	// ── 2 · Resolve demo ───────────────────────────────────────────────────────
	.demo {
		display: grid;
		gap: $x-space-6;
		width: 100%;
		max-width: 60rem;
		margin: $x-space-8 auto 0;

		@include layout-respond('md') {
			grid-template-columns: 1fr 1fr;
			align-items: stretch;
		}

		&__stage-wrap {
			display: flex;
			flex-direction: column;
			gap: $x-space-4;
		}

		&__stage {
			flex: 1;
			min-height: 12rem;
			display: grid;
			place-items: center;
			border-radius: $x-space-3;
			border: 1px solid var(--color-border);
			background: var(--color-surface);
			background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
			background-size: 16px 16px;
		}

		&__preview {
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-lg;
			border: none;
			cursor: default;
			transition:
				background-color $x-duration-ui $x-timing-ui,
				padding $x-duration-ui $x-timing-ui,
				color $x-duration-ui $x-timing-ui;
		}

		&__axes {
			display: flex;
			flex-direction: column;
			gap: $x-space-3;
		}

		&__axis {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: $x-space-3;
			flex-wrap: wrap;
		}

		&__axis-label {
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			@include fonts-stack('Satoshi-Medium', sans);
		}

		&__code {
			border-radius: $x-space-3;
			border: 1px solid var(--color-border);
			background: var(--color-code-bg);
			overflow: hidden;
			text-align: left;
		}

		&__code-head {
			display: flex;
			align-items: center;
			gap: $x-space-2;
			padding: $x-space-3 $x-space-4;
			border-bottom: 1px solid var(--color-border);
		}

		&__dot {
			width: 10px;
			height: 10px;
			border-radius: 50%;
			background: var(--color-border);
		}

		&__code-title {
			margin-left: $x-space-2;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			font-family: $x-font-family-mono;
		}

		&__code-body {
			padding: $x-space-4;
			font-family: $x-font-family-mono;
			font-size: $x-font-size-sm;
			line-height: 1.9;
			// Long resolved lines (nowrap) scroll inside the card rather than pushing the
			// whole page wider on mobile.
			overflow-x: auto;
		}

		&__caption {
			max-width: 46rem;
			margin: $x-space-6 auto 0;
			text-align: center;
			font-size: $x-font-size-md;
			color: var(--color-text-muted);

			strong {
				color: var(--color-text);
				@include fonts-stack('Satoshi-Medium', sans);
			}
			i {
				color: var(--color-success);
				margin-right: $x-space-1;
			}
		}
	}

	.seg {
		display: inline-flex;
		border: 1px solid var(--color-border);
		border-radius: $x-space-2;
		overflow: hidden;
		background: var(--color-surface);

		&__btn {
			padding: $x-space-1 $x-space-3;
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			cursor: pointer;
			border: none;
			@include fonts-stack('Satoshi-Medium', sans);
			transition:
				background-color $x-duration-ui $x-timing-ui,
				color $x-duration-ui $x-timing-ui;

			&--on {
				background: var(--color-primary);
				color: var(--color-pure);
			}

			&:not(&--on):hover {
				color: var(--color-text);
			}
		}
	}

	.code-line {
		display: flex;
		align-items: center;
		gap: $x-space-2;
		white-space: nowrap;

		&--brace {
			color: var(--color-text-muted);
		}

		&--specific .code-val {
			color: var(--color-success);
		}
		&--specific .code-from {
			color: var(--color-success);
			opacity: 0.85;
		}

		.code-prop {
			color: var(--color-text);
			padding-left: $x-space-4;
		}
		.code-punc {
			color: var(--color-text-muted);
		}
		.code-swatch {
			width: 12px;
			height: 12px;
			border-radius: 3px;
			border: 1px solid oklch(50% 0 0 / 0.3);
			flex: 0 0 auto;
		}
		.code-val {
			color: var(--color-primary);
		}
		.code-from {
			margin-left: auto;
			color: var(--color-text-muted);
			opacity: 0.7;
			font-size: 0.9em;
		}
	}

	// ── 3 · Anatomy build-up ───────────────────────────────────────────────────
	.anatomy {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: $x-space-2;
		width: 100%;
		max-width: 34rem;
		margin: $x-space-8 auto 0;

		&__step {
			width: 100%;
			padding: $x-space-4 $x-space-5;
			border-radius: $x-space-3;
			border: 1px solid var(--color-border);
			background: var(--color-surface);
		}

		&__head {
			display: flex;
			align-items: center;
			gap: $x-space-3;
			margin-bottom: $x-space-1;

			h3 {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-lg;
				color: var(--color-heading);
			}
		}

		&__num {
			flex: 0 0 auto;
			width: 1.6rem;
			height: 1.6rem;
			border-radius: 50%;
			display: grid;
			place-items: center;
			background: var(--color-primary);
			color: var(--color-pure);
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-sm;
		}

		&__def {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
			line-height: 1.5;
			margin-bottom: $x-space-3;

			em {
				color: var(--color-primary);
				font-style: normal;
				@include fonts-stack('Satoshi-Medium', sans);
			}
		}

		&__ex {
			display: flex;
			flex-direction: column;
			gap: $x-space-2;
		}

		&__arrow {
			color: var(--color-text-muted);
			opacity: 0.6;
			font-size: $x-font-size-md;
		}
	}

	// Axes example — labelled chip rows
	.ex-axis {
		display: flex;
		align-items: center;
		gap: $x-space-3;
		flex-wrap: wrap;

		&__label {
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			min-width: 4.5rem;
			@include fonts-stack('Satoshi-Medium', sans);
		}
	}
	.ex-chips {
		display: inline-flex;
		gap: $x-space-1;
		flex-wrap: wrap;

		b,
		i {
			font-style: normal;
			font-size: $x-font-size-xs;
			padding: 2px $x-space-2;
			border-radius: 999px;
		}
		b {
			background: var(--color-primary);
			color: var(--color-pure);
			@include fonts-stack('Satoshi-Medium', sans);
		}
		i {
			background: var(--color-primary-soft);
			color: var(--color-primary);
		}
	}

	// Tokens example — named swatches
	.ex-tokens {
		flex-direction: row;
		flex-wrap: wrap;
	}
	.ex-token {
		display: inline-flex;
		align-items: center;
		gap: $x-space-2;
		font-size: $x-font-size-sm;
		font-family: $x-font-family-mono;
		color: var(--color-text);
		padding: $x-space-1 $x-space-3;
		border-radius: $x-space-1;
		background: var(--color-code-bg);

		.ex-dot {
			width: 12px;
			height: 12px;
			border-radius: 3px;
			border: 1px solid oklch(50% 0 0 / 0.25);
		}
	}

	// Layers example — readable rules
	.ex-rule {
		display: block;
		font-family: $x-font-family-mono;
		font-size: $x-font-size-sm;
		color: var(--color-text);
		padding: $x-space-2 $x-space-3;
		border-radius: $x-space-1;
		background: var(--color-code-bg);
		overflow-x: auto;
		white-space: nowrap;

		.ex-kw {
			color: var(--color-text-muted);
		}
		.ex-arrow {
			color: var(--color-primary);
		}
		.ex-tok {
			color: var(--color-primary);
		}

		&--win {
			border: 1px solid var(--color-success);
			.ex-tok {
				color: var(--color-success);
			}
		}
	}
	.ex-win {
		font-family: 'Satoshi-Bold', sans-serif;
		font-size: $x-font-size-xs;
		color: var(--color-success);
		margin-left: $x-space-1;
	}
	.ex-note {
		font-size: $x-font-size-xs;
		color: var(--color-text-muted);
		font-style: italic;
	}

	// Kit example — a bundle box
	.ex-kit {
		border: 1.5px solid var(--color-primary);
		border-radius: $x-space-2;
		padding: $x-space-3 $x-space-4;
		display: flex;
		flex-direction: column;
		gap: 2px;
		background: color-mix(in oklab, var(--color-primary) 6%, transparent);

		&__title {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-sm;
			color: var(--color-primary);
			margin-bottom: $x-space-1;

			i {
				margin-right: $x-space-1;
			}
		}
		&__line {
			font-family: $x-font-family-mono;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}
	}

	// View example — a mini screen with a rendered button
	.ex-view {
		border: 1px solid var(--color-border);
		border-radius: $x-space-2;
		overflow: hidden;
		max-width: 16rem;

		&__bar {
			display: flex;
			gap: 4px;
			padding: $x-space-2 $x-space-3;
			background: var(--color-surface-alt);
			border-bottom: 1px solid var(--color-border);

			i {
				width: 8px;
				height: 8px;
				border-radius: 50%;
				background: var(--color-border);
			}
		}
		&__body {
			display: flex;
			flex-direction: column;
			gap: $x-space-3;
			padding: $x-space-4;
			align-items: flex-start;
		}
		&__line {
			width: 70%;
			height: 8px;
			border-radius: 4px;
			background: var(--color-surface-alt);
		}
		&__btn {
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-sm;
			padding: $x-space-2 $x-space-4;
			border-radius: $x-space-1;
			border: none;
			background: var(--color-primary);
			color: var(--color-pure);
		}
	}

	// ── 4 · Specificity: tiers + concrete result ───────────────────────────────
	.g-spec-pair {
		display: grid;
		gap: $x-space-8;
		width: 100%;
		max-width: 58rem;
		margin: $x-space-8 auto 0;
		align-items: center;

		@include layout-respond('md') {
			grid-template-columns: 1fr 1fr;
		}
	}

	.g-tiers {
		display: flex;
		flex-direction: column;
		gap: $x-space-3;
		width: 100%;
		max-width: 22rem;
		margin-inline: auto;
	}

	.g-tier {
		display: flex;
		align-items: center;
		gap: $x-space-3;
		padding: $x-space-4;
		border-radius: $x-space-2;
		border: 1px solid var(--color-border);
		background: color-mix(in oklab, var(--color-primary) calc(var(--rank) * 7%), var(--color-surface));
		width: calc(72% + var(--rank) * 9%);

		&__rank {
			flex: 0 0 auto;
			width: 1.9rem;
			height: 1.9rem;
			border-radius: 50%;
			display: grid;
			place-items: center;
			background: var(--color-primary);
			color: var(--color-pure);
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-sm;
		}

		&__body {
			display: flex;
			flex-direction: column;
		}

		&__name {
			@include fonts-stack('Satoshi-Bold', sans);
			color: var(--color-heading);
			font-size: $x-font-size-md;
		}

		&__ex {
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}
	}

	.g-tiers__note {
		display: inline-flex;
		align-items: center;
		gap: $x-space-2;
		margin-top: $x-space-1;
		font-size: $x-font-size-sm;
		color: var(--color-success);
		@include fonts-stack('Satoshi-Medium', sans);
	}

	.g-why {
		padding: $x-space-5;
		border-radius: $x-space-3;
		border: 1px solid var(--color-border);
		background: var(--color-bg);

		&__label {
			display: block;
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			margin-bottom: $x-space-3;
		}

		&__stage {
			display: grid;
			place-items: center;
			padding: $x-space-5;
			border-radius: $x-space-2;
			background: var(--color-surface);
			background-image: radial-gradient(var(--color-border) 1px, transparent 1px);
			background-size: 16px 16px;
			margin-bottom: $x-space-4;
		}

		&__stack {
			list-style: none;
			padding: 0;
			margin: 0;
			display: flex;
			flex-direction: column;
			gap: $x-space-2;

			li {
				display: flex;
				align-items: center;
				gap: $x-space-2;
				font-family: $x-font-family-mono;
				font-size: $x-font-size-xs;
				padding: $x-space-2 $x-space-3;
				border-radius: $x-space-1;
				background: var(--color-surface);
				color: var(--color-text-muted);
			}
		}

		&__cond {
			color: var(--color-primary);
		}
		&__prop {
			color: var(--color-text);
			margin-left: auto;
		}

		&__won {
			border: 1px solid var(--color-success);
			color: var(--color-text) !important;
			i {
				color: var(--color-success);
			}
			.g-why__prop {
				margin-left: $x-space-2;
			}
			.fa-trophy {
				margin-left: auto;
			}
		}

		&__lost {
			opacity: 0.6;
			text-decoration: line-through;
			.g-why__x {
				margin-left: auto;
				text-decoration: none;
				font-style: italic;
			}
			.g-why__prop {
				margin-left: $x-space-2;
			}
		}
	}

	// ── 5 · Plugin graph ───────────────────────────────────────────────────────
	.g-graph {
		width: 100%;
		max-width: 26rem;
		height: auto;

		text {
			font-family: 'Satoshi-Medium', sans-serif;
			font-size: 12px;
			text-anchor: middle;
			dominant-baseline: middle;
		}

		&__sat {
			rect {
				fill: var(--color-surface);
				stroke: var(--color-border);
				stroke-width: 1.5;
			}
			text {
				fill: var(--color-text);
			}
			&--you rect {
				fill: var(--color-primary-soft);
				stroke: var(--color-primary);
				stroke-dasharray: 4 3;
			}
			&--you text {
				fill: var(--color-primary);
			}
		}

		&__core {
			circle {
				fill: var(--color-primary);
			}
			text {
				fill: var(--color-pure);
				font-family: 'Satoshi-Bold', sans-serif;
			}
			.g-graph__sub {
				font-size: 9px;
				font-family: 'Satoshi-Regular', sans-serif;
				opacity: 0.85;
			}
		}
	}

	// ── 6 · Import → own → export ──────────────────────────────────────────────
	.g-flow {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: $x-space-4;
		width: 100%;
		max-width: 56rem;
		margin: $x-space-8 auto 0;

		@include layout-respond('md') {
			flex-direction: row;
			align-items: stretch;
		}

		&__col {
			display: flex;
			flex-direction: column;
			gap: $x-space-2;
			padding: $x-space-4;
			border-radius: $x-space-3;
			border: 1px solid var(--color-border);
			background: var(--color-surface);
			min-width: 12rem;

			&--out {
				border-color: var(--color-primary);
			}
		}

		&__head {
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			letter-spacing: 1px;
			color: var(--color-text-muted);
			margin-bottom: $x-space-1;
		}

		&__item {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			font-size: $x-font-size-sm;
			color: var(--color-text);

			i {
				width: 1.1rem;
				text-align: center;
				color: var(--color-text-muted);
			}
		}

		&__own {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			margin-top: $x-space-2;
			padding: $x-space-1 $x-space-3;
			border-radius: 999px;
			background: var(--color-primary);
			color: var(--color-pure);
			font-size: $x-font-size-xs;
			@include fonts-stack('Satoshi-Bold', sans);
			align-self: flex-start;
		}

		&__arrow {
			color: var(--color-text-muted);
			font-size: $x-font-size-lg;
			// Default (mobile) the flow is stacked in a column, so the arrows point DOWN.
			// Only once it becomes a row at md+ do they point right.
			transform: rotate(90deg);

			@include layout-respond('md') {
				transform: rotate(0deg);
			}
		}

		&__core {
			display: flex;
			flex-direction: column;
			align-items: center;
			justify-content: center;
			gap: $x-space-1;
			padding: $x-space-5 $x-space-4;
			border-radius: $x-space-3;
			background: var(--color-primary);
			color: var(--color-pure);
			text-align: center;
			min-width: 11rem;

			i {
				font-size: $x-font-size-xl;
			}
			span {
				@include fonts-stack('Satoshi-Bold', sans);
			}
			small {
				font-size: $x-font-size-xs;
				opacity: 0.85;
			}
		}
	}

	.cta-section {
		text-align: center;
		padding: $x-space-16 $x-space-6;
		background-color: var(--color-bg);
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

	.footer {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		justify-content: space-between;
		gap: $x-space-8;
		padding: $x-space-12 $x-space-8;
		background-color: var(--color-surface);
		border-top: 1px solid var(--color-border);

		@include layout-respond('md') {
			flex-direction: row;
			align-items: flex-start;
		}

		&__left {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: $x-space-4;
		}

		&__brand {
			display: flex;
			align-items: center;
			gap: $x-space-2;
			color: var(--color-heading);

			img {
				height: $x-font-size-lg;
			}
			span {
				@include fonts-stack('Satoshi-Bold', sans);
				font-size: $x-font-size-lg;
			}
		}

		&__made {
			@include fonts-stack('Satoshi-Light', sans);
			color: var(--color-text-muted);
			font-size: $x-font-size-lg;
			line-height: 1.5;
			max-width: 34rem;
		}

		&__copy {
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			opacity: 0.7;
			margin-top: $x-space-2;
		}

		&__team {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: $x-space-3;

			@include layout-respond('md') {
				align-items: flex-end;
				text-align: right;
			}
		}

		&__team-title {
			@include fonts-stack('Satoshi-Bold', sans);
			font-size: $x-font-size-sm;
			text-transform: uppercase;
			letter-spacing: 1.5px;
			color: var(--color-text-muted);
		}

		&__member {
			display: inline-flex;
			align-items: center;
			gap: $x-space-2;
			color: var(--color-text);
			text-decoration: none;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			transition: color $x-duration-ui $x-timing-ui;

			i {
				font-size: $x-font-size-md;
				color: var(--color-text-muted);
				transition: color $x-duration-ui $x-timing-ui;
			}

			&:hover {
				color: var(--color-primary);

				i {
					color: var(--color-primary);
				}
			}
		}

		&__avatar {
			width: 2rem;
			height: 2rem;
			border-radius: 50%;
			border: 1px solid var(--color-border);
			object-fit: cover;
		}
	}

	#landing {
		// Scoped under #landing (not the top-level `nav {}` block): `#landing a` carries an id and
		// would out-specify a plain `nav .nav-link`, stripping color/font. Same reason as the buttons.
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

			@include layout-respond-max('md') {
				display: none;
			}
		}

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

		.btn-kofi {
			display: inline-flex;
			align-items: center;
			justify-content: center;
			gap: $x-space-2;
			padding: $x-space-3 $x-space-6;
			background-color: var(--color-donate-text);
			color: var(--color-pure);
			border: none;
			border-radius: $x-space-3;
			@include fonts-stack('Satoshi-Medium', sans);
			font-size: $x-font-size-md;
			text-decoration: none;
			cursor: pointer;
			transition:
				background-color $x-duration-ui $x-timing-ui,
				box-shadow $x-duration-ui $x-timing-ui;

			i {
				font-size: $x-font-size-lg;
			}

			&:hover {
				background-color: var(--color-donate-hover-text);
				box-shadow: $x-bs-sketch-soft;
				color: var(--color-pure);
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

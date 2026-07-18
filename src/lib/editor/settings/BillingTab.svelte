<script lang="ts">
	interface Tier {
		id: string;
		name: string;
		price: string;
		cadence: string;
		tagline: string;
		features: string[];
		cta: string;
		active?: boolean;
		featured?: boolean;
	}

	const tiers: Tier[] = [
		{
			id: 'free',
			name: 'Free Forever',
			price: '$0',
			cadence: 'forever',
			tagline: 'Everything you need to design solo.',
			features: [
				'Unlimited local projects',
				'All community plugins',
				'In-browser PGlite storage',
				'Display-P3 wide-gamut preview'
			],
			cta: 'Current plan',
			active: true
		},
		{
			id: 'studio',
			name: 'Studio',
			price: '$14',
			cadence: 'per month',
			tagline: 'For designers who ship.',
			features: [
				'Cloud sync across devices',
				'Unlimited workspaces',
				'Priority font CDN + uploads',
				'30-day version history',
				'Private plugin installs'
			],
			cta: 'Upgrade to Studio',
			featured: true
		},
		{
			id: 'atelier',
			name: 'Atelier',
			price: '$49',
			cadence: 'per seat / month',
			tagline: 'For teams and type foundries.',
			features: [
				'Everything in Studio',
				'Team seats & shared kits',
				'Private plugin registry',
				'SSO / SAML',
				'Export targets: CSS, SCSS, Swift',
				'White-glove onboarding'
			],
			cta: 'Talk to us'
		}
	];
</script>

<div class="tab">
	<p class="hint">You’re on the free plan. Upgrades are illustrative — there’s no billing backend yet.</p>
	<div class="tiers">
		{#each tiers as t (t.id)}
			<article class="tier" class:active={t.active} class:featured={t.featured}>
				{#if t.active}<span class="ribbon">Active</span>{/if}
				{#if t.featured}<span class="ribbon featured-ribbon">Popular</span>{/if}
				<h3>{t.name}</h3>
				<div class="price"><span class="amount">{t.price}</span><span class="cadence">{t.cadence}</span></div>
				<p class="tagline">{t.tagline}</p>
				<ul>
					{#each t.features as f (f)}
						<li><i class="fa-solid fa-check"></i> {f}</li>
					{/each}
				</ul>
				<button class="cta" disabled={t.active} class:primary={t.featured}>{t.cta}</button>
			</article>
		{/each}
	</div>

	<div class="support">
		<p class="lede">
			KIT·10 stays free and keeps getting built because of donations.
		</p>
		<p class="powering">By supporting, you’re powering:</p>
		<ul class="powers">
			<li><i class="fa-solid fa-cube"></i> KIT·10</li>
			<li><i class="fa-solid fa-plug"></i> First-party plugins</li>
			<li><i class="fa-solid fa-cat"></i> Cats</li>
		</ul>
		<a class="donate" href="https://ko-fi.com/yorqat" target="_blank" rel="noreferrer">
			<i class="fa-solid fa-heart"></i> Support KIT·10
		</a>
	</div>
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-sm;
	}

	.hint {
		color: var(--color-text-muted);
		font-size: $x-font-size-sm;
		@include fonts-stack('Satoshi-Regular', sans);
	}

	.tiers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: $x-space-sm;
	}

	.tier {
		position: relative;
		border: 1px solid var(--color-bg);
		border-radius: $x-space-xs;
		background: var(--color-surface);
		padding: $x-space-sm;
		display: flex;
		flex-direction: column;
		gap: $x-space-xs;

		&.active {
			border-color: var(--color-primary);
		}
		&.featured {
			border-color: var(--color-primary);
			box-shadow: 0 0 0 1px var(--color-primary);
		}

		.ribbon {
			position: absolute;
			top: -1px;
			right: -1px;
			background: var(--color-primary);
			color: var(--color-bg);
			font-size: $x-font-size-sm;
			padding: 2px $x-space-xs;
			border-radius: 0 $x-space-xs 0 $x-space-xs;
			letter-spacing: 1px;
			text-transform: uppercase;
		}
		.featured-ribbon {
			background: var(--color-text);
		}

		h3 {
			@include fonts-stack('Satoshi-Regular', sans);
			font-weight: 600;
			color: var(--color-text);
			font-size: $x-font-size-lg;
		}

		.price {
			display: flex;
			align-items: baseline;
			gap: $x-space-xs;

			.amount {
				font-size: calc($x-font-size-lg * 1.4);
				@include fonts-stack('Satoshi-Regular', sans);
				font-weight: 700;
				color: var(--color-text);
			}
			.cadence {
				font-size: $x-font-size-sm;
				color: var(--color-text-muted);
			}
		}

		.tagline {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
			min-height: 2.4em;
		}

		ul {
			@include layout-flex-column();
			gap: calc($x-space-xs / 2);
			flex: 1;

			li {
				display: flex;
				align-items: baseline;
				gap: $x-space-xs;
				color: var(--color-text);
				font-size: $x-font-size-sm;
				@include fonts-stack('Satoshi-Regular', sans);

				i {
					color: var(--color-primary);
					font-size: $x-font-size-sm;
				}
			}
		}

		.cta {
			border: 1px solid var(--color-bg);
			background: transparent;
			color: var(--color-text);
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2) $x-space-sm;
			cursor: pointer;
			@include fonts-stack('Satoshi-Regular', sans);

			&.primary {
				background: var(--color-primary);
				border-color: var(--color-primary);
				color: var(--color-bg);
			}
			&:disabled {
				opacity: 0.6;
				cursor: default;
			}
			&:not(:disabled):hover {
				border-color: var(--color-primary);
				color: var(--color-primary);
			}
			&.primary:not(:disabled):hover {
				background: var(--color-primary-hover);
				color: var(--color-bg);
			}
		}
	}

	.support {
		margin-top: $x-space-sm;
		padding: $x-space-md;
		border: 1px solid var(--color-bg);
		border-radius: $x-space-xs;
		background: var(--color-surface);
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: $x-space-xs;

		.lede {
			@include fonts-stack('Satoshi-Regular', sans);
			font-weight: 600;
			color: var(--color-text);
			font-size: $x-font-size-md;
			max-width: 40ch;
		}

		.powering {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
		}

		.powers {
			display: flex;
			flex-wrap: wrap;
			justify-content: center;
			gap: $x-space-sm;
			list-style: none;

			li {
				display: inline-flex;
				align-items: center;
				gap: calc($x-space-xs / 2);
				color: var(--color-text);
				font-size: $x-font-size-sm;
				@include fonts-stack('Satoshi-Regular', sans);

				i {
					color: var(--color-primary);
				}
			}
		}

		.donate {
			margin-top: calc($x-space-xs / 2);
			display: inline-flex;
			align-items: center;
			gap: $x-space-xs;
			background: var(--color-primary);
			color: var(--color-bg);
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2) $x-space-md;
			text-decoration: none;
			@include fonts-stack('Satoshi-Regular', sans);
			font-weight: 600;

			&:hover {
				background: var(--color-primary-hover);
			}
		}
	}
</style>

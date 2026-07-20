<script lang="ts">
	import { type CascadeKit } from 'manager';
	import { layerDotColor, shapeIcon } from './layer-color.ts';

	interface LayersPanel {
		// Full resolution cascade for the active view: each kit's matched-layer stack, most-specific
		// first. Unlike the winner-only resolved properties, this keeps overridden entries so we can
		// strike them through.
		cascades: CascadeKit[];
	}

	let { cascades }: LayersPanel = $props();

	type DisplayEntry = {
		property: string;
		value: string;
		isToken: boolean;
		tokenAlias: string | null;
		overridden: boolean;
		// Populated only when overridden: the conditions/tier of the layer that first claimed this
		// property, so the strikethrough can explain itself on hover instead of just crossing it out.
		beatenBy: { conditionValues: { axisId: string; value: string }[]; conditionCount: number } | null;
	};
	type DisplayLayer = {
		layerId: string;
		conditionCount: number;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		entries: DisplayEntry[];
	};
	// Layers of equal condition count are the same specificity tier. Orthogonal rules (different
	// key-sets, same count) live in one tier and render as sibling branches; tiers stack as the
	// tree's rank axis, most-specific on top.
	type Tier = { conditionCount: number; layers: DisplayLayer[] };
	type DisplayKit = { kitId: string; kitName: string; icon: string; tiers: Tier[] };

	const sections = $derived.by<DisplayKit[]>(() =>
		cascades.map((kit, kitIndex) => {
			// Winner tracking walks the WHOLE stack in specificity order (most-specific first), keyed
			// on the WINNING layer itself (not just a seen-it flag) so any later, beaten occurrence of
			// the same property can explain itself: "overridden by <winner's conditions>, tier N". The
			// axis-priority tiebreak between two orthogonal same-tier rules is already baked into
			// kit.layers' order by the resolver, so this walk honors it too.
			const won = new Map<string, DisplayLayer>();
			const ordered: DisplayLayer[] = kit.layers.map((layer) => {
				const displayLayer: DisplayLayer = {
					layerId: layer.layerId,
					conditionCount: layer.conditionCount,
					keys: layer.keys,
					conditionValues: layer.conditionValues,
					entries: []
				};
				const entries = [...layer.entries]
					.sort((a, b) => a.property.localeCompare(b.property))
					.map((e) => {
						const winner = won.get(e.property) ?? null;
						return {
							property: e.property,
							value: e.value,
							isToken: e.isToken,
							tokenAlias: e.tokenAlias,
							overridden: winner !== null,
							beatenBy: winner
								? { conditionValues: winner.conditionValues, conditionCount: winner.conditionCount }
								: null
						};
					});
				displayLayer.entries = entries;
				for (const e of entries) {
					if (!won.has(e.property)) won.set(e.property, displayLayer);
				}
				return displayLayer;
			});

			// Group into tiers by condition count. `ordered` is already most-specific first, so counts
			// are non-increasing; sort defensively anyway. Within a tier, layer order (the priority
			// tiebreak) is preserved.
			const tierMap = new Map<number, DisplayLayer[]>();
			for (const l of ordered) {
				if (!tierMap.has(l.conditionCount)) tierMap.set(l.conditionCount, []);
				tierMap.get(l.conditionCount)!.push(l);
			}
			const tiers = [...tierMap.entries()]
				.sort((a, b) => b[0] - a[0])
				.map(([conditionCount, layers]) => ({ conditionCount, layers }));

			return { kitId: kit.kitId, kitName: kit.kitName, icon: shapeIcon(kitIndex), tiers };
		})
	);

	const hasContent = $derived(sections.some((s) => s.tiers.length > 0));

	function conditionsLabel(conditionValues: { axisId: string; value: string }[]): string {
		return conditionValues.length === 0
			? 'base'
			: conditionValues.map((cv) => cv.value).join(', ');
	}

	function beatenByLabel(beatenBy: DisplayEntry['beatenBy']): string | undefined {
		if (!beatenBy) return undefined;
		return `overridden by ${conditionsLabel(beatenBy.conditionValues)} (tier ${beatenBy.conditionCount})`;
	}
</script>

<section class="layers">
	<header class="layers__header">
		<h2
			title="Resolution inspector — matched rules for the active view, shown as a tree: kit → specificity tier → rule → property. Struck-through values were overridden by a higher rule; hover one to see which."
		>
			Layers
		</h2>
	</header>

	<div class="layers__body">
		{#if !hasContent}
			<p class="layers__empty">No matched rules for the current selection.</p>
		{:else}
			{#each sections as section (section.kitId)}
				{#if section.tiers.length > 0}
					{@render kitNode(section)}
				{/if}
			{/each}
		{/if}
	</div>
</section>

{#snippet kitNode(section: DisplayKit)}
	<details class="kit" open>
		<summary class="kit__name">
			<i class="fa-solid {section.icon}"></i>
			<span>{section.kitName}</span>
			<i class="fa-solid fa-angle-down kit__chevron"></i>
		</summary>
		<ul class="kit__tiers">
			{#each section.tiers as tier (tier.conditionCount)}
				{@render tierNode(tier)}
			{/each}
		</ul>
	</details>
{/snippet}

{#snippet tierNode(tier: Tier)}
	<li class="tier-node" style="--level: 1">
		<details class="tier" open>
			<summary class="tier__label">
				<span class="tier__pips" title="{tier.conditionCount} condition(s)">
					{#if tier.conditionCount === 0}
						<i class="fa-regular fa-circle"></i>
					{:else}
						{#each Array(tier.conditionCount) as _}<i class="fa-solid fa-circle"></i>{/each}
					{/if}
				</span>
				<i class="fa-solid fa-angle-down tier__chevron"></i>
			</summary>
			<ul class="tier__layers">
				{#each tier.layers as layer (layer.layerId)}
					{@render layerNode(layer)}
				{/each}
			</ul>
		</details>
	</li>
{/snippet}

{#snippet layerNode(layer: DisplayLayer)}
	<li class="layer-node" style="--level: 2" style:--rule-color={layerDotColor(layer.keys, true)}>
		<div class="layer__row">
			<div class="layer__conds">
				{#if layer.conditionValues.length === 0}
					<span class="chip chip--base">base</span>
				{:else}
					{#each layer.conditionValues as cv (cv.axisId + cv.value)}
						<span class="chip">{cv.value}</span>
					{/each}
				{/if}
			</div>
		</div>

		<ul class="layer__props">
			{#each layer.entries as p (p.property)}
				<li
					class="prop"
					style="--level: 3"
					class:prop--overridden={p.overridden}
					title={beatenByLabel(p.beatenBy)}
				>
					<span class="prop__name" title={p.property}>{p.property}</span>
					<span class="prop__value">
						{#if p.isToken && p.tokenAlias}<i
								class="fa-solid fa-link prop__token"
								title="token: {p.tokenAlias}"
							></i>{/if}<span title={p.value}>{p.value}</span>
					</span>
				</li>
			{/each}
		</ul>
	</li>
{/snippet}

<style lang="scss">
	@use '_index' as *;

	.layers {
		// Fill the whole .console grid cell and manage scrolling internally.
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;

		&__header {
			display: flex;
			align-items: center;
			background: var(--color-panel-header-fill);
			user-select: none;
			flex: 0 0 auto;

			h2 {
				@include fonts-stack('Satoshi-Light', sans);
				text-transform: uppercase;
				color: var(--color-text-muted);
				letter-spacing: 1px;
				font-size: $x-font-size-sm;
				padding-block: $x-space-xs;
				padding-left: $x-space-sm;
				margin: 0;
			}
		}

		&__body {
			flex: 1 1 auto;
			min-height: 0;
			overflow-y: auto;
			scrollbar-width: thin;
			padding: $x-space-xs $x-space-sm $x-space-md;
		}

		&__empty {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
			padding: $x-space-sm;
		}
	}

	// Shared disclosure-triangle chevron, same convention as Variables.svelte's token-scope
	// sections: fa-angle-down, rotated 180deg while its <details> is open.
	@mixin chevron($class) {
		#{$class} {
			position: relative;
			transition: rotate 200ms ease-out;
		}

		&[open] #{$class} {
			rotate: 180deg;
		}
	}

	.kit {
		margin-top: $x-space-sm;
		@include chevron('.kit__chevron');

		&__name {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			list-style: none;
			cursor: pointer;
			user-select: none;
			color: var(--color-text);
			font-size: $x-font-size-sm;
			@include fonts-stack('Satoshi-Regular', sans);
			padding-block: $x-space-xs;

			i:not(.kit__chevron) {
				color: var(--color-text-muted);
				font-size: $x-font-size-xs;
			}

			.kit__chevron {
				margin-left: auto;
				color: var(--color-text-muted);
			}

			&:hover {
				background: var(--color-surface-alt);
			}
		}
	}

	// Every nesting level below "kit" is a real <ul>/<li>, so the DOM tree IS the cascade tree --
	// the guide-column mixin below draws connector lines off that real structure, the same
	// technique Views.svelte uses for the composition tree, just applied one level deeper (kit is
	// the collapsible root; tier/layer/property form the rank+leaf structure inside it).
	.kit__tiers,
	.tier__layers,
	.layer__props {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.tier-node,
	.layer-node {
		position: relative;
		list-style: none;
	}

	// Parent icon column: a child's own content indent (its row's padding for --level) minus one
	// level step lands the guide line on the parent row's left edge -- same formula and same
	// reasoning as Views.svelte's @mixin guide-column, retuned for this panel's smaller
	// pip/chip rail instead of a view icon.
	@mixin guide-column {
		left: calc($x-space-sm + $x-space-lg * var(--level) * 0.35 - $x-space-md * 0.35);
	}

	// Trunk: every direct child except the last paints a full-node-height segment, so the
	// segments stack into one continuous line running down the left of any content between
	// siblings. Applied identically to the ranked axis (tier -> tier, always-descending
	// specificity) and the orthogonal axis (layer -> layer within one tier, mutually exclusive
	// axis values) -- nesting alone conveys containment; there's no separate visual language for
	// "ranked" vs "orthogonal" here, matching the plan's intent not to overload the connector.
	.kit__tiers > .tier-node:not(:last-child)::after,
	.tier__layers > .layer-node:not(:last-child)::after,
	.layer__props > .prop:not(:last-child)::after {
		content: '';
		position: absolute;
		@include guide-column;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--color-text-muted);
		pointer-events: none;
	}

	// Curve: the LAST direct child paints from its node top down to its own row's midline, then
	// bends right into it. Drawn on the row element itself (the thing with position: relative),
	// not the whole collapsible <details> -- otherwise "50% height" would measure the whole open
	// subtree instead of just the row.
	.kit__tiers > .tier-node:last-child > .tier > summary::before,
	.tier__layers > .layer-node:last-child > .layer__row::before,
	.layer__props > .prop:last-child::before {
		content: '';
		position: absolute;
		@include guide-column;
		top: 0;
		height: 50%;
		width: calc($x-space-lg * 0.16);
		border-left: 0.6px solid var(--color-text-muted);
		border-bottom: 0.6px solid var(--color-text-muted);
		border-bottom-left-radius: $x-space-xs;
		pointer-events: none;
	}

	.tier {
		@include chevron('.tier__chevron');

		summary {
			display: flex;
			align-items: center;
			list-style: none;
			cursor: pointer;
			user-select: none;
			position: relative;
			padding-block: calc($x-space-xs / 2);
			padding-left: calc($x-space-sm + $x-space-lg * var(--level) * 0.35);

			&:hover {
				background: var(--color-surface-alt);
			}
		}

		&__pips {
			display: flex;
			gap: 2px;
			color: var(--color-text-muted);
			font-size: 0.5rem;
		}

		&__chevron {
			margin-left: auto;
			color: var(--color-text-muted);
		}
	}

	.layer-node {
		padding-left: calc($x-space-sm + $x-space-lg * var(--level) * 0.35);
		margin-block: 2px;
	}

	.layer__row {
		position: relative;
	}

	.layer__conds {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: $x-space-xs;
		border-left: 3px solid var(--rule-color, var(--color-text-muted));
		padding-left: $x-space-xs;
		margin-bottom: calc($x-space-xs / 2);
	}

	.chip {
		font-size: $x-font-size-xs;
		color: var(--color-text);
		background: color-mix(in oklab, var(--rule-color) 22%, transparent);
		border-radius: $x-space-xs;
		padding: 1px $x-space-xs;
		@include fonts-stack('Satoshi-Regular', sans);

		&--base {
			background: transparent;
			color: var(--color-text-muted);
			font-style: italic;
		}
	}

	.prop {
		position: relative;
		display: grid;
		grid-template-columns: minmax(5rem, 45%) 1fr;
		gap: $x-space-sm;
		font-size: $x-font-size-xs;
		align-items: baseline;
		padding-left: calc($x-space-sm + $x-space-lg * var(--level) * 0.35);
		border-left: 3px solid var(--rule-color, var(--color-text-muted));

		&__name {
			color: var(--color-text-muted);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		&__value {
			color: var(--color-text);
			font-family: monospace;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		// Overridden by a higher-specificity rule: struck through and dimmed, but still visible so
		// the cascade chain reads top-to-bottom through the tree. Hover for which rule beat it
		// (title set to beatenByLabel(...) in the markup).
		&--overridden {
			.prop__name,
			.prop__value {
				color: var(--color-text-muted);
				text-decoration: line-through;
				opacity: 0.7;
			}
		}
	}

	.prop__token {
		color: var(--color-text-muted);
		font-size: 0.6rem;
		margin-right: 2px;
	}
</style>

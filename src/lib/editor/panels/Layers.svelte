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
	};
	type DisplayLayer = {
		layerId: string;
		conditionCount: number;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		entries: DisplayEntry[];
	};
	// Layers of equal condition count are the same specificity tier. Orthogonal rules (different
	// key-sets, same count) live in one tier and render side-by-side as columns; the tiers stack
	// vertically, most-specific on top.
	type Tier = { conditionCount: number; layers: DisplayLayer[] };
	type DisplayKit = { kitId: string; kitName: string; icon: string; tiers: Tier[] };

	const sections = $derived.by<DisplayKit[]>(() =>
		cascades.map((kit, kitIndex) => {
			// Override marking walks the WHOLE stack in specificity order (most-specific first), so a
			// property claimed by a higher rule strikes every lower occurrence -- across columns and
			// across tiers alike. The axis-priority tiebreak between two orthogonal same-tier rules is
			// already baked into kit.layers' order by the resolver, so this walk honors it too.
			const won = new Set<string>();
			const ordered: DisplayLayer[] = kit.layers.map((layer) => {
				const entries = [...layer.entries]
					.sort((a, b) => a.property.localeCompare(b.property))
					.map((e) => ({
						property: e.property,
						value: e.value,
						isToken: e.isToken,
						tokenAlias: e.tokenAlias,
						overridden: won.has(e.property)
					}));
				for (const e of layer.entries) won.add(e.property);
				return {
					layerId: layer.layerId,
					conditionCount: layer.conditionCount,
					keys: layer.keys,
					conditionValues: layer.conditionValues,
					entries
				};
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
</script>

<section class="layers">
	<header class="layers__header">
		<h2 title="Resolution inspector — matched rules for the active view. Rows are specificity tiers (most-specific on top); orthogonal rules in a tier sit side by side. Struck-through values were overridden by a higher rule.">
			Layers
		</h2>
	</header>

	<div class="layers__body">
		{#if !hasContent}
			<p class="layers__empty">No matched rules for the current selection.</p>
		{:else}
			{#each sections as section (section.kitId)}
				{#if section.tiers.length > 0}
					<div class="kit">
						<div class="kit__name">
							<i class="fa-solid {section.icon}"></i>
							<span>{section.kitName}</span>
						</div>

						{#each section.tiers as tier (tier.conditionCount)}
							<div class="tier">
								<div class="tier__rail" title="{tier.conditionCount} condition(s)">
									{#if tier.conditionCount === 0}
										<i class="fa-regular fa-circle"></i>
									{:else}
										{#each Array(tier.conditionCount) as _}<i class="fa-solid fa-circle"></i>{/each}
									{/if}
								</div>

								<div class="tier__cols">
									{#each tier.layers as layer (layer.layerId)}
										<div class="rule" style:--rule-color={layerDotColor(layer.keys, true)}>
											<div class="rule__conds">
												{#if layer.conditionValues.length === 0}
													<span class="chip chip--base">base</span>
												{:else}
													{#each layer.conditionValues as cv (cv.axisId + cv.value)}
														<span class="chip">{cv.value}</span>
													{/each}
												{/if}
											</div>

											<dl class="rule__props">
												{#each layer.entries as p (p.property)}
													<div class="prop" class:prop--overridden={p.overridden}>
														<dt title={p.property}>{p.property}</dt>
														<dd title={p.value}>
															{#if p.isToken && p.tokenAlias}<i
																	class="fa-solid fa-link prop__token"
																	title="token: {p.tokenAlias}"
																></i>{/if}
															{p.value}
														</dd>
													</div>
												{/each}
											</dl>
										</div>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			{/each}
		{/if}
	</div>
</section>

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

	.kit {
		margin-top: $x-space-sm;

		&__name {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			color: var(--color-text);
			font-size: $x-font-size-sm;
			@include fonts-stack('Satoshi-Regular', sans);
			padding-block: $x-space-xs;

			i {
				color: var(--color-text-muted);
				font-size: $x-font-size-xs;
			}
		}
	}

	// A specificity tier: a small left rail of condition pips + the tier's rules laid out as
	// wrapping columns (orthogonal siblings side by side, using the wide drawer's horizontal room).
	.tier {
		display: flex;
		align-items: flex-start;
		gap: $x-space-sm;
		margin-bottom: $x-space-sm;

		&__rail {
			flex: 0 0 auto;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 2px;
			min-width: 0.9rem;
			padding-top: 3px;
			color: var(--color-text-muted);
			font-size: 0.5rem;
		}

		&__cols {
			flex: 1 1 auto;
			min-width: 0;
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-sm;
		}
	}

	.rule {
		// Column: grow to share the row, but stay within a readable band; wrap when they don't fit.
		flex: 1 1 13rem;
		min-width: 11rem;
		max-width: 24rem;
		border-left: 3px solid var(--rule-color, var(--color-text-muted));
		padding-left: $x-space-sm;

		&__conds {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: $x-space-xs;
			margin-bottom: calc($x-space-xs / 2);
		}

		&__props {
			margin: 0;
			display: flex;
			flex-direction: column;
			gap: 1px;
		}
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
		display: grid;
		grid-template-columns: minmax(5rem, 45%) 1fr;
		gap: $x-space-sm;
		font-size: $x-font-size-xs;
		align-items: baseline;

		dt {
			color: var(--color-text-muted);
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		dd {
			margin: 0;
			color: var(--color-text);
			font-family: monospace;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		// Overridden by a higher-specificity rule: struck through and dimmed, but still visible so
		// the cascade chain reads top-to-bottom (and across columns).
		&--overridden {
			dt,
			dd {
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

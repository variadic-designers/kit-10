<script lang="ts">
	import { type ResolvedKit, type ResolvedProperty } from 'manager';
	import { layerDotColor, shapeIcon } from './layer-color.ts';

	interface LayersPanel {
		// The active view's resolved kits (same shape the Styles panel receives). Each carries its
		// properties' winning provenance (sourceLayerId, conditionCount, keys, conditionValues).
		resolvedKits: ResolvedKit[] | null;
	}

	let { resolvedKits }: LayersPanel = $props();

	// A "rule block": one source layer (a distinct condition-set) and the properties whose WINNING
	// value came from it. This is the computed/cascade view built from resolved output — it shows
	// which rule won each property, grouped and tiered by specificity. Showing the *overridden*
	// (struck-through) entries of a rule needs the raw layer entries, not just the resolved winners;
	// that's the next iteration (a manager query for all matched layers). For now every property
	// appears once, under the rule that actually produced its value.
	type RuleBlock = {
		layerId: string;
		conditionCount: number;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		props: { property: string; value: string; isToken: boolean; tokenAlias: string | null }[];
	};

	type KitSection = {
		kitId: string;
		kitName: string;
		icon: string;
		blocks: RuleBlock[];
	};

	const sections = $derived.by<KitSection[]>(() => {
		if (!resolvedKits) return [];
		return resolvedKits.map((kit, kitIndex) => {
			const byLayer = new Map<string, RuleBlock>();
			for (const prop of kit.properties.values()) {
				let block = byLayer.get(prop.sourceLayerId);
				if (!block) {
					block = {
						layerId: prop.sourceLayerId,
						conditionCount: prop.conditionCount,
						keys: prop.keys,
						conditionValues: prop.conditionValues,
						props: []
					};
					byLayer.set(prop.sourceLayerId, block);
				}
				block.props.push({
					property: prop.property,
					value: prop.value,
					isToken: prop.isToken,
					tokenAlias: prop.tokenAlias
				});
			}
			// Most-specific first (top of the stack): higher condition count wins; ties ordered by
			// key-set for stability. Property lists sorted by name so the block reads predictably.
			const blocks = [...byLayer.values()].sort(
				(a, b) =>
					b.conditionCount - a.conditionCount || a.keys.join('|').localeCompare(b.keys.join('|'))
			);
			for (const b of blocks) b.props.sort((x, y) => x.property.localeCompare(y.property));
			return {
				kitId: kit.kitId,
				kitName: kit.kitName,
				icon: shapeIcon(kitIndex),
				blocks
			};
		});
	});

	const hasContent = $derived(sections.some((s) => s.blocks.length > 0));
</script>

<section class="layers">
	<header class="layers__header">
		<h2 title="Resolution inspector — the rules that produced the active view's resolved values, stacked by specificity">
			Layers
		</h2>
	</header>

	<div class="layers__body">
		{#if !hasContent}
			<p class="layers__empty">No resolved rules for the current selection.</p>
		{:else}
			{#each sections as section (section.kitId)}
				{#if section.blocks.length > 0}
					<div class="kit">
						<div class="kit__name">
							<i class="fa-solid {section.icon}"></i>
							<span>{section.kitName}</span>
						</div>

						<!-- Stacked most-specific first. Each block is one condition-set (a "rule"). -->
						{#each section.blocks as block (block.layerId)}
							<div class="rule" style:--rule-color={layerDotColor(block.keys, true)}>
								<div class="rule__conds">
									<span class="rule__tier" title="{block.conditionCount} condition(s)">
										{#if block.conditionCount === 0}
											<i class="fa-regular fa-circle"></i>
										{:else}
											{#each Array(block.conditionCount) as _}<i class="fa-solid fa-circle"></i>{/each}
										{/if}
									</span>
									{#if block.conditionValues.length === 0}
										<span class="chip chip--base">base</span>
									{:else}
										{#each block.conditionValues as cv (cv.axisId + cv.value)}
											<span class="chip">{cv.value}</span>
										{/each}
									{/if}
								</div>

								<dl class="rule__props">
									{#each block.props as p (p.property)}
										<div class="prop">
											<dt title={p.property}>{p.property}</dt>
											<dd title={p.value}>
												{#if p.isToken && p.tokenAlias}<i class="fa-solid fa-link prop__token" title="token: {p.tokenAlias}"></i>{/if}
												{p.value}
											</dd>
										</div>
									{/each}
								</dl>
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

	.rule {
		border-left: 3px solid var(--rule-color, var(--color-text-muted));
		padding-left: $x-space-sm;
		margin-bottom: $x-space-sm;

		&__conds {
			display: flex;
			align-items: center;
			flex-wrap: wrap;
			gap: $x-space-xs;
			margin-bottom: calc($x-space-xs / 2);
		}

		&__tier {
			display: inline-flex;
			gap: 2px;
			color: var(--rule-color, var(--color-text-muted));
			font-size: 0.5rem;
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
		grid-template-columns: minmax(6rem, 40%) 1fr;
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
	}

	.prop__token {
		color: var(--color-text-muted);
		font-size: 0.6rem;
		margin-right: 2px;
	}
</style>

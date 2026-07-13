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

	// Per kit, mark each entry as winning or overridden. Layers arrive most-specific first, so the
	// FIRST layer to set a property is its winner; the same property lower in the stack is beaten.
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
	type DisplayKit = { kitId: string; kitName: string; icon: string; layers: DisplayLayer[] };

	const sections = $derived.by<DisplayKit[]>(() =>
		cascades.map((kit, kitIndex) => {
			const won = new Set<string>();
			const layers: DisplayLayer[] = kit.layers.map((layer) => {
				const entries = [...layer.entries]
					.sort((a, b) => a.property.localeCompare(b.property))
					.map((e) => {
						const overridden = won.has(e.property);
						return {
							property: e.property,
							value: e.value,
							isToken: e.isToken,
							tokenAlias: e.tokenAlias,
							overridden
						};
					});
				// Mark these properties claimed only AFTER building this layer's entries, so the
				// first (most-specific) setter is the winner and equal-property entries below it lose.
				for (const e of layer.entries) won.add(e.property);
				return {
					layerId: layer.layerId,
					conditionCount: layer.conditionCount,
					keys: layer.keys,
					conditionValues: layer.conditionValues,
					entries
				};
			});
			return { kitId: kit.kitId, kitName: kit.kitName, icon: shapeIcon(kitIndex), layers };
		})
	);

	const hasContent = $derived(sections.some((s) => s.layers.length > 0));
</script>

<section class="layers">
	<header class="layers__header">
		<h2 title="Resolution inspector — the matched rules for the active view, stacked most-specific first; struck-through values were overridden by a higher rule">
			Layers
		</h2>
	</header>

	<div class="layers__body">
		{#if !hasContent}
			<p class="layers__empty">No matched rules for the current selection.</p>
		{:else}
			{#each sections as section (section.kitId)}
				{#if section.layers.length > 0}
					<div class="kit">
						<div class="kit__name">
							<i class="fa-solid {section.icon}"></i>
							<span>{section.kitName}</span>
						</div>

						{#each section.layers as layer (layer.layerId)}
							<div class="rule" style:--rule-color={layerDotColor(layer.keys, true)}>
								<div class="rule__conds">
									<span class="rule__tier" title="{layer.conditionCount} condition(s)">
										{#if layer.conditionCount === 0}
											<i class="fa-regular fa-circle"></i>
										{:else}
											{#each Array(layer.conditionCount) as _}<i class="fa-solid fa-circle"></i>{/each}
										{/if}
									</span>
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

		// Overridden by a higher-specificity rule: struck through and dimmed, but still visible so
		// the cascade chain reads top-to-bottom.
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

<script module>
</script>

<script lang="ts">
	import type { AxisVariantLayerTrace } from '../../cascadeAxesMap';

	type LayerWidgetProps = {
		layers: AxisVariantLayerTrace;
	};

	const { layers }: LayerWidgetProps = $props();

	const layerWidgets = $derived.by(() => {});
</script>

<div class="layers">
	<label class="layer layer--base" aria-label="&lcub; &rcub;" title="No Axes layer">
		<i class="layer--new__icon fa-solid fa-diamond"></i>
		<input type="radio" name="same" disabled />
	</label>

	{#if layerWidgets}
		{#each layerWidgets as layer}
			<div class="layer__specificity">
				{#each layer as l}
					{@const hsv = stringSetToHSV(l)}

					<label
						style="--colour:hsl({hsv.h}, {hsv.s}%, {hsv.v}%);"
						title={JSON.stringify(l, null, 2)}
						class="layer layer--valued"
						aria-label="&lcub; &rcub;"
					>
						<i class="layer--new__icon fa-solid fa-diamond"></i>
						<input
							type="radio"
							value={JSON.stringify(l)}
							name="layers"
							disabled
							bind:group={selectedLayer}
						/>
					</label>
				{/each}
			</div>
		{/each}
	{/if}

	<label class="layer layer--new layer--last" aria-label="&lcub; &rcub;">
		<i class="layer--new__icon fa-solid fa-diamond"></i>
		<input type="radio" name="some" disabled />
		<i class="layer--new__icon fa-solid fa-plus"></i>
	</label>
</div>

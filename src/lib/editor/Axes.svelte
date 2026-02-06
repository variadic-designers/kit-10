<script lang="ts" module>
	import { type Snippet } from 'svelte';

	// export { axisOption }

	import { type TrackerExclusiveVariant, type AxisDefinition } from '../axesBuiltIn';
	import { getTheme } from '$lib/theming';
</script>

<!-- {#snippet breakpoints()} -->
<!-- 	{#snippet options()} -->
<!-- 		{@render rangedList([ -->
<!-- 			{ label: '0', tooltip: '0px', shorthand: '•' }, -->
<!-- 			{ label: 'Mobile Small', tooltip: '320px', shorthand: 'MS' }, -->
<!-- 			{ label: 'Mobile Medium', tooltip: '375px', shorthand: 'M' }, -->
<!-- 			{ label: 'Mobile Large', tooltip: '425px', shorthand: 'ML' }, -->
<!-- 			{ label: 'Tablet', tooltip: '768px', shorthand: 'T' }, -->
<!-- 			{ label: 'Laptop', tooltip: '1024px', shorthand: 'L' }, -->
<!-- 			{ label: 'Laptop Large', tooltip: '1440px', shorthand: 'LL' }, -->
<!-- 			{ label: '4K', tooltip: '2560px', shorthand: '4K' }, -->
<!-- 			{ label: 'Upper', tooltip: '∞px', shorthand: '∞' } -->
<!-- 		])} -->
<!-- 	{/snippet} -->
<!---->
<!-- 	{@render axis('Breakpoint', options)} -->
<!-- {/snippet} -->

<!-- For style fields that require 1 | 2 | 4 values -->
{#snippet rangedList(elements: { label: string; tooltip: string; shorthand: string }[])}
	<ul class="ranged-list">
		{#each elements as element, i (element.shorthand)}
			<li class="ranged-list__element">
				<label
					for="ranged-list__element__button-{element.shorthand}"
					class="ranged-list__element__label"
					title={element.tooltip}
				>
					{element.label}
				</label>
				<button
					id="ranged-list__element__button-{element.shorthand}"
					class="ranged-list__element__button"
					class:first={i === 0}
					class:last={i === elements.length - 1}
					class:active={i >= 0 && i <= elements.length - 1}
				>
					{element.shorthand}
				</button>
			</li>
		{/each}
	</ul>
{/snippet}

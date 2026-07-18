<script lang="ts">
	// Renders a set of PreferenceBindings, grouped by their def.group, through the one generic
	// PreferenceControl. Reused by Appearance, Canvas, and Plugins tabs -- no tab hardcodes a row.
	import type { PreferenceBinding } from '$lib/plugins/preferences.js';
	import PreferenceControl from '../PreferenceControl.svelte';

	let {
		bindings,
		showGroupHeaders = true,
		emptyLabel = 'No settings.'
	}: {
		bindings: PreferenceBinding[];
		showGroupHeaders?: boolean;
		emptyLabel?: string;
	} = $props();

	const groups = $derived.by(() => {
		const map = new Map<string, PreferenceBinding[]>();
		for (const b of bindings) {
			const g = b.def.group ?? '';
			const list = map.get(g) ?? [];
			list.push(b);
			map.set(g, list);
		}
		return [...map.entries()];
	});
</script>

{#if bindings.length === 0}
	<p class="empty">{emptyLabel}</p>
{:else}
	{#each groups as [groupName, groupBindings] (groupName)}
		{#if showGroupHeaders && groupName}
			<h4 class="group">{groupName}</h4>
		{/if}
		{#each groupBindings as binding (binding.key)}
			<PreferenceControl
				id={`pref-${binding.key}`}
				def={binding.def}
				value={binding.value}
				onChange={binding.set}
			/>
		{/each}
	{/each}
{/if}

<style lang="scss">
	@use '_index' as *;

	.group {
		font-size: $x-font-size-sm;
		color: var(--color-text-muted);
		text-transform: uppercase;
		letter-spacing: 1px;
		@include fonts-stack('Satoshi-Light', sans);
		padding: $x-space-sm $x-space-xs calc($x-space-xs / 2);
	}

	.empty {
		color: var(--color-text-muted);
		font-size: $x-font-size-md;
		padding: $x-space-xs;
		@include fonts-stack('Satoshi-Regular', sans);
	}
</style>

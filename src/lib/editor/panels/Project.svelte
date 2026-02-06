<script lang="ts">
	import { type Kit10ProjectMeta } from '../../types';
	import type { ContextMenuContent } from '../contextMenuStore';
	import Panel from '../Panel.svelte';

	type ProjectPanelProps = Kit10ProjectMeta;

	let {
		name = $bindable('Untitled'),
		description = $bindable('No Description'),
		author = 'Me',
		license = 'Not licensed'
	} = $props();

	const projectContextMenu: ContextMenuContent = [];
</script>

<Panel name="Exports" tooltip="Project Settings" contextMenuContent={projectContextMenu}>
	{#snippet content()}
		<!-- <div class="title" bind:innerHTML={name} contenteditable="true">{name}</div> -->
		<!-- <div class="description" bind:innerHTML={description} contenteditable="true">{description}</div> -->
		<!-- <div class="license"> -->
		<!-- 	<i class="fa-solid fa-triangle-exclamation"></i> Project is not Licensed -->
		<!-- </div> -->
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	i {
		color: var(--color-warning);
		font-size: $x-font-size-lg;
	}
</style>

<script lang="ts">
	import { contextMenuState, closeContextMenu } from './contextMenuStore.js';
	import ContextMenuBox from './ContextMenuBox.svelte';
	import ContextMenuList from './ContextMenuList.svelte';

	let menuRef: HTMLElement | undefined = $state();

	function handleWindowClick(e: MouseEvent) {
		if (menuRef && !menuRef.contains(e.target as Node)) closeContextMenu();
	}

	function handleWindowKeydown(e: KeyboardEvent) {
		if ($contextMenuState.show && e.key === 'Escape') closeContextMenu();
	}
</script>

<svelte:window on:click={handleWindowClick} on:keydown={handleWindowKeydown} />

{#if $contextMenuState.show}
	<ContextMenuBox rawPos={$contextMenuState.pos} bind:boxRef={menuRef}>
		<ContextMenuList options={$contextMenuState.options} target={$contextMenuState.target} />
	</ContextMenuBox>
{/if}

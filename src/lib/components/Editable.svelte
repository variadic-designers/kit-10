<script lang="ts">
	import type { Snippet } from 'svelte';

	type EditableProps = {
		value: string;
		// The "display" version of your component
		children: Snippet<[string]>;
		finalize: (val: string) => void;
		class?: string;
	};

	let { value, children, finalize, class: className }: EditableProps = $props();

	let isEditing = $state(false);
	let tempValue = $state(value);

	function startEditing() {
		tempValue = value;
		isEditing = true;
	}

	function submit() {
		finalize(tempValue);
		isEditing = false;
	}

	function cancel() {
		isEditing = false;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') submit();
		if (e.key === 'Escape') cancel();
	}
</script>

{#if isEditing}
	<input
		bind:value={tempValue}
		onblur={submit}
		onkeydown={handleKey}
		class="editable-input {className}"
	/>
{:else}
	<button onclick={startEditing} class="editable-trigger {className}" type="button">
		{@render children(value)}
	</button>
{/if}

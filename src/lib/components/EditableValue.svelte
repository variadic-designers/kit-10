<script lang="ts">
	import { tick } from 'svelte';

	type Props = {
		value: string;
		onCommit: (value: string) => void;
		editing?: boolean;
		placeholder?: string;
		class?: string;
		children?: import('svelte').Snippet;
	};

	let {
		value,
		onCommit,
		editing = false,
		placeholder = '',
		class: className = '',
		children
	}: Props = $props();

	let isEditing = $state(false);
	let draft = $state('');
	let inputRef: HTMLInputElement | undefined = $state();

	$effect(() => {
		if (editing) {
			draft = value;
			isEditing = true;
			tick().then(() => {
				inputRef?.focus();
				inputRef?.select();
			});
		}
	});

	function startEdit() {
		draft = value;
		isEditing = true;
		tick().then(() => {
			inputRef?.focus();
			inputRef?.select();
		});
	}

	function submit() {
		const trimmed = draft.trim();
		if (trimmed !== value) {
			onCommit(trimmed);
		} else {
			draft = value;
		}
		isEditing = false;
	}

	function cancel() {
		draft = value;
		isEditing = false;
	}
</script>

{#if isEditing}
	<input
		bind:this={inputRef}
		bind:value={draft}
		onblur={submit}
		onkeydown={(e) => {
			if (e.key === 'Enter') submit();
			if (e.key === 'Escape') cancel();
		}}
		onclick={(e) => e.stopPropagation()}
		ondblclick={(e) => e.stopPropagation()}
		{placeholder}
		class="editable-value-input {className}"
	/>
{:else if children}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span
		onclick={(e) => {
			e.stopPropagation();
			startEdit();
		}}
		class="editable-value {className}"
	>
		{@render children()}
	</span>
{:else}
	<button
		onclick={(e) => {
			e.stopPropagation();
			startEdit();
		}}
		class="editable-value {className}"
	>
		{value || placeholder}
	</button>
{/if}

<style>
	.editable-value {
		cursor: pointer;
	}

	.editable-value-input {
		min-width: 3ch;
		font: inherit;
		letter-spacing: inherit;
		line-height: inherit;
		color: inherit;
		background: transparent;
		border: none;
		outline: none;
		padding: 0;
		margin: 0;
		display: inline;
	}
</style>

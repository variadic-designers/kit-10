<script lang="ts">
	import { tick } from 'svelte';

	type Props = {
		value: string;
		onCommit: (value: string) => void;
		editing?: boolean;
		class?: string;
		children: import('svelte').Snippet;
	};

	let {
		value,
		onCommit,
		editing = false,
		class: className = '',
		children
	}: Props = $props();

	let isEditing = $state(editing);
	let draft = $state(value);
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
		if (trimmed && trimmed !== value) {
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
		placeholder={value}
		class="renameable-input {className}"
	/>
{:else}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<span ondblclick={(e) => { e.stopPropagation(); startEdit(); }} class="renameable {className}">
		{@render children()}
	</span>
{/if}

<style>
	.renameable {
		cursor: text;
	}

	.renameable-input {
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

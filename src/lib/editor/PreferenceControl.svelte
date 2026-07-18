<script lang="ts">
	// The ONE renderer for every preference -- host or plugin. It maps a PreferenceDef's declared
	// `kind` to a concrete control and reports changes back through `onChange`; it never knows what a
	// specific preference means. This is the whole point of the registry: adding a preference is a
	// data entry (host-preferences.ts or a plugin's `preferences` export), never new markup here.
	import type { Readable } from 'svelte/store';
	import type { PreferenceDef } from '$lib/plugins/preferences.js';

	let {
		id,
		def,
		value,
		onChange
	}: {
		id: string;
		def: PreferenceDef;
		value: Readable<string>;
		onChange: (value: string) => void;
	} = $props();

	// Subscribe through an effect (rather than aliasing the store once) so the control still tracks
	// the value if the parent ever swaps in a different store on the same component instance.
	let current = $state('');
	$effect(() => value.subscribe((v) => (current = v)));
</script>

<div class="pref-row">
	<label for={id}>{def.label}</label>
	{#if def.kind === 'toggle'}
		<input
			{id}
			type="checkbox"
			checked={current === 'true'}
			onchange={(e) => onChange(String(e.currentTarget.checked))}
		/>
	{:else if def.kind === 'select'}
		<select {id} value={current} onchange={(e) => onChange(e.currentTarget.value)}>
			{#each def.options ?? [] as opt (opt.value)}
				<option value={opt.value}>{opt.label}</option>
			{/each}
		</select>
	{:else}
		<input
			{id}
			type="number"
			value={current}
			min={def.min}
			max={def.max}
			onchange={(e) => onChange(e.currentTarget.value)}
		/>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	.pref-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: $x-space-sm;
		padding: calc($x-space-xs / 2) $x-space-sm;

		label {
			font-size: $x-font-size-md;
			@include fonts-stack('Satoshi-Regular', sans);
			color: var(--color-text);
		}

		select,
		input[type='number'] {
			background: var(--color-surface);
			color: var(--color-text);
			border: 1px solid var(--color-bg);
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 4) $x-space-xs;
			font-size: $x-font-size-md;
			min-width: calc($x-space-xxxl);
		}
	}
</style>

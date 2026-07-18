<script lang="ts">
	import { hostPreferences } from '../host-preferences.js';
	import PreferenceList from './PreferenceList.svelte';

	// Only the canvas/input-grouped host prefs (pan gesture, zoom invert).
	const bindings = hostPreferences.filter((b) => b.def.group === 'Canvas & Input');
</script>

<div class="tab">
	<p class="hint">
		How the infinite canvas responds to your mouse and keyboard. Vellum renders the canvas; these
		control how the editor interprets your input before it.
	</p>
	<PreferenceList {bindings} showGroupHeaders={false} />
</div>

<style lang="scss">
	@use '_index' as *;
	.tab {
		@include layout-flex-column();
		gap: 2px;
	}
	.hint {
		color: var(--color-text-muted);
		font-size: $x-font-size-sm;
		padding: 0 $x-space-xs $x-space-sm;
		@include fonts-stack('Satoshi-Regular', sans);
	}
</style>

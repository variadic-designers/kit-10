<script lang="ts">
	import { hostPreferences } from '../host-preferences.js';
	import PreferenceList from './PreferenceList.svelte';

	// Only the appearance-grouped host prefs (theme, motion).
	const bindings = hostPreferences.filter((b) => b.def.group === 'Appearance');
</script>

<div class="tab">
	<PreferenceList {bindings} showGroupHeaders={false} />
</div>

<style lang="scss">
	@use '_index' as *;
	.tab {
		@include layout-flex-column();
		gap: 2px;
	}
</style>

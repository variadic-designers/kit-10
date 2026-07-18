<script lang="ts">
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import { queryBuilder, type EditorState } from 'manager';
	import { type EditorActivity } from './Editor.svelte';
	import SettingsDialog from './settings/SettingsDialog.svelte';
	import type { PluginManager } from '$lib/plugins/manager.svelte.js';

	type NavProps = {
		editorActivity: EditorActivity;
		editorLoading: EditorState | undefined;
		pluginManager: PluginManager | null;
	};

	let { editorActivity = $bindable(), editorLoading, pluginManager }: NavProps = $props();

	let settingsOpen = $state(false);

	let workspaces = $state();

	const activateWorkspace = (id: string, name: string) => {
		if (editorActivity.activeWorkspaceId === id) return;

		editorActivity.activeWorkspaceId = id;
		editorActivity.activeWorkspaceName = name;
	};

	// Set activeWorkspaceId if not present
	$effect(() => {
		if (editorActivity.activeWorkspaceId) return;

		if (editorLoading) {
			queryBuilder(editorLoading.dialect)
				.getAllWorkspaces()
				.executeTakeFirst()
				.then((w) => {
					if (w) {
						activateWorkspace(w.workspaceId, w.workspaceName);
					}
				});
		}
	});
</script>

<heading>
	<a class="branding" href="/">
		<img src="/favicon.svg" alt="kit10 logo" />
	</a>
</heading>

<div class="quick-preferences">
	<DarkModeToggle />
	<button class="pfp" onclick={() => (settingsOpen = true)} title="Settings">
		<img src="https://cataas.com/cat/closeup" crossorigin="anonymous" alt="user profile" />
	</button>

	{#if editorLoading}
		<SettingsDialog
			api={queryBuilder(editorLoading.dialect)}
			{editorActivity}
			bind:open={settingsOpen}
			{pluginManager}
		/>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	.quick-preferences {
		position: relative;
	}

	.pfp {
		cursor: pointer;
		border-color: transparent;
		background: transparent;
	}
</style>

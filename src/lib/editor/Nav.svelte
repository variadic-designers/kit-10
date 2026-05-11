<script lang="ts">
	import DarkModeToggle from '$lib/components/DarkModeToggle.svelte';
	import { queryBuilder, type EditorState } from 'manager';
	import { type EditorActivity } from './Editor.svelte';
	import MainMenu from './MainMenu.svelte';

	type NavProps = {
		editorActivity: EditorActivity;
		editorLoading: EditorState | undefined;
	};

	let { editorActivity = $bindable(), editorLoading }: NavProps = $props();

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
	<a class="branding" href="#s">
		<img src="/favicon.svg" alt="kit10 logo" />
	</a>
</heading>

<div class="quick-preferences">
	<DarkModeToggle />
	<button popovertarget="profile" class="pfp">
		<img src="https://cataas.com/cat/closeup" alt="user profile" />
	</button>

	{#if editorLoading}
		<MainMenu
			editorReady={editorLoading}
			api={queryBuilder(editorLoading.dialect)}
			bind:editorActivity
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

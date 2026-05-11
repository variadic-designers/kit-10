<script lang="ts">
	import { type EditorState, type Api, queryBuilder } from 'manager';
	import { liveQuery, type EditorActivity } from './Editor.svelte';

	type MainMenuProps = {
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	const { editorReady, editorActivity = $bindable() }: MainMenuProps = $props();

	const workspaceQuery = liveQuery((api) => api.getAllWorkspaces());

	import { type Snippet } from 'svelte';

	import type { ContextMenuContentGenerator } from './contextMenuStore.ts';

	import { contextMenu } from './contextMenu.ts';
	const workspacesMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'new_project',
				displayText: 'New Project',
				icon: 'fa-solid fa-diagram-project',
				onClick: () => {
					queryBuilder(editorReady.dialect)
						.createWorkspace('Untitled')
						.then((w) => {
							if (w) {
								selectWorkspace(w.id, w.name);
							}
						});
				}
			}
		];
	};

	const selectWorkspace = (id: string, name: string) => {
		editorActivity.activeWorkspaceId = id;
		editorActivity.activeWorkspaceName = name;
		editorActivity.activeProjectId = null;
		editorActivity.activeProjectName = null;
		editorActivity.activeViewId = null;
		editorActivity.activeKitId = null;
	};
</script>

{#snippet section(header: Snippet, content: Snippet)}
	<div class="menu__section">
		<h2 class="menu__section__header">{@render header()}</h2>
		<h2 class="menu__section__content">{@render content()}</h2>
	</div>
{/snippet}

<div id="profile" popover class="menu">
	<h2 use:contextMenu={workspacesMenu}>Workspaces</h2>
	<ul class="workspaces">
		{#if workspaceQuery.rows}
			<!-- <pre>{JSON.stringify(workspaceQuery, null, 2)}</pre> -->
			{#each workspaceQuery.rows as w}
				<li>
					<button
						title={w.workspaceId}
						class:selected={w.workspaceId === editorActivity.activeWorkspaceId}
						onclick={() => {
							selectWorkspace(w.workspaceId, w.workspaceName);
						}}
					>
						<i class="fa-solid fa-folder"></i>
						<sup class="count">{w.projectCount}</sup>
						<span class="workspace-name" id="editable-{w.workspaceId}">{w.workspaceName}</span>
					</button>
				</li>
			{/each}
		{/if}
	</ul>

	<h2>Profiles</h2>
	<ul class="profiles">Cat Profiles</ul>

	<h2>Preferences</h2>
	<ul class="preferences">Preferences</ul>
</div>

<style lang="scss">
	@use '_index' as *;

	#profile {
		// not widely supported yet :/
		// position-area: bottom-right;
		position: fixed;
		left: initial;
		right: $x-space-md;
		top: $x-space-xl;
		border-radius: $x-space-xs;

		min-width: calc($x-space-xxxl * 1.6);
		background: var(--color-panel-header-fill);
		border: unset;
		border: 1px solid var(--color-bg);
		color: var(--color-pure-alt);

		ul {
			@include layout-flex-column();
			gap: 2px;
			background: var(--color-surface);

			li {
				button {
					padding: calc($x-space-xs / 4) $x-space-xs;
					width: 100%;
					border: unset;
					text-align: left;
					font-size: $x-font-size-md;
					@include fonts-stack('Satoshi-Regular', sans);
					font-weight: 600;
					color: var(--color-text);
					letter-spacing: 1px;
					background: var(--color-surface);
					display: flex;
					align-items: center;
					gap: $x-space-xs;

					.count {
						color: var(--color-text-muted);
						font-size: $x-space-sm;
					}

					&:hover {
						color: var(--color-primary);
					}

					&.selected {
						background: var(--color-surface-alt);
						color: var(--color-primary);

						&:hover {
							color: var(--color-primary-hover);
						}
					}
				}
			}
		}

		h2 {
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			text-transform: uppercase;
			letter-spacing: 1px;
			@include fonts-stack('Satoshi-Light', sans);
			padding: $x-space-xs $x-space-xs;
		}
	}
</style>

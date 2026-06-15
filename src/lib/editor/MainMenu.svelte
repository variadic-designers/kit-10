<script lang="ts">
	import { type EditorState, type Api, queryBuilder } from 'manager';
	import { liveQuery, type EditorActivity } from './Editor.svelte';
	import Renameable from '$lib/components/Renameable.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu';

	type MainMenuProps = {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
	};

	const { editorReady, editorActivity = $bindable(), api }: MainMenuProps = $props();

	const workspaceQuery = liveQuery((api) => api.getAllWorkspaces());

	let workspaceEditing: Record<string, boolean> = $state({});

	const selectWorkspace = (id: string, name: string) => {
		if (editorActivity.activeWorkspaceId === id) return;

		editorActivity.activeWorkspaceId = id;
		editorActivity.activeWorkspaceName = name;
		editorActivity.activeProjectId = null;
		editorActivity.activeProjectName = null;
		editorActivity.activeViewId = null;
		editorActivity.activeKitId = null;
	};

	const workspaceMenu = (workspaceId: string): ContextMenuContentGenerator => {
		return () => [
			{
				name: 'rename',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => {
					workspaceEditing[workspaceId] = true;
				}
			},
			'hr',
			{
				name: 'delete',
				displayText: 'Delete',
				icon: 'fa-solid fa-trash',
				destructive: true,
				onClick: () => {
					api.deleteWorkspace(workspaceId);
				}
			}
		];
	};

	const workspacesHeaderMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'new_workspace',
				displayText: 'New Workspace',
				icon: 'fa-solid fa-folder-plus',
				onClick: () => {
					api.createWorkspace('Untitled').then((w) => {
						if (w) {
							selectWorkspace(w.id, w.name);
						}
					});
				}
			}
		];
	};
</script>

<div id="profile" popover class="menu">
	<h2 use:contextMenu={workspacesHeaderMenu}>Workspaces</h2>
	<ul class="workspaces">
		{#if workspaceQuery.rows}
			{#each workspaceQuery.rows as w (w.workspaceId)}
				<li>
					<button
						title={w.workspaceId}
						class:selected={w.workspaceId === editorActivity.activeWorkspaceId}
						use:contextMenu={workspaceMenu(w.workspaceId)}
						onclick={() => selectWorkspace(w.workspaceId, w.workspaceName)}
					>
						<i class="fa-solid fa-folder"></i>
						<sup class="count">{w.projectCount}</sup>
						<Renameable
							editing={workspaceEditing[w.workspaceId] === true}
							value={w.workspaceName}
							onCommit={(name) => {
								api.renameWorkspace(w.workspaceId, name);
								if (w.workspaceId === editorActivity.activeWorkspaceId) {
									editorActivity.activeWorkspaceName = name;
								}
								workspaceEditing[w.workspaceId] = false;
							}}
						>
							{w.workspaceName}
						</Renameable>
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
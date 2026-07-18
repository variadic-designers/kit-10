<script lang="ts">
	import type { SettingsContext } from './context.js';
	import { liveQuery } from '../Editor.svelte';
	import Renameable from '$lib/components/Renameable.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu.js';

	let { ctx }: { ctx: SettingsContext } = $props();
	const api = $derived(ctx.api);

	const workspaceQuery = liveQuery((api) => api.getAllWorkspaces());
	let workspaceEditing: Record<string, boolean> = $state({});

	const selectWorkspace = (id: string, name: string) => {
		if (ctx.editorActivity.activeWorkspaceId === id) return;
		ctx.editorActivity.activeWorkspaceId = id;
		ctx.editorActivity.activeWorkspaceName = name;
		ctx.editorActivity.activeProjectId = null;
		ctx.editorActivity.activeProjectName = null;
		ctx.editorActivity.activeViewId = null;
		ctx.editorActivity.activeKitId = null;
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

	const createWorkspace = () => {
		api.createWorkspace('Untitled').then((w) => {
			if (w) selectWorkspace(w.id, w.name);
		});
	};
</script>

<div class="tab">
	<div class="head">
		<p class="hint">Switch, rename, or create workspaces. The active one is highlighted.</p>
		<button class="new" onclick={createWorkspace}>
			<i class="fa-solid fa-folder-plus"></i> New
		</button>
	</div>

	<ul class="workspaces">
		{#if workspaceQuery.rows}
			{#each workspaceQuery.rows as w (w.workspaceId)}
				<li>
					<button
						title={w.workspaceId}
						class:selected={w.workspaceId === ctx.editorActivity.activeWorkspaceId}
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
								if (w.workspaceId === ctx.editorActivity.activeWorkspaceId) {
									ctx.editorActivity.activeWorkspaceName = name;
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
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-sm;
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: $x-space-sm;

		.hint {
			color: var(--color-text-muted);
			font-size: $x-font-size-sm;
			@include fonts-stack('Satoshi-Regular', sans);
		}

		.new {
			border: 1px solid var(--color-bg);
			background: var(--color-surface);
			color: var(--color-text);
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 4) $x-space-xs;
			cursor: pointer;
			white-space: nowrap;

			&:hover {
				color: var(--color-primary);
			}
		}
	}

	ul.workspaces {
		@include layout-flex-column();
		gap: 2px;

		li button {
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
			border-radius: calc($x-space-xs / 2);

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
			}
		}
	}
</style>

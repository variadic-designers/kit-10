<script lang="ts">
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Renameable from '$lib/components/Renameable.svelte';
	import Panel from '../Panel.svelte';
	import type { EditorState } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { queryBuilder, type Api } from 'manager';

	const {
		editorReady,
		editorActivity = $bindable(),
		api
	}: { editorReady: EditorState; editorActivity: EditorActivity; api: Api } = $props();

	const projectsQuery = liveQuery((api, activity) => {
		return api.getProjectsByWorkspaceId(activity.activeWorkspaceId);
	});

	$effect(() => {
		const ws = editorActivity.activeWorkspaceId;
		const rows = projectsQuery.rows;

		if (!ws) {
			editorActivity.activeProjectId = null;
			editorActivity.activeProjectName = null;
			return;
		}

		if (projectsQuery.isFetching) return;

		if (!rows.some((p) => p.projectId === editorActivity.activeProjectId)) {
			const first = rows[0];
			editorActivity.activeProjectId = first?.projectId ?? null;
			editorActivity.activeProjectName = first?.projectName ?? null;
		}
	});

	const projectPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'new_project',
				displayText: 'New Project',
				icon: 'fa-solid fa-diagram-project',
				onClick: () => {
					if (!editorActivity.activeWorkspaceId) {
						console.log('No active Workspace');
						return;
					}

					api.createProjectInWorkspace(editorActivity.activeWorkspaceId, 'Untitled').then((p) => {
						if (p) {
							selectProject(p.id, p.name);
						}
					});
				}
			}
		];
	};

	import YAML from 'yaml';

	let projectEditing: Record<string, boolean> = $state({});

	const projectListingContextMenu: (projectId: string) => ContextMenuContentGenerator = (
		projectId
	) => {
		return () => [
			{
				name: 'rename_project',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => {
					projectEditing[projectId] = true;
				}
			},
			{
				name: 'delete_project',
				displayText: 'Delete',
				icon: 'fa-solid fa-trash',
				onClick: () => {
					api.deleteProject(projectId);
				}
			},
			{
				name: 'export_project',
				displayText: 'Export',
				icon: 'fa-solid fa-file-export',
				onClick: () => {
					api.exportProject(projectId).then((p) => {
						console.log(YAML.stringify(p, null, 8));
					});
				}
			}
		];
	};

	const selectProject = (id: string, name: string) => {
		if (editorActivity.activeProjectId !== id) {
			editorActivity.activeProjectId = id;
			editorActivity.activeProjectName = name;
		}
	};
</script>

<Panel name="Projects" tooltip="Project Settings" contextMenuContent={projectPanelContextMenu}>
	{#snippet content()}
		{#each projectsQuery.rows as p (p.projectId)}
			<li class="project-listing">
				<button
					onclick={() => selectProject(p.projectId, p.projectName)}
					class:selected={p.projectId === editorActivity.activeProjectId}
					use:contextMenu={projectListingContextMenu(p.projectId)}
					title={`by ${p.author} - ${p.license}`}
				>
					<span class="project-listing__name"
						><i class="fa-solid fa-diagram-project"></i>
						<Renameable
							editing={projectEditing[p.projectId] === true}
							value={p.projectName}
							onCommit={(name) => {
								api.renameProject(p.projectId, name);
								editorActivity.activeProjectName = name;
								projectEditing[p.projectId] = false;
							}}
						>
							{p.projectName}
						</Renameable></span
					>
					<span class="project-listing__description"> - {p.projectDescription}</span>
				</button>
			</li>
		{/each}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.project-listing {
		&__name {
			@include fonts-stack('Satoshi-Regular', sans);

			i {
				color: currentColor;
				font-size: $x-font-size-md;
			}
		}

		&__description {
			color: var(--color-text-muted);
			@include fonts-stack('Satoshi-Light', sans);
		}
	}

	button {
		width: 100%;
		height: 100%;
		padding-left: $x-space-sm;
		letter-spacing: 1px;

		text-align: left;
		background: var(--color-surface);
		color: var(--color-pure-alt);
		border: unset;
		padding-block: calc($x-space-xs / 4);

		&:hover {
			color: var(--color-primary);
		}

		&.selected {
			background: var(--color-surface-alt);

			.project-listing__name {
				color: var(--color-primary);
			}

			&:hover .project-listing__name {
				color: var(--color-primary-hover);
			}
		}

		font-size: $x-font-size-md;
	}

	i {
		color: var(--color-warning);
		font-size: $x-font-size-lg;
	}
</style>

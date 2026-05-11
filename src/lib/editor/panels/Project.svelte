<script lang="ts">
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';
	import Panel from '../Panel.svelte';
	import type { EditorState } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import { queryBuilder, type Api } from 'manager';

	const {
		editorReady,
		editorActivity = $bindable(),
		api,
  }: { editorReady: EditorState; editorActivity: EditorActivity, api: Api } = $props();

	const projectsQuery = liveQuery(
		(api, activity) => {
			return api.getProjectsByWorkspaceId(activity.activeWorkspaceId);
		}
	);

	// Reset selection
	$effect(() => {
		if (
			projectsQuery.rows[0] &&
			!editorActivity.activeProjectId &&
			editorActivity.activeWorkspaceId
		) {
			api
				.getProjectsByWorkspaceId(editorActivity.activeWorkspaceId)
				.executeTakeFirst()
				.then((p) => {
					if (p) {
						editorActivity.activeProjectId = p.projectId;
					}
				});
		} else if (!editorActivity.activeWorkspaceId) {
			editorActivity.activeProjectId = null;
			editorActivity.activeProjectName = null;
			return;
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

	const projectListingContextMenu: (projectId: string) => ContextMenuContentGenerator = (
		projectId
	) => {
		return () => [
			{
				name: 'rename_project',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => {
					api.renameProject(projectId, 'Bleh');
				}
			},
			{
				name: 'delete_project',
				displayText: 'Delete',
				icon: 'fa-solid fa-trash',
				onClick: () => {
					api.deleteProject(projectId);
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
						<span id="editable-{p.projectId}">{p.projectName}</span></span
					>
					<span class="project-listing__description"> - {p.description}</span>
				</button>

				<!--
				<form style="display:flex"
						onsubmit={async (e) => {
              await api.renameProject(p.projectId, p.projectName);
            }}
        >
					<input
						placeholder={p.projectName}
            bind:value={p.projectName}
					/>
					<button type="submit">Rename</button>
				</form>

        -->
			</li>
		{/each}

		<!--
		{#if projectsQuery.rows}
			{#each projectsQuery.rows as project (project.id)}
				<li class="project-listing">
					<button
						onclick={selectProject(project.id, project.name)}
						class:selected={project.id === editorActivity.activeProjectId}
						use:contextMenu={projectListingContextMenu(project.id)}
						title={`by ${project.author} - ${project.license}`}
					>
						<span class="project-listing__name"
							><i class="fa-solid fa-diagram-project"></i>
							<span id="editable-{project.id}">{project.name}</span></span
						>
						<span class="project-listing__description"> - {project.description}</span>
					</button>
				</li>
			{/each}

			{#each projectsQuery.rows as project (project.id)}

			{/each}
		{:else if projectsQuery.isFetching}
			<span>WAIT</span>
		{:else if projectsQuery.error}
			<span>{projectsQuery.error}</span>
		{/if}
    -->
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

<script lang="ts">
	import {
		contextMenu,
		type ContextMenuContent,
		type ContextMenuContentGenerator
	} from '$lib/components/contextMenu.js';
	import Renameable from '$lib/components/Renameable.svelte';
	import Panel from '../Panel.svelte';
	import type { EditorState } from 'manager';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import { queryBuilder, type Api } from 'manager';
	import {
		resolveExportProviders,
		type ProjectExportProvider
	} from '$lib/plugins/project-export-providers.js';
	import {
		resolveImportProviders,
		type ProjectImportProvider
	} from '$lib/plugins/project-import-providers.js';

	const {
		editorReady,
		editorActivity = $bindable(),
		api,
		callUtilityPlugin
	}: {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
	} = $props();

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

	// Export/import providers resolved from whatever's actually installed (each plugin declares
	// its own `provides.exports`/`provides.imports` capability on its manifest -- see
	// project-export-providers.ts). Both are install-level (see PluginActivation in schema.ts) --
	// neither is scoped per-project, so export and import share the exact same fetch, done once:
	// the catalogue only changes on app bootstrap (registerBuiltinPlugins), not during a normal
	// session.
	let availableExportProviders: ProjectExportProvider[] = $state([]);
	let availableImportProviders: ProjectImportProvider[] = $state([]);

	$effect(() => {
		api.listPlugins().then((plugins) => {
			availableExportProviders = resolveExportProviders(plugins);
			availableImportProviders = resolveImportProviders(plugins);
		});
	});

	// Prompts a native file picker, reads the chosen file as text, and hands it to the import
	// provider's plugin function along with the active workspace to create the new project in.
	// Mirrors buildExportSubmenu's callUtilityPlugin shape, just in the opposite direction. On
	// success the plugin returns the new project's {id, name} as its plain text result, which we
	// use to select it immediately -- the project list itself updates via the existing live query.
	const pickFileAndImport = (provider: ProjectImportProvider) => {
		const workspaceId = editorActivity.activeWorkspaceId;
		if (!workspaceId) {
			console.error('No active workspace to import into');
			return;
		}

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = provider.accept;
		input.onchange = () => {
			const file = input.files?.[0];
			if (!file) return;

			file
				.text()
				.then((text) =>
					callUtilityPlugin?.(
						provider.id,
						provider.fn,
						JSON.stringify({ workspace_id: workspaceId, text })
					)
				)
				.then((result) => {
					if (!result) return;
					const project = JSON.parse((result as { text(): string }).text()) as {
						id: string;
						name: string;
					};
					selectProject(project.id, project.name);
				})
				.catch((err) => console.error(`[${provider.id}] ${provider.fn} failed:`, err));
		};
		input.click();
	};

	const buildImportSubmenu = (): ContextMenuContent => {
		if (availableImportProviders.length === 0) {
			return [
				{
					name: 'check_store_for_import_options',
					displayText: 'Check Store for Options',
					icon: 'fa-solid fa-store',
					disabled: true,
					description: 'No import plugins are available yet.'
				}
			];
		}

		return availableImportProviders.map((provider) => ({
			name: `import_${provider.id}`,
			displayText: provider.label,
			icon: 'fa-solid fa-file-import',
			onClick: () => pickFileAndImport(provider)
		}));
	};

	const projectPanelContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'new_project',
				displayText: 'New Project',
				icon: 'fa-solid fa-diagram-project',
				onClick: () => {
					if (!editorActivity.activeWorkspaceId) return;

					api.createProjectInWorkspace(editorActivity.activeWorkspaceId, 'Untitled').then((p) => {
						if (p) {
							selectProject(p.id, p.name);
						}
					});
				}
			},
			'hr',
			{
				name: 'import_project',
				displayText: 'Import',
				icon: 'fa-solid fa-file-import',
				submenu: buildImportSubmenu()
			}
		];
	};

	let projectEditing: Record<string, boolean> = $state({});

	const downloadText = (text: string, filename: string, mimeType: string) => {
		const blob = new Blob([text], { type: mimeType });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = filename;
		a.click();
		URL.revokeObjectURL(url);
	};

	// Builds the "Export" submenu from whichever export providers are actually resolved from
	// installed plugins (see availableExportProviders above). Never hardcodes Tenner (or any
	// other specific plugin) by name here -- that mapping lives entirely in
	// project-export-providers.ts, so a future second export plugin needs no change to this file.
	const buildExportSubmenu = (projectId: string, projectName: string): ContextMenuContent => {
		const providers = availableExportProviders;

		if (providers.length === 0) {
			return [
				{
					name: 'check_store_for_export_options',
					displayText: 'Check Store for Options',
					icon: 'fa-solid fa-store',
					disabled: true,
					description: 'No export plugins are available for this project yet.'
				}
			];
		}

		return providers.map((provider) => ({
			name: `export_${provider.id}`,
			displayText: provider.label,
			icon: 'fa-solid fa-file-export',
			onClick: () => {
				callUtilityPlugin
					?.(provider.id, provider.fn, JSON.stringify({ project_id: projectId }))
					.then((result) => {
						const text = (result as { text(): string }).text();
						downloadText(text, `${projectName}.${provider.fileExtension}`, provider.mimeType);
					})
					.catch((err) => console.error(`[${provider.id}] ${provider.fn} failed:`, err));
			}
		}));
	};

	const projectListingContextMenu: (
		projectId: string,
		projectName: string
	) => ContextMenuContentGenerator = (projectId, projectName) => {
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
				submenu: buildExportSubmenu(projectId, projectName)
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
					use:contextMenu={projectListingContextMenu(p.projectId, p.projectName)}
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

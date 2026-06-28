<script lang="ts">
	import type { EditorSelection } from '../Editor.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Renameable from '$lib/components/Renameable.svelte';

	type ViewsPanel = {
		selection: EditorSelection;
	} & {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
	};

	let {
		selection = $bindable(),

		// new API
		api,
		editorReady,
		editorActivity = $bindable()
	}: ViewsPanel = $props();

	export const selectView = (id: string, name: string) => {
		if (editorActivity.activeViewId !== id) {
			editorActivity.activeViewId = id;
		}
	};

	let kitsContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'add',
			displayText: 'Box',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => {
				if (!editorActivity.activeProjectId) {
					console.log('No active Project');
					return;
				}

				api.createViewInProject(editorActivity.activeProjectId, 'Idk').then((p) => {
					if (p) {
						selectView(p.id, p.name);
					}
				});
			}
		},
		'hr',
		{
			name: 'add',
			displayText: 'Text',
			icon: 'fa-solid fa-italic',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'Image',
			icon: 'fa-solid fa-image',
			onClick: () => console.log('Add')
		},
		{
			name: 'add',
			displayText: 'Shape',
			icon: 'fa-solid fa-star',
			onClick: () => console.log('Add')
		},
		'hr',
		{
			name: 'add',
			displayText: 'Screen',
			icon: 'fa-solid fa-display',
			onClick: () => console.log('Add')
		}
	];

	let viewEditing: Record<string, boolean> = $state({});

	let menu = (viewId: string): ContextMenuContentGenerator => {
		return () => [
			{
				name: 'add',
				displayText: 'Mark as Export',
				icon: 'fa-solid fa-file-export',
				onClick: () => console.log('Add')
			},
			'hr',
			{
				name: 'add',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => {
					viewEditing[viewId] = true;
				}
			},
			{
				name: 'add',
				displayText: 'Deselect',
				icon: 'fa-solid fa-minus',
				onClick: () => {
					selection.selectedViewPrimary = null;
					selection.selectedKitIndex = null;
				}
			},
			'hr',
			{
				name: 'add',
				displayText: 'New View',
				icon: 'fa-solid fa-diamond',
				onClick: () => {}
			},

			{
				name: 'trash',
				displayText: 'Clone View',
				icon: 'fa-solid fa-clone',
				onClick: () => {}
			},
			'hr',
			{
				name: 'trash',
				displayText: 'Delete View',
				icon: 'fa-solid fa-trash-can',
				onClick: () => {
					api.deleteView(viewId).then((v) => {
						console.log(`Deleted view#${viewId}`);
					});
				}
			}
		];
	};

	import type { Api, EditorState } from 'manager';
	import { type EditorActivity, liveQuery } from '../Editor.svelte';

	const viewsQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
	});

	$effect(() => {
		const proj = editorActivity.activeProjectId;
		const rows = viewsQuery.rows;

		if (!proj) {
			editorActivity.activeViewId = null;
			return;
		}

		if (viewsQuery.isFetching) return;

		if (!rows.some((v) => v.viewId === editorActivity.activeViewId)) {
			editorActivity.activeViewId = rows[0]?.viewId ?? null;
		}
	});
</script>

<Panel contextMenuContent={kitsContextMenu} name="Views" tooltip="Kit Views">
	{#snippet content()}
		<!-- <pre>{JSON.stringify(viewsQuery, null, 2)}</pre> -->
		<ul class="views">
			{#if viewsQuery.rows}
				{#each viewsQuery.rows as v (v.viewId)}
					{@render kitter(v, 0)}
				{/each}
			{/if}
		</ul>
	{/snippet}
</Panel>

{#snippet kitter(v: any, level: number)}
	<!--
				{@const hideVerb = view['hide'] ? 'Show' : 'Hide'}
				{@const hideFontAwesomeType = view['selected'] ? 'solid' : 'regular'}
				{@const hideFontAwesomeChar = view['hide'] ? 'eye-slash' : 'eye'}
				{@const lockFontAwesomeChar = view['lock'] ? 'lock' : 'lock-open'}
        -->

	{@const viewIcon = v.viewLocked ? 'fa-solid fa-lock' : 'fa-regular fa-window-maximize'}

	<li class="view-field" class:selected={editorActivity.activeViewId === v.viewId}>
		<button
			style="--level: {level}"
			class="view"
			use:contextMenu={menu(v.viewId)}
			aria-label={v.viewName}
			onclick={() => selectView(v.viewId, v.viewName)}
		>
			<i class="view__icon {viewIcon}"></i>
			<div class="view__name">
				<Renameable
					editing={viewEditing[v.viewId] === true}
					value={v.viewName ?? ''}
					onCommit={(name) => {
						api.renameView(v.viewId, name);
						viewEditing[v.viewId] = false;
					}}
				>
					{v.viewName ?? 'Literally Nothing'}
				</Renameable>
			</div>
		</button>
	</li>
{/snippet}

<style lang="scss">
	@use '_index' as *;

	.views {
		@include layout-flex-column();
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.view-field {
		display: flex;
		padding-left: $x-space-sm;

		&.selected {
			background-color: var(--color-surface-alt);

			.view__icon,
			.view__name {
				color: var(--color-primary);
			}

			&:hover {
				.view__icon,
				.view__name {
					color: var(--color-primary-hover);
				}
			}
		}
	}

	.view-option {
		background: inherit;
		color: var(--color-text-muted);
		border: unset;
		// border-right: 1px solid var(--color-text-muted);
		padding-right: calc($x-space-xs / 1);
	}

	.view {
		padding-left: calc($x-space-lg * (-0 + var(--level) * 0.45));
		padding-block: calc($x-space-xs * 0.25);

		color: var(--color-text);

		background-color: inherit;
		border: unset;

		display: flex;
		width: 100%;
		cursor: pointer;
		position: relative;
		font-size: $x-font-size-md;
		align-items: center;

		&__icon {
			font-size: $x-font-size-md;
		}

		&__name {
			@include fonts-stack('Satoshi-Light', sans);
			padding-left: $x-space-xs;
			font-weight: 600;
			letter-spacing: 1px;
			color: var(--color-text);
		}

		&:hover {
			.view__icon,
			.view__name {
				color: var(--color-primary);
			}
		}
	}
</style>

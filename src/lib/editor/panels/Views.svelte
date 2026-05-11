<script lang="ts">
	import type { ComponentFlat, ComponentView, ComponentViewRoot } from '../Component.svelte';
	import type { EditorSelection } from '../Editor.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';

	type ViewsPanel = {
		selection: EditorSelection;
		views: string[];
		viewsPool: Record<string, ComponentView>;
	} & {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
	};

	let {
		selection = $bindable(),
		views = $bindable(),
		viewsPool = $bindable(),

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
				icon: 'fa-solid fa-italic',
				onClick: () => console.log('Add')
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
					apiapi.deleteView(viewId).then((v) => {
						console.log(`Deleted view#${viewId}`);
					});
				}
			}
		];
	};

	import type { Api, EditorState } from 'manager';
	import { type EditorActivity, liveQuery } from '../Editor.svelte';

	// Select view on project switch
	$effect(() => {
		if (viewsQuery.rows[0] && editorActivity.activeProjectId && editorActivity.activeWorkspaceId) {
			editorActivity.activeViewId = viewsQuery.rows[0].viewId;
		} else {
			editorActivity.activeViewId = null;
		}
	});

	const viewsQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
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

{#snippet kitter(v, level: number)}
	<!--
				{@const hideVerb = view['hide'] ? 'Show' : 'Hide'}
				{@const hideFontAwesomeType = view['selected'] ? 'solid' : 'regular'}
				{@const hideFontAwesomeChar = view['hide'] ? 'eye-slash' : 'eye'}
				{@const lockFontAwesomeChar = view['lock'] ? 'lock' : 'lock-open'}
        -->

	{@const viewIcon =
		v.primitive?.kind === 'text' ? 'fa-solid fa-italic' : 'fa-regular fa-window-maximize'}

	<li class="view-field">
		<button
			style="--level: {level}"
			class="view"
			class:view--selected={editorActivity.activeViewId === v.viewId}
			use:contextMenu={menu(v.viewId)}
			aria-label={v.viewName}
			onclick={() => selectView(v.viewId, v.viewName)}
		>
			<i class="view__icon {viewIcon}"></i>
			<div class="view__name" contenteditable="false">
				{v.viewName ?? 'Literally Nothing'}
			</div>
		</button>
	</li>

	{#if v.primitive?.kind === 'container'}
		{#each v.primitive.children as child}
			{#if viewsPool[child]}
				{@render kitter(viewsPool[child], level + 1, child)}
			{:else}
				<li class="view-field">
					<button class="view" title="Unable to resolve #{child}">
						<i class="view__icon fa-solid fa-question"></i>
						<div class="view__name" contenteditable="false"></div>
					</button>
				</li>
			{/if}
		{/each}
	{/if}
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

		&:has(.view--selected) {
			background-color: var(--color-surface-alt);
		}
	}

	.view-option {
		background: inherit;
		color: var(--color-text-muted);
		border: unset;
		// border-right: 1px solid var(--color-text-muted);
		padding-right: calc($x-space-xs / 1);

		&--lock:has(.fa-lock) {
			color: var(--color-text);
		}

		&--hide:has(.fa-eye-slash) {
			color: var(--color-text);
		}
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

		&--selected {
			> * {
				color: var(--color-primary);
			}

			&:hover {
				border-color: var(--color-primary-hover);

				.view__icon,
				.view__name {
					color: var(--color-primary-hover);
				}
			}
		}

		&:hover {
			color: var(--color-primary);
		}
	}
</style>

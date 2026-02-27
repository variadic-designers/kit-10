<script lang="ts">
	import type { ComponentFlat, ComponentView, ComponentViewRoot } from '../Component.svelte';
	import type { EditorSelection } from '../Editor.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';
	import V from './views.ts';

	type ViewsPanel = {
		selection: EditorSelection;
		views: string[];
		viewsPool: Record<string, ComponentView>;
	};

	const {
		selection = $bindable(),
		views = $bindable(),
		viewsPool = $bindable()
	}: ViewsPanel = $props();

	let kitsContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'add',
			displayText: 'Box',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => {}
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

	let menu = () => [
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
			onClick: () => {}
		}
	];

	import { selectView } from './views.ts';

	import { setDebugMode, dndzone } from 'svelte-dnd-action';
	setDebugMode(true);
</script>

<Panel contextMenuContent={kitsContextMenu} name="Views" tooltip="Kit Views">
	{#snippet content()}
		<ul class="views">
			{#snippet kitter(view: ComponentView, level: number, id: string)}
				{@const hideVerb = view['hide'] ? 'Show' : 'Hide'}
				{@const hideFontAwesomeType = view['selected'] ? 'solid' : 'regular'}
				{@const hideFontAwesomeChar = view['hide'] ? 'eye-slash' : 'eye'}
				{@const lockFontAwesomeChar = view['lock'] ? 'lock' : 'lock-open'}

				{@const viewIcon =
					view.primitive?.kind === 'text' ? 'fa-solid fa-italic' : 'fa-regular fa-window-maximize'}

				<li class="view-field">
					<button
						style="--level: {level}"
						class="view"
						class:view--selected={selection.selectedViewPrimary === id}
						use:contextMenu={menu}
						aria-label={view.name}
						onclick={selectView(view, id, selection)}
					>
						<i class="view__icon {viewIcon}"></i>
						<div class="view__name" contenteditable="false">
							{view.name ?? 'Unnamed'}
						</div>
					</button>

					<button
						onclick={() => {
							view['lock'] = !!!view['lock'];
						}}
						class="view-option view-option--lock"
						title="{hideVerb} '{view.name}'"
						aria-label="{hideVerb} '{view.name}'"
					>
						<i class="fa-solid fa-{lockFontAwesomeChar}"></i>
					</button>

					<button
						onclick={() => {
							view['hide'] = !!!view['hide'];
						}}
						class="view-option view-option--hide"
						title="{hideVerb} '{view.name}'"
						aria-label="{hideVerb} '{view.name}'"
					>
						<i class="fa-{hideFontAwesomeType} fa-{hideFontAwesomeChar}"></i>
					</button>
				</li>

				{#if view.primitive?.kind === 'container'}
					{#each view.primitive.children as child}
						{#if viewsPool[child]}
							{@render kitter(viewsPool[child], level + 1, child)}
						{:else}
							<li class="view-field">
								<button class="view">
									<i class="view__icon fa-solid fa-question"></i>
									<div class="view__name" contenteditable="false">
										'Unable to resolve #{child.split('-')[0]}'
									</div>
								</button>
							</li>
						{/if}
					{/each}
				{/if}
			{/snippet}

			{#each views as view, i}
				{@const viewFound = viewsPool[view]}

				{#if viewFound}
					{@render kitter(viewFound, 0, view)}
				{:else}
					Unresolved View. ID: {view}
				{/if}
			{/each}
		</ul>
	{/snippet}
</Panel>

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

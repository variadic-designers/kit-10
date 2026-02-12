<script lang="ts">
	import type { ComponentFlat, ComponentView, ComponentViewRoot } from '../Component.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';

	type ViewsPanel = {
		selectedKit?: ComponentViewRoot;
		kits: ComponentFlat[];
		kitViews: ComponentView[];
	};

	const { selectedKit, kits = $bindable(), kitViews = $bindable() }: ViewsPanel = $props();
	// deselect everything
	const deselectAll = (list: ComponentView[]) => {
		for (const c of list) {
			delete c.selected;
			if (c.children) deselectAll(c.children);
		}
	};

	const selectKit = (target: ComponentView) => {
		deselectAll(kitViews);

		// select the target
		target.selected = 'primary';
	};

	let kitsContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'add',
			displayText: 'Kit',
			icon: 'fa-regular fa-window-maximize',
			onClick: () => {
				let index = kits.push({
					name: 'Unnamed',
					discriminator: 0,
					sets: {
						layers: [],
						axisRank: []
					}
				});

				kitViews.push({
					source_index: index - 1,
					params: {},
					rootPosition: {
						x: 0,
						y: 0
					}
				});
			}
		},
		'hr',
		{
			name: 'add',
			displayText: 'Text',
			icon: 'fa-solid fa-bold',
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
				if (selectedKit) {
					deselectAll(kitViews);
				}
			}
		},
		'hr',
		{
			name: 'add',
			displayText: 'New View',
			icon: 'fa-solid fa-diamond',
			onClick: () => {
				if (selectedKit) {
					kitViews.push({
						source_index: selectedKit.source_index,
						params: selectedKit.params,
						discriminator: 5,
						name: selectedKit.name,
						rootPosition: { x: 0, y: 0 }
					});
				}
			}
		},

		{
			name: 'trash',
			displayText: 'Clone View',
			icon: 'fa-solid fa-clone',
			onClick: () => {
				if (selectedKit) {
				}
			}
		},
		'hr',
		{
			name: 'trash',
			displayText: 'Delete View',
			icon: 'fa-solid fa-trash-can',
			onClick: () => {
				if (selectedKit) {
				}
			}
		}
	];

	const newKit: { name: string } | undefined = $state();
</script>

<Panel contextMenuContent={kitsContextMenu} name="Views" tooltip="Kit Views">
	{#snippet content()}
		<div class="components">
			{#snippet kitter(component: ComponentView, level: number)}
				{@const hideVerb = component['hide'] ? 'Show' : 'Hide'}
				{@const hideFontAwesomeType = component['selected'] ? 'solid' : 'regular'}
				{@const hideFontAwesomeChar = component['hide'] ? 'eye-slash' : 'eye'}
				{@const lockFontAwesomeChar = component['lock'] ? 'lock' : 'lock-open'}

				<div class="component-field">
					<button
						style="--coords: 'x: {component.rootPosition?.x ?? 0} y: {component.rootPosition?.y ??
							0}'; --level: {level}"
						class="component"
						class:component--selected={component.selected}
						use:contextMenu={menu}
						aria-label={component.name}
						onclick={() => selectKit(component)}
					>
						<i class="component__icon fa-regular fa-window-maximize"></i>
						<div class="component__name" contenteditable="false">
							{component.name ?? kits[component.source_index].name ?? 'Unnamed'}
						</div>
					</button>

					<button
						onclick={() => {
							component['lock'] = !!!component['lock'];
						}}
						class="component-option component-option--lock"
						title="{hideVerb} '{component.name}'"
						aria-label="{hideVerb} '{component.name}'"
					>
						<i class="fa-solid fa-{lockFontAwesomeChar}"></i>
					</button>

					<button
						onclick={() => {
							component['hide'] = !!!component['hide'];
						}}
						class="component-option component-option--hide"
						title="{hideVerb} '{component.name}'"
						aria-label="{hideVerb} '{component.name}'"
					>
						<i class="fa-{hideFontAwesomeType} fa-{hideFontAwesomeChar}"></i>
					</button>
				</div>

				{#if component.children}
					{#each component.children as child}
						{@render kitter(child, level + 1)}
					{/each}
				{/if}
			{/snippet}

			{#each kitViews as kit}
				{@render kitter(kit, 0)}
			{/each}
		</div>
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.components {
		@include layout-flex-column();
		overflow-x: auto;
		scrollbar-width: thin;
	}

	.component-field {
		display: flex;
		padding-left: $x-space-sm;

		&:has(.component--selected) {
			background-color: var(--color-surface-alt);
		}
	}

	.component-option {
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

	.component {
		padding-left: calc($x-space-lg * (-0 + var(--level) * 0.45));
		padding-block: calc($x-space-xs * 0.25);

		color: var(--color-text);

		background-color: inherit;
		border: unset;

		display: flex;
		width: 100%;
		cursor: pointer;
		position: relative;
		// border-left: 2px solid var(--color-surface);
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
			.component__icon,
			.component__name {
				color: var(--color-primary);
			}
		}

		&--selected {
			// border-left: 2px solid var(--color-primary);

			.component__name {
				@include fonts-stack('Satoshi-Regular', sans);
			}

			> * {
				color: var(--color-primary);
			}

			&:hover {
				border-color: var(--color-primary-hover);

				.component__icon,
				.component__name {
					color: var(--color-primary-hover);
				}
			}
		}

		&::after {
			content: var(--coords);
			color: var(--color-text-muted);
			position: absolute;
			right: $x-space-md;
			display: none;
		}

		&:hover {
			color: var(--color-primary);

			&::after {
				display: block;
			}
		}
	}
</style>

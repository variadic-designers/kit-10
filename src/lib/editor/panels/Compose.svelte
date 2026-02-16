<script lang="ts">
	import Panel from '../Panel.svelte';
	import type { ComponentView, ComponentFlat } from '../Component.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';

	type ComposePanelProps = {
		selectedKit?: ComponentView;
		kits: ComponentFlat[];
	};

	const { selectedKit, kits = $bindable() }: ComposePanelProps = $props();

	const tooltip = $derived.by(() => {
		const subject = selectedKit ? `View: \`${selectedKit.name}\`` : 'Selected View';

		return `Compose Kits on ${subject}`;
	});

	const composeContextMenuContent: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'add',
				displayText: 'New Kit',
				icon: 'fa-solid fa-box-open',
				onClick: () => console.log('Add')
			}
		];
	};

	const kitcontextMenuContent = () => {
		return [
			{
				name: 'add',
				displayText: 'Rename',
				icon: 'fa-solid fa-italic',
				onClick: () => console.log('Add')
			},
			{
				name: 'add',
				displayText: 'Set Icon',
				icon: 'fa-solid fa-icons',
				onClick: () => console.log('Add')
			},
			{
				name: 'add',
				displayText: 'Set Mode',
				icon: 'fa-solid fa-screwdriver',
				onClick: () => console.log('Add')
			},
			'hr',
			{
				name: 'add',
				displayText: 'Remove',
				icon: 'fa-solid fa-trash',
				onClick: () => console.log('Add')
			}
		];
	};
</script>

<Panel name="Compose" contextMenuContent={composeContextMenuContent} {tooltip}>
	{#snippet content()}
		{@const icons = ['fa-diamond', 'fa-pentagon', 'fa-hexagon', 'fa-septagon', 'fa-octagon']}
		<ol class="kits">
			{#if selectedKit}
				{#each selectedKit.resolve.map((r) => kits[r.source_index]) as kit, i}
					<li class="kit-field">
						<label use:contextMenu={kitcontextMenuContent}>
							<span class="kit-field__name">
								<i class="kit-field__icon fa-solid fa-puzzle-piece"></i>
								{kit.name}</span
							>
							<input class="kit-field__radio" type="radio" value={kit.name} name="compose" />
							<i class="kit-field__layer-icon kit-field__icon fa-solid {icons[i]}"></i>

							<button>
								<i class="kit-field__icon fa-regular fa-eye"></i>
							</button>
						</label>
					</li>
				{/each}
			{/if}
		</ol>
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.kits {
		@include layout-flex-column();
	}

	.kit-field {
		@include layout-flex-column();
		user-select: none;

		label {
			flex-grow: 1;
			display: flex;
			align-items: center;
		}

		padding-block: calc($x-space-xs / 4);

		&__icon {
			font-size: $x-font-size-md;
		}

		&__layer-icon {
			padding-inline: $x-space-xs;
			min-width: max-content;
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
			-webkit-text-stroke-width: 2px;
			-webkit-text-stroke-color: black;
		}

		&__name {
			@include fonts-stack('Satoshi-Light', sans);
			padding-left: $x-space-sm;
			font-weight: 600;
			letter-spacing: 1px;
			color: var(--color-text);
			flex-grow: 1;
		}

		&:has(input[type='radio']:checked) {
			background: var(--color-surface-alt);

			.kit-field__icon,
			.kit-field__name {
				color: var(--color-primary);
			}
		}

		&:hover {
			.kit-field__name {
				color: var(--color-primary);
			}

			&:has(input[type='radio']:checked) {
				.kit-field__name {
					color: var(--color-primary-hover);
				}
			}
		}

		input[type='radio'] {
			opacity: 0;
			position: absolute;
		}
	}
</style>

<script lang="ts">
	import Panel from '../Panel.svelte';
	import type { ComponentView, ComponentFlat } from '../Component.svelte';
	import { contextMenu } from '../contextMenu.ts';
	import type { ContextMenuContentGenerator } from '../contextMenuStore.ts';
	import { liveQuery, type EditorActivity, type EditorSelection } from '../Editor.svelte';
	import { type Api, type EditorState } from 'manager';

	type ComposePanelProps = {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		selection: EditorSelection;
		viewsPool: Record<string, ComponentView>;
		kitsPool: Record<string, ComponentFlat>;
		api: Api;
	};

	const {
		api,
		editorReady,
		editorActivity = $bindable(),
		viewsPool,
		selection = $bindable(),
		kitsPool
	}: ComposePanelProps = $props();

	const composeContextMenuContent: ContextMenuContentGenerator = $derived(() => {
		return [
			{
				name: 'add',
				displayText: 'New Kit',
				icon: 'fa-solid fa-box-open',
				onClick: () => {
					if (editorActivity.activeViewId && editorActivity.activeProjectId) {
						console.log('About to create kit');
						api.createKitInProject(editorActivity.activeProjectId, 'Cool Kit').then((k) => {
							console.log(`About to attach kit ${k.id}`);
							if (k && editorActivity.activeViewId) {
								api.attachKitToComposition(k.id, editorActivity.activeViewId).then((kc) => {
									if (kc) {
										console.log(
											`Succeeded. Attached kit#${k.id} to view#${editorActivity.activeViewId}`
										);
									} else {
										console.error(`Failed to attach kit ${k.id}`);
									}
								});
							}
						});
					}
				}
			},

			'hr',

			...kitsUnusedQuery.rows.map((k) => {
				kitsQuery.rows;
				return {
					name: k.kitName,
					displayText: k.kitName,
					icon: 'fa-solid fa-puzzle-piece',
					onClick: () => {
						if (editorActivity.activeViewId) {
							api.attachKitToComposition(k.kitId, editorActivity.activeViewId).then((kc) => {
								if (kc) {
									console.log(
										`Succeeded. Attached kit#${k.id} to view#${editorActivity.activeViewId}`
									);
								} else {
									console.error(`Failed to attach kit ${k.id}`);
								}
							});
						}
					}
				};
			})
		];
	});

	const kitcontextMenuContent: (kitId: string, viewId: string) => ContextMenuContentGenerator = (
		kitId,
		viewId
	) => {
		return () => [
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
				onClick: () => {
					api.detachKitFromComposition(kitId, viewId);
				}
			}
		];
	};

	const kitsQuery = liveQuery((api, activity) => {
		return api.getKitCompositionByViewId(activity.activeViewId);
	});

	const kitsUnusedQuery = liveQuery((api, activity) => {
		// funny way to be reactive ngl
		kitsQuery.rows;
		return api.getKitsExceptFromViewId(activity.activeViewId);
	});

	// Select kit on project switch
	$effect(() => {
		if (
			kitsQuery.rows[0] &&
			editorActivity.activeViewId &&
			editorActivity.activeProjectId &&
			editorActivity.activeWorkspaceId
		) {
			editorActivity.activeKitId = kitsQuery.rows[0].kitId;
		} else {
			editorActivity.activeKitId = null;
		}
	});
</script>

<Panel name="Compose" contextMenuContent={composeContextMenuContent} tooltip="Compose Current View">
	{#snippet content()}
		<!-- {@const icons = ['fa-diamond', 'fa-pentagon', 'fa-hexagon', 'fa-septagon', 'fa-octagon']} -->
		{@const icons = ['fa-octagon', 'fa-septagon', 'fa-hexagon', 'fa-pentagon', 'fa-diamond']}
		<ol class="kits">
			<!--
			<pre>{JSON.stringify(kitsQuery, null, 2)}</pre>
      -->

			{#if kitsQuery.rows}
				{#each kitsQuery.rows as k, i}
					<li class="kit-field" title={k.kitId}>
						<label use:contextMenu={kitcontextMenuContent(k.kitId, k.kitView)}>
							<span class="kit-field__name">
								<i class="kit-field__icon fa-solid fa-puzzle-piece"></i>
								{k.kitName}</span
							>
							<input
								class="kit-field__radio"
								type="radio"
								value={k.kitName}
								name="compose"
								checked={editorActivity.activeKitId === k.kitId}
								onclick={() => (selection.selectedKitIndex = i)}
							/>
							<i
								class="kit-field__layer-icon fa-solid {icons[
									icons.length - kitsQuery.rows.length + i
								]}"
							></i>

							<!--
							<button aria-label="Hide/Unhide Kit">
								<i class="kit-field__icon fa-regular fa-eye"></i>
							</button>
              -->
						</label>
					</li>
				{/each}
			{:else}
				No rows
			{/if}

			<!--
			{#if selection.selectedViewPrimary && viewsPool[selection.selectedViewPrimary]}
				{@const kits = viewsPool[selection.selectedViewPrimary].resolve.map(
					(r) => kitsPool[r.source_uuid]
				)}

				{#each kits as kit, i}
					<li class="kit-field">
						<label use:contextMenu={kitcontextMenuContent}>
							<span class="kit-field__name">
								<i class="kit-field__icon fa-solid fa-puzzle-piece"></i>
								{kit.name}</span
							>
							<input
								class="kit-field__radio"
								type="radio"
								value={kit.name}
								name="compose"
								checked={selection.selectedKitIndex === i}
								onclick={() => (selection.selectedKitIndex = i)}
							/>
							<i
								class="kit-field__layer-icon kit-field__icon fa-solid {icons[
									icons.length - kits.length + i
								]}"
							></i>

							<button aria-label="Hide/Unhide Kit">
								<i class="kit-field__icon fa-regular fa-eye"></i>
							</button>
						</label>
					</li>
				{/each}
			{/if}

      -->
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
			color: transparent;
			-webkit-text-stroke-width: 2px;
			-webkit-text-stroke-color: var(--color-text);
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

			.kit-field__icon {
				-webkit-text-stroke-color: var(--color-primary);
			}
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

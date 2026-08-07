<script lang="ts">
	import Panel from '../Panel.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import Renameable from '$lib/components/Renameable.svelte';
	import { liveQuery, type EditorActivity, type EditorSelection } from '../Editor.svelte';
	import { type Api, type EditorState } from 'manager';
	import { draggable, dropZone } from '../dnd.svelte.ts';

	type ComposePanelProps = {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		selection: EditorSelection;
		api: Api;
	};

	const {
		api,
		editorReady,
		editorActivity = $bindable(),
		selection = $bindable()
	}: ComposePanelProps = $props();

	// Attach a kit to the active view, then eagerly instantiate the kit's default composition as
	// this view's own cloned per-instance copies (clone-per-view) -- so composing a kit that ships
	// default children gives this instance unique children, not shared template references.
	async function attachKit(kitId: string) {
		const viewId = editorActivity.activeViewId;
		if (!viewId) return;
		const kc = await api.attachKitToComposition(kitId, viewId);
		if (!kc) {
			console.error(`Failed to attach kit ${kitId}`);
			return;
		}
		await api.instantiateKitDefaults(viewId);
	}

	// Drop-to-reorder: place the dragged kit on the target's before/after edge, then persist the
	// whole new order in one collision-safe call - mirrors Axes.svelte's handleAxisReorder.
	// kitsQuery is a live query, so no manual refetch is needed after the write (unlike
	// Axes.svelte's consumedAxes, which is a one-shot fetch).
	async function handleKitReorder(
		draggedKitId: string,
		targetKitId: string,
		edge: 'before' | 'after' = 'before'
	) {
		const viewId = editorActivity.activeViewId;
		if (!viewId || draggedKitId === targetKitId) return;

		const ids = kitsQuery.rows.map((k) => k.kitId);
		const from = ids.indexOf(draggedKitId);
		if (from < 0) return;
		ids.splice(from, 1);

		const ti = ids.indexOf(targetKitId);
		if (ti < 0) return;
		ids.splice(edge === 'after' ? ti + 1 : ti, 0, draggedKitId);

		await api.setKitCompositionOrder(viewId, ids);
	}

	const composeContextMenuContent: ContextMenuContentGenerator = $derived(() => {
		return [
			{
				name: 'new-kit',
				description: 'Create a new kit in this view',
				displayText: 'New Kit',
				icon: 'fa-solid fa-box-open',
				onClick: () => {
					if (editorActivity.activeViewId && editorActivity.activeProjectId) {
						api.createKitInProject(editorActivity.activeProjectId, 'Cool Kit').then((k) => {
							if (!k) return;
							// A brand-new kit has zero layers, so its first field edit would hit
							// commitFieldValue's "no source layer" guard (getNullLayerId returns
							// undefined for a kit with no layers at all, never creates one) -
							// createLayerWithConditions(kitId, []) is the exact-match find-or-create
							// this codebase already uses elsewhere (Axes panel "create layer", the
							// pipette write target); an empty condition set IS the null layer.
							api.createLayerWithConditions(k.id, []);
							attachKit(k.id);
						});
					}
				}
			},
			{
				name: 'use-kits',
				description: 'Compose an existing kit from this project into the view',
				displayText: 'Use Kits',
				icon: 'fa-solid fa-puzzle-piece',
				// Disabled (won't open) when every project kit is already composed here -- mirrors the
				// Axes panel's "Use Axis" submenu.
				disabled: kitsUnusedQuery.rows.length === 0,
				submenu: kitsUnusedQuery.rows.map((k) => ({
					name: `kit-${k.kitId}`,
					description: `Add ${k.kitName} to this view`,
					displayText: k.kitName,
					icon: 'fa-solid fa-puzzle-piece',
					onClick: () => attachKit(k.kitId)
				}))
			}
		];
	});

	let kitEditing: Record<string, boolean> = $state({});

	const kitcontextMenuContent: (kitId: string, viewId: string) => ContextMenuContentGenerator = (
		kitId,
		viewId
	) => {
		return () => [
			{
				name: 'add',
				displayText: 'Rename',
				icon: 'fa-solid fa-i-cursor',
				onClick: () => {
					kitEditing[kitId] = true;
				}
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
		kitsQuery.rows;
		return api.getKitsExceptFromViewId(activity.activeViewId);
	});

	$effect(() => {
		const viewId = editorActivity.activeViewId;
		const rows = kitsQuery.rows;

		if (!viewId) {
			editorActivity.activeKitId = null;
			return;
		}

		if (kitsQuery.isFetching) return;

		if (!rows.some((k) => k.kitId === editorActivity.activeKitId)) {
			editorActivity.activeKitId = rows[0]?.kitId ?? null;
		}
	});
</script>

<Panel name="Compose" contextMenuContent={composeContextMenuContent} tooltip="Compose Current View">
	{#snippet content()}
		<!-- {@const icons = ['fa-diamond', 'fa-pentagon', 'fa-hexagon', 'fa-septagon', 'fa-octagon']} -->
		{@const icons = [
			'fa-circle',
			'fa-square',
			'fa-diamond',
			'fa-star',
			'fa-heart',
			'fa-bolt',
			'fa-gem',
			'fa-crown'
		]}
		<ol class="kits">
			<!--
			<pre>{JSON.stringify(kitsQuery, null, 2)}</pre>
      -->

			{#if kitsQuery.rows}
				{#each kitsQuery.rows as k, i}
					<li
						class="kit-field"
						class:selected={editorActivity.activeKitId === k.kitId}
						title={k.kitId}
						use:draggable={{
							payload: () => ({ kind: 'composition', kitId: k.kitId, viewId: k.kitView }),
							preview: k.kitName
						}}
						use:dropZone={{
							accepts: 'composition',
							mode: 'reorder',
							canDrop: (p) => p.kind === 'composition' && p.viewId === k.kitView && p.kitId !== k.kitId,
							onDrop: (p, { position }) => {
								if (p.kind === 'composition')
									handleKitReorder(p.kitId, k.kitId, position === 'after' ? 'after' : 'before');
							}
						}}
					>
						<button
							type="button"
							use:contextMenu={kitcontextMenuContent(k.kitId, k.kitView)}
							onclick={() => {
								editorActivity.activeKitId = k.kitId;
							}}
						>
							<span class="kit-field__name">
								<i class="kit-field__icon fa-solid fa-puzzle-piece"></i>
								<Renameable
									editing={kitEditing[k.kitId] === true}
									value={k.kitName}
									onCommit={(name) => {
										api.renameKit(k.kitId, name);
										kitEditing[k.kitId] = false;
									}}
								>
									{k.kitName}
								</Renameable></span
							>
							<i
								class="kit-field__layer-icon fa-solid {(() => {
									const idx = kitsQuery.rows.length - 1 - i;
									return idx >= icons.length ? 'fa-crown' : (icons[idx] ?? 'fa-circle');
								})()}"
							></i>
						</button>
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
		position: relative;

		// The dnd-* classes are applied at runtime by the dnd controller, not present in this
		// component's markup, so they must be :global() -- otherwise Svelte's scoped-CSS pass prunes
		// them as "unused" and the indicator never renders. Same bar treatment as Axes.svelte's
		// .axis-row and Views.svelte's .view-field, kept visually identical across all three panels.
		&:global(.dnd-insert-before)::before,
		&:global(.dnd-insert-after)::after {
			content: '';
			position: absolute;
			left: 0;
			right: 0;
			height: 2px;
			background: var(--color-primary);
			box-shadow: 0 0 0 1px var(--color-primary);
			z-index: 3;
			pointer-events: none;
		}
		&:global(.dnd-insert-before)::before {
			top: -1px;
		}
		&:global(.dnd-insert-after)::after {
			bottom: -1px;
		}

		button {
			all: unset;
			flex-grow: 1;
			display: flex;
			align-items: center;
			cursor: pointer;
		}

		padding-block: calc($x-space-xs / 4);

		&__icon {
			font-size: $x-font-size-md;
		}

		&__layer-icon {
			flex-shrink: 0;
			margin-right: $x-space-sm;
			width: $x-font-size-lg;
			text-align: center;
			font-size: $x-font-size-sm;
			color: var(--color-text-muted);
		}

		&__name {
			@include fonts-stack('Satoshi-Light', sans);
			padding-left: $x-space-sm;
			font-weight: 600;
			letter-spacing: 1px;
			color: var(--color-text);
			flex-grow: 1;
		}

		&.selected {
			background: var(--color-surface-alt);

			.kit-field__name {
				color: var(--color-primary);
			}

			&:hover {
				.kit-field__name {
					color: var(--color-primary-hover);
				}
			}
		}

		&:hover {
			.kit-field__name {
				color: var(--color-primary);
			}

			&.selected {
				.kit-field__name {
					color: var(--color-primary-hover);
				}
			}
		}
	}
</style>

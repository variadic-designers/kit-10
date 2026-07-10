<script lang="ts">
	import type { EditorSelection } from '../Editor.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Renameable from '$lib/components/Renameable.svelte';
	import { selectView as selectViewShared, deselectView } from '../selection.js';
	import { draggable, dropZone, type DropPosition } from '../dnd.svelte.ts';
	import type { ResolvedView, FieldUpdate } from '$lib/plugins/types.js';

	type ViewsPanel = {
		selection: EditorSelection;
	} & {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
		hoveredViewId?: string | null;
		resolvedViews?: ResolvedView[];
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let {
		selection = $bindable(),

		// new API
		api,
		editorReady,
		editorActivity = $bindable(),
		hoveredViewId = $bindable(null),
		resolvedViews = [],
		onFieldUpdate
	}: ViewsPanel = $props();

	export const selectView = (id: string, _name: string) => {
		selectViewShared(editorActivity, selection, id);
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
					deselectView(editorActivity, selection);
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

	// A view's own child references, unioned across its resolved kits -- the same computation
	// Charter's collect_child_view_ids does per-view, done here client-side so this panel can
	// nest views the same way build_viewport does (see CLAUDE.md: a view is never "top-level" or
	// "child" by declaration, only by whether some other view's box currently lists it).
	const childrenByViewId = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const view of resolvedViews) {
			const ids = new Set<string>();
			for (const kit of view.resolvedKits) {
				for (const id of kit.childViewIds ?? []) ids.add(id);
			}
			map.set(view.viewId, [...ids]);
		}
		return map;
	});

	// Project-wide union of every view referenced as somebody's child -- mirrors build_viewport's
	// own `referenced` set. A view NOT in this set is a root (rendered at the top level); a view
	// that IS gets nested under whichever parent(s) reference it instead. Views are unique rows
	// referenced by id, not instanced (see CLAUDE.md) -- a view referenced by more than one
	// parent is a real DAG, not a tree, so it's rendered once per parent that claims it.
	const referencedViewIds = $derived.by(() => {
		const set = new Set<string>();
		for (const ids of childrenByViewId.values()) {
			for (const id of ids) set.add(id);
		}
		return set;
	});

	const rowsByViewId = $derived(new Map(viewsQuery.rows.map((v) => [v.viewId, v] as const)));

	// viewsQuery (a plain `views` table select) settles well before resolvedViews (the full
	// resolve pipeline -- layers, axis args, tokens) does, so rendering the tree the instant
	// viewsQuery lands would show every view flatly at the root for one frame, then reflow into
	// the real nesting once resolvedViews (and therefore referencedViewIds) catches up -- the
	// exact flat-then-nested flash this guards against. Same single-reveal principle
	// Viewport.svelte's hasData gate already uses: wait until every current view id has a
	// resolvedViews entry, then reveal the correctly-nested tree in one clean render instead of
	// reflowing visibly. An empty project (no views at all) counts as trivially hydrated so the
	// empty state still renders immediately rather than hanging.
	const resolvedViewIdSet = $derived(new Set(resolvedViews.map((v) => v.viewId)));
	const viewsHydrated = $derived(
		viewsQuery.rows.length === 0 || viewsQuery.rows.every((v) => resolvedViewIdSet.has(v.viewId))
	);

	const rootViews = $derived(viewsQuery.rows.filter((v) => !referencedViewIds.has(v.viewId)));

	// --- Drag-and-drop nesting/reordering ---------------------------------------------------------
	// A view's ordered children (childrenByViewId preserves first-seen order across kits). Used both
	// for rendering the tree and for computing insertion indices on drop.
	function orderedChildren(viewId: string): string[] {
		return childrenByViewId.get(viewId) ?? [];
	}

	// The resolved `children` property of a view, if any kit declares one. Carries the render
	// entry's `sourceLayerId` and `tokenAlias`. NOTE: `tokenId` here is the *entry's* token, which
	// for a kit-declared children property is the kit-scoped base token (a shared fallback, e.g.
	// seed's empty `childrenBaseToken`) -- NOT the view's actual child list. A view's real children
	// live in a View-scoped `view-list` token that overrides the base *by alias* during resolution
	// (see setViewChildren). So never write through this `tokenId` to change one view's children.
	function childrenPropOf(viewId: string) {
		const v = resolvedViews.find((x) => x.viewId === viewId);
		if (!v) return undefined;
		for (const kit of v.resolvedKits) {
			const p = (kit as any).properties?.get?.('children');
			if (p) return p as { sourceLayerId: string; tokenId: string | null; tokenAlias: string | null };
		}
		return undefined;
	}

	// Guard against building a cycle: is `candidateId` anywhere inside `rootId`'s subtree?
	function isDescendant(rootId: string, candidateId: string): boolean {
		const stack = [...orderedChildren(rootId)];
		const seen = new Set<string>();
		while (stack.length) {
			const id = stack.pop()!;
			if (id === candidateId) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			stack.push(...orderedChildren(id));
		}
		return false;
	}

	// Persist a parent view's ordered child list. A view's children live in a View-scoped
	// `view-list` token that overrides the kit's `children` entry *by alias* during resolution (the
	// same model seed.ts + ChildViewField use) -- so the write target is that view token, NOT the
	// resolved property's `tokenId` (which points at the kit-scoped base token, shared across every
	// view composing the kit; writing it would move every view's children at once, or -- since the
	// per-view token shadows it -- do nothing at all).
	async function setViewChildren(parentViewId: string, viewIds: string[]) {
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;

		const prop = childrenPropOf(parentViewId);
		const alias = prop?.tokenAlias ?? 'children';

		// Write the view's own scoped token (find-or-create), which overrides the kit's `children`
		// entry by alias -- same helper ChildViewField uses.
		const { id, created } = await api.upsertViewToken(projectId, parentViewId, alias, {
			type: 'view-list',
			view_ids: viewIds
		});

		// A token-backed declaring entry (prop.tokenId set -- the normal case, e.g. the kit's base
		// `children` token) is already overridden by the alias above, so no render entry is needed.
		// Only when nothing token-declares children AND we just minted the token do we point a fresh
		// entry on the kit's null layer at it, so the property exists to resolve.
		if (!created || prop?.tokenId) return;

		let layerId = prop?.sourceLayerId ?? null;
		if (!layerId) {
			const comp = await api.getKitCompositionByViewId(parentViewId).execute();
			const kitId = comp[0]?.kitId;
			if (kitId) layerId = (await api.getNullLayerId(kitId)) ?? null;
		}
		if (layerId && onFieldUpdate) onFieldUpdate({ layerId, property: alias, tokenId: id });
	}

	// Move `dragged` relative to `target`: `into` nests it under target; `before`/`after` make it a
	// sibling of target (same parent). Single-parent: it's removed from its old parent and added to
	// the new one in one gesture. Dropping onto the root band (newParent null) just un-nests it --
	// root ordering isn't persisted yet, so there's no index to set there.
	async function handleViewDrop(
		dragged: { viewId: string; parentViewId: string | null },
		targetViewId: string,
		targetParentId: string | null,
		position: DropPosition
	) {
		const draggedId = dragged.viewId;
		if (draggedId === targetViewId) return;
		if (isDescendant(draggedId, targetViewId)) return; // can't move into own subtree

		const oldParentId = dragged.parentViewId;
		const newParentId = position === 'into' ? targetViewId : targetParentId;
		if (newParentId === draggedId) return;

		if (newParentId && newParentId === oldParentId) {
			// Reorder within the same parent.
			const list = orderedChildren(newParentId).filter((id) => id !== draggedId);
			const at =
				position === 'into'
					? list.length
					: (() => {
							const ti = list.indexOf(targetViewId);
							if (ti < 0) return list.length;
							return position === 'after' ? ti + 1 : ti;
						})();
			list.splice(at, 0, draggedId);
			await setViewChildren(newParentId, list);
			return;
		}

		// Cross-parent (or to/from root). Detach from the old parent first.
		if (oldParentId) {
			await setViewChildren(
				oldParentId,
				orderedChildren(oldParentId).filter((id) => id !== draggedId)
			);
		}
		if (newParentId) {
			const list = orderedChildren(newParentId).filter((id) => id !== draggedId);
			if (position === 'into') {
				list.push(draggedId);
			} else {
				const ti = list.indexOf(targetViewId);
				list.splice(ti < 0 ? list.length : position === 'after' ? ti + 1 : ti, 0, draggedId);
			}
			await setViewChildren(newParentId, list);
		}
		// newParentId === null: dropped at root -> detach only; it renders as a root automatically.
	}

	// Plain (non-$state) bookkeeping var -- tracks the last project this effect settled on, so
	// it can tell "just switched projects / never selected anything yet" (auto-select rows[0])
	// apart from "user deliberately deselected within the same project" (activeViewId === null,
	// leave it alone). Without this distinction, deselectView setting activeViewId to null would
	// immediately trigger this effect (it reads activeViewId) and snap the selection right back.
	let lastProjectId: string | null = null;

	$effect(() => {
		const proj = editorActivity.activeProjectId;
		const rows = viewsQuery.rows;

		if (!proj) {
			editorActivity.activeViewId = null;
			lastProjectId = null;
			return;
		}

		if (viewsQuery.isFetching) return;

		const projectChanged = proj !== lastProjectId;
		lastProjectId = proj;

		const currentId = editorActivity.activeViewId;
		const currentIsValid = currentId !== null && rows.some((v) => v.viewId === currentId);

		// Auto-select a fallback view on a genuine project switch, or when the current id points
		// at a view that no longer exists (e.g. it was deleted). Don't auto-select when the id is
		// null within the same project -- that's an explicit deselect, not a stale reference.
		if (!currentIsValid && (projectChanged || currentId !== null)) {
			editorActivity.activeViewId = rows[0]?.viewId ?? null;
		}
	});
</script>

<Panel contextMenuContent={kitsContextMenu} name="Views" tooltip="Kit Views">
	{#snippet content()}
		<!-- <pre>{JSON.stringify(viewsQuery, null, 2)}</pre> -->
		<ul class="views">
			{#if viewsQuery.rows && viewsHydrated}
				{#each rootViews as v (v.viewId)}
					{@render kitter(v, 0, [])}
				{/each}
			{/if}
		</ul>
	{/snippet}
</Panel>

{#snippet kitter(v: any, level: number, ancestors: string[])}
	<!--
				{@const hideVerb = view['hide'] ? 'Show' : 'Hide'}
				{@const hideFontAwesomeType = view['selected'] ? 'solid' : 'regular'}
				{@const hideFontAwesomeChar = view['hide'] ? 'eye-slash' : 'eye'}
				{@const lockFontAwesomeChar = view['lock'] ? 'lock' : 'lock-open'}
        -->

	{@const viewIcon = v.viewLocked ? 'fa-solid fa-lock' : 'fa-regular fa-window-maximize'}
	{@const parentId = ancestors[ancestors.length - 1] ?? null}

	<li
		class="view-field"
		style="--level: {level}"
		class:selected={editorActivity.activeViewId === v.viewId}
		class:hovered={hoveredViewId === v.viewId}
		use:draggable={{
			disabled: viewEditing[v.viewId] === true,
			preview: v.viewName ?? 'View',
			payload: () => ({
				kind: 'view',
				viewId: v.viewId,
				viewName: v.viewName,
				parentViewId: parentId
			})
		}}
		use:dropZone={{
			accepts: 'view',
			mode: 'tree',
			canDrop: (p) =>
				p.kind === 'view' && p.viewId !== v.viewId && !isDescendant(p.viewId, v.viewId),
			onDrop: (p, { position }) => {
				if (p.kind === 'view') handleViewDrop(p, v.viewId, parentId, position);
			}
		}}
	>
		<button
			style="--level: {level}"
			class="view"
			use:contextMenu={menu(v.viewId)}
			aria-label={v.viewName}
			onclick={() => selectView(v.viewId, v.viewName)}
			onmouseenter={() => (hoveredViewId = v.viewId)}
			onmouseleave={() => {
				if (hoveredViewId === v.viewId) hoveredViewId = null;
			}}
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

	<!-- Views are unique, reference-based, not instanced -- the composition graph is a DAG, not
	     strictly a tree, so a child is rendered under every parent that currently references it.
	     The `!ancestors.includes(id)` filter is a cycle guard, not a "already shown" dedupe: if a
	     chain of children ever loops back to a view already open in this exact render path (A's
	     children include B, B's include A), that branch just stops instead of recursing forever. -->
	{#each (childrenByViewId.get(v.viewId) ?? []).filter((id) => id !== v.viewId && !ancestors.includes(id)) as childId (childId)}
		{@const childRow = rowsByViewId.get(childId)}
		{#if childRow}
			{@render kitter(childRow, level + 1, [...ancestors, v.viewId])}
		{/if}
	{/each}
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
		position: relative;

		// Drag-and-drop indicators (classes applied at runtime by the dnd controller, hence
		// :global()). `into` = nest under this view (outline the whole row); before/after = drop as
		// a sibling on that edge (an insertion line, indented to this row's depth so it reads as
		// landing at the right level).
		&:global(.dnd-over) {
			outline: 1px solid var(--color-primary);
			outline-offset: -1px;
			background-color: color-mix(in srgb, var(--color-primary) 14%, transparent);
		}
		&:global(.dnd-insert-before)::before,
		&:global(.dnd-insert-after)::after {
			content: '';
			position: absolute;
			left: calc($x-space-sm + $x-space-lg * var(--level) * 0.45);
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

		// Reflects hoveredViewId regardless of source (this row's own mouseenter, or the
		// Viewport hovering the same view in the canvas) -- subtler than .selected since it's a
		// lighter-weight affordance, not a competing one.
		&.hovered:not(.selected) {
			background-color: var(--color-surface-alt);
			opacity: 0.7;
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

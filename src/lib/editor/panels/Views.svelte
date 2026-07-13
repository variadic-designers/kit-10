<script lang="ts">
	import type { EditorSelection } from '../Editor.svelte';
	import Panel from '../Panel.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import Renameable from '$lib/components/Renameable.svelte';
	import { selectView as selectViewShared, deselectView } from '../selection.js';
	import { draggable, dropZone, type DropPosition } from '../dnd.svelte.ts';
	import type { PanelManifest, PanelItem, PanelOp, ResolvedView } from '$lib/plugins/types.js';
	import type { MenuItem } from '$lib/components/contextMenuStore.js';

	type ViewsPanel = {
		selection: EditorSelection;
	} & {
		editorReady: EditorState;
		editorActivity: EditorActivity;
		api: Api;
		hoveredViewId?: string | null;
		// The full resolve array — the host walks this for composition-field view_refs to build
		// the Views DAG itself. Generic graph math (root detection, ordering, cycle guard);
		// routing it through the plugin manifest (Phase 1's `child_ids`/`is_root`) just wrapped a
		// universal computation across the WASM boundary for nothing. The manifest carries only
		// the plugin's opinionated facts per view (write_alias + ops) + the composition field key
		// list (Charter's single nesting opinion: "this field's view_refs nest").
		resolvedViews?: ResolvedView[];
		// The Views panel manifest published by the active plugin via `kit10_panel_publish`
		// (Charter today). Carries composition_field_keys + per-view write_alias + per-view ops +
		// header_ops — everything the tree needs to render menus and dispatch DnD writes without
		// the editor re-deriving which field is the composition one. undefined until the first
		// `on_resolve` lands; the panel renders empty in that window.
		viewsPanelManifest?: PanelManifest;
	};

	let {
		selection = $bindable(),
		api,
		editorReady,
		editorActivity = $bindable(),
		hoveredViewId = $bindable(null),
		resolvedViews = [],
		viewsPanelManifest
	}: ViewsPanel = $props();

	export const selectView = (id: string, _name: string) => {
		selectViewShared(editorActivity, selection, id);
	};

	let viewEditing: Record<string, boolean> = $state({});

	// Op dispatch — the manifest declares which ops exist + their label/icon; the editor switches
	// on `op.name` to actually execute. Adding a new op name requires editor support here, but the
	// plugin still owns *availability* (which items get which ops in their context menu) — the
	// editor never decides "Box should be deletable" on its own, the manifest's `ops` list does.
	// `kind` is the op-specific payload (today only `add-child` uses it: "box"|"text"|"image").
	// `item` carries the parent's `write_alias` (used by `add-child` to attach the new view) and
	// the row's `viewLocked`/`viewHidden` for `lock`/`hide` toggles.
	async function dispatchOp(op: PanelOp, viewId: string, item: PanelItem | undefined) {
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;
		const row = rowsByViewId.get(viewId);

		switch (op.name) {
			case 'rename':
				viewEditing[viewId] = true;
				return;
			case 'deselect':
				deselectView(editorActivity, selection);
				return;
			case 'delete':
				await api.deleteView(viewId);
				return;
			case 'clone': {
				const alias = item?.write_alias ?? 'children';
				const newId = await api.cloneViewSubtree(viewId, alias);
				if (newId) selectView(newId, '');
				return;
			}
			case 'lock':
				if (row) await api.toggleViewLock(viewId, !row.viewLocked);
				return;
			case 'hide':
				if (row) await api.toggleViewHide(viewId, !row.viewHidden);
				return;
			case 'add-child': {
				const kind = op.kind ?? 'box';
				const created = await api.createViewInProject(projectId, `New ${kind}`);
				if (!created) return;
				// Primitive is a Charter hint, not a column — set it on `hints.charter.primitive`
				// only for non-box kinds (Box is the default detection path). The editor merges
				// sub-objects itself (see QueryView.updateViewHints in manager), so pass a full
				// `{ charter: { primitive } }` object — not just `{ charter: { primitive: kind } }`
				// (which would wipe any other charter hints). In practice a freshly-created view has
				// no hints yet, so the merge is a clean write. Skipping it for `box` keeps the
				// common path minimal.
				if (kind !== 'box') {
					await api.updateViewHints(created.id, { charter: { primitive: kind } });
				}
				if (viewId) {
					const alias = item?.write_alias ?? 'children';
					const current = childIds(viewId);
					await setViewChildren(viewId, [...current, created.id]);
				}
				selectView(created.id, created.name);
				return;
			}
		}
	}

	// Build a context menu (the shared `MenuItem` shape) from a list of manifest ops, splitting
	// op-name groups with `'hr'` separators so the menu reads as grouped (container ops first,
	// then common ops — same visual order as the original hardcoded menu). `add-child` ops with
	// different `kind`s collapse into a single "Add Child" submenu entry, mirroring the original
	// pre-Phase-1 "Box/Text/Image" trio.
	function buildMenuFromOps(ops: PanelOp[], dispatch: (op: PanelOp) => void): (MenuItem | 'hr')[] {
		const items: (MenuItem | 'hr')[] = [];
		let lastName: string | null = null;
		const addChildOps = ops.filter((o) => o.name === 'add-child');

		for (const op of ops) {
			if (lastName !== null && lastName !== op.name) items.push('hr');
			lastName = op.name;

			// Collapse `add-child` (box/text/image) into a submenu on the first encounter; skip
			// subsequent ones since they're already inside the submenu.
			if (op.name === 'add-child' && items.some((m) => m !== 'hr' && m.name === 'add-child')) {
				continue;
			}
			if (op.name === 'add-child') {
				items.push({
					name: 'add-child',
					displayText: 'Add Child',
					icon: 'fa-solid fa-plus',
					submenu: addChildOps.map((c) => ({
						name: `add-child-${c.kind}`,
						displayText: c.label,
						icon: c.icon,
						onClick: () => dispatch(c)
					}))
				});
				continue;
			}

			items.push({
				name: op.name,
				displayText: op.label,
				icon: op.icon,
				onClick: () => dispatch(op)
			});
		}
		return items;
	}

	// Per-item context menu — built from the item's declared ops. The plugin owns what's on the
	// menu (Charter's `common_item_ops`/`container_item_ops`), the editor only renders + dispatches.
	function menuFor(viewId: string): ContextMenuContentGenerator {
		return () => {
			const item = manifestById.get(viewId);
			if (!item) return [];
			// `lock`/`hide` op labels override the generic plugin-supplied ones with the actual
			// next-state of the toggle ("Lock" when currently unlocked, "Unlock" when locked) —
			// live DB state the manifest doesn't carry. Pure presentation; `name` stays the same
			// so dispatch routing is unaffected.
			const row = rowsByViewId.get(viewId);
			const ops = item.ops.map((op) => {
				if (op.name === 'lock' && row) {
					return { ...op, label: row.viewLocked ? 'Unlock' : 'Lock' };
				}
				if (op.name === 'hide' && row) {
					return { ...op, label: row.viewHidden ? 'Show' : 'Hide' };
				}
				return op;
			});
			return buildMenuFromOps(ops, (op) => dispatchOp(op, viewId, item));
		};
	}

	// Panel-header context menu — built from the manifest's `header_ops` (today: the "create a
	// top-level Box/Text/Image" trio). Same builder, just no parent view to attach to.
	let kitsContextMenu: ContextMenuContentGenerator = () => {
		const ops = viewsPanelManifest?.header_ops ?? [];
		return buildMenuFromOps(ops, async (op) => {
			const projectId = editorActivity.activeProjectId;
			if (!projectId) return;
			if (op.name === 'add-child') {
				const kind = op.kind ?? 'box';
				const created = await api.createViewInProject(projectId, `New ${kind}`);
				if (!created) return;
				if (kind !== 'box') {
					await api.updateViewHints(created.id, { charter: { primitive: kind } });
				}
				selectView(created.id, created.name);
			}
		});
	};

	import type { Api, EditorState } from 'manager';
	import { type EditorActivity, liveQuery } from '../Editor.svelte';

	const viewsQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
	});

	const rowsByViewId = $derived(new Map(viewsQuery.rows.map((v) => [v.viewId, v] as const)));

	// Index PanelManifest.items by id — used for per-view `write_alias` + `ops` lookups, not
	// topology (that's host-computed below off `resolvedViews` + `composition_field_keys`).
	const manifestById = $derived.by(() => {
		const map = new Map<string, PanelItem>();
		if (viewsPanelManifest) {
			for (const item of viewsPanelManifest.items) map.set(item.id, item);
		}
		return map;
	});

	// The composition field keys Charter declares — its single nesting opinion: "this resolved
	// property name's `viewRefs` nest as children." Everything else in nesting (root detection,
	// ordering, cycle guarding) is generic graph math the host does itself, using this list as
	// the only plugin-injected input. Reads off the manifest instead of a separate
	// `OnResolveResult.composition_field_keys` field (Phase 1 dropped that, Phase 3 restores it
	// housed in the manifest, since the manifest is the panel channel).
	const compositionKeys = $derived(viewsPanelManifest?.composition_field_keys ?? []);

	// A view's own child references, unioned across its resolved kits — the same computation
	// Charter's `collect_child_view_ids` does per-view, done here client-side so the panel can
	// nest views the same way `build_viewport` does. Generic graph math over already-resolved
	// data; not Charter-specific (the plugin's only injection is `compositionKeys`).
	const childrenByViewId = $derived.by(() => {
		const map = new Map<string, string[]>();
		for (const view of resolvedViews) {
			const ids = new Set<string>();
			for (const kit of view.resolvedKits) {
				for (const key of compositionKeys) {
					for (const id of (kit as any).properties?.get?.(key)?.viewRefs ?? []) ids.add(id);
				}
			}
			map.set(view.viewId, [...ids]);
		}
		return map;
	});

	// Project-wide union of every view referenced as somebody's child — mirrors build_viewport's
	// own `referenced` set. A view NOT in this set is a root; a view in it gets nested under
	// whichever parent(s) reference it. Views are unique rows referenced by id, not instanced —
	// a view referenced by more than one parent is a real DAG, rendered once per parent.
	const referencedViewIds = $derived.by(() => {
		const set = new Set<string>();
		for (const ids of childrenByViewId.values()) {
			for (const id of ids) set.add(id);
		}
		return set;
	});

	const rootViews = $derived(
		viewsQuery.rows.filter(
			(v) => resolvedViewIdSet.has(v.viewId) && !referencedViewIds.has(v.viewId)
		)
	);

	// A view's ordered children, read off the host-computed DAG.
	function childIds(viewId: string): string[] {
		return childrenByViewId.get(viewId) ?? [];
	}

	// Cycle guard for DnD: is `candidateId` anywhere inside `rootId`'s subtree? Walks the manifest's
	// topology — no resolved-kits reading, no composition-key lookup. This is the only place the
	// panel still traverses the DAG itself (necessary: a cycle check has to walk the candidate's
	// subtree, which is intrinsically a traversal, not a single lookup).
	function isDescendant(rootId: string, candidateId: string): boolean {
		const stack = [...childIds(rootId)];
		const seen = new Set<string>();
		while (stack.length) {
			const id = stack.pop()!;
			if (id === candidateId) return true;
			if (seen.has(id)) continue;
			seen.add(id);
			stack.push(...childIds(id));
		}
		return false;
	}

	// Persist a parent view's ordered child list. The plugin's manifest carries, per item, the
	// `write_alias` to upsert when that item's children list changes — that's the token alias the
	// view's own View-scoped `view-list` token lives under (overriding any kit-declared `children`
	// by alias during resolution; self-declares when no kit declares one — see CLAUDE.md). The
	// panel never reads resolved kits to find the alias anymore; the plugin owns it.
	async function setViewChildren(parentViewId: string, viewIds: string[]) {
		const projectId = editorActivity.activeProjectId;
		if (!projectId) return;

		const item = manifestById.get(parentViewId);
		// `write_alias` is null when this view's primitive has no children field (Text/Image) —
		// drops onto such a view are rejected by `canDrop` before they reach here, but guard
		// anyway so a stale manifest can't crash a write.
		const alias = item?.write_alias ?? 'children';

		await api.upsertViewToken(projectId, parentViewId, alias, {
			type: 'view-list',
			view_ids: viewIds
		});
	}

	// Move `dragged` relative to `target`: `into` nests it under target; `before`/`after` make it a
	// sibling of target (same parent). Single-parent: it's removed from its old parent and added to
	// the new one in one gesture. Dropping onto the root band (newParent null) just un-nests it.
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
			const list = childIds(newParentId).filter((id) => id !== draggedId);
			const ti = list.indexOf(targetViewId);
			const at =
				position === 'into'
					? list.length
					: position === 'after'
						? ti + 1
						: ti < 0
							? list.length
							: ti;
			list.splice(at, 0, draggedId);
			await setViewChildren(newParentId, list);
			return;
		}

		if (oldParentId) {
			await setViewChildren(
				oldParentId,
				childIds(oldParentId).filter((id) => id !== draggedId)
			);
		}
		if (newParentId) {
			const list = childIds(newParentId).filter((id) => id !== draggedId);
			if (position === 'into') {
				list.push(draggedId);
			} else {
				const ti = list.indexOf(targetViewId);
				list.splice(ti < 0 ? list.length : position === 'after' ? ti + 1 : ti, 0, draggedId);
			}
			await setViewChildren(newParentId, list);
		}
		// newParentId === null: dropped at root -> detach only; it renders as a root automatically
		// (its `is_root` flag recomputes in Charter's next manifest publish, after the DB write
		// fires the resolve loop — no client-side root-list bookkeeping).
	}

	// Per-row hydration gate. Each view row renders only when its id is in `resolvedViews` —
	// i.e. the resolve pipeline has caught up to the live DB query for *that* row. A
	// freshly-added child view (id in viewsQuery but not yet in resolvedViews) is filtered out
	// for one tick, then appears already nested when its resolve lands. The previous design gated
	// the entire tree on "every row hydrated" — one unresolved row hid the whole `<ul>`, causing
	// the Big Flicker on add-child / project switch. Per-row gating hides only the row that's
	// actually unsettled; existing rows keep rendering uninterrupted. Also filters roots the
	// same way in `rootViews` above, so the new view never flashes at the root while resolve is
	// catching up to know its parent's `children` now lists it.
	const resolvedViewIdSet = $derived(new Set(resolvedViews.map((v) => v.viewId)));

	// Plain (non-$state) bookkeeping var — see comment below.
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

		if (!currentIsValid && (projectChanged || currentId !== null)) {
			editorActivity.activeViewId = rows[0]?.viewId ?? null;
		}
	});
</script>

<Panel contextMenuContent={kitsContextMenu} name="Views" tooltip="Kit Views">
	{#snippet content()}
		<!-- <pre>{JSON.stringify(viewsQuery, null, 2)}</pre> -->
		<ul class="views">
			{#if viewsQuery.rows}
				{#each rootViews as v (v.viewId)}
					{@const item = manifestById.get(v.viewId)}
					{@render kitter(v, item, 0, [])}
				{/each}
			{/if}
		</ul>
	{/snippet}
</Panel>

{#snippet kitter(v: any, item: PanelItem | undefined, level: number, ancestors: string[])}
	{@const viewIcon = v.viewLocked
		? 'fa-solid fa-lock'
		: ((v.hints?.view_icon as string | undefined) ?? 'fa-regular fa-window-maximize')}
	{@const parentId = ancestors[ancestors.length - 1] ?? null}
	{@const kidIds = childIds(v.viewId).filter(
		(id) => id !== v.viewId && !ancestors.includes(id) && resolvedViewIdSet.has(id)
	)}

	<!-- Node = one view: a fixed-height row (`.view-field`) stacked ABOVE an optional children
	     <ul>, so a parent sits directly on top of its subtree, never beside it. --level rides the
	     node, so the row's button padding and the guide line both read the same nesting depth. -->
	<li class="view-node" style="--level: {level}">
		<!-- Row only. Selection, hover, drag payload and drop zone all live here, NOT on the
		     children container -- otherwise "insert after" would target the bottom of the entire
		     subtree instead of this single row. -->
		<div
			class="view-field"
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
				class="view"
				use:contextMenu={menuFor(v.viewId)}
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
		</div>

		<!-- Children as a real nested <ul>, SIBLING of the row (not inside it), so the DOM tree IS
		     the view tree and the browser's own :last-child drives the guide line -- no per-row JS
		     to find the "last direct child". Indentation still comes from the button's --level
		     padding, so rows land exactly where the flat layout put them; the <ul> adds structure,
		     not offset. Views are reference-based (DAG, not strict tree): a child renders under
		     every parent referencing it, and `!ancestors.includes(id)` (in kidIds) is a cycle
		     guard, not a dedupe -- a chain looping back to an ancestor stops instead of recursing. -->
		{#if kidIds.length}
			<ul class="view__children">
				{#each kidIds as childId (childId)}
					{@const childRow = rowsByViewId.get(childId)}
					{@const childItem = manifestById.get(childId)}
					{#if childRow}
						{@render kitter(childRow, childItem, level + 1, [...ancestors, v.viewId])}
					{/if}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<style lang="scss">
	@use '_index' as *;

	.views {
		@include layout-flex-column();
		overflow-x: auto;
		scrollbar-width: thin;
	}

	// Parent icon column: a child's own content indent (button padding for its --level) minus one
	// level step lands exactly on the parent icon's LEFT edge, so the line hugs the left of the
	// icon. Shared by the trunk and the curve so they line up exactly. Add a small `+ $x-font-size-md
	// * k` term here to shift it rightward onto the icon if you ever want it centred instead.
	@mixin guide-column {
		left: calc($x-space-sm + $x-space-lg * var(--level) * 0.35 - $x-space-md * 0.35);
	}

	// Each nesting level is a real <ul>, a SIBLING of its parent's row, so the DOM tree is the view
	// tree. Zero padding/margin: indentation stays on the button's --level, so rows land exactly
	// where the flat layout put them -- this <ul> adds structure, not geometry.
	.view__children {
		@include layout-flex-column();
		list-style: none;
		margin: 0;
		padding: 0;
	}

	// One tree node: a row stacked directly above its (optional) children <ul>.
	.view-node {
		position: relative;
		list-style: none;
	}

	// Guide line. A single vertical rule sits in the PARENT's icon column and drops from just below
	// the parent row down to its LAST direct child's midline, curving right into it. Intermediate
	// children get no horizontal tick -- deliberately quiet. Built from two pieces so it survives
	// variable row heights (wrapping names) and nested subtrees between siblings:
	//
	//   Trunk -- every direct child EXCEPT the last paints a full-node-height segment (top -> bottom
	//   of its whole subtree). The segments stack into one continuous line that runs cleanly down
	//   the left of any grandchildren sitting between two direct children.
	// ::after, not ::before, on purpose: it's the LAST generated child of .view-node, so it paints
	// after the sibling .view-field (and the nested <ul>) in tree order and lands on top of the
	// row's full-width background with no z-index needed. A ::before here would paint first and get
	// covered by that background.
	.view__children > .view-node:not(:last-child)::after {
		content: '';
		position: absolute;
		@include guide-column;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--color-text-muted);
		pointer-events: none;
	}
	//   Curve -- the LAST direct child paints from its node top down to its own ROW midline (50% of
	//   the row, NOT the node, so it lands on the row even when the name wraps or the last child has
	//   its own subtree below), then bends right into the row. `:last-child` is the browser telling
	//   us the last direct child for free. Drawn on `.view-field` (position: relative). The
	//   `:not(dnd-*)` guard drops it mid-drag so the DnD insert bar isn't overridden into a stubby
	//   curved box on that one row.
	.view__children
		> .view-node:last-child
		> .view-field:not(:global(.dnd-insert-before)):not(:global(.dnd-insert-after))::before {
		content: '';
		position: absolute;
		@include guide-column;
		top: 0;
		height: 50%;
		width: calc($x-space-lg * 0.16);
		border-left: 0.6px solid var(--color-text-muted);
		border-bottom: 0.6px solid var(--color-text-muted);
		border-bottom-left-radius: $x-space-xs;
		pointer-events: none;
		// No z-index needed: this ::before is on .view-field itself, so it paints after that
		// element's own background (element bg first, then its positioned pseudo-children).
	}

	// When a parent row is selected, promote its subtree's guide line to primary.
	// `.view-field.selected` is the immediate previous sibling of the children <ul>, so
	// `+ .view__children` reaches exactly this parent's own guide lines (trunk + curve) and not
	// grandchildren's (their <ul> is nested deeper, never adjacent to the selected row). The two
	// inner selectors mirror the trunk/curve rules above; `border-color` covers both the trunk's
	// border-left and the curve's border-left + border-bottom in one line.
	.view-field.selected + .view__children {
		> .view-node:not(:last-child)::after,
		> .view-node:last-child > .view-field::before {
			border-color: var(--color-primary);
		}
	}

	.view-field {
		display: flex;
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
			// Neutralize the guide-line ::before (border/curve/width) so the DnD indicator is a
			// clean horizontal bar, not the guide line. Harmless on ::after (no guide there).
			top: auto;
			bottom: auto;
			width: auto;
			height: 2px;
			border: none;
			border-radius: 0;
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
					// color: var(--color-primary-hover);
				}
			}
		}

		// Reflects hoveredViewId regardless of source (this row's own mouseenter, or the
		// Viewport hovering the same view in the canvas) -- subtler than .selected since it's a
		// lighter-weight affordance, not a competing one.
		&.hovered:not(.selected) {
			// background-color: var(--color-surface-alt);
      color: var(--color-primary);
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
		// $x-space-sm here is the constant left gutter that used to live on `.view-field`; folding
		// it into the button (which already carries the per-level indent) keeps the row itself at
		// zero offset, so `.view-field` backgrounds still bleed full-width and nested rows don't
		// stack up a gutter per level.
		padding-left: calc($x-space-sm + $x-space-lg * var(--level) * 0.38);
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
			@include fonts-stack('Satoshi-Regular', sans);
			padding-left: $x-space-xs;
			font-weight: 600;
			letter-spacing: 0px;
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

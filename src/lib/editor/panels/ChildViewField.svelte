<script lang="ts">
	import { tick } from 'svelte';
	import FieldRow from './FieldRow.svelte';
	import { clampToViewport } from '$lib/components/contextMenuStore.js';
	import type { Api } from 'manager';
	import type { FieldUpdate } from '$lib/plugins/types.js';

	export interface ChildViewCandidate {
		viewId: string;
		viewName: string;
	}

	// One entry per underlying `view`-typed token row -- `tokenId` is the specific reference (not
	// the target view's own id), needed so remove/reorder can target one row even when two rows
	// share a `viewId` (the same view referenced twice, see resolve.ts's OverriddenOccurrence).
	export interface ChildViewRef {
		viewId: string;
		tokenId: string;
	}

	type ChildViewFieldProps = {
		key: string;
		displayText: string;
		sourceLayerId?: string | null;
		kitId?: string | null;
		kitIcon?: string;
		keys?: string[];
		conditionValues?: { axisId: string; value: string }[];
		childRefs?: ChildViewRef[];
		candidateViews?: ChildViewCandidate[];
		axisNameById?: Record<string, string>;
		api?: Api;
		projectId?: string | null;
		viewId?: string | null;
		onFieldUpdate?: (update: FieldUpdate) => void;
		/** Navigate the editor to (select) a child view when its row is clicked. */
		onSelectView?: (viewId: string) => void;
	};

	let {
		key,
		displayText,
		sourceLayerId,
		kitIcon = 'fa-circle',
		keys = [],
		conditionValues = [],
		childRefs = [],
		candidateViews = [],
		axisNameById = {},
		api,
		projectId,
		viewId,
		onFieldUpdate,
		onSelectView
	}: ChildViewFieldProps = $props();

	// Unlike an ordinary style property, `children` is inherently per-view-instance data -- two
	// views composing the same kit essentially always want their own distinct child list, which
	// is exactly what View-scoped tokens already model. So the picker never writes a literal
	// value: it always creates/removes View-scoped `view`-typed token rows (one per child),
	// created transparently on each pick rather than requiring a separate manual "Tokenize" step.

	// The current child views, in order, resolved to { id, tokenId, name } rows for display. A
	// referenced id with no matching candidate (e.g. mid-delete) still gets a row, labelled '?'.
	// Not deduped by viewId -- the same view can legitimately be referenced twice (two distinct
	// token rows), and each is its own row here.
	const childRows = $derived(
		childRefs.map((ref) => ({
			id: ref.viewId,
			tokenId: ref.tokenId,
			name: candidateViews.find((v) => v.viewId === ref.viewId)?.viewName ?? '?'
		}))
	);

	// Candidate views not already added -- what the `+` picker offers. Filters out any view
	// already referenced (even though a genuine duplicate reference is legal, this basic picker
	// only ever adds a not-yet-present view; a deliberate duplicate isn't exposed here).
	const addableViews = $derived(
		candidateViews.filter((v) => !childRefs.some((ref) => ref.viewId === v.viewId))
	);

	let open = $state(false);
	let triggerRef: HTMLButtonElement | undefined = $state();
	let panelRef: HTMLDivElement | undefined = $state();
	let panelStyle = $state('');

	// Same overflow problem the right-click context menu had (see ContextMenuBox.svelte): this
	// panel is anchored off the trigger's own position, which sits inside the narrow Render
	// panel sidebar near the right edge of the screen -- rendered at its natural content width
	// (view names), it routinely runs off the right edge of the viewport. Reuses the same
	// clampToViewport helper the context menu already validated, rather than inventing a second
	// flavor of "keep a floating panel on-screen."
	function positionPanel() {
		if (!triggerRef) return;
		const rect = triggerRef.getBoundingClientRect();
		// Paint at the raw, un-clamped position first (correct in the common case, no visible
		// jump), then correct after the DOM reflects this panel's real content width/height.
		panelStyle = `top:${rect.bottom}px; left:${rect.left}px; min-width:${rect.width}px;`;

		tick().then(() => {
			if (!panelRef || !open) return;
			const panelRect = panelRef.getBoundingClientRect();
			const clamped = clampToViewport(rect.left, rect.bottom, panelRect.width, panelRect.height);
			panelStyle = `top:${clamped.y}px; left:${clamped.x}px; min-width:${rect.width}px;`;
		});
	}

	function openPicker() {
		open = true;
		positionPanel();
	}

	function closePicker() {
		open = false;
	}

	function handleWindowClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (triggerRef?.contains(target)) return;
		if (panelRef && !panelRef.contains(target)) closePicker();
	}

	async function addChild(candidateViewId: string) {
		if (!api || !projectId || !viewId) {
			// No project/view context to scope a token to (e.g. a design-time preview harness) --
			// fall back to a literal value rather than failing silently.
			if (onFieldUpdate && sourceLayerId) {
				const next = [...childRefs.map((r) => r.viewId), candidateViewId];
				onFieldUpdate({ layerId: sourceLayerId, property: key, value: JSON.stringify(next) });
			}
			return;
		}

		// Append one new View-scoped `view`-typed token row. A view-scope children token is
		// self-declaring in resolution -- it defines this view's children on its own, with no
		// render entry anchored on a shared kit layer (see resolve.ts). So there's nothing else to
		// wire: no null-layer fallback, no onFieldUpdate.
		await api.addViewRef(projectId, viewId, key, candidateViewId);
	}

	async function removeChild(row: { id: string; tokenId: string }) {
		if (!api || !projectId || !viewId) {
			if (onFieldUpdate && sourceLayerId) {
				const next = childRefs.map((r) => r.viewId).filter((id) => id !== row.id);
				onFieldUpdate({ layerId: sourceLayerId, property: key, value: JSON.stringify(next) });
			}
			return;
		}

		// Delete this ONE specific token row by its own id -- not by (alias, viewId), since another
		// row could share the same target view id (a legal duplicate reference).
		await api.removeViewRef(row.tokenId);
	}
</script>

<svelte:window onclick={handleWindowClick} onresize={() => open && positionPanel()} />

<FieldRow
	label={displayText ?? key}
	track={{ kitIcon, keys, conditionValues }}
	{axisNameById}
	trackEmpty={childRefs.length === 0}
	trackAriaLabel="View-scoped token"
>
	{#snippet valueSlot()}
		<span class="child-field__count">{childRefs.length || 'none'}</span>
	{/snippet}

	{#snippet body()}
		<!-- One row per referenced child view (name + remove), then a `+` add row. -->
		<ul class="child-field__list">
			{#each childRows as row (row.tokenId)}
				<li class="child-field__row">
					<button
						type="button"
						class="child-field__select"
						title="Go to {row.name}"
						disabled={!onSelectView || row.name === '?'}
						onclick={() => onSelectView?.(row.id)}
					>
						<i class="fa-regular fa-window-maximize child-field__row-icon"></i>
						<span
							class="child-field__row-name"
							class:child-field__row-name--missing={row.name === '?'}>{row.name}</span
						>
					</button>
					<button
						type="button"
						class="child-field__remove"
						aria-label="Remove {row.name}"
						title="Remove"
						onclick={() => removeChild(row)}
					>
						<i class="fa-solid fa-xmark"></i>
					</button>
				</li>
			{/each}

			<li class="child-field__add-row">
				<button
					type="button"
					class="child-field__add"
					bind:this={triggerRef}
					onclick={openPicker}
				>
					<i class="fa-solid fa-plus"></i>
					<span>Add view</span>
				</button>
			</li>
		</ul>

		{#if open}
			<div class="child-view-panel" style={panelStyle} bind:this={panelRef}>
				{#if addableViews.length === 0}
					<div class="child-view-panel__status">
						{candidateViews.length === 0 ? 'No other views in this project' : 'All views already added'}
					</div>
				{:else}
					<ul class="child-view-panel__list">
						{#each addableViews as candidate (candidate.viewId)}
							<li>
								<button
									type="button"
									class="child-view-panel__row"
									onclick={() => addChild(candidate.viewId)}
								>
									<i class="fa-solid fa-plus child-view-panel__add-icon"></i>
									<span class="child-view-panel__name">{candidate.viewName}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		{/if}
	{/snippet}
</FieldRow>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.child-field__count {
		font-size: $x-font-size-sm;
		color: var(--color-add-var-text);
	}

	.child-field__list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.child-field__row {
		display: flex;
		align-items: center;
		border-radius: 1px;
		background: var(--color-panel-header-fill);
		font-size: $x-font-size-sm;

		&:hover {
			background: var(--color-surface-alt);
		}
	}

	// The name is a button that navigates the editor to that child view (onSelectView).
	.child-field__select {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		flex: 1;
		min-width: 0;
		padding: calc($x-space-xs / 2) $x-space-xs;
		cursor: pointer;
		text-align: left;
		color: var(--color-text);

		&:disabled {
			cursor: default;
		}

		&:hover:not(:disabled) {
			color: var(--color-primary);
		}
	}

	.child-field__row-icon {
		flex: 0 0 auto;
		font-size: $x-font-size-xs;
		opacity: 0.6;
	}

	.child-field__row-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;

		&--missing {
			opacity: 0.5;
			font-style: italic;
		}
	}

	.child-field__remove {
		flex: 0 0 auto;
		cursor: pointer;
		padding-inline: calc($x-space-xs / 2);
		opacity: 0.5;
		color: var(--color-text);

		&:hover {
			opacity: 1;
			color: var(--color-danger, var(--color-text));
		}
	}

	.child-field__add-row {
		display: flex;
	}

	.child-field__add {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		width: 100%;
		padding: calc($x-space-xs / 2) $x-space-xs;
		cursor: pointer;
		border-radius: 1px;
		font-size: $x-font-size-sm;
		color: var(--color-add-var-text);
		border: 1px dashed var(--color-panel-header-border);

		&:hover {
			background: var(--color-surface-alt);
			color: var(--color-text);
		}
	}

	.child-view-panel {
		position: fixed;
		z-index: 1000;
		background: var(--color-pure);
		border: 1px solid var(--color-panel-header-border);
		border-radius: 4px;
		box-shadow: 0 4px 12px oklch(0% 0 0 / 0.15);
		min-width: 14rem;
		// Without a cap, the panel grows to fit its widest row (checkbox + full view name)
		// instead of letting __name's own text-overflow:ellipsis do its job -- on a project with
		// any reasonably long view names this pushed the whole panel wider than the viewport
		// (see positionPanel's clampToViewport comment).
		max-width: min(22rem, calc(100vw - 1rem));

		&__status {
			padding: 0.5em;
			opacity: 0.6;
			font-size: 0.85em;
		}

		&__list {
			list-style: none;
			margin: 0;
			padding: 0;
			max-height: 16rem;
			overflow-y: auto;
		}

		&__row {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			padding: 0.4em 0.6em;
			cursor: pointer;
			width: 100%;
			text-align: left;

			&:hover {
				background: var(--color-surface-alt);
			}
		}

		&__add-icon {
			flex: 0 0 auto;
			font-size: 0.8em;
			opacity: 0.6;
		}

		&__name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
	}
</style>

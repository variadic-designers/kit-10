<script lang="ts">
	import { tick } from 'svelte';
	import { layerDotColor } from './layer-color.ts';
	import { clampToViewport } from '$lib/components/contextMenuStore.js';
	import type { Api } from 'manager';
	import type { FieldUpdate } from '$lib/plugins/types.js';

	export interface ChildViewCandidate {
		viewId: string;
		viewName: string;
	}

	type ChildViewFieldProps = {
		key: string;
		displayText: string;
		sourceLayerId?: string | null;
		kitId?: string | null;
		kitIcon?: string;
		keys?: string[];
		conditionValues?: { axisId: string; value: string }[];
		tokenId?: string | null;
		childViewIds?: string[];
		candidateViews?: ChildViewCandidate[];
		position?: 'top' | 'bottom' | 'mid';
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
		tokenId,
		childViewIds = [],
		candidateViews = [],
		position = 'mid',
		axisNameById = {},
		api,
		projectId,
		viewId,
		onFieldUpdate,
		onSelectView
	}: ChildViewFieldProps = $props();

	function trackColor(axisIds: string[]): string {
		return layerDotColor(axisIds, true);
	}

	function trackTitle(conditions: { axisId: string; value: string }[]): string {
		if (conditions.length === 0) return 'Base layer · always applies';
		const parts = conditions
			.map((c) => `${axisNameById[c.axisId] ?? c.axisId}: ${c.value}`)
			.join(', ');
		return `${parts} · ${conditions.length} condition${conditions.length === 1 ? '' : 's'}`;
	}

	// Unlike an ordinary style property, `children` is inherently per-view-instance data -- two
	// views composing the same kit essentially always want their own distinct child list, which
	// is exactly what a View-scoped token already models. So the picker never writes a literal
	// value: it always reads/writes a View-scoped `view-list` token, created transparently on the
	// first pick rather than requiring a separate manual "Tokenize" step.

	// The current child views, in order, resolved to { id, name } rows for display. A referenced
	// id with no matching candidate (e.g. mid-delete) still gets a row, labelled '?'.
	const childRows = $derived(
		[...new Set(childViewIds)].map((id) => ({
			id,
			name: candidateViews.find((v) => v.viewId === id)?.viewName ?? '?'
		}))
	);

	// Candidate views not already added -- what the `+` picker offers.
	const addableViews = $derived(candidateViews.filter((v) => !childViewIds.includes(v.viewId)));

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

	async function toggleChild(candidateViewId: string) {
		const next = childViewIds.includes(candidateViewId)
			? childViewIds.filter((id) => id !== candidateViewId)
			: [...childViewIds, candidateViewId];

		if (!api || !projectId || !viewId) {
			// No project/view context to scope a token to (e.g. a design-time preview harness) --
			// fall back to a literal value rather than failing silently.
			if (onFieldUpdate && sourceLayerId) {
				onFieldUpdate({ layerId: sourceLayerId, property: key, value: JSON.stringify(next) });
			}
			return;
		}

		// Write this view's own scoped `children` token (find-or-create). A view-scope children
		// token is self-declaring in resolution -- it defines this view's children on its own, with
		// no render entry anchored on a shared kit layer (see resolve.ts). So there's nothing else
		// to wire: no null-layer fallback, no onFieldUpdate.
		await api.upsertViewToken(projectId, viewId, key, { type: 'view-list', view_ids: next });
	}
</script>

<svelte:window onclick={handleWindowClick} onresize={() => open && positionPanel()} />

<div
	class="child-field"
	class:child-field--top={position === 'top'}
	class:child-field--bottom={position === 'bottom'}
>
	<!-- Header row: the property label + the layer/scope track dot, mirroring a StyleField's
	     label + track so `children` reads as the same kind of field, just one that expands into
	     per-view rows below instead of a single value box. -->
	<div class="child-field__header">
		<button
			class="child-field__track"
			style="--track-color: {trackColor(keys)}"
			class:child-field__track--empty={childViewIds.length === 0}
			aria-label="View-scoped token"
			title={trackTitle(conditionValues)}
			type="button"
		>
			<i class="fa-solid {kitIcon}"></i>
		</button>
		<span class="child-field__label">{displayText ?? key}</span>
		<span class="child-field__count">{childViewIds.length || ''}</span>
	</div>

	<!-- One row per referenced child view (name + remove), then a `+` add row. Empty state is
	     just the `+` row under the header. -->
	<ul class="child-field__list">
		{#each childRows as row (row.id)}
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
					onclick={() => toggleChild(row.id)}
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
								onclick={() => toggleChild(candidate.viewId)}
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
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
	}

	.child-field {
		display: flex;
		flex-direction: column;
		user-select: none;
		position: relative;
		padding-block: calc($x-space-xs / 2);

		@include layout-respond('md') {
			font-size: $x-font-size-sm;
			letter-spacing: 1px;
		}

		&__header {
			display: flex;
			align-items: center;
			gap: $x-space-xs;
			padding-inline: $x-space-sm;
			font-weight: 600;
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-sm;
			color: var(--track-color, var(--color-text));
			flex: 0 0 auto;

			&--empty {
				color: var(--color-surface-alt);
			}
		}

		&__label {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			text-transform: capitalize;
		}

		&__count {
			flex: 0 0 auto;
			font-size: $x-font-size-sm;
			opacity: 0.6;
		}

		&__list {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			// The rows are indented past the header's track dot so they read as nested under the
			// "Children" label, one line per referenced view (see project-view-array-display-revamp).
			padding-left: calc($x-space-sm + $x-space-md);
			padding-right: $x-space-sm;
			margin-top: calc($x-space-xs / 2);
			gap: 1px;
		}

		&__row {
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
		&__select {
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

		&__row-icon {
			flex: 0 0 auto;
			font-size: $x-font-size-xs;
			opacity: 0.6;
		}

		&__row-name {
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

		&__remove {
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

		&__add-row {
			display: flex;
		}

		&__add {
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

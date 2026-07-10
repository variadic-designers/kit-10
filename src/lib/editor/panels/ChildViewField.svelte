<script lang="ts">
	import { tick } from 'svelte';
	import { layerDotColor } from './layer-color.ts';
	import { formatViewArray } from './token-utils.ts';
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
		onFieldUpdate
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
	function summary(): string {
		if (childViewIds.length === 0) return '+';
		const names = childViewIds.map(
			(id) => candidateViews.find((v) => v.viewId === id)?.viewName ?? '?'
		);
		return formatViewArray(names);
	}

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

		// Write this view's own scoped token (find-or-create). A View token overrides the kit's
		// same-named `children` token during resolution (CONCEPTS.md §Tokens) -- the canonical
		// per-view override. Do NOT write through `tokenId`: that's the *declaring* entry's token,
		// which for a kit-declared property is a shared Kit-scoped base, not this view's override.
		const { id, created } = await api.upsertViewToken(projectId, viewId, key, {
			type: 'view-list',
			view_ids: next
		});

		// A token-backed declaring entry (tokenId set) is already overridden by the alias above.
		// Only if nothing token-declares this property AND we just minted the token do we point a
		// render entry at it, so the property exists to resolve (also converts a literal to a token).
		if (created && tokenId == null && sourceLayerId && onFieldUpdate) {
			onFieldUpdate({ layerId: sourceLayerId, property: key, tokenId: id });
		}
	}
</script>

<svelte:window onclick={handleWindowClick} onresize={() => open && positionPanel()} />

<div
	class="option124"
	class:option124--top={position === 'top'}
	class:option124--bottom={position === 'bottom'}
	class:option124--mid={position !== 'top' && position !== 'bottom'}
>
	<span class="option124__style-name">{displayText ?? key}</span>

	<button
		class="option124__track"
		style="--track-color: {trackColor(keys)}"
		class:option124__track--empty={childViewIds.length === 0}
		aria-label="View-scoped token"
		title={trackTitle(conditionValues)}
		type="button"
	>
		<i class="fa-solid {kitIcon}"></i>
	</button>

	<button
		type="button"
		class="option124__value"
		class:option124__value--new={childViewIds.length === 0}
		bind:this={triggerRef}
		onclick={openPicker}
	>
		{summary()}
	</button>

	{#if open}
		<div class="child-view-panel" style={panelStyle} bind:this={panelRef}>
			{#if candidateViews.length === 0}
				<div class="child-view-panel__status">No other views in this project</div>
			{:else}
				<ul class="child-view-panel__list">
					{#each candidateViews as candidate (candidate.viewId)}
						<li>
							<label class="child-view-panel__row">
								<input
									type="checkbox"
									checked={childViewIds.includes(candidate.viewId)}
									onchange={() => toggleChild(candidate.viewId)}
								/>
								<span class="child-view-panel__name">{candidate.viewName}</span>
							</label>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button,
	input {
		all: unset;
	}

	.option124 {
		display: flex;
		justify-content: space-between;
		align-items: center;
		user-select: none;
		align-items: stretch;
		font-weight: 600;
		padding-inline: $x-space-sm;
		position: relative;

		@include layout-respond('md') {
			font-size: $x-font-size-sm;
			letter-spacing: 1px;
			gap: $x-space-xs;
		}

		&__track {
			text-align: center;
			font-size: $x-font-size-sm;
			color: var(--track-color, var(--color-text));

			&--empty {
				color: var(--color-surface-alt);
			}
		}

		&__style-name {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			padding-inline: calc($x-space-xs / 2);
			text-transform: capitalize;
		}

		&__value {
			all: unset;
			padding: calc($x-space-xs / 2) $x-space-sm;
			text-align: left;
			flex-basis: 40%;
			flex-shrink: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			cursor: pointer;
			border-radius: 1px;
			color: var(--color-add-var-text);
			font-size: $x-font-size-sm;
			background: var(--color-panel-header-fill);

			&--new {
				cursor: pointer;
				text-align: center;
			}

			&:hover {
				background: var(--color-surface-alt);
				color: var(--color-text);
			}
		}

		$border-rad: calc($x-space-xs / 2);

		&--top > * {
			border-radius: $border-rad $border-rad 0 0;
		}
		&--bottom > * {
			border-radius: 0 0 $border-rad $border-rad;
		}
	}

	.child-view-panel {
		position: fixed;
		z-index: 1000;
		background: var(--color-pure);
		border: 1px solid var(--color-panel-header-border);
		border-radius: 4px;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
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

			input[type='checkbox'] {
				all: revert;
				flex: 0 0 auto;
			}

			&:hover {
				background: var(--color-surface-alt);
			}
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

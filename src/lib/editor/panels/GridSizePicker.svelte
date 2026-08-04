<script lang="ts">
	import { tick } from 'svelte';
	import { clampToViewport } from '$lib/components/contextMenuStore.js';
	import { commitFieldValue } from './field-commit.ts';
	import { parseTrackList, serializeTrackList, type Track } from './grid-tracks.ts';
	import type { Api, ResolvedProperty } from 'manager';
	import type { FieldDef, FieldUpdate } from '$lib/plugins/types.js';

	type TrackInfo = {
		sourceLayerId: string | null;
		kitId: string | null;
		kitIcon: string;
		keys: string[];
		conditionValues: { axisId: string; value: string }[];
		isToken: boolean;
		tokenAlias: string | null;
		tokenId: string | null;
	};

	type GridSizePickerProps = {
		columnsField: FieldDef; // grid-template-columns
		rowsField: FieldDef; // grid-template-rows
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { columnsField, rowsField, track, resolvedMap, api, onFieldUpdate }: GridSizePickerProps =
		$props();

	// Excel/Word "insert table" pattern, capped at 11x11 - a fast on-ramp for the common case, never
	// a replacement for the full track vocabulary the two GridTracksField list editors below already
	// expose (minmax/%/auto/repeat/named lines).
	const GRID_SIZE = 11;
	const cells = Array.from({ length: GRID_SIZE }, (_, i) => i);

	const columnCount = $derived(
		parseTrackList(resolvedMap.get(columnsField.key)?.value ?? '').length
	);
	const rowCount = $derived(parseTrackList(resolvedMap.get(rowsField.key)?.value ?? '').length);
	// Once either axis has explicit tracks (from this picker OR hand-built via the list editors),
	// the picker collapses to a re-open button so it never fights the list editors for the same
	// screen space once there's real per-track detail to preserve.
	const hasTracks = $derived(columnCount > 0 || rowCount > 0);

	let hoverCell: { row: number; col: number } | null = $state(null);

	let open = $state(false);
	let triggerRef: HTMLButtonElement | undefined = $state();
	let panelRef: HTMLDivElement | undefined = $state();
	let panelStyle = $state('');

	// Same anchor-then-clamp two-step ChildViewField's own popover uses, reusing the same
	// clampToViewport helper rather than inventing a second flavor of "keep a floating panel
	// on-screen" in a narrow sidebar panel.
	function positionPanel() {
		if (!triggerRef) return;
		const rect = triggerRef.getBoundingClientRect();
		panelStyle = `top:${rect.bottom}px; left:${rect.left}px;`;

		tick().then(() => {
			if (!panelRef || !open) return;
			const panelRect = panelRef.getBoundingClientRect();
			const clamped = clampToViewport(rect.left, rect.bottom, panelRect.width, panelRect.height);
			panelStyle = `top:${clamped.y}px; left:${clamped.x}px;`;
		});
	}

	function openPicker() {
		open = true;
		hoverCell = null;
		positionPanel();
	}

	function closePicker() {
		open = false;
		hoverCell = null;
	}

	function handleWindowClick(e: MouseEvent) {
		if (!open) return;
		const target = e.target as Node;
		if (triggerRef?.contains(target)) return;
		if (panelRef && !panelRef.contains(target)) closePicker();
	}

	// A full reset of both axes to N/M single-kind (1fr) tracks, not a merge with whatever was
	// there before - matches the Excel gesture (picking a new size replaces the table), and the two
	// GridTracksField list editors below remain the tool for tuning individual tracks afterward.
	function pickSize(row: number, col: number) {
		const columns: Track[] = Array.from({ length: col + 1 }, () => ({ kind: 'fr', value: 1 }));
		const rows: Track[] = Array.from({ length: row + 1 }, () => ({ kind: 'fr', value: 1 }));
		commitFieldValue(track(columnsField.key), columnsField.key, serializeTrackList(columns), {
			onFieldUpdate,
			api
		});
		commitFieldValue(track(rowsField.key), rowsField.key, serializeTrackList(rows), {
			onFieldUpdate,
			api
		});
		closePicker();
	}
</script>

{#snippet pickerGrid()}
	<div class="grid-size-picker__label">
		{hoverCell ? `${hoverCell.col + 1} x ${hoverCell.row + 1}` : 'Set grid size'}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="grid-size-picker__grid"
		style="--grid-size: {GRID_SIZE}"
		onpointerleave={() => (hoverCell = null)}
	>
		{#each cells as r (r)}
			{#each cells as c (c)}
				<button
					type="button"
					class="grid-size-picker__cell"
					class:grid-size-picker__cell--active={hoverCell !== null &&
						r <= hoverCell.row &&
						c <= hoverCell.col}
					aria-label="{c + 1} columns by {r + 1} rows"
					onpointerenter={() => (hoverCell = { row: r, col: c })}
					onclick={() => pickSize(r, c)}
				></button>
			{/each}
		{/each}
	</div>
{/snippet}

<svelte:window onclick={handleWindowClick} onresize={() => open && positionPanel()} />

<div class="grid-size-picker">
	{#if hasTracks}
		<button
			type="button"
			class="grid-size-picker__trigger"
			bind:this={triggerRef}
			onclick={() => (open ? closePicker() : openPicker())}
		>
			<i class="fa-solid fa-table-cells"></i>
			<span>{columnCount} x {rowCount}</span>
			<i class="fa-solid fa-angle-down"></i>
		</button>

		{#if open}
			<div class="grid-size-picker__panel" style={panelStyle} bind:this={panelRef}>
				{@render pickerGrid()}
			</div>
		{/if}
	{:else}
		<div class="grid-size-picker__inline">
			{@render pickerGrid()}
		</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
		cursor: pointer;
	}

	.grid-size-picker {
		position: relative;

		&__trigger {
			display: flex;
			align-items: center;
			gap: calc($x-space-xs / 2);
			width: 100%;
			padding-inline: $x-space-sm;
			padding-block: calc($x-space-xs / 2);
			font-size: $x-font-size-sm;
			opacity: 0.85;

			span {
				flex: 1;
			}

			&:hover {
				opacity: 1;
				background: var(--color-surface-alt);
			}
		}

		&__inline {
			padding-inline: $x-space-sm;
			padding-block: calc($x-space-xs / 2);
		}

		&__panel {
			position: fixed;
			z-index: 1000;
			background: var(--color-pure);
			border: 1px solid var(--color-panel-header-border);
			border-radius: 4px;
			box-shadow: 0 4px 12px oklch(0% 0 0 / 0.15);
			padding: $x-space-xs;
		}

		&__label {
			font-size: $x-font-size-xs;
			opacity: 0.75;
			text-align: center;
			padding-bottom: calc($x-space-xs / 2);
		}

		&__grid {
			display: grid;
			grid-template-columns: repeat(var(--grid-size), 1.1em);
			grid-template-rows: repeat(var(--grid-size), 1.1em);
			gap: 2px;
			user-select: none;
			touch-action: none;
		}

		&__cell {
			background: var(--color-panel-header-fill);
			border-radius: 1px;

			&:hover {
				background: var(--color-surface-alt);
			}

			&--active {
				background: var(--color-primary);
			}
		}
	}
</style>

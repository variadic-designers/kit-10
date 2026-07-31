<script lang="ts">
	import { commitFieldValue } from './field-commit.ts';
	import { parseAreas, serializeAreas, paintArea, removeArea, renameArea, nextAreaName, type Area } from './grid-areas.ts';
	import { layerDotColor } from './layer-color.ts';
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

	type GridAreaPainterProps = {
		field: FieldDef; // grid-template-areas
		// The box's current track counts, from GridTracksField's own parsed state -- the painter's
		// grid always matches what's actually defined, never a guess.
		colCount: number;
		rowCount: number;
		track: (key: string) => TrackInfo;
		resolvedMap: Map<string, ResolvedProperty>;
		api?: Api;
		onFieldUpdate?: (update: FieldUpdate) => void;
	};

	let { field, colCount, rowCount, track, resolvedMap, api, onFieldUpdate }: GridAreaPainterProps = $props();

	const rawValue = $derived(resolvedMap.get(field.key)?.value ?? '');
	const areas = $derived(parseAreas(rawValue));

	function commit(next: Area[]) {
		commitFieldValue(track(field.key), field.key, serializeAreas(next, rowCount, colCount), {
			onFieldUpdate,
			api
		});
	}

	let dragStart: { row: number; col: number } | null = $state(null);
	let dragEnd: { row: number; col: number } | null = $state(null);
	let renamingArea: string | null = $state(null);
	let renameValue = $state('');

	function cellArea(row: number, col: number): Area | undefined {
		return areas.find((a) => row >= a.rowStart && row < a.rowEnd && col >= a.colStart && col < a.colEnd);
	}

	function inDragRect(row: number, col: number): boolean {
		if (!dragStart || !dragEnd) return false;
		const r0 = Math.min(dragStart.row, dragEnd.row);
		const r1 = Math.max(dragStart.row, dragEnd.row);
		const c0 = Math.min(dragStart.col, dragEnd.col);
		const c1 = Math.max(dragStart.col, dragEnd.col);
		return row >= r0 && row <= r1 && col >= c0 && col <= c1;
	}

	function onCellPointerDown(row: number, col: number) {
		dragStart = { row, col };
		dragEnd = { row, col };
	}

	function onCellPointerEnter(row: number, col: number) {
		if (dragStart) dragEnd = { row, col };
	}

	function onPointerUp() {
		if (!dragStart || !dragEnd) return;
		const r0 = Math.min(dragStart.row, dragEnd.row);
		const r1 = Math.max(dragStart.row, dragEnd.row);
		const c0 = Math.min(dragStart.col, dragEnd.col);
		const c1 = Math.max(dragStart.col, dragEnd.col);
		const name = nextAreaName(areas);
		commit(paintArea(areas, { name, rowStart: r0, rowEnd: r1 + 1, colStart: c0, colEnd: c1 + 1 }));
		dragStart = null;
		dragEnd = null;
		renamingArea = name;
		renameValue = name;
	}

	function startRename(name: string) {
		renamingArea = name;
		renameValue = name;
	}

	function commitRename() {
		if (renamingArea && renameValue.trim()) {
			commit(renameArea(areas, renamingArea, renameValue.trim()));
		}
		renamingArea = null;
	}

	function deleteArea(name: string) {
		commit(removeArea(areas, name));
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
		node.select();
	}
</script>

<svelte:window onpointerup={onPointerUp} />

<div class="area-painter">
	{#if colCount === 0 || rowCount === 0}
		<div class="area-painter__empty">
			Define columns and rows above to paint named areas.
		</div>
	{:else}
		<div
			class="area-painter__grid"
			style="grid-template-columns: repeat({colCount}, 1fr); grid-template-rows: repeat({rowCount}, 1.6em);"
		>
			{#each Array(rowCount) as _, rowIdx (rowIdx)}
				{#each Array(colCount) as _, colIdx (colIdx)}
					{@const row = rowIdx + 1}
					{@const col = colIdx + 1}
					{@const area = cellArea(row, col)}
					<button
						type="button"
						class="area-painter__cell"
						class:area-painter__cell--filled={!!area}
						class:area-painter__cell--dragging={inDragRect(row, col)}
						style={area ? `--area-color: ${layerDotColor([area.name], true)}` : ''}
						title={area ? area.name : `row ${row}, column ${col}`}
						onpointerdown={() => onCellPointerDown(row, col)}
						onpointerenter={() => onCellPointerEnter(row, col)}
					>
						{#if area && row === area.rowStart && col === area.colStart}
							<span class="area-painter__name">{area.name}</span>
						{/if}
					</button>
				{/each}
			{/each}
		</div>

		{#if areas.length > 0}
			<ul class="area-painter__list">
				{#each areas as area (area.name)}
					<li class="area-painter__item">
						<span class="area-painter__swatch" style="--area-color: {layerDotColor([area.name], true)}"></span>
						{#if renamingArea === area.name}
							<input
								class="area-painter__rename"
								bind:value={renameValue}
								onblur={commitRename}
								onkeydown={(e) => e.key === 'Enter' && commitRename()}
								use:focusOnMount
							/>
						{:else}
							<button type="button" class="area-painter__item-name" onclick={() => startRename(area.name)}>
								{area.name}
							</button>
						{/if}
						<button type="button" class="area-painter__item-delete" title="Delete area" onclick={() => deleteArea(area.name)}>
							<i class="fa-solid fa-xmark"></i>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<div class="area-painter__hint">Click-drag cells to paint a region, click a name below to rename it.</div>
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	button {
		all: unset;
		cursor: pointer;
	}

	.area-painter {
		display: flex;
		flex-direction: column;
		gap: calc($x-space-xs / 2);
		padding-inline: $x-space-sm;
		padding-block: calc($x-space-xs / 2);

		&__empty {
			font-size: $x-font-size-xs;
			opacity: 0.6;
			padding-block: $x-space-xs;
		}

		&__grid {
			display: grid;
			gap: 2px;
			user-select: none;
			touch-action: none;
		}

		&__cell {
			background: var(--color-panel-header-fill);
			border-radius: 2px;
			display: flex;
			align-items: center;
			justify-content: center;
			overflow: hidden;

			&:hover {
				background: var(--color-surface-alt);
			}

			&--filled {
				background: color-mix(in oklab, var(--area-color) 35%, var(--color-panel-header-fill));
			}

			&--dragging {
				outline: 1px solid var(--color-primary);
				outline-offset: -1px;
			}
		}

		&__name {
			font-size: 0.6em;
			opacity: 0.85;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			padding-inline: 2px;
		}

		&__list {
			list-style: none;
			margin: 0;
			padding: 0;
			display: flex;
			flex-direction: column;
			gap: 1px;
		}

		&__item {
			display: flex;
			align-items: center;
			gap: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2);
			font-size: $x-font-size-xs;
		}

		&__swatch {
			flex: 0 0 auto;
			width: 0.7em;
			height: 0.7em;
			border-radius: 50%;
			background: var(--area-color);
		}

		&__item-name {
			flex: 1;
			text-align: left;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;

			&:hover {
				text-decoration: underline;
			}
		}

		&__rename {
			flex: 1;
			min-width: 0;
			background: var(--color-surface-alt);
			border: none;
			border-radius: 2px;
			color: var(--color-text);
			font-size: $x-font-size-xs;
			padding: 2px calc($x-space-xs / 2);
		}

		&__item-delete {
			flex: 0 0 auto;
			opacity: 0.6;

			&:hover {
				opacity: 1;
				color: var(--color-danger, #e05252);
			}
		}

		&__hint {
			font-size: 0.65em;
			opacity: 0.5;
			padding-top: 2px;
		}
	}
</style>

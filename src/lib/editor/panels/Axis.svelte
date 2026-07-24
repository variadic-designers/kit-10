<script lang="ts" module>
	import type { DragPayload } from '../dnd.svelte.ts';

	export type AxisMode = 'categorical' | 'range' | 'discrete';

	export type AxisArgValue =
		| { type: 'literal'; value: string }
		| { type: 'range'; min: number | null; max: number | null };

	export type AxisValueOption =
		| { type: 'literal'; value: string }
		| { type: 'range'; operator: string; threshold: number; threshold_high?: number }
		| { type: 'discrete'; value: string };

	export type AxisProps = {
		axisId: string;
		axisName: string;
		axisDescription?: string;
		kind: AxisMode;
		values: AxisValueOption[];
		currentArg: AxisArgValue | null;
		kitShape?: string;
		axisCount?: number;
		axisValueIds?: Record<string, string>;
		valueLayerCells?: Record<
			string,
			{ layerId: string; active: boolean; conditionCount: number; keys: string[] }[]
		>;
		axisNameById?: Record<string, string>;
		disabled?: boolean;
		// Drag-to-reorder: the whole header (<summary>) is the drag source. Payload/preview are
		// owned by the parent (Axes.svelte) since they need the kit context; Axis just wires the
		// action onto its own summary. A trailing-click guard in the action keeps a drag from
		// toggling the <details> open/closed.
		dragPayload?: () => DragPayload | null;
		dragPreview?: string;
		onArgChange: (arg: AxisArgValue | null) => void;
		// Remove this axis from the active kit (unconsume). Mirrors the Compose panel's "Remove" on a
		// composed kit -- detach from the container, not a project-wide delete. The parent owns the
		// kit context + refresh, so this is a plain callback.
		onRemove?: () => void;
		// Whether this axis is safe to hard-delete project-wide (not consumed by any other kit). Gates
		// the "Delete Axis" menu item; when false only "Remove" is offered.
		deletable?: boolean;
		onDelete?: () => void;
		// Opens the axis name straight into Renameable's edit mode -- set true right after creation
		// so a freshly-created axis is immediately nameable instead of stuck as "New Axis".
		autoEdit?: boolean;
		onRename?: (name: string) => void;
		// Value ids currently forced into their own Renameable's edit mode (keyed by axisValueId,
		// not the value's literal -- renaming changes the literal, so the id is the stable key).
		valueEditing?: Record<string, boolean>;
		// Categorical-only value CRUD/reorder -- undefined/no-op for kinds that don't have a
		// discrete value list to manage (range/number, once they exist).
		onValueAdd?: () => void;
		onValueRename?: (axisValueId: string, text: string) => void;
		onValueDelete?: (axisValueId: string) => void;
		onValueReorder?: (draggedValueId: string, targetValueId: string, edge?: 'before' | 'after') => void;
		// Hovering a layer-combo dot reports the axis-id set of the layer it belongs to (null on
		// leave). The parent broadcasts it back down as `highlightColor` on every axis in that set,
		// so a multi-axis layer's dot lights up every axis it spans, not just the one you're over.
		onLayerHover?: (keys: string[] | null) => void;
		highlightColor?: string | null;
		// Create-layer mode: while active, clicking a value toggles it into the pending condition set
		// (parent owns the set) instead of selecting the current arg. pendingValueIds marks which of
		// this axis's values are picked; pendingColor previews the new layer's dot color on them.
		createMode?: boolean;
		pendingValueIds?: Set<string>;
		pendingColor?: string | null;
		onToggleCondition?: (axisId: string, axisValueId: string) => void;
		// Clicking a combo dot picks up the real layer behind it (pipette). Reports this value's id
		// plus the dot's axis-id set; the parent resolves the exact layer and holds it.
		onPickLayer?: (axisValueId: string, keys: string[]) => void;
		// Alt-clicking a dot deletes the layer it represents.
		onDeleteLayer?: (axisValueId: string, keys: string[]) => void;
		// Right-click a dot -> "Edit Conditions…" -- opens the layer's whole condition set for
		// editing (a different op from pick-up/delete: it changes what the layer itself matches,
		// not which layer a paint targets or removing it outright).
		onEditLayerConditions?: (axisValueId: string, keys: string[]) => void;
	};
</script>

<script lang="ts">
	import RangeSlider from '$lib/components/RangeSlider.svelte';
	import Renameable from '$lib/components/Renameable.svelte';
	import { contextMenu, type ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import { draggable, dropZone } from '../dnd.svelte.ts';
	import { layerDotColor } from './layer-color.ts';
	import { AXIS_KINDS } from './axisKinds.ts';
	import { keybinds, matchMouse } from '../keybinds.js';

	let {
		axisId,
		axisName,
		axisDescription,
		kind = 'categorical',
		values = [],
		currentArg,
		kitShape = 'fa-circle',
		axisCount = 0,
		axisValueIds = {},
		valueLayerCells = {},
		axisNameById = {},
		disabled = false,
		dragPayload,
		dragPreview,
		onArgChange,
		onRemove,
		deletable = false,
		onDelete,
		autoEdit = false,
		onRename,
		valueEditing = {},
		onValueAdd,
		onValueRename,
		onValueDelete,
		onValueReorder,
		onLayerHover,
		highlightColor = null,
		createMode = false,
		pendingValueIds,
		pendingColor = null,
		onToggleCondition,
		onPickLayer,
		onDeleteLayer,
		onEditLayerConditions
	}: AxisProps = $props();

	// One dot per distinct axis key-set this variant belongs to — not one per other-axis column,
	// and not one per literal Layer (different Layers sharing the same key-set are visually
	// identical and mutually exclusive within an axis, so they're pre-grouped in valueLayerCells).
	// Includes Layers conditioned solely on this axis (no "other" axis at all) — those still color
	// real properties in the Render panel, so they need a dot to match against. A value can belong
	// to several DIFFERENT key-sets at once; a more specific Layer overriding another on a shared
	// property doesn't make the less specific one inactive, so every key-set family whose conditions
	// currently match still gets its own dot. The null layer never appears here — it has no
	// conditions, so it isn't "attached" to any axis value; it belongs to property/token resolution
	// (Render, Tokens panels), not axis-value selection.
	function layerDots(variantId: string) {
		const axisValueId = axisValueIds[variantId];
		return (axisValueId && valueLayerCells[axisValueId]) || [];
	}

	function keySetId(keys: string[]): string {
		return [...new Set(keys)].sort().join('|');
	}

	// Stable column order shared across every value of THIS axis — the union of key-sets that
	// appear for any of its values, sorted by magnitude descending (most specific first, on the
	// left) so specificity reads right-to-left. Lets matching combos line up vertically (e.g.
	// the "Theme+Density" dot always sits in the same column for both "dark" and "light")
	// instead of packing left, where the same combo could land in a different position per row.
	let keySetColumns = $derived.by(() => {
		const seen = new Map<string, string[]>();
		for (const variant of categoricalValues) {
			for (const layer of layerDots(variant.value)) {
				const id = keySetId(layer.keys);
				if (!seen.has(id)) seen.set(id, layer.keys);
			}
		}
		return [...seen.entries()].sort(
			(a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)
		);
	});

	function dotForColumn(variantId: string, columnId: string) {
		return layerDots(variantId).find((layer) => keySetId(layer.keys) === columnId) ?? null;
	}

	// Names of the other axes a Layer combines with, for the dot's tooltip — empty if this Layer
	// conditions solely on this one axis.
	function otherAxisNames(keys: string[]): string {
		return keys
			.filter((id) => id !== axisId)
			.map((id) => axisNameById[id] ?? id)
			.join(' + ');
	}

	function dotTitle(layer: { active: boolean; conditionCount: number; keys: string[] }): string {
		const others = otherAxisNames(layer.keys);
		const scope = others ? `${axisName} + ${others}` : `${axisName} only`;
		const conditions = `${layer.conditionCount} condition${layer.conditionCount === 1 ? '' : 's'}`;
		return `${scope} · ${conditions}${layer.active ? ' · active' : ''}`;
	}

	// Generator (not a static array) so the menu reflects the current `deletable` each time it opens.
	const axisContextMenu: ContextMenuContentGenerator = () => [
		{
			name: 'custom axis',
			description: 'Connect state',
			displayText: 'Connect',
			icon: 'fa-solid fa-upload',
			onClick: () => {}
		},
		'hr',
		{
			name: 'custom axis',
			description: 'Mark as export',
			displayText: 'Expose',
			icon: 'fa-solid fa-tower-broadcast',
			onClick: () => {}
		},
		// Categorical-only (see axisKinds.ts) -- range/number have no discrete value list to add to.
		...(kind === 'categorical' && onValueAdd
			? [
					'hr' as const,
					{
						name: 'add-value',
						description: 'Add a value to this axis',
						displayText: 'Add Value',
						icon: 'fa-solid fa-plus',
						onClick: () => onValueAdd?.()
					}
				]
			: []),
		'hr',
		{
			name: 'remove-axis',
			description: 'Remove this axis from the kit',
			displayText: 'Remove',
			icon: 'fa-solid fa-trash',
			tone: 'destructive',
			onClick: () => onRemove?.()
		},
		// Hard delete, offered only when the axis isn't used by another kit (parent-provided).
		...(deletable
			? [
					{
						name: 'delete-axis',
						description: 'Delete this axis from the project (not used by other kits)',
						displayText: 'Delete Axis',
						icon: 'fa-solid fa-trash-can',
						tone: 'destructive' as const,
						onClick: () => onDelete?.()
					}
				]
			: [])
	];

	// Per-value context menu -- mirrors axisContextMenu's shape (destructive delete, generator so it
	// can close over the current axisValueId). Rename has no menu entry, same as the axis's own
	// name: double-clicking the Renameable is the rename affordance at both levels.
	function valueContextMenu(axisValueId: string | undefined): ContextMenuContentGenerator {
		return () => [
			{
				name: 'delete-value',
				description: 'Delete this value from the axis',
				displayText: 'Delete',
				icon: 'fa-solid fa-trash',
				tone: 'destructive',
				onClick: () => {
					if (axisValueId) onValueDelete?.(axisValueId);
				}
			}
		];
	}

	// Right-click menu for a layer-combo dot -- distinct from the value's own context menu
	// (valueContextMenu) and from the dot's plain-click (pick up) / alt-click (delete) gestures.
	function dotContextMenu(axisValueId: string, keys: string[]): ContextMenuContentGenerator {
		return () => [
			{
				name: 'edit-conditions',
				description: "Change which axis values this layer's whole condition set matches",
				displayText: 'Edit Conditions…',
				icon: 'fa-solid fa-sliders',
				onClick: () => onEditLayerConditions?.(axisValueId, keys)
			}
		];
	}

	function selectVariant(variantId: string) {
		if (disabled) return;
		if (currentArg?.type === 'literal' && currentArg.value === variantId) {
			onArgChange(null);
		} else {
			onArgChange({ type: 'literal', value: variantId });
		}
	}

	function handleRangeChange(min: number | null, max: number | null) {
		if (disabled) return;
		onArgChange({ type: 'range', min, max });
	}

	function handleDiscreteInput(e: Event) {
		const value = (e.target as HTMLInputElement).value;
		if (value === '') {
			onArgChange(null);
		} else {
			onArgChange({ type: 'literal', value });
		}
	}

	let rangeThresholds = $derived(
		values
			.filter((v): v is { type: 'range'; operator: string; threshold: number; threshold_high?: number } => v.type === 'range')
			.map((v) => ({ value: v.threshold, label: `${v.operator} ${v.threshold}` }))
	);

	let rangeMin = $derived(
		currentArg?.type === 'range' ? currentArg.min : null
	);

	let rangeMax = $derived(
		currentArg?.type === 'range' ? currentArg.max : null
	);

	let displayValue = $derived.by(() => {
		if (!currentArg) return 'Not set';
		if (currentArg.type === 'literal') return currentArg.value;
		if (currentArg.type === 'range') {
			const min = currentArg.min == null ? '-∞' : String(currentArg.min);
			const max = currentArg.max == null ? '+∞' : String(currentArg.max);
			return `${min} ↔ ${max}`;
		}
		return 'Not set';
	});

	let isSet = $derived(currentArg !== null);

	let categoricalValues = $derived(
		values.filter((v): v is { type: 'literal'; value: string } => v.type === 'literal')
	);
</script>

<details class="axis">
	<summary
		title={axisDescription}
		class="axis__name"
		class:axis__name--highlighted={!!highlightColor}
		style={highlightColor ? `--axis-highlight: ${highlightColor}` : undefined}
		use:contextMenu={axisContextMenu}
		use:draggable={{ payload: dragPayload ?? (() => null), preview: dragPreview }}
	>
		<h3>
			<Renameable
				editing={autoEdit}
				value={axisName}
				onCommit={(name) => onRename?.(name)}
			>
				{axisName}
			</Renameable>
		</h3>
		<div class="axis__name__value" class:axis__name__value--unset={!isSet}>
			{displayValue}
		</div>
		<i class="fa-solid fa-angle-down axis__name__collapse-icon"></i>
	</summary>

	<div class="axis__content">
		{#if kind === 'categorical'}
			<ul class="axis__variants">
				{#each categoricalValues as variant}
					{@const variantId = variant.value}
					{@const axisValueId = axisValueIds[variantId]}
					{@const pending = createMode && !!axisValueId && !!pendingValueIds?.has(axisValueId)}
					<li
						use:dropZone={{
							accepts: 'axis-value',
							mode: 'reorder',
							canDrop: (p) => p.kind === 'axis-value' && p.axisId === axisId && p.axisValueId !== axisValueId,
							onDrop: (p, { position }) => {
								if (p.kind === 'axis-value' && axisValueId)
									onValueReorder?.(p.axisValueId, axisValueId, position === 'after' ? 'after' : 'before');
							}
						}}
					>
						<!-- The onclick only repurposes the wrapped radio in create mode; the label is
						     already interactive via that radio, hence the a11y ignores below. -->
						<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
						<!-- svelte-ignore a11y_click_events_have_key_events -->
						<label
							class="axis-field"
							class:axis-field--selected={currentArg?.type === 'literal' && currentArg.value === variantId}
							class:axis-field--pending={pending}
							style={pending && pendingColor ? `--pending: ${pendingColor}` : undefined}
							use:contextMenu={valueContextMenu(axisValueId)}
							use:draggable={{
								payload: () => (axisValueId ? { kind: 'axis-value', axisValueId, axisId } : null),
								preview: variant.value
							}}
							onclick={(e) => {
								if (createMode) {
									e.preventDefault();
									if (axisValueId) onToggleCondition?.(axisId, axisValueId);
								} else if (currentArg?.type === 'literal' && currentArg.value === variantId) {
									// Re-clicking the active value deselects it. A radio doesn't fire change when you
									// click the already-checked one, so this click handler is what enables it.
									e.preventDefault();
									selectVariant(variantId);
								}
							}}
						>
							<input
								class="axis-field__radio"
								type="radio"
								name="axis-{axisId}"
								value={variantId}
								checked={currentArg?.type === 'literal' && currentArg.value === variantId}
								onchange={() => selectVariant(variantId)}
								{disabled}
							/>
							<span class="axis-field__name">
								<Renameable
									editing={axisValueId ? valueEditing[axisValueId] === true : false}
									value={AXIS_KINDS.categorical.valueLabel(variant)}
									onCommit={(text) => axisValueId && onValueRename?.(axisValueId, text)}
								>
									{variant.value}
								</Renameable>
							</span>
							<span class="axis-field__layers">
								{#each keySetColumns as [columnId] (columnId)}
									{@const layer = dotForColumn(variantId, columnId)}
									<span class="axis-field__layer-slot">
										{#if layer}
											<!-- svelte-ignore a11y_no_static_element_interactions -->
											<i
												class="fa-solid {kitShape} axis-field__layer-shape axis-field__layer-shape--pick"
												class:axis-field__layer-shape--active={layer.active}
												style="--shape-color: {layerDotColor(layer.keys, layer.active)}"
												title={dotTitle(layer)}
												use:contextMenu={dotContextMenu(axisValueId ?? '', layer.keys)}
												onmouseenter={() => onLayerHover?.(layer.keys)}
												onmouseleave={() => onLayerHover?.(null)}
												onclick={(e) => {
													if (createMode || !axisValueId) return;
													e.preventDefault();
													e.stopPropagation();
													if (matchMouse(e, $keybinds['layer.delete'], false))
														onDeleteLayer?.(axisValueId, layer.keys);
													else onPickLayer?.(axisValueId, layer.keys);
												}}
											></i>
										{/if}
									</span>
								{/each}
							</span>
						</label>
					</li>
				{/each}
			</ul>
		{:else if kind === 'range'}
			<div class="axis__range">
				<RangeSlider
					min={rangeMin}
					max={rangeMax}
					thresholds={rangeThresholds}
					{disabled}
					onChange={handleRangeChange}
				/>
			</div>
		{:else if kind === 'discrete'}
			<div class="axis__discrete">
				<input
					class="axis__discrete-input"
					type="text"
					placeholder="Enter value…"
					value={currentArg?.type === 'literal' ? currentArg.value : ''}
					oninput={handleDiscreteInput}
					{disabled}
				/>
			</div>
		{/if}
	</div>
</details>

<style lang="scss">
	@use '_index' as *;

	.axis {
		position: relative;
		user-select: none;

		&[open] {
			.axis__name__collapse-icon {
				rotate: -180deg;
			}

			.axis__name__value {
				opacity: 0;
			}
		}

		&:not([open]) {
			.axis__name:hover {
				background: var(--color-surface-alt);
			}
		}

		&__name {
			display: grid;
			grid-template-rows: 1fr;
			grid-template-columns: 1fr 1fr max-content;
			justify-content: space-between;
			align-items: center;
			padding-inline: $x-space-sm;
			cursor: pointer;
			font-size: $x-font-size-xs;
			gap: $x-space-sm;
			color: var(--color-pure-alt);

			// The header is the drag source, but hover keeps the normal (pointer) cursor -- a click
			// still toggles the panel, so grab-on-hover would mislabel it. Only while an actual drag
			// is in flight does it read as grabbing. dnd-dragging is applied at runtime, hence :global().
			&:global(.dnd-dragging) {
				cursor: grabbing;
				opacity: 0.5;
			}

			// Lit when a layer dot is hovered anywhere in the panel and this axis is part of that
			// layer's span -- the tint is the dot's own key-set color, so a multi-axis layer visibly
			// connects every axis it conditions on. --axis-highlight is set inline from the dot.
			&--highlighted {
				box-shadow: inset 3px 0 0 var(--axis-highlight);
				background: color-mix(in oklch, var(--axis-highlight) 14%, transparent);
			}

			h3 {
				grid-area: 1 / 1 / 1 / 2;
				text-transform: uppercase;
				@include fonts-stack('Satoshi-Bold', sans);
				padding-block: calc($x-space-xs / 2);
			}

			&__value {
				padding-inline: $x-space-sm;
				grid-area: 1 / 2 / 1 / 3;
				min-width: 2rem;
				font-size: $x-font-size-md;
				font-weight: 800;
				@include fonts-stack('Satoshi-Regular', sans);
				color: var(--color-primary);
				border: 1px solid var(--color-surface-alt);
				background: var(--color-surface-alt);
				text-transform: capitalize;
				border-radius: calc($x-space-xs / 2);

				&--unset {
					color: var(--color-text-muted);
					border: 1px solid var(--color-panel-header-fill);
					background: var(--color-panel-header-fill);
				}
			}

			&__collapse-icon {
				transition: rotate 200ms ease-out;
				rotate: -360deg;
			}
		}

		&__content {
			padding-inline: $x-space-sm;
		}

		&__variants {
			list-style-type: none;
			@include layout-flex-column();
		}

		&__range {
			padding: $x-space-xs 0;
		}

		&__discrete {
			padding: $x-space-xs 0;

			&-input {
				width: 100%;
				padding: $x-space-xs $x-space-sm;
				border: 1px solid var(--color-surface-alt);
				border-radius: calc($x-space-xs / 2);
				background: var(--color-bg);
				color: var(--color-text);
				font-size: $x-font-size-md;
				@include fonts-stack('Satoshi-Regular', sans);

				&:focus {
					border-color: var(--color-primary);
					outline: none;
				}
			}
		}
	}

	.axis-field {
		display: flex;
		flex-direction: row;
		gap: $x-space-xs;
		font-weight: 600;
		padding-block: calc($x-space-xs / 4);
		padding-inline: $x-space-md;
		cursor: pointer;
		border-radius: calc($x-space-xs / 2);

		&:hover {
			background: var(--color-surface-alt);
		}

		&--selected {
			background: var(--color-surface-alt);

			.axis-field__name {
				color: var(--color-primary);
			}
		}

		// Picked into the pending condition set while in create-layer mode. Tinted in the color the
		// new layer's dots will be, so the combination you're assembling previews as one family.
		&--pending {
			background: color-mix(in oklch, var(--pending) 18%, transparent);
			box-shadow: inset 0 0 0 1.5px var(--pending);

			.axis-field__name {
				color: var(--pending);
			}
		}

		&__radio {
			opacity: 0;
			position: absolute;
		}

		&__name {
			flex-grow: 1;
			padding-inline: $x-space-xs;
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-md;
			font-weight: 600;
			text-transform: capitalize;
			cursor: pointer;

			&:hover {
				color: var(--color-primary);
			}
		}

		&__layers {
			display: flex;
			align-items: center;
			flex-shrink: 0;
		}

		// Fixed width regardless of whether this slot has a dot, so the same key-set column
		// lines up at the same horizontal position across every value row of this axis.
		&__layer-slot {
			width: $x-font-size-md;
			display: flex;
			justify-content: center;
			flex-shrink: 0;
		}

		&__layer-shape {
			font-size: $x-font-size-sm;
			color: var(--shape-color);
			opacity: 0.4;

			&--active {
				opacity: 1;
				-webkit-text-stroke: 2px var(--color-text);
			}

			// The dot is a pipette handle -- click to pick up the layer behind it.
			&--pick {
				cursor: pointer;

				&:hover {
					opacity: 1;
					scale: 1.25;
				}
			}
		}

	}
</style>
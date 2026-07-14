<script lang="ts" module>
	import type { AxisMode, AxisArgValue, AxisValueOption } from './Axis.svelte';

	export type { AxisMode, AxisArgValue, AxisValueOption };
</script>

<script lang="ts">
	import Panel from '../Panel.svelte';
	import Axis from './Axis.svelte';
	import type { Api } from 'manager';
	import { matchesArg } from 'manager';
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import type { EditorActivity } from '../Editor.svelte';
	import type { EditorState } from 'manager';
	import { shapeIcon } from './layer-color.ts';
	import { dropZone } from '../dnd.svelte.ts';

	type AxesPanel = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
	};

	let { api, editorReady, editorActivity = $bindable() }: AxesPanel = $props();

	const detailCollapse = (collapse: boolean) => {
		return () => {
			const axesDetail = document.querySelectorAll<HTMLDetailsElement>('details.axis');
			axesDetail.forEach((detail) => (detail.open = !collapse));
		};
	};

	const addAxisContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'expand',
				description: 'Expand all Axes',
				displayText: 'Expand',
				icon: 'fa-solid fa-angles-down',
				onClick: detailCollapse(false)
			},
			{
				name: 'collapse',
				description: 'Collapse all Axes',
				displayText: 'Collapse',
				icon: 'fa-solid fa-angles-up',
				onClick: detailCollapse(true)
			},
			'hr',
			{
				name: 'custom axis',
				description: 'Add custom axis',
				displayText: 'Custom Axis',
				icon: 'fa-solid fa-plus',
				onClick: () => {}
			},
			{
				name: 'use-axis',
				description: 'Use an existing axis from this project in this kit',
				displayText: 'Use Axis',
				icon: 'fa-solid fa-ruler-combined',
				// Disabled (won't open) when the kit already consumes every project axis.
				disabled: unusedAxes.length === 0,
				// Axes in the project not yet consumed by this kit -- click to consume (add) one.
				submenu: unusedAxes.map((axis) => ({
					name: `axis-${axis.axisId}`,
					description: `Add ${axis.axisName ?? 'axis'} to this kit`,
					displayText: axis.axisName ?? 'Untitled axis',
					icon: 'fa-solid fa-ruler-combined',
					onClick: () => addAxisToKit(axis.axisId)
				}))
			}
		];
	};

	// Fetch consumed axes for the active kit
	let consumedAxes = $state<any[]>([]);
	let axisValues = $state<Record<string, any[]>>({});
	let axisArgs = $state<Record<string, any>>({});
	let activeKitShape = $state('fa-circle');
	// Axes in the project not yet consumed by the active kit -- offered in the add-axis context menu.
	let unusedAxes = $state<{ axisId: string; axisName: string | null }[]>([]);
	// Axis ids consumed by some OTHER kit -- those can only be removed from this kit, not hard-deleted.
	let sharedAxisIds = $state<Set<string>>(new Set());
	// Bumped after consuming an axis so the kit/view-keyed loadAxes effect re-runs and both the
	// panel body (consumedAxes) and this menu (unusedAxes) refresh without a kit/view change.
	let refreshTrigger = $state(0);

	async function addAxisToKit(axisId: string) {
		const kitId = editorActivity.activeKitId;
		if (!kitId) return;
		await api.consumeAxis(kitId, axisId);
		refreshTrigger++;
	}

	// Remove an axis from the active kit (unconsume) -- the inverse of addAxisToKit, mirroring the
	// Compose panel's "Remove" on a composed kit. Not a project-wide delete; the axis stays available
	// to re-add via "Use Axis".
	async function removeAxisFromKit(axisId: string) {
		const kitId = editorActivity.activeKitId;
		if (!kitId) return;
		await api.unconsumeAxis(kitId, axisId);
		refreshTrigger++;
	}

	// Hard-delete the axis project-wide (cascade). Only offered by the row menu when the axis isn't
	// used by another kit (see sharedAxisIds), so this never destroys another kit's work.
	async function deleteAxisHard(axisId: string) {
		if (sharedAxisIds.has(axisId)) return; // guard: never hard-delete a shared axis
		await api.deleteAxisCascade(axisId);
		refreshTrigger++;
	}

	// Raw per-layer conditions, kit-scoped only — refetched on kit/view change, NOT on axis-arg change.
	let layerConditionsByLayer = $state<
		{ layerId: string; conds: { axisId: string; axisValueId: string; value: any }[] }[]
	>([]);

	$effect(() => {
		const currentKitId = editorActivity.activeKitId;
		const currentViewId = editorActivity.activeViewId;
		refreshTrigger; // dependency: re-run loadAxes after consuming an axis

		if (!currentKitId || !editorReady) {
			consumedAxes = [];
			axisValues = {};
			axisArgs = {};
			layerConditionsByLayer = [];
			unusedAxes = [];
			return;
		}

		const loadAxes = async () => {
			const axes = await api.getConsumedAxesByKitId(currentKitId).execute();
			consumedAxes = axes;

			unusedAxes = await api.getAxesExceptFromKitId(currentKitId).execute();

			const sharedRows = await api.getAxisIdsUsedByOtherKits(currentKitId).execute();
			sharedAxisIds = new Set(sharedRows.map((r) => r.axisId));

			const valuesMap: Record<string, any[]> = {};
			for (const axis of axes) {
				valuesMap[axis.axisId] = await api.getAxisValuesByAxisId(axis.axisId).execute();
			}
			axisValues = valuesMap;

			let argsMap: Record<string, any> = {};
			if (currentViewId) {
				const args = await api.getAllAxisArgs(currentViewId, currentKitId).execute();
				for (const arg of args) {
					argsMap[arg.axisId] = arg.value;
				}
			}
			axisArgs = argsMap;

			const layers = await editorReady.dialect
				.selectFrom('layers')
				.where('kit_id', '=', currentKitId)
				.select(['id'])
				.execute();

			const layerIds = layers.map((l) => l.id);

			if (layerIds.length === 0) {
				layerConditionsByLayer = [];
			} else {
				const conditions = await editorReady.dialect
					.selectFrom('layer_axis_values')
					.innerJoin('axis_values', 'axis_values.id', 'layer_axis_values.axis_value_id')
					.where('layer_axis_values.layer_id', 'in', layerIds)
					.select([
						'layer_axis_values.layer_id',
						'layer_axis_values.axis_value_id',
						'axis_values.axis_id',
						'axis_values.value'
					])
					.execute();

				const grouped = new Map<string, { axisId: string; axisValueId: string; value: any }[]>();
				for (const c of conditions) {
					if (!grouped.has(c.layer_id)) grouped.set(c.layer_id, []);
					grouped
						.get(c.layer_id)!
						.push({ axisId: c.axis_id, axisValueId: c.axis_value_id, value: c.value });
				}

				layerConditionsByLayer = layerIds.map((layerId) => ({
					layerId,
					conds: grouped.get(layerId) ?? []
				}));
			}

			let kitShape = 'fa-circle';
			if (currentViewId) {
				const composition = await api.getKitCompositionByViewId(currentViewId).execute();
				const kitIndex = composition.findIndex((k) => k.kitId === currentKitId);
				if (kitIndex >= 0) {
					const iconIdx = composition.length - 1 - kitIndex;
					kitShape = shapeIcon(iconIdx);
				}
			}
			activeKitShape = kitShape;
		};

		loadAxes();
	});

	// Recomputes whenever axis args change (not just when the kit/view changes) — this is what
	// keeps the "active" flag on each layer-combo dot in sync with the currently selected values.
	//
	// One entry per DISTINCT key-set a value belongs to (not one per literal Layer). Two different
	// Layers can share the exact same axis-set — e.g. theme:dark;density:compact and
	// theme:light;density:compact are both {theme,density} — and since axis values within one
	// axis are mutually exclusive, at most one of them can ever be active at once. They're also
	// visually identical (same hue, same shape), so showing both as separate dots is pure clutter,
	// not information. Grouped by key-set; a group is active if ANY Layer in it currently matches.
	//
	// Includes single-axis Layers (conditioned solely on this value, nothing else) — unlike the
	// null layer, those DO belong to this specific value, and StyleField already colors properties
	// sourced from them with a real (non-muted) hue, so they need a dot here to match against.
	const valueLayerCells = $derived.by(() => {
		const grouped: Record<
			string,
			Record<string, { active: boolean; conditionCount: number; keys: string[] }>
		> = {};

		for (const { conds } of layerConditionsByLayer) {
			if (conds.length === 0) continue; // the null layer isn't attached to any axis value

			const isActive = conds.every((c) => {
				const arg = axisArgs[c.axisId];
				if (!arg) return false;
				return matchesArg(c.value as any, arg as any);
			});
			const keys = conds.map((c) => c.axisId);
			const keySetId = [...new Set(keys)].sort().join('|');

			for (const c of conds) {
				if (!grouped[c.axisValueId]) grouped[c.axisValueId] = {};
				const existing = grouped[c.axisValueId][keySetId];
				grouped[c.axisValueId][keySetId] = {
					active: (existing?.active ?? false) || isActive,
					conditionCount: conds.length,
					keys
				};
			}
		}

		const cellsMap: Record<
			string,
			{ layerId: string; active: boolean; conditionCount: number; keys: string[] }[]
		> = {};
		for (const [axisValueId, bySet] of Object.entries(grouped)) {
			cellsMap[axisValueId] = Object.entries(bySet).map(([keySetId, entry]) => ({
				layerId: keySetId,
				...entry
			}));
		}
		return cellsMap;
	});

	// Derive kind from axis values
	function inferKind(values: any[]): AxisMode {
		if (values.length === 0) return 'discrete';
		const first = values[0].value;
		if (first.type === 'range') return 'range';
		if (first.type === 'literal') return 'categorical';
		return 'discrete';
	}

	// Transform axis_values into AxisValueOption format
	function toValueOptions(values: any[]): AxisValueOption[] {
		return values.map((v) => v.value as AxisValueOption);
	}

	// Transform current arg into AxisArgValue format
	function getCurrentArg(axisId: string): AxisArgValue | null {
		const raw = axisArgs[axisId];
		if (!raw) return null;
		return raw as AxisArgValue;
	}

	// Drop-to-reorder: place the dragged axis on the target's before/after edge, then persist the
	// whole new order in one collision-safe call. consumedAxes isn't a live query (it's fetched by
	// the $effect above), so refetch it explicitly here rather than waiting for a reactive re-run.
	async function handleAxisReorder(
		draggedAxisId: string,
		targetAxisId: string,
		edge: 'before' | 'after' = 'before'
	) {
		const kitId = editorActivity.activeKitId;
		if (!kitId || draggedAxisId === targetAxisId) return;

		const ids = consumedAxes.map((a) => a.axisId);
		const from = ids.indexOf(draggedAxisId);
		if (from < 0) return;
		ids.splice(from, 1);

		const ti = ids.indexOf(targetAxisId);
		if (ti < 0) return;
		ids.splice(edge === 'after' ? ti + 1 : ti, 0, draggedAxisId);

		await api.setConsumedAxesOrder(kitId, ids);
		consumedAxes = await api.getConsumedAxesByKitId(kitId).execute();
	}

	// Handle arg changes from Axis component
	async function handleArgChange(axisId: string, arg: AxisArgValue | null) {
		if (!editorActivity.activeViewId || !editorActivity.activeKitId) return;

		if (arg === null) {
			return;
		}

		await api.setAxisArg(editorActivity.activeViewId, editorActivity.activeKitId, axisId, arg);

		const args = await api
			.getAllAxisArgs(editorActivity.activeViewId, editorActivity.activeKitId)
			.execute();
		const argsMap: Record<string, any> = {};
		for (const a of args) {
			argsMap[a.axisId] = a.value;
		}
		axisArgs = argsMap;
	}
</script>

<Panel contextMenuContent={addAxisContextMenu} name="Axes" tooltip="Adjust the axes set">
	{#snippet content()}
		{#if !editorActivity.activeKitId || !editorActivity.activeViewId}
			<p class="axes-empty">
				<i class="fa-solid fa-up-long"></i> Select a view and kit to adjust axes
			</p>
		{:else if consumedAxes.length === 0}
			<p class="axes-empty">
				<i class="fa-solid fa-up-long"></i> Add axes to the selected kit
			</p>
		{:else}
			{#each consumedAxes as axisData (axisData.axisId)}
				{@const values = axisValues[axisData.axisId] ?? []}
				{@const kind = inferKind(values)}
				{@const currentArg = getCurrentArg(axisData.axisId)}
				<div
					class="axis-row"
					use:dropZone={{
						accepts: 'axis',
						mode: 'reorder',
						canDrop: (p) => p.kind === 'axis' && p.axisId !== axisData.axisId,
						onDrop: (p, { position }) => {
							if (p.kind === 'axis')
								handleAxisReorder(p.axisId, axisData.axisId, position === 'after' ? 'after' : 'before');
						}
					}}
				>
				<!-- The Axis header (its <summary>) is the drag source -- Axis.svelte wires the
				     draggable action onto its own summary; we just hand it the payload + preview,
				     which need the kit context this panel has. The row itself is the drop target. -->
				<Axis
					axisId={axisData.axisId}
					axisName={axisData.axisName ?? axisData.axisId}
					axisDescription={axisData.axisKind ?? undefined}
					dragPreview={axisData.axisName ?? 'Axis'}
					dragPayload={() =>
						editorActivity.activeKitId
							? { kind: 'axis', axisId: axisData.axisId, kitId: editorActivity.activeKitId }
							: null}
					{kind}
					values={toValueOptions(values)}
					{currentArg}
					kitShape={activeKitShape}
					axisCount={consumedAxes.length}
					axisValueIds={values.reduce(
						(acc, v) => {
							acc[v.value.value ?? v.value.type] = v.axisValueId;
							return acc;
						},
						{} as Record<string, string>
					)}
					{valueLayerCells}
					axisNameById={consumedAxes.reduce(
						(acc, a) => {
							acc[a.axisId] = a.axisName ?? a.axisId;
							return acc;
						},
						{} as Record<string, string>
					)}
					onArgChange={(arg) => handleArgChange(axisData.axisId, arg)}
				onRemove={() => removeAxisFromKit(axisData.axisId)}
				deletable={!sharedAxisIds.has(axisData.axisId)}
				onDelete={() => deleteAxisHard(axisData.axisId)}
				/>
				</div>
			{/each}
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	// Drop target for axis reorder. The drag *source* is each Axis's own header (see Axis.svelte);
	// this wrapper just shows a live insertion line on the edge the dragged axis will land against.
	.axis-row {
		position: relative;

		// The dnd-* classes are applied at runtime by the dnd controller, not present in this
		// component's markup, so they must be :global() -- otherwise Svelte's scoped-CSS pass prunes
		// them as "unused" and the indicator never renders.
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
	}

	.axes-empty {
		padding: $x-space-sm;
		text-align: center;
		color: var(--color-text-muted);
		font-size: $x-font-size-sm;

		i {
			margin-right: $x-space-xs;
		}
	}
</style>

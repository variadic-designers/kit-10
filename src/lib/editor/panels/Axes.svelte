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
				name: 'custom axis',
				description: 'Add custom axis',
				displayText: 'Custom Axis',
				icon: 'fa-solid fa-plus',
				onClick: () => {}
			},
			'hr',
			{
				name: 'collapse',
				description: 'Collapse all Axes',
				displayText: 'Collapse',
				icon: 'fa-solid fa-angles-up',
				onClick: detailCollapse(true)
			},
			{
				name: 'expand',
				description: 'Expand all Axes',
				displayText: 'Expand',
				icon: 'fa-solid fa-angles-down',
				onClick: detailCollapse(false)
			},
			'hr'
		];
	};

	// Fetch consumed axes for the active kit
	let consumedAxes = $state<any[]>([]);
	let axisValues = $state<Record<string, any[]>>({});
	let axisArgs = $state<Record<string, any>>({});
	let activeKitShape = $state('fa-circle');

	// Raw per-layer conditions, kit-scoped only — refetched on kit/view change, NOT on axis-arg change.
	let layerConditionsByLayer = $state<
		{ layerId: string; conds: { axisId: string; axisValueId: string; value: any }[] }[]
	>([]);

	$effect(() => {
		const currentKitId = editorActivity.activeKitId;
		const currentViewId = editorActivity.activeViewId;

		if (!currentKitId || !editorReady) {
			consumedAxes = [];
			axisValues = {};
			axisArgs = {};
			layerConditionsByLayer = [];
			return;
		}

		const loadAxes = async () => {
			const axes = await api.getConsumedAxesByKitId(currentKitId).execute();
			consumedAxes = axes;

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
	// One entry per Layer that conditions on this axis value (not one winner per other-axis
	// column). A value can belong to several multi-axis Layers at once — e.g. {density:compact}
	// combined with {theme} in one Layer and with {theme,state} in another. Even when a more
	// specific Layer overrides the others on a shared property, every Layer whose own conditions
	// currently match is still "active" and gets its own dot — overridden isn't the same as inactive.
	const valueLayerCells = $derived.by(() => {
		const cellsMap: Record<
			string,
			{ layerId: string; active: boolean; conditionCount: number; keys: string[] }[]
		> = {};

		for (const { layerId, conds } of layerConditionsByLayer) {
			if (conds.length < 2) continue; // single-axis layers don't "combine" with anything

			const isActive = conds.every((c) => {
				const arg = axisArgs[c.axisId];
				if (!arg) return false;
				return matchesArg(c.value as any, arg as any);
			});
			const keys = conds.map((c) => c.axisId);

			for (const c of conds) {
				if (!cellsMap[c.axisValueId]) cellsMap[c.axisValueId] = [];
				cellsMap[c.axisValueId].push({
					layerId,
					active: isActive,
					conditionCount: conds.length,
					keys
				});
			}
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
			{#each consumedAxes as axisData}
				{@const values = axisValues[axisData.axisId] ?? []}
				{@const kind = inferKind(values)}
				{@const currentArg = getCurrentArg(axisData.axisId)}
				<Axis
					axisId={axisData.axisId}
					axisName={axisData.axisName ?? axisData.axisId}
					axisDescription={axisData.axisKind ?? undefined}
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
				/>
			{/each}
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

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

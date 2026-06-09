<script lang="ts" module>
	export type AxisMode = 'categorical' | 'range' | 'discrete';

	export type AxisArgValue =
		| { type: 'literal'; value: string }
		| { type: 'range'; min: number | null; max: number | null };

	export type AxisValueOption =
		| { type: 'literal'; value: string }
		| { type: 'range'; operator: string; threshold: number; threshold_high?: number }
		| { type: 'discrete'; value: string };
</script>

<script lang="ts">
	import Panel from '../Panel.svelte';
	import Axis from './Axis.svelte';
	import type { Api } from 'manager';
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import type { EditorSelection } from '../Editor.svelte';
	import type { EditorState } from 'manager';

	type AxesPanel = {
		selection: EditorSelection;
		api: Api;
		editorReady: EditorState;
		activeKitId: string | null;
		activeViewId: string | null;
	};

	let {
		selection,
		api,
		editorReady,
		activeKitId,
		activeViewId
	}: AxesPanel = $props();

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

	$effect(() => {
		if (!activeKitId || !editorReady) {
			consumedAxes = [];
			axisValues = {};
			axisArgs = {};
			return;
		}

		const dialect = editorReady.dialect;
		const db = editorReady.core;

		const loadAxes = async () => {
			const axes = await api.getConsumedAxesByKitId(activeKitId).execute();
			consumedAxes = axes;

			// Load values for each axis
			const valuesMap: Record<string, any[]> = {};
			for (const axis of axes) {
				valuesMap[axis.axisId] = await api.getAxisValuesByAxisId(axis.axisId).execute();
			}
			axisValues = valuesMap;

			// Load current args if we have a view
			if (activeViewId) {
				const args = await api.getAllAxisArgs(activeViewId, activeKitId).execute();
				const argsMap: Record<string, any> = {};
				for (const arg of args) {
					argsMap[arg.axisId] = arg.value;
				}
				axisArgs = argsMap;
			} else {
				axisArgs = {};
			}
		};

		loadAxes();
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
		if (!activeViewId || !activeKitId) return;

		if (arg === null) {
			// Delete the arg — for now we just set it, API doesn't have delete
			// TODO: add deleteAxisArg to API
			return;
		}

		await api.setAxisArg(activeViewId, activeKitId, axisId, arg);

		// Refresh args
		const args = await api.getAllAxisArgs(activeViewId, activeKitId).execute();
		const argsMap: Record<string, any> = {};
		for (const a of args) {
			argsMap[a.axisId] = a.value;
		}
		axisArgs = argsMap;
	}
</script>

<Panel contextMenuContent={addAxisContextMenu} name="Axes" tooltip="Adjust the axes set">
	{#snippet content()}
		{#if !activeKitId || !activeViewId}
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
					currentArg={currentArg}
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

		strong {
			color: var(--color-primary);
		}
	}

	input[type='text'] {
		border-radius: $x-space-lg;
		text-align: center;
	}

	.layer__specificity {
		@include layout-flex-column();
		gap: $x-space-xs;
		padding-block: $x-space-xs;
	}
</style>
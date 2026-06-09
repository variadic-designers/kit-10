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

	type AxesPanel = {
		selection: EditorSelection;
		api: Api;
	};

	let { selection, api }: AxesPanel = $props();

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
				name: 'custom axis',
				description: 'Collapse all Axes',
				displayText: 'Collapse',
				icon: 'fa-solid fa-angles-up',
				onClick: detailCollapse(true)
			},
			{
				name: 'custom axis',
				description: 'Expand all Axes',
				displayText: 'Expand',
				icon: 'fa-solid fa-angles-down',
				onClick: detailCollapse(false)
			},
			'hr'
		];
	};

	// TODO: Wire to manager API — getConsumedAxesByKitId, getAxisValuesByAxisId, getAllAxisArgs
	// For now, no axes are rendered until manager wiring is complete.
	// The Axis component is ready to receive data from the manager.

	// Placeholder: when manager wiring is complete, this will be populated
	// from liveQuery on axes_consumed + axis_values + axis_args.
	let axesData: {
		axisId: string;
		axisName: string;
		kind: import('./Axis.svelte').AxisMode;
		values: import('./Axis.svelte').AxisValueOption[];
		currentArg: import('./Axis.svelte').AxisArgValue | null;
	}[] = $state([]);

	function handleArgChange(axisId: string, arg: import('./Axis.svelte').AxisArgValue | null) {
		// TODO: Wire to api.setAxisArg(viewId, kitId, axisId, arg)
		const axis = axesData.find((a) => a.axisId === axisId);
		if (axis) {
			axis.currentArg = arg;
		}
	}
</script>

<Panel contextMenuContent={addAxisContextMenu} name="Axes" tooltip="Adjust the axes set">
	{#snippet content()}
		{#if !selection.selectedViewPrimary || selection.selectedKitIndex === null}
			<p class="axes-empty">
				<i class="fa-solid fa-up-long"></i> Select a view and kit to adjust axes
			</p>
		{:else if axesData.length === 0}
			<p class="axes-empty">
				<i class="fa-solid fa-up-long"></i> Add axes to the selected kit
			</p>
		{:else}
			{#each axesData as axisData}
				<Axis
					axisId={axisData.axisId}
					axisName={axisData.axisName}
					kind={axisData.kind}
					values={axisData.values}
					currentArg={axisData.currentArg}
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
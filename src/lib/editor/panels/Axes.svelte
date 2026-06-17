<script lang="ts" module>
	import type { AxisMode, AxisArgValue, AxisValueOption } from './Axis.svelte';

	export type { AxisMode, AxisArgValue, AxisValueOption };
</script>

<script lang="ts">
	import Panel from '../Panel.svelte';
	import Axis from './Axis.svelte';
	import type { Api } from 'manager';
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu';
	import type { EditorActivity } from '../Editor.svelte';
	import type { EditorState } from 'manager';

	type AxesPanel = {
		api: Api;
		editorReady: EditorState;
		editorActivity: EditorActivity;
		onArgChange?: () => void;
	};

	let {
		api,
		editorReady,
		editorActivity = $bindable(),
		onArgChange
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
		const currentKitId = editorActivity.activeKitId;
		const currentViewId = editorActivity.activeViewId;

		if (!currentKitId || !editorReady) {
			consumedAxes = [];
			axisValues = {};
			axisArgs = {};
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

			if (currentViewId) {
				const args = await api.getAllAxisArgs(currentViewId, currentKitId).execute();
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
		if (!editorActivity.activeViewId || !editorActivity.activeKitId) return;

		if (arg === null) {
			return;
		}

		await api.setAxisArg(editorActivity.activeViewId, editorActivity.activeKitId, axisId, arg);

		const args = await api.getAllAxisArgs(editorActivity.activeViewId, editorActivity.activeKitId).execute();
		const argsMap: Record<string, any> = {};
		for (const a of args) {
			argsMap[a.axisId] = a.value;
		}
		axisArgs = argsMap;

		onArgChange?.();
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
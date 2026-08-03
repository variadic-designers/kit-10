<script lang="ts" module>
	import type { AxisMode, AxisArgValue, AxisValueOption } from './Axis.svelte';

	export type { AxisMode, AxisArgValue, AxisValueOption };
</script>

<script lang="ts">
	import Panel from '../Panel.svelte';
	import Axis from './Axis.svelte';
	import type { Api } from 'manager';
	import { matchesArg, resolveLinkedArg } from 'manager';
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import { liveQuery, type EditorActivity } from '../Editor.svelte';
	import type { EditorState } from 'manager';
	import { shapeIcon, layerDotColor } from './layer-color.ts';
	import { dropZone } from '../dnd.svelte.ts';
	import { AXIS_KINDS, type AxisKindId } from './axisKinds.ts';
	import { paintKeys, paintTarget, startPaint, setPaintTarget, stopPaint } from '../pipette.svelte.ts';
	import { keybinds, matchKey } from '../keybinds.js';

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
				name: 'new-axis',
				description: 'Create a new axis in this kit',
				displayText: 'New Axis',
				icon: 'fa-solid fa-plus',
				// Driven entirely off the AXIS_KINDS registry -- adding a new kind (or flipping
				// Range/Number on once they're implemented) is a change to axisKinds.ts, not here.
				submenu: Object.values(AXIS_KINDS).map((k) => ({
					name: `new-axis-${k.id}`,
					description: k.description,
					displayText: k.label,
					icon: k.icon,
					disabled: !k.enabled,
					onClick: () => createNewAxis(k.id)
				}))
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
			},
			'hr',
			{
				name: 'new-layer',
				description: 'Pick axis values, then Enter to create a layer for that combination',
				displayText: 'New Layer',
				icon: 'fa-solid fa-layer-group',
				disabled: !editorActivity.activeKitId,
				onClick: () => enterCreateMode()
			}
		];
	};

	// Fetch consumed axes for the active kit
	let consumedAxes = $state<any[]>([]);
	let axisValues = $state<Record<string, any[]>>({});
	let activeKitShape = $state('fa-circle');

	// Project-wide, live -- axisArgs below used to be a one-shot fetch re-run only on the panel's own
	// writes or a kit/view switch, meaning a lock created elsewhere (e.g. dragged from the Tokens
	// panel) while this panel was already showing that exact view+kit would sit stale until you
	// navigated away and back. Project-wide (not scoped to the active view+kit alone) because
	// resolveLinkedArg needs to walk a 'linked' chain that can pass through any other view in the
	// project. Mirrors Variables.svelte's identically-purposed allAxisArgsQuery/argsByViewKitAll.
	const allAxisArgsQuery = liveQuery((api, activity) => api.getAxisArgsByProjectId(activity.activeProjectId));

	const argsByViewKitAll = $derived.by(() => {
		const map = new Map<string, Record<string, any>>();
		for (const a of allAxisArgsQuery.rows) {
			const key = `${a.viewId}::${a.kitId}`;
			if (!map.has(key)) map.set(key, {});
			map.get(key)![a.axisId] = a.value;
		}
		return map;
	});

	// The active view+kit's OWN raw axis_args (never resolved) -- only for isLocked/lockedSourceLabel,
	// which need to know whether a cell IS a pointer, not what it currently resolves to.
	const rawAxisArgs = $derived.by(() => {
		const viewId = editorActivity.activeViewId;
		const kitId = editorActivity.activeKitId;
		if (!viewId || !kitId) return {};
		return argsByViewKitAll.get(`${viewId}::${kitId}`) ?? {};
	});

	// The RESOLVED value for every axis the active kit consumes -- every other read site in this file
	// (paint-target matching, layer-dot active state, resolveDotLayer, getCurrentArg) reads THIS, so a
	// locked axis participates in matching/display exactly like a plain literal would, with zero
	// changes needed at those call sites.
	const axisArgs = $derived.by(() => {
		const viewId = editorActivity.activeViewId;
		const kitId = editorActivity.activeKitId;
		const result: Record<string, any> = {};
		if (!viewId || !kitId) return result;
		for (const axis of consumedAxes) {
			const resolved = resolveLinkedArg(viewId, kitId, axis.axisId, argsByViewKitAll);
			if (resolved) result[axis.axisId] = resolved;
		}
		return result;
	});

	function isLocked(axisId: string): boolean {
		return rawAxisArgs[axisId]?.type === 'linked';
	}

	// Project-wide, live -- names the source view for a locked axis's tooltip. `activity.activeViewId`
	// as the query key is arbitrary (the live query itself is what matters); the callback signature
	// requires an activity param even though this specific query doesn't scope by it.
	const viewNameQuery = liveQuery((api, activity) => api.getViewsByProjectId(activity.activeProjectId));
	const viewNameById = $derived.by(() => new Map(viewNameQuery.rows.map((v) => [v.viewId, v.viewName] as const)));

	function lockedSourceLabel(axisId: string): string | undefined {
		const raw = rawAxisArgs[axisId];
		if (raw?.type !== 'linked') return undefined;
		return viewNameById.get(raw.view_id) ?? 'another view';
	}

	// Unlocking freezes the currently-resolved value as a plain literal snapshot -- nothing visually
	// changes at the instant of unlock, only its future liveness. Falls back to clearAxisArg only
	// when there's nothing to freeze (a dangling/cyclic source resolved to unset).
	async function unlockAxis(axisId: string) {
		const viewId = editorActivity.activeViewId;
		const kitId = editorActivity.activeKitId;
		if (!viewId || !kitId || !isLocked(axisId)) return;
		const resolved = axisArgs[axisId];
		if (resolved) await api.setAxisArg(viewId, kitId, axisId, resolved);
		else await api.clearAxisArg(viewId, kitId, axisId);
	}
	// Axes in the project not yet consumed by the active kit -- offered in the add-axis context menu.
	let unusedAxes = $state<{ axisId: string; axisName: string | null }[]>([]);
	// Axis ids consumed by some OTHER kit -- those can only be removed from this kit, not hard-deleted.
	let sharedAxisIds = $state<Set<string>>(new Set());
	// Bumped after consuming an axis so the kit/view-keyed loadAxes effect re-runs and both the
	// panel body (consumedAxes) and this menu (unusedAxes) refresh without a kit/view change.
	let refreshTrigger = $state(0);

	// Axis/value ids currently forced into Renameable's edit mode -- set true to open, the
	// component's onCommit sets it back to false. Mirrors Views.svelte's viewEditing pattern.
	let axisEditing: Record<string, boolean> = $state({});
	let valueEditing: Record<string, boolean> = $state({});

	// The axis-id set of the layer dot currently hovered anywhere in the panel (null = none).
	// Every axis whose id is in this set gets tinted in the layer's key-set color, so a multi-axis
	// layer's dot visibly lights up all the axes it spans at once.
	let hoveredLayerKeys = $state<string[] | null>(null);

	// Create-layer mode: while active, clicking an axis value builds a pending condition set
	// (one value per axis) instead of selecting the current arg. Enter commits it into a new layer,
	// Esc cancels. pendingConditions maps axisId -> axisValueId (so re-picking an axis replaces).
	let createMode = $state(false);
	let pendingConditions = $state<Record<string, string>>({});
	const pendingValueIds = $derived(new Set(Object.values(pendingConditions)));
	const pendingAxisIds = $derived(Object.keys(pendingConditions));
	// The color the new layer's dots will be -- previewed live on the picked values as you build it.
	const pendingColor = $derived(pendingAxisIds.length ? layerDotColor(pendingAxisIds, true) : null);

	function enterCreateMode() {
		pendingConditions = {};
		editingLayerId = null;
		createMode = true;
	}

	// Shares createMode's whole condition-builder UI/state with "new layer" -- editingLayerId is
	// what distinguishes the two at commit time (updateLayerAxisValues vs createLayerWithConditions).
	// Seeded from the layer currently behind the clicked dot so editing starts from its real,
	// current condition set rather than empty.
	let editingLayerId = $state<string | null>(null);

	function enterEditLayerMode(axisValueId: string, keys: string[]) {
		const resolved = resolveDotLayer(axisValueId, keys);
		if (!resolved) return;
		pendingConditions = Object.fromEntries(resolved.conds.map((c) => [c.axisId, c.axisValueId]));
		editingLayerId = resolved.layerId;
		createMode = true;
	}

	// True while build-a-condition-set mode is editing an EXISTING layer's conditions rather than
	// building a brand-new one -- distinguishes the shared createMode UI's commit target and copy.
	const editingExisting = $derived(editingLayerId !== null);

	function cancelCreateMode() {
		createMode = false;
		pendingConditions = {};
		editingLayerId = null;
	}

	function toggleCondition(axisId: string, axisValueId: string) {
		if (pendingConditions[axisId] === axisValueId) {
			const { [axisId]: _drop, ...rest } = pendingConditions;
			pendingConditions = rest;
		} else {
			pendingConditions = { ...pendingConditions, [axisId]: axisValueId };
		}
	}

	// Push the current selection so it reflects a combination, then let the live axisArgs query drive
	// the paint-target recompute. Used when a layer is created or a dot is picked up, so "what you're
	// painting on" starts aligned with what you just chose (and follows you if you re-pick after).
	async function applySelection(conds: { axisId: string; value: string | undefined }[]) {
		const viewId = editorActivity.activeViewId;
		const kitId = editorActivity.activeKitId;
		if (!viewId || !kitId) return;
		for (const c of conds) {
			if (c.value == null || isLocked(c.axisId)) continue;
			await api.setAxisArg(viewId, kitId, c.axisId, { type: 'literal', value: c.value });
		}
	}

	async function commitCreateLayer() {
		const kitId = editorActivity.activeKitId;
		const ids = Object.values(pendingConditions);
		const editingId = editingLayerId;
		if (!kitId || ids.length === 0) {
			cancelCreateMode();
			return;
		}
		const keys = Object.keys(pendingConditions);
		const conds = keys.map((axisId) => ({
			axisId,
			value: (axisValues[axisId] ?? []).find((v) => v.axisValueId === pendingConditions[axisId])?.value
				.value
		}));
		if (editingId) {
			await api.updateLayerAxisValues(editingId, ids);
			cancelCreateMode();
			// Reflect the edited combination in the selection so the row now visibly matches it, but
			// don't arm painting -- editing conditions isn't a "start painting here" gesture.
			await applySelection(conds);
			return;
		}
		await api.createLayerWithConditions(kitId, ids);
		cancelCreateMode();
		// The new dot appears via the live query. Reflect the combination in the selection, then paint
		// across its axes -- from here the specific layer follows the selection, not a frozen snapshot.
		await applySelection(conds);
		startPaint(keys);
	}

	// A dot is a key-set *group* (a value + an axis-set) that can cover more than one real layer
	// (dark+compact and dark+dense both sit in dark's {theme,density} dot); prefer the one matching
	// the current selection, else the first. Returns its condition values so we can align the
	// selection to it -- the paint target itself is then derived from the selection, never frozen.
	function resolveDotLayer(
		axisValueId: string,
		keys: string[]
	): { layerId: string; conds: { axisId: string; axisValueId: string; value: string }[] } | null {
		const kSorted = [...new Set(keys)].sort().join('|');
		const candidates = layerConditionsByLayer.filter(({ conds }) => {
			if (conds.length === 0) return false;
			const axisSet = [...new Set(conds.map((c) => c.axisId))].sort().join('|');
			return axisSet === kSorted && conds.some((c) => c.axisValueId === axisValueId);
		});
		if (candidates.length === 0) return null;
		const active = candidates.find(({ conds }) =>
			conds.every((c) => {
				const arg = axisArgs[c.axisId];
				return arg && matchesArg(c.value as any, arg as any);
			})
		);
		const chosen = active ?? candidates[0]!;
		const conds = chosen.conds.map((c) => ({
			axisId: c.axisId,
			axisValueId: c.axisValueId,
			value: (c.value as any)?.value
		}));
		return { layerId: chosen.layerId, conds };
	}

	function onPickLayer(axisValueId: string, keys: string[]) {
		const resolved = resolveDotLayer(axisValueId, keys);
		if (!resolved) return;
		applySelection(resolved.conds);
		startPaint(keys);
	}

	// Alt-click a dot deletes the whole layer it represents (cascade drops its entries + conditions).
	async function onDeleteLayer(axisValueId: string, keys: string[]) {
		const resolved = resolveDotLayer(axisValueId, keys);
		if (!resolved) return;
		await api.deleteLayer(resolved.layerId);
	}

	// Painting belongs to a specific kit/view context -- stop when either changes.
	$effect(() => {
		editorActivity.activeKitId;
		editorActivity.activeViewId;
		stopPaint();
	});

	// The live paint target: the pinned keyset with each axis resolved to its CURRENT selected value.
	// Recomputed whenever the selection or the keyset changes, so re-picking a value in Axes moves
	// what you paint onto -- and the Styles panel reads this straight off the pipette module.
	$effect(() => {
		const k = paintKeys();
		if (!k) {
			setPaintTarget(null);
			return;
		}
		const ids: string[] = [];
		const labels: string[] = [];
		let ready = true;
		for (const axisId of k) {
			const arg = axisArgs[axisId];
			const match = (axisValues[axisId] ?? []).find(
				(v) => arg?.type === 'literal' && v.value?.value === arg.value
			);
			if (!match) {
				ready = false;
				labels.push('-');
				continue;
			}
			ids.push(match.axisValueId);
			labels.push(match.value.value);
		}
		setPaintTarget({
			keys: k,
			color: layerDotColor(k, true),
			label: labels.join(' + '),
			axisValueIds: ids,
			ready
		});
	});

	const held = $derived(paintTarget());

	function onCreateModeKey(e: KeyboardEvent) {
		if (!createMode) return;
		if (e.key === 'Enter') {
			e.preventDefault();
			commitCreateLayer();
		} else if (matchKey(e, $keybinds['edit.cancel'])) {
			e.preventDefault();
			cancelCreateMode();
		}
	}

	async function addAxisToKit(axisId: string) {
		const kitId = editorActivity.activeKitId;
		if (!kitId) return;
		await api.consumeAxis(kitId, axisId);
		refreshTrigger++;
	}

	// Create a brand-new axis of `kind` in the project and consume it into the active kit so it shows
	// up immediately, seeded with the kind's default value(s) (see axisKinds.ts) so it's usable on
	// sight instead of an empty shell -- then drop it straight into rename-edit mode, matching this
	// codebase's "create with a sane default, then edit inline" convention used everywhere else.
	async function createNewAxis(kind: AxisKindId) {
		const projectId = editorActivity.activeProjectId;
		const kitId = editorActivity.activeKitId;
		if (!projectId || !kitId) return;
		const seedValues = AXIS_KINDS[kind].createSeedValues();
		const result = await api.createAxisWithValues(projectId, 'New Axis', kind, seedValues);
		if (!result) return;
		await api.consumeAxis(kitId, result.axis.id);
		refreshTrigger++;
		axisEditing[result.axis.id] = true;
	}

	// --- Axis value CRUD/reorder, delegated down from Axis.svelte's callback props ---

	async function onRenameAxis(axisId: string, name: string) {
		await api.renameAxis(axisId, name);
		axisEditing[axisId] = false;
		refreshTrigger++;
	}

	async function onValueAdd(axisId: string) {
		const kind = inferKind(axisValues[axisId] ?? []);
		const descriptor = kind === 'categorical' ? AXIS_KINDS.categorical : null;
		if (!descriptor) return;
		const created = await api.createAxisValue(axisId, descriptor.createDefaultValue(axisValues[axisId] ?? []));
		refreshTrigger++;
		if (created) valueEditing[created.id] = true;
	}

	async function onValueRename(axisId: string, axisValueId: string, text: string) {
		const values = axisValues[axisId] ?? [];
		const prev = values.find((v) => v.axisValueId === axisValueId)?.value;
		if (!prev) return;
		const kind = inferKind(values);
		const descriptor = kind === 'categorical' ? AXIS_KINDS.categorical : null;
		if (!descriptor) return;
		await api.updateAxisValue(axisValueId, descriptor.parseLabel(text, prev));
		valueEditing[axisValueId] = false;
		refreshTrigger++;
	}

	// Warns before deleting a value that's still referenced by a layer condition (layer_axis_values
	// -> axis_values is ON DELETE restrict) -- deleteAxisValueSafe would silently clear those
	// conditions otherwise, and the user should know that's about to happen.
	async function onValueDelete(axisValueId: string) {
		const usage = await api.getAxisValueUsage(axisValueId);
		if (usage > 0) {
			const noun = usage === 1 ? 'layer' : 'layers';
			const ok = confirm(`Used by ${usage} ${noun} -- deleting will remove those conditions.`);
			if (!ok) return;
		}
		await api.deleteAxisValueSafe(axisValueId);
		refreshTrigger++;
	}

	async function onValueReorder(
		axisId: string,
		draggedValueId: string,
		targetValueId: string,
		edge: 'before' | 'after' = 'before'
	) {
		if (draggedValueId === targetValueId) return;
		const ids = (axisValues[axisId] ?? []).map((v) => v.axisValueId);
		const from = ids.indexOf(draggedValueId);
		if (from < 0) return;
		ids.splice(from, 1);

		const ti = ids.indexOf(targetValueId);
		if (ti < 0) return;
		ids.splice(edge === 'after' ? ti + 1 : ti, 0, draggedValueId);

		await api.setAxisValuesOrder(axisId, ids);
		axisValues[axisId] = await api.getAxisValuesByAxisId(axisId).execute();
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

	// Toggles whether WebCodium's (or any future export plugin's) Kit-basis export collapses this
	// axis to a single base rule for the active kit, instead of emitting a variant per value.
	// Scoped to (kit, axis) -- see AxesConsumedTable.excluded_from_export.
	async function toggleAxisExcludedFromExport(axisId: string, currentlyExcluded: boolean) {
		const kitId = editorActivity.activeKitId;
		if (!kitId) return;
		await api.setAxisExcludedFromExport(kitId, axisId, !currentlyExcluded);
		refreshTrigger++;
	}

	// Toggles this axis's static/dynamic export classification -- static values become BEM
	// modifier classes, dynamic values become real pseudo-class/state selectors. Global to the
	// axis (not per-kit), see AxisTable.variant_kind.
	async function toggleAxisVariantKind(axisId: string, current: 'static' | 'dynamic') {
		await api.setAxisVariantKind(axisId, current === 'dynamic' ? 'static' : 'dynamic');
		refreshTrigger++;
	}

	// Hard-delete the axis project-wide (cascade). Only offered by the row menu when the axis isn't
	// used by another kit (see sharedAxisIds), so this never destroys another kit's work.
	async function deleteAxisHard(axisId: string) {
		if (sharedAxisIds.has(axisId)) return; // guard: never hard-delete a shared axis
		await api.deleteAxisCascade(axisId);
		refreshTrigger++;
	}

	// Live (a real PGlite live query), kit-scoped -- backs the combo-dot indicators. Used to be a
	// one-shot fetch refetched only on kit/view switch or an explicit refreshTrigger bump, so a
	// layer created from somewhere that doesn't know about this component's own refreshTrigger
	// (in particular, the Render panel's pipette write path) never showed up here: the dot for a
	// freshly painted layer silently never appeared. See getLayerConditionsByKitId.
	const layerConditionsQuery = liveQuery((api, activity) => api.getLayerConditionsByKitId(activity.activeKitId));

	const layerConditionsByLayer = $derived.by(() => {
		const grouped = new Map<string, { axisId: string; axisValueId: string; value: any }[]>();
		for (const c of layerConditionsQuery.rows) {
			if (!grouped.has(c.layerId)) grouped.set(c.layerId, []);
			grouped.get(c.layerId)!.push({ axisId: c.axisId, axisValueId: c.axisValueId, value: c.value });
		}
		return [...grouped.entries()].map(([layerId, conds]) => ({ layerId, conds }));
	});

	$effect(() => {
		const currentKitId = editorActivity.activeKitId;
		const currentViewId = editorActivity.activeViewId;
		refreshTrigger; // dependency: re-run loadAxes after consuming an axis

		if (!currentKitId || !editorReady) {
			consumedAxes = [];
			axisValues = {};
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

	// Recomputes whenever axis args change (not just when the kit/view changes) - this is what
	// keeps the "active" flag on each layer-combo dot in sync with the currently selected values.
	//
	// One entry per DISTINCT key-set a value belongs to (not one per literal Layer). Two different
	// Layers can share the exact same axis-set - e.g. theme:dark;density:compact and
	// theme:light;density:compact are both {theme,density} - and since axis values within one
	// axis are mutually exclusive, at most one of them can ever be active at once. They're also
	// visually identical (same hue, same shape), so showing both as separate dots is pure clutter,
	// not information. Grouped by key-set; a group is active if ANY Layer in it currently matches.
	//
	// Includes single-axis Layers (conditioned solely on this value, nothing else) - unlike the
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

	// Handle arg changes from Axis component. A null arg means deselect -- clear the stored selection
	// so the axis reads as unset (re-clicking the active value toggles it off, see Axis.svelte).
	async function handleArgChange(axisId: string, arg: AxisArgValue | null) {
		if (!editorActivity.activeViewId || !editorActivity.activeKitId) return;
		// The Axis component already disables interaction on a locked axis (see the `locked` prop
		// passed to it below) -- this is a defensive guard against any other future caller.
		if (isLocked(axisId)) return;

		if (arg === null) {
			await api.clearAxisArg(editorActivity.activeViewId, editorActivity.activeKitId, axisId);
		} else {
			await api.setAxisArg(editorActivity.activeViewId, editorActivity.activeKitId, axisId, arg);
		}
	}
</script>

<svelte:window onkeydown={onCreateModeKey} />

<Panel contextMenuContent={addAxisContextMenu} name="Axes" tooltip="Adjust the axes set">
	{#snippet content()}
		{#if createMode}
			<div class="create-layer-bar" style={pendingColor ? `--pending: ${pendingColor}` : undefined}>
				<span class="create-layer-bar__dot"></span>
				<span class="create-layer-bar__text">
					{#if pendingAxisIds.length === 0}
						{editingExisting ? 'Pick this layer’s new condition set…' : 'Pick axis values for the new layer…'}
					{:else}
						{pendingAxisIds.length} axis{pendingAxisIds.length === 1 ? '' : 'es'} · press Enter to {editingExisting
							? 'save'
							: 'create'}
					{/if}
				</span>
				<button
					class="create-layer-bar__btn"
					onclick={() => commitCreateLayer()}
					disabled={pendingAxisIds.length === 0}>{editingExisting ? 'Save' : 'Create'}</button
				>
				<button class="create-layer-bar__btn create-layer-bar__btn--ghost" onclick={() => cancelCreateMode()}>Cancel</button>
			</div>
		{/if}
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
					locked={isLocked(axisData.axisId)}
					lockedSourceLabel={lockedSourceLabel(axisData.axisId)}
					onUnlock={() => unlockAxis(axisData.axisId)}
				onRemove={() => removeAxisFromKit(axisData.axisId)}
				deletable={!sharedAxisIds.has(axisData.axisId)}
				onDelete={() => deleteAxisHard(axisData.axisId)}
				excludedFromExport={axisData.excludedFromExport === true}
				onToggleExcludedFromExport={() =>
					toggleAxisExcludedFromExport(axisData.axisId, axisData.excludedFromExport === true)}
				variantKind={axisData.variantKind ?? 'static'}
				onToggleVariantKind={() =>
					toggleAxisVariantKind(axisData.axisId, axisData.variantKind ?? 'static')}
				autoEdit={axisEditing[axisData.axisId] === true}
				onRename={(name) => onRenameAxis(axisData.axisId, name)}
				{valueEditing}
				onValueAdd={() => onValueAdd(axisData.axisId)}
				onValueRename={(axisValueId, text) => onValueRename(axisData.axisId, axisValueId, text)}
				onValueDelete={(axisValueId) => onValueDelete(axisValueId)}
				onValueReorder={(draggedId, targetId, edge) =>
					onValueReorder(axisData.axisId, draggedId, targetId, edge)}
				onLayerHover={(keys) => (hoveredLayerKeys = keys)}
				highlightColor={hoveredLayerKeys?.includes(axisData.axisId)
					? layerDotColor(hoveredLayerKeys, true)
					: held?.keys.includes(axisData.axisId)
						? held.color
						: null}
				{createMode}
				{pendingValueIds}
				{pendingColor}
				onToggleCondition={toggleCondition}
				onPickLayer={(axisValueId, keys) => onPickLayer(axisValueId, keys)}
				onDeleteLayer={(axisValueId, keys) => onDeleteLayer(axisValueId, keys)}
				onEditLayerConditions={(axisValueId, keys) => enterEditLayerMode(axisValueId, keys)}
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

	.create-layer-bar {
		display: flex;
		align-items: center;
		gap: $x-space-xs;
		padding: $x-space-xs $x-space-sm;
		margin-bottom: $x-space-xs;
		font-size: $x-font-size-sm;
		background: color-mix(in oklch, var(--pending, var(--color-primary)) 12%, var(--color-surface-alt));
		border-left: 3px solid var(--pending, var(--color-primary));
		border-radius: calc($x-space-xs / 2);

		&__dot {
			width: 0.7em;
			height: 0.7em;
			flex-shrink: 0;
			border-radius: 50%;
			background: var(--pending, var(--color-text-muted));
		}

		&__text {
			flex-grow: 1;
			color: var(--color-pure-alt);
		}

		&__btn {
			flex-shrink: 0;
			border: none;
			border-radius: calc($x-space-xs / 2);
			padding: calc($x-space-xs / 2) $x-space-sm;
			font-size: $x-font-size-xs;
			font-weight: 700;
			cursor: pointer;
			background: var(--color-primary);
			color: var(--color-on-primary, oklch(100% 0 0));

			&:disabled {
				opacity: 0.4;
				cursor: default;
			}

			&--ghost {
				background: transparent;
				color: var(--color-text-muted);
			}
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

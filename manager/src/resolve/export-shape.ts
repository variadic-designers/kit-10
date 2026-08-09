import type { ArgValue, AxisValueType, SchemaDialect, TokenValue } from '../schema.js';
import { resolveAllLinkedArgs } from './resolve.js';

// Unresolved, axis-args-independent per-Kit export shape for WebCodium's Kit-basis export
// (resources/webcodium-export-plan.md, Phase 3). This is deliberately NOT part of the hot
// live-query resolve path (resolve.ts's RESOLUTION_RELEVANT_TABLES) -- it's an on-demand fetch a
// plugin calls once per export, the same "slow path" posture as resolveManySlowPath. It reuses
// the same conditions/entries query shape resolve.ts's fetchLayerData already runs, but skips
// matchLayers's collapse-to-winner step entirely: a plugin doing Kit-basis export needs every
// layer's full condition set, not just the one that wins for some particular view's current
// axis_args.

export interface ExportAxisValue {
	axisValueId: string;
	value: AxisValueType;
	priorityIndex: number;
}

export interface AxisExportMeta {
	axisId: string;
	axisName: string | null;
	// 'categorical' today -- range/number axis kinds are disabled stubs project-wide
	// (resources/layer-authoring.md), so this plumbing doesn't special-case them.
	kind: string | null;
	variantKind: 'static' | 'dynamic';
	excludedFromExport: boolean;
	defaultValue: ArgValue | null;
	priorityIndex: number;
	// Ordered by priority_index ascending, same order as getAxisValuesByAxisId.
	values: ExportAxisValue[];
}

export interface ExportLayerCondition {
	axisId: string;
	axisValueId: string;
	value: AxisValueType;
}

export interface ExportLayerEntry {
	property: string;
	literalValue: string | null;
	tokenId: string | null;
	tokenAlias: string | null;
	tokenValue: TokenValue | null;
}

export interface ExportLayer {
	layerId: string;
	conditions: ExportLayerCondition[];
	entries: ExportLayerEntry[];
}

export interface KitExportShape {
	kitId: string;
	kitName: string;
	axes: AxisExportMeta[];
	layers: ExportLayer[];
}

// One view's own resolved axis selection for one composed kit -- the axis_args a designer actually
// set on this particular view instance, as opposed to KitExportShape's axis-args-INDEPENDENT
// layer/condition data above. WebCodium needs both: KitExportShape to know what CSS rules exist
// per Kit, this to know which of those rules a given exported node instance's own view should
// actually carry as classes (see plugins/webcodium/src/variants.rs's rule_matches_args).
export interface ViewAxisArgRow {
	viewId: string;
	kitId: string;
	axisId: string;
	value: ArgValue;
}

// Flat rows, not pre-nested into a Map -- mirrors this file's own conditionRows/entryRows
// convention (let the Rust side reassemble whatever shape it needs) rather than picking a nesting
// order here that may not match every caller.
//
// A view's own axis_args cell can be 'linked' (drag-to-lock -- see schema.ts's ArgLinked doc
// comment), which re-reads another (view, kit)'s own axis pick live rather than storing a literal.
// That link target can be ANY view in the project, not just one of the requested `viewIds` (e.g. a
// nav view links its theme axis to a page-level source view that isn't itself being exported), so
// this can't resolve 'linked' with a query scoped to `viewIds` alone -- it needs the resolver to
// see the whole project's axis_args/compositions, exactly the same "project-wide fetch, then
// resolveAllLinkedArgs" shape resolveOne's slow path already uses (see resolve.ts, the axisArgsRows/
// projectCompositionsRows fetch). Returned rows are filtered back down to just the requested
// `viewIds` and are always already resolved -- a 'linked' value is never returned here, only
// whatever it ultimately resolves to (or the row is simply absent if the chain terminates unset).
export async function fetchViewAxisArgs(
	db: SchemaDialect,
	viewIds: string[]
): Promise<ViewAxisArgRow[]> {
	if (viewIds.length === 0) return [];

	const requestedViews = await db
		.selectFrom('views')
		.where('views.id', 'in', viewIds)
		.select(['views.id', 'views.project_id'])
		.execute();
	const projectIds = [...new Set(requestedViews.map((v) => v.project_id))];
	if (projectIds.length === 0) return [];

	const [axisArgsRows, compositionRows] = await Promise.all([
		db
			.selectFrom('axis_args')
			.innerJoin('views', 'views.id', 'axis_args.view_id')
			.where('views.project_id', 'in', projectIds)
			.select(['axis_args.view_id', 'axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
			.execute(),
		db
			.selectFrom('compositions')
			.innerJoin('views', 'views.id', 'compositions.view_id')
			.where('views.project_id', 'in', projectIds)
			.select(['compositions.view_id', 'compositions.kit_id'])
			.execute()
	]);

	const argsByViewKit = new Map<string, Record<string, ArgValue>>();
	for (const row of axisArgsRows) {
		if (!row.value) continue;
		const key = `${row.view_id}::${row.kit_id}`;
		if (!argsByViewKit.has(key)) argsByViewKit.set(key, {});
		argsByViewKit.get(key)![row.axis_id] = row.value as unknown as ArgValue;
	}
	const validCompositions = new Set(compositionRows.map((c) => `${c.view_id}::${c.kit_id}`));
	const resolvedArgsByViewKit = resolveAllLinkedArgs(argsByViewKit, validCompositions);

	const requestedViewIds = new Set(viewIds);
	const result: ViewAxisArgRow[] = [];
	for (const [key, resolved] of resolvedArgsByViewKit) {
		const [viewId, kitId] = key.split('::') as [string, string];
		if (!requestedViewIds.has(viewId)) continue;
		for (const [axisId, value] of Object.entries(resolved)) {
			result.push({ viewId, kitId, axisId, value });
		}
	}
	return result;
}

// One row per (view, kit) actually composed, in composition-priority order -- the piece of data
// WebCodium's Kit-basis export needs to know a view composes MORE than one kit at all, and in
// what order, which neither KitExportShape (per-kit, no view/composition awareness) nor
// ViewAxisArgRow (per-axis-arg, no ordering) can answer. Backs multi-kit class emission and
// cross-kit contested-property disambiguation (resources/webcodium-export-plan.md).
export interface ViewCompositionRow {
	viewId: string;
	kitId: string;
	priorityIndex: number;
}

export async function fetchViewCompositions(
	db: SchemaDialect,
	viewIds: string[]
): Promise<ViewCompositionRow[]> {
	if (viewIds.length === 0) return [];

	const rows = await db
		.selectFrom('compositions')
		.where('compositions.view_id', 'in', viewIds)
		.orderBy('compositions.priority_index', 'asc')
		.select(['compositions.view_id', 'compositions.kit_id', 'compositions.priority_index'])
		.execute();

	return rows.map((r) => ({
		viewId: r.view_id,
		kitId: r.kit_id,
		priorityIndex: r.priority_index
	}));
}

export async function fetchKitExportShapes(
	db: SchemaDialect,
	kitIds: string[]
): Promise<Map<string, KitExportShape>> {
	const result = new Map<string, KitExportShape>();
	if (kitIds.length === 0) return result;

	const [kits, axesConsumedRows, layers] = await Promise.all([
		db.selectFrom('kits').where('kits.id', 'in', kitIds).select(['kits.id', 'kits.name']).execute(),
		db
			.selectFrom('axes_consumed')
			.innerJoin('axes', 'axes.id', 'axes_consumed.axis_id')
			.where('axes_consumed.kit_id', 'in', kitIds)
			.select([
				'axes_consumed.kit_id',
				'axes.id as axis_id',
				'axes.name as axis_name',
				'axes.kind as axis_kind',
				'axes.variant_kind as variant_kind',
				'axes.default_value as default_value',
				'axes_consumed.priority_index as priority_index',
				'axes_consumed.excluded_from_export as excluded_from_export'
			])
			.execute(),
		db
			.selectFrom('layers')
			.where('layers.kit_id', 'in', kitIds)
			.select(['layers.id', 'layers.kit_id'])
			.execute()
	]);

	for (const kit of kits) {
		result.set(kit.id, { kitId: kit.id, kitName: kit.name, axes: [], layers: [] });
	}

	const axisIds = [...new Set(axesConsumedRows.map((r) => r.axis_id))];
	const layerIds = layers.map((l) => l.id);

	const [axisValueRows, conditionRows, entryRows] = await Promise.all([
		axisIds.length === 0
			? Promise.resolve([])
			: db
					.selectFrom('axis_values')
					.where('axis_values.axis_id', 'in', axisIds)
					.orderBy('axis_values.priority_index', 'asc')
					.select(['axis_values.id', 'axis_values.axis_id', 'axis_values.value', 'axis_values.priority_index'])
					.execute(),
		layerIds.length === 0
			? Promise.resolve([])
			: db
					.selectFrom('layers')
					.where('layers.id', 'in', layerIds)
					.innerJoin('layer_axis_values', 'layer_axis_values.layer_id', 'layers.id')
					.innerJoin('axis_values', 'axis_values.id', 'layer_axis_values.axis_value_id')
					.select([
						'layer_axis_values.layer_id',
						'axis_values.id as axis_value_id',
						'axis_values.value',
						'axis_values.axis_id'
					])
					.execute(),
		layerIds.length === 0
			? Promise.resolve([])
			: db
					.selectFrom('render_entries')
					.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
					.innerJoin('layers', 'layers.id', 'render_snippets.layer_id')
					.leftJoin('tokens', 'tokens.id', 'render_entries.token_id')
					.where('layers.id', 'in', layerIds)
					.select([
						'layers.id as layer_id',
						'render_entries.property',
						'render_entries.value as literal_value',
						'render_entries.token_id',
						'tokens.alias as token_alias',
						'tokens.value as token_value'
					])
					.execute()
	]);

	const valuesByAxis = new Map<string, ExportAxisValue[]>();
	for (const v of axisValueRows) {
		if (!v.value) continue;
		const list = valuesByAxis.get(v.axis_id) ?? [];
		list.push({
			axisValueId: v.id,
			value: v.value as unknown as AxisValueType,
			priorityIndex: v.priority_index
		});
		valuesByAxis.set(v.axis_id, list);
	}

	for (const row of axesConsumedRows) {
		const shape = result.get(row.kit_id);
		if (!shape) continue;
		shape.axes.push({
			axisId: row.axis_id,
			axisName: row.axis_name,
			kind: row.axis_kind,
			variantKind: row.variant_kind,
			excludedFromExport: row.excluded_from_export,
			defaultValue: (row.default_value as unknown as ArgValue) ?? null,
			priorityIndex: row.priority_index,
			values: valuesByAxis.get(row.axis_id) ?? []
		});
	}

	const layerKitMap = new Map<string, string>(layers.map((l) => [l.id, l.kit_id]));
	const layerDataMap = new Map<string, ExportLayer>();
	for (const layer of layers) {
		layerDataMap.set(layer.id, { layerId: layer.id, conditions: [], entries: [] });
	}

	for (const c of conditionRows) {
		const data = layerDataMap.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValueId: c.axis_value_id,
				value: c.value as unknown as AxisValueType
			});
		}
	}

	for (const e of entryRows) {
		const data = layerDataMap.get(e.layer_id);
		if (data) {
			data.entries.push({
				property: e.property,
				literalValue: e.literal_value,
				tokenId: e.token_id,
				tokenAlias: e.token_alias,
				tokenValue: e.token_value
			});
		}
	}

	for (const [layerId, data] of layerDataMap) {
		const kitId = layerKitMap.get(layerId);
		const shape = kitId ? result.get(kitId) : undefined;
		if (shape) shape.layers.push(data);
	}

	return result;
}

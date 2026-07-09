import type { SchemaDialect, TokenValue } from '../schema.js';
import type { ArgValue } from '../schema.js';

export interface ResolvedKit {
	kitId: string;
	kitName: string;
	properties: Map<string, ResolvedProperty>;
	childViewIds: string[];
}

type AxisValueType =
	| { type: 'literal'; value: string }
	| { type: 'range'; operator: '>=' | '<=' | '>' | '<' | 'between'; threshold: number; threshold_high?: number }
	| { type: 'discrete'; value: string };

export interface ResolvedProperty {
	property: string;
	value: string;
	sourceLayerId: string;
	kitId: string;
	isToken: boolean;
	tokenAlias: string | null;
	// The render entry's own token row id (not the alias-override winner from pass 2) -- lets the
	// UI update a token-backed property's value in place (e.g. ChildViewField writing to its
	// per-view `children` token) without a separate lookup-by-alias round trip.
	tokenId: string | null;
	conditionCount: number;
	// Axis-id set the winning Layer conditions on — lets the UI color a property by which axes
	// combine to produce it (e.g. theme+state vs theme+density), not just how many conditions.
	keys: string[];
	// Same conditions as `keys`, but with the actual matched value per axis (e.g. theme: "dark"),
	// for display — "Theme + Density" tells you which axes combine, this tells you which value.
	conditionValues: { axisId: string; value: string }[];
	childViewIds: string[] | null;
}

function formatAxisValue(v: AxisValueType): string {
	switch (v.type) {
		case 'literal':
		case 'discrete':
			return v.value;
		case 'range':
			return v.operator === 'between'
				? `${v.threshold}–${v.threshold_high ?? v.threshold}`
				: `${v.operator} ${v.threshold}`;
	}
}

interface LayerCondition {
	axisId: string;
	axisValue: AxisValueType;
	priorityIndex: number;
}

interface LayerEntry {
	property: string;
	literalValue: string | null;
	tokenId: string | null;
	tokenAlias: string | null;
	tokenValue: TokenValue | null;
}

interface LayerData {
	id: string;
	conditions: LayerCondition[];
	entries: LayerEntry[];
}

export function matchesArg(condition: AxisValueType, arg: ArgValue): boolean {
	switch (condition.type) {
		case 'literal':
			return arg.type === 'literal' && arg.value === condition.value;
		case 'discrete':
			return arg.type === 'literal' && arg.value === condition.value;
		case 'range': {
			const condLo = condition.operator === '>' ? condition.threshold : condition.threshold;
			const condHi = condition.operator === 'between'
				? (condition.threshold_high ?? condition.threshold)
				: condition.operator === '>=' || condition.operator === '>'
					? Infinity
					: condition.threshold;
			const condOpenLo = condition.operator === '>' || condition.operator === '<';
			const condOpenHi = condition.operator === '<' || condition.operator === '>';

			let argLo: number;
			let argHi: number;
			let argOpenLo = false;
			let argOpenHi = false;

			if (arg.type === 'literal') {
				const num = parseFloat(arg.value);
				if (isNaN(num)) return false;
				argLo = num;
				argHi = num;
			} else {
				if (arg.min === null && arg.max === null) return true;
				argLo = arg.min ?? -Infinity;
				argHi = arg.max ?? Infinity;
				argOpenLo = arg.min === null;
				argOpenHi = arg.max === null;
			}

			const lo = Math.max(argLo, condLo);
			const hi = Math.min(argHi, condHi);

			if (lo > hi) return false;
			if (lo === hi) {
				const loClosed = !argOpenLo && !condOpenLo;
				const hiClosed = !argOpenHi && !condOpenHi;
				return loClosed || hiClosed;
			}
			return true;
		}
	}
}

function tryParseChildViewIds(value: string): string[] | null {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) return parsed;
	} catch {
		// not a valid JSON array
	}
	return null;
}

function computeSpecificity(conditions: LayerCondition[]): number[] {
	const count = conditions.length;
	const priorities = conditions.map((c) => c.priorityIndex).sort((a, b) => b - a);
	return [count, ...priorities];
}

function compareSpecificity(a: number[], b: number[]): number {
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		if (ai !== bi) return ai - bi;
	}
	return 0;
}

// Pure in-memory matching: given a populated LayerData map and axis args, returns resolved properties.
function matchLayers(
	kitId: string,
	layerDataMap: Map<string, LayerData>,
	axisArgs: Record<string, ArgValue>,
): Map<string, ResolvedProperty> {
	const matchingLayers: { data: LayerData; specificity: number[] }[] = [];
	for (const [, data] of layerDataMap) {
		const allMatch = data.conditions.every((c) => {
			const arg = axisArgs[c.axisId];
			if (!arg) return false;
			return matchesArg(c.axisValue, arg);
		});

		if (allMatch) {
			const specificity = computeSpecificity(data.conditions);
			matchingLayers.push({ data, specificity });
		}
	}

	matchingLayers.sort((a, b) => compareSpecificity(a.specificity, b.specificity));

	const result = new Map<string, ResolvedProperty>();
	for (const { data } of matchingLayers) {
		for (const entry of data.entries) {
			const resolvedValue = entry.tokenId
				? (entry.tokenValue?.type === 'scalar' ? entry.tokenValue.value
					: entry.tokenValue?.type === 'view' ? entry.tokenValue.view_id
					: '')
				: (entry.literalValue ?? '');
			result.set(entry.property, {
				property: entry.property,
				value: resolvedValue,
				sourceLayerId: data.id,
				kitId,
				isToken: !!entry.tokenId,
				tokenAlias: entry.tokenAlias,
				tokenId: entry.tokenId ?? null,
				conditionCount: data.conditions.length,
				keys: data.conditions.map((c) => c.axisId),
				conditionValues: data.conditions.map((c) => ({
					axisId: c.axisId,
					value: formatAxisValue(c.axisValue),
				})),
				childViewIds: entry.property === 'children' ? tryParseChildViewIds(resolvedValue) : null,
			});
		}
	}

	return result;
}

// Fetch conditions and entries for a set of layer IDs in parallel.
async function fetchLayerData(db: SchemaDialect, layerIds: string[]) {
	return Promise.all([
		db
			.selectFrom('layers')
			.where('layers.id', 'in', layerIds)
			.innerJoin('layer_axis_values', 'layer_axis_values.layer_id', 'layers.id')
			.innerJoin('axis_values', 'axis_values.id', 'layer_axis_values.axis_value_id')
			.innerJoin('axes_consumed', (join) =>
				join
					.onRef('axes_consumed.axis_id', '=', 'axis_values.axis_id')
					.onRef('axes_consumed.kit_id', '=', 'layers.kit_id'),
			)
			.select([
				'layer_axis_values.layer_id',
				'axis_values.value',
				'axis_values.axis_id',
				'axes_consumed.priority_index',
			])
			.execute(),

		db
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
				'tokens.value as token_value',
			])
			.execute(),
	]);
}

export async function resolve(
	db: SchemaDialect,
	kitId: string,
	axisArgs: Record<string, ArgValue>,
): Promise<Map<string, ResolvedProperty>> {
	const layers = await db
		.selectFrom('layers')
		.where('layers.kit_id', '=', kitId)
		.select(['layers.id'])
		.execute();

	const layerIds = layers.map((l) => l.id);
	if (layerIds.length === 0) return new Map();

	const [conditions, entries] = await fetchLayerData(db, layerIds);

	const layerDataMap = new Map<string, LayerData>();
	for (const layer of layers) {
		layerDataMap.set(layer.id, { id: layer.id, conditions: [], entries: [] });
	}

	for (const c of conditions) {
		const data = layerDataMap.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index,
			});
		}
	}

	for (const e of entries) {
		const data = layerDataMap.get(e.layer_id);
		if (data) {
			data.entries.push({
				property: e.property,
				literalValue: e.literal_value,
				tokenId: e.token_id,
				tokenAlias: e.token_alias,
				tokenValue: e.token_value,
			});
		}
	}

	return matchLayers(kitId, layerDataMap, axisArgs);
}

// Resolves all kits in one pass: 3 queries total instead of 3 per kit.
async function resolveAll(
	db: SchemaDialect,
	kitIds: string[],
	argsByKit: Map<string, Record<string, ArgValue>>,
): Promise<Map<string, Map<string, ResolvedProperty>>> {
	if (kitIds.length === 0) return new Map();

	const layers = await db
		.selectFrom('layers')
		.where('layers.kit_id', 'in', kitIds)
		.select(['layers.id', 'layers.kit_id'])
		.execute();

	if (layers.length === 0) {
		return new Map(kitIds.map((id) => [id, new Map()]));
	}

	const allLayerIds = layers.map((l) => l.id);
	const [conditions, entries] = await fetchLayerData(db, allLayerIds);

	const layerKitMap = new Map<string, string>(layers.map((l) => [l.id, l.kit_id]));
	const kitLayerDataMaps = new Map<string, Map<string, LayerData>>(
		kitIds.map((id) => [id, new Map()]),
	);

	for (const layer of layers) {
		kitLayerDataMaps.get(layer.kit_id)!.set(layer.id, { id: layer.id, conditions: [], entries: [] });
	}

	for (const c of conditions) {
		const kitId = layerKitMap.get(c.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index,
			});
		}
	}

	for (const e of entries) {
		const kitId = layerKitMap.get(e.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(e.layer_id);
		if (data) {
			data.entries.push({
				property: e.property,
				literalValue: e.literal_value,
				tokenId: e.token_id,
				tokenAlias: e.token_alias,
				tokenValue: e.token_value,
			});
		}
	}

	const results = new Map<string, Map<string, ResolvedProperty>>();
	for (const kitId of kitIds) {
		results.set(kitId, matchLayers(kitId, kitLayerDataMaps.get(kitId)!, argsByKit.get(kitId) ?? {}));
	}
	return results;
}

export interface ScopedTokenMaps {
	// alias -> scalar string value, narrowest scope (project -> kit -> view) wins.
	scalarMap: Map<string, string>;
	// alias -> list of view ids, same scope-precedence rule. Separate map rather than widening
	// scalarMap's value type -- keeps the existing scalar substitution path completely untouched,
	// and a property only ever wants one or the other (children wants view-list, everything else
	// wants scalar), never both.
	viewListMap: Map<string, string[]>;
}

async function gatherScopedTokens(
	db: SchemaDialect,
	projectId: string | undefined,
	// ordered by kit priority_index ASC — determines which kit wins alias conflicts
	kitIds: string[],
	viewId: string,
): Promise<ScopedTokenMaps> {
	const scalarMap = new Map<string, string>();
	const viewListMap = new Map<string, string[]>();

	if (!projectId) return { scalarMap, viewListMap };

	const [projectTokens, kitTokenRows, viewTokens] = await Promise.all([
		db
			.selectFrom('tokens')
			.where('tokens.project_id', '=', projectId)
			.where('tokens.kit_id', 'is', null)
			.where('tokens.view_id', 'is', null)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.alias', 'tokens.value'])
			.execute(),

		kitIds.length > 0
			? db
				.selectFrom('tokens')
				.where('tokens.kit_id', 'in', kitIds)
				.where('tokens.alias', 'is not', null)
				.select(['tokens.alias', 'tokens.value', 'tokens.kit_id'])
				.execute()
			: Promise.resolve([] as { alias: string | null; value: TokenValue | null; kit_id: string | null }[]),

		db
			.selectFrom('tokens')
			.where('tokens.view_id', '=', viewId)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.alias', 'tokens.value'])
			.execute(),
	]);

	const apply = (alias: string | null, value: TokenValue | null) => {
		if (!alias || !value) return;
		if (value.type === 'scalar') scalarMap.set(alias, value.value);
		else if (value.type === 'view-list') viewListMap.set(alias, value.view_ids);
	};

	for (const t of projectTokens) apply(t.alias, t.value);

	// Group kit tokens by kit_id, then apply in kitIds order so priority is preserved.
	const tokensByKit = new Map<string, typeof kitTokenRows>();
	for (const t of kitTokenRows) {
		if (!t.kit_id) continue;
		if (!tokensByKit.has(t.kit_id)) tokensByKit.set(t.kit_id, []);
		tokensByKit.get(t.kit_id)!.push(t);
	}
	for (const kitId of kitIds) {
		for (const t of tokensByKit.get(kitId) ?? []) apply(t.alias, t.value);
	}

	for (const t of viewTokens) apply(t.alias, t.value);

	return { scalarMap, viewListMap };
}

function substituteTokens(properties: Map<string, ResolvedProperty>, tokenMaps: ScopedTokenMaps): void {
	for (const [, resolved] of properties) {
		if (!resolved.isToken || !resolved.tokenAlias) continue;

		if (resolved.property === 'children') {
			const viewIds = tokenMaps.viewListMap.get(resolved.tokenAlias);
			if (viewIds !== undefined) resolved.childViewIds = viewIds;
			continue;
		}

		const scalarValue = tokenMaps.scalarMap.get(resolved.tokenAlias);
		if (scalarValue !== undefined) resolved.value = scalarValue;
	}
}

export async function resolveMany(
	db: SchemaDialect,
	viewId: string,
): Promise<ResolvedKit[]> {
	const compositions = await db
		.selectFrom('compositions')
		.innerJoin('kits', 'kits.id', 'compositions.kit_id')
		.where('compositions.view_id', '=', viewId)
		.orderBy('compositions.priority_index', 'asc')
		.select(['compositions.kit_id', 'compositions.priority_index', 'kits.name as kit_name', 'kits.project_id'])
		.execute();

	const allKitIds = compositions.map((c) => c.kit_id);
	const projectId = compositions[0]?.project_id;

	// axisArgs and token scopes are independent — fetch in parallel.
	const [axisArgsRows, tokenMap] = await Promise.all([
		db
			.selectFrom('axis_args')
			.where('axis_args.view_id', '=', viewId)
			.select(['axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
			.execute(),
		gatherScopedTokens(db, projectId, allKitIds, viewId),
	]);

	const argsByKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgsRows) {
		if (!arg.value) continue;
		if (!argsByKit.has(arg.kit_id)) argsByKit.set(arg.kit_id, {});
		argsByKit.get(arg.kit_id)![arg.axis_id] = arg.value as ArgValue;
	}

	const resolvedByKit = await resolveAll(db, allKitIds, argsByKit);

	const results: ResolvedKit[] = [];
	for (const comp of compositions) {
		const properties = resolvedByKit.get(comp.kit_id) ?? new Map();
		substituteTokens(properties, tokenMap);
		results.push({
			kitId: comp.kit_id,
			kitName: comp.kit_name,
			properties,
			childViewIds: properties.get('children')?.childViewIds ?? [],
		});
	}

	return results;
}

export function flattenKitResults(kits: ResolvedKit[]): Map<string, ResolvedProperty> {
	const merged = new Map<string, ResolvedProperty>();
	for (const kit of kits) {
		for (const [prop, resolved] of kit.properties) {
			merged.set(prop, resolved);
		}
	}
	return merged;
}

export interface ResolvedViewData {
	viewId: string;
	viewName: string;
	hints: Record<string, unknown> | null;
	resolvedKits: ResolvedKit[];
}

// Resolves all views for a project in 4 round-trips instead of ~8 per view.
// RT1: views. RT2: compositions + axis_args + project tokens + view tokens (parallel).
// RT3: kit tokens + layers (parallel). RT4: layer conditions + entries (parallel).
export async function resolveManyViews(
	db: SchemaDialect,
	projectId: string,
): Promise<ResolvedViewData[]> {
	const viewRows = await db
		.selectFrom('views')
		.selectAll()
		.where('views.project_id', '=', projectId)
		.execute();

	if (viewRows.length === 0) return [];
	const viewIds = viewRows.map((v) => v.id);

	const [compositions, axisArgsRows, projectTokens, viewTokenRows] = await Promise.all([
		db
			.selectFrom('compositions')
			.innerJoin('kits', 'kits.id', 'compositions.kit_id')
			.where('compositions.view_id', 'in', viewIds)
			.orderBy('compositions.priority_index', 'asc')
			.select([
				'compositions.view_id',
				'compositions.kit_id',
				'compositions.priority_index',
				'kits.name as kit_name',
			])
			.execute(),

		db
			.selectFrom('axis_args')
			.where('axis_args.view_id', 'in', viewIds)
			.select(['axis_args.view_id', 'axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
			.execute(),

		db
			.selectFrom('tokens')
			.where('tokens.project_id', '=', projectId)
			.where('tokens.kit_id', 'is', null)
			.where('tokens.view_id', 'is', null)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.alias', 'tokens.value'])
			.execute(),

		db
			.selectFrom('tokens')
			.where('tokens.view_id', 'in', viewIds)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.view_id', 'tokens.alias', 'tokens.value'])
			.execute(),
	]);

	const allKitIds = [...new Set(compositions.map((c) => c.kit_id))];

	if (allKitIds.length === 0) {
		return viewRows.map((v) => ({
			viewId: v.id,
			viewName: v.name,
			hints: ((v as any).hints ?? null) as Record<string, unknown> | null,
			resolvedKits: [],
		}));
	}

	const [kitTokenRows, layers] = await Promise.all([
		db
			.selectFrom('tokens')
			.where('tokens.kit_id', 'in', allKitIds)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.alias', 'tokens.value', 'tokens.kit_id'])
			.execute(),

		db
			.selectFrom('layers')
			.where('layers.kit_id', 'in', allKitIds)
			.select(['layers.id', 'layers.kit_id'])
			.execute(),
	]);

	const [conditions, entries] = layers.length > 0
		? await fetchLayerData(db, layers.map((l) => l.id))
		: [[], []];

	// Build per-kit LayerData maps
	const layerKitMap = new Map<string, string>(layers.map((l) => [l.id, l.kit_id]));
	const kitLayerDataMaps = new Map<string, Map<string, LayerData>>(
		allKitIds.map((id) => [id, new Map()]),
	);
	for (const layer of layers) {
		kitLayerDataMaps.get(layer.kit_id)!.set(layer.id, { id: layer.id, conditions: [], entries: [] });
	}
	for (const c of conditions) {
		const kitId = layerKitMap.get(c.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index,
			});
		}
	}
	for (const e of entries) {
		const kitId = layerKitMap.get(e.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(e.layer_id);
		if (data) {
			data.entries.push({
				property: e.property,
				literalValue: e.literal_value,
				tokenId: e.token_id,
				tokenAlias: e.token_alias,
				tokenValue: e.token_value,
			});
		}
	}

	// Build token maps
	const baseTokenMap = new Map<string, string>();
	const baseViewListMap = new Map<string, string[]>();
	for (const t of projectTokens) {
		if (!t.alias || !t.value) continue;
		if (t.value.type === 'scalar') baseTokenMap.set(t.alias, t.value.value);
		else if (t.value.type === 'view-list') baseViewListMap.set(t.alias, t.value.view_ids);
	}
	const tokensByKit = new Map<string, typeof kitTokenRows>();
	for (const t of kitTokenRows) {
		if (!t.kit_id) continue;
		if (!tokensByKit.has(t.kit_id)) tokensByKit.set(t.kit_id, []);
		tokensByKit.get(t.kit_id)!.push(t);
	}
	const tokensByView = new Map<string, typeof viewTokenRows>();
	for (const t of viewTokenRows) {
		if (!t.view_id) continue;
		if (!tokensByView.has(t.view_id)) tokensByView.set(t.view_id, []);
		tokensByView.get(t.view_id)!.push(t);
	}

	const compsByView = new Map<string, typeof compositions>();
	for (const c of compositions) {
		if (!compsByView.has(c.view_id)) compsByView.set(c.view_id, []);
		compsByView.get(c.view_id)!.push(c);
	}

	const argsByViewKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgsRows) {
		if (!arg.value) continue;
		const key = `${arg.view_id}::${arg.kit_id}`;
		if (!argsByViewKit.has(key)) argsByViewKit.set(key, {});
		argsByViewKit.get(key)![arg.axis_id] = arg.value as ArgValue;
	}

	return viewRows.map((v) => {
		const comps = compsByView.get(v.id) ?? [];

		// Token resolution order: project → kit (in composition order) → view
		const tokenMap = new Map(baseTokenMap);
		const viewListTokenMap = new Map(baseViewListMap);
		for (const comp of comps) {
			for (const t of tokensByKit.get(comp.kit_id) ?? []) {
				if (!t.alias || !t.value) continue;
				if (t.value.type === 'scalar') tokenMap.set(t.alias, t.value.value);
				else if (t.value.type === 'view-list') viewListTokenMap.set(t.alias, t.value.view_ids);
			}
		}
		for (const t of tokensByView.get(v.id) ?? []) {
			if (!t.alias || !t.value) continue;
			if (t.value.type === 'scalar') tokenMap.set(t.alias, t.value.value);
			else if (t.value.type === 'view-list') viewListTokenMap.set(t.alias, t.value.view_ids);
		}

		const resolvedKits: ResolvedKit[] = comps.map((comp) => {
			const args = argsByViewKit.get(`${v.id}::${comp.kit_id}`) ?? {};
			const properties = matchLayers(
				comp.kit_id,
				kitLayerDataMaps.get(comp.kit_id) ?? new Map(),
				args,
			);
			substituteTokens(properties, { scalarMap: tokenMap, viewListMap: viewListTokenMap });
			return {
				kitId: comp.kit_id,
				kitName: comp.kit_name,
				properties,
				childViewIds: properties.get('children')?.childViewIds ?? [],
			};
		});

		return {
			viewId: v.id,
			viewName: v.name,
			hints: ((v as any).hints ?? null) as Record<string, unknown> | null,
			resolvedKits,
		};
	});
}

import type { SchemaDialect, TokenValue } from '../schema.js';
import type { ArgValue } from '../schema.js';
import { sql } from 'kysely';
import { mark, measure } from './profile.js';

// The complete set of tables `resolveManyViews` (and `resolve`/`resolveAll`) reads from.
// The editor's live-query JOIN must cover every table here so a write to any of them
// fires the re-resolve callback. Exported so a test can assert the JOIN's table set
// equals this list -- turning "coverage by convention" into "coverage by assertion".
// `tokens` is listed once but covers project/kit/view scopes (all token rows carry
// project_id, so a single join on project_id sees every scope).
export const RESOLUTION_RELEVANT_TABLES = [
	'views',
	'compositions',
	'kits',
	'axis_args',
	'tokens',
	'layers',
	'layer_axis_values',
	'axis_values',
	'axes_consumed',
	'render_snippets',
	'render_entries'
] as const;

export interface ResolvedKit {
	kitId: string;
	kitName: string;
	properties: Map<string, ResolvedProperty>;
}

type AxisValueType =
	| { type: 'literal'; value: string }
	| {
			type: 'range';
			operator: '>=' | '<=' | '>' | '<' | 'between';
			threshold: number;
			threshold_high?: number;
	  }
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
	// View ids this property's value references, when the value is a `view-list` -- otherwise null.
	// Purely a function of the value TYPE (a native token-value kind), NOT the property name: the
	// resolver assigns no meaning to any particular name like "children". A consumer that wants to
	// treat some property as nested composition (Charter's `children`, the editor's Views tree)
	// identifies it by its own field-kind convention, not here.
	viewRefs: string[] | null;
}

// --- Cascade (resolution inspector) types ---------------------------------------------------
// The winner-only ResolvedProperty above can't show *overrides* (it keeps only the top entry per
// property). The cascade keeps the full ordered stack of matched layers so a UI can strike through
// the entries a higher-specificity layer beat. This is a SLOW PATH (per-view, on demand) -- it is
// NOT used by the editor's live-query resolve loop.
export interface CascadeEntry {
	property: string;
	// Entry-local declared value: a literal, or the entry's own token value/id. Deliberately does
	// NOT apply the scope-based alias override (substituteTokens) the winner path does -- that
	// narrower-scope override is a separate concept that belongs to the planned view-override band,
	// not to illustrating the kit-layer stack. In the common (no alias override) case it matches.
	value: string;
	isToken: boolean;
	tokenAlias: string | null;
	tokenId: string | null;
}

export interface CascadeLayer {
	layerId: string;
	conditionCount: number;
	// Axis-id set + matched values, same shape/semantics as ResolvedProperty.keys/conditionValues,
	// so the UI colors a layer with the exact same hash hue as the Axes dots and StyleField track.
	keys: string[];
	conditionValues: { axisId: string; value: string }[];
	entries: CascadeEntry[];
}

export interface CascadeKit {
	kitId: string;
	kitName: string;
	// Ordered MOST-SPECIFIC FIRST (top of the stack). The first layer to set a property is its
	// winner; the same property in any later layer is overridden.
	layers: CascadeLayer[];
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
			const condHi =
				condition.operator === 'between'
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
	axisArgs: Record<string, ArgValue>
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
		// A layer's conditions arrive in whatever order the DB returned them (no ORDER BY
		// on the conditions fetch, and UNION ALL wouldn't preserve one anyway). Sort by
		// axisId so `keys`/`conditionValues` are deterministic -- otherwise identical DB
		// state resolves to different-ordered arrays run to run, which made the batched-vs-
		// slow parity test flaky. Order is display/grouping-only; specificity sorts
		// priorities internally, so this is safe. (The raw conditions-row order feeding
		// `rowsKey` upstream is a separate, deliberately-deferred concern -- see rowsKey.)
		const conds = [...data.conditions].sort((a, b) => a.axisId.localeCompare(b.axisId));
		for (const entry of data.entries) {
			const tv = entry.tokenId ? entry.tokenValue : null;
			const resolvedValue = tv
				? tv.type === 'scalar'
					? tv.value
					: tv.type === 'view'
						? tv.view_id
						: ''
				: (entry.literalValue ?? '');
			result.set(entry.property, {
				property: entry.property,
				value: resolvedValue,
				sourceLayerId: data.id,
				kitId,
				isToken: !!entry.tokenId,
				tokenAlias: entry.tokenAlias,
				tokenId: entry.tokenId ?? null,
				conditionCount: conds.length,
				keys: conds.map((c) => c.axisId),
				conditionValues: conds.map((c) => ({
					axisId: c.axisId,
					value: formatAxisValue(c.axisValue)
				})),
				// Type-driven, not name-driven: a `view-list` token value carries view refs. (A
				// later view-scope token of the same alias overrides these in substituteTokens.)
				viewRefs: tv?.type === 'view-list' ? tv.view_ids : null
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
					.onRef('axes_consumed.kit_id', '=', 'layers.kit_id')
			)
			.select([
				'layer_axis_values.layer_id',
				'axis_values.value',
				'axis_values.axis_id',
				'axes_consumed.priority_index'
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
				'tokens.value as token_value'
			])
			.execute()
	]);
}

export async function resolve(
	db: SchemaDialect,
	kitId: string,
	axisArgs: Record<string, ArgValue>
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
				priorityIndex: c.priority_index
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
				tokenValue: e.token_value
			});
		}
	}

	return matchLayers(kitId, layerDataMap, axisArgs);
}

// Build per-kit { layerId -> LayerData } maps from the flat conditions/entries rowsets returned
// by fetchLayerData. Shared by resolveAll (winner-only) and resolveAllCascade (full stack) so the
// two can never disagree on how a layer's conditions/entries are assembled.
function buildKitLayerDataMaps(
	kitIds: string[],
	layers: { id: string; kit_id: string }[],
	conditions: Awaited<ReturnType<typeof fetchLayerData>>[0],
	entries: Awaited<ReturnType<typeof fetchLayerData>>[1]
): Map<string, Map<string, LayerData>> {
	const layerKitMap = new Map<string, string>(layers.map((l) => [l.id, l.kit_id]));
	const kitLayerDataMaps = new Map<string, Map<string, LayerData>>(
		kitIds.map((id) => [id, new Map()])
	);

	for (const layer of layers) {
		kitLayerDataMaps
			.get(layer.kit_id)!
			.set(layer.id, { id: layer.id, conditions: [], entries: [] });
	}

	for (const c of conditions) {
		const kitId = layerKitMap.get(c.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index
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
				tokenValue: e.token_value
			});
		}
	}

	return kitLayerDataMaps;
}

// Resolves all kits in one pass: 3 queries total instead of 3 per kit.
async function resolveAll(
	db: SchemaDialect,
	kitIds: string[],
	argsByKit: Map<string, Record<string, ArgValue>>
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

	const kitLayerDataMaps = buildKitLayerDataMaps(kitIds, layers, conditions, entries);

	const results = new Map<string, Map<string, ResolvedProperty>>();
	for (const kitId of kitIds) {
		results.set(
			kitId,
			matchLayers(kitId, kitLayerDataMaps.get(kitId)!, argsByKit.get(kitId) ?? {})
		);
	}
	return results;
}

export interface ScopedTokenMaps {
	// alias -> scalar string value, narrowest scope (project -> kit -> view) wins.
	scalarMap: Map<string, string>;
	// alias -> list of view ids, same scope-precedence rule. Separate map rather than widening
	// scalarMap's value type -- keeps the existing scalar substitution path completely untouched,
	// and a property only ever wants one or the other (a view-list vs a scalar), never both.
	viewListMap: Map<string, string[]>;
}

async function gatherScopedTokens(
	db: SchemaDialect,
	projectId: string | undefined,
	// ordered by kit priority_index ASC — determines which kit wins alias conflicts
	kitIds: string[],
	viewId: string
): Promise<ScopedTokenMaps & { viewTokens: { alias: string | null; value: TokenValue | null }[] }> {
	const scalarMap = new Map<string, string>();
	const viewListMap = new Map<string, string[]>();

	if (!projectId) return { scalarMap, viewListMap, viewTokens: [] };

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
			: Promise.resolve(
					[] as { alias: string | null; value: TokenValue | null; kit_id: string | null }[]
				),

		db
			.selectFrom('tokens')
			.where('tokens.view_id', '=', viewId)
			.where('tokens.alias', 'is not', null)
			.select(['tokens.alias', 'tokens.value'])
			.execute()
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

	return { scalarMap, viewListMap, viewTokens };
}

function substituteTokens(
	properties: Map<string, ResolvedProperty>,
	tokenMaps: ScopedTokenMaps
): void {
	for (const [, resolved] of properties) {
		if (!resolved.isToken || !resolved.tokenAlias) continue;

		// Which kind of value a given alias holds is decided by the token's own value type (i.e.
		// which map it landed in), not by the property's name. A view-list alias sets viewRefs; a
		// scalar alias sets the string value. No property name is special.
		const viewIds = tokenMaps.viewListMap.get(resolved.tokenAlias);
		if (viewIds !== undefined) {
			resolved.viewRefs = viewIds;
			continue;
		}

		const scalarValue = tokenMaps.scalarMap.get(resolved.tokenAlias);
		if (scalarValue !== undefined) resolved.value = scalarValue;
	}
}

/**
 * Self-declaring view-scope references: a view's OWN view-list token materializes a property of
 * the same name (= its alias) carrying its view refs, even when no kit layer declares that
 * property. This lets a per-view composition override (e.g. a view's `children`) exist with no
 * render entry anchored on a shared kit layer -- which would otherwise force the property onto
 * every view composing the kit. Only the view's own tokens self-declare; kit/project-scope tokens
 * do not. Name-neutral by construction: whatever the token is aliased, that's the property name;
 * the resolver reads no meaning into it.
 */
function applySelfDeclaredViewRefs(
	resolvedKits: ResolvedKit[],
	viewTokens: { alias: string | null; value: TokenValue | null }[]
): void {
	const target = resolvedKits[resolvedKits.length - 1];
	if (!target) return;
	for (const t of viewTokens) {
		if (!t.alias || t.value?.type !== 'view-list') continue;
		if (resolvedKits.some((k) => k.properties.has(t.alias!))) continue; // a layer already declares it
		target.properties.set(t.alias, {
			property: t.alias,
			value: '',
			sourceLayerId: '',
			kitId: target.kitId,
			isToken: true,
			tokenAlias: t.alias,
			tokenId: null,
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			viewRefs: t.value.view_ids
		});
	}
}

/**
 * Per-view resolution. SLOW PATH: ~3 round-trips per view. Do NOT use this inside the
 * editor's live-query loop or any hot path -- use `fetchResolutionRows` + `resolveViewsFromRows`
 * (or the `resolveManyViews` wrapper), which resolves all project views in a single batched
 * fetch. This function exists for one-shot callers (tests, single-view export lookups) that
 * genuinely want one view and can afford the per-view IPC cost.
 */
export async function resolveManySlowPath(
	db: SchemaDialect,
	viewId: string
): Promise<ResolvedKit[]> {
	const compositions = await db
		.selectFrom('compositions')
		.innerJoin('kits', 'kits.id', 'compositions.kit_id')
		.where('compositions.view_id', '=', viewId)
		.orderBy('compositions.priority_index', 'asc')
		.select([
			'compositions.kit_id',
			'compositions.priority_index',
			'kits.name as kit_name',
			'kits.project_id'
		])
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
		gatherScopedTokens(db, projectId, allKitIds, viewId)
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
			properties
		});
	}
	applySelfDeclaredViewRefs(results, tokenMap.viewTokens);

	return results;
}

// Pure: mirror of matchLayers, but keeps the FULL ordered stack of matched layers (each with all
// its entries) instead of collapsing to a winner-per-property map. Ordered most-specific first.
function matchLayersCascade(
	layerDataMap: Map<string, LayerData>,
	axisArgs: Record<string, ArgValue>
): CascadeLayer[] {
	const matching: { data: LayerData; specificity: number[] }[] = [];
	for (const [, data] of layerDataMap) {
		const allMatch = data.conditions.every((c) => {
			const arg = axisArgs[c.axisId];
			if (!arg) return false;
			return matchesArg(c.axisValue, arg);
		});
		if (allMatch) matching.push({ data, specificity: computeSpecificity(data.conditions) });
	}

	// Descending: most-specific first (opposite of matchLayers, which sorts ascending so later
	// entries overwrite earlier in a Map). Here order IS the output, top of the stack leading.
	matching.sort((a, b) => compareSpecificity(b.specificity, a.specificity));

	return matching.map(({ data }) => {
		// Same deterministic axisId sort as matchLayers, for stable display order.
		const conds = [...data.conditions].sort((a, b) => a.axisId.localeCompare(b.axisId));
		return {
			layerId: data.id,
			conditionCount: conds.length,
			keys: conds.map((c) => c.axisId),
			conditionValues: conds.map((c) => ({ axisId: c.axisId, value: formatAxisValue(c.axisValue) })),
			entries: data.entries.map((entry) => {
				const tv = entry.tokenId ? entry.tokenValue : null;
				const value = tv
					? tv.type === 'scalar'
						? tv.value
						: tv.type === 'view'
							? tv.view_id
							: '' // view-list has no scalar display
					: (entry.literalValue ?? '');
				return {
					property: entry.property,
					value,
					isToken: !!entry.tokenId,
					tokenAlias: entry.tokenAlias,
					tokenId: entry.tokenId ?? null
				};
			})
		};
	});
}

// Cascade counterpart of resolveAll: full matched-layer stack per kit (most-specific first).
async function resolveAllCascade(
	db: SchemaDialect,
	kitIds: string[],
	argsByKit: Map<string, Record<string, ArgValue>>
): Promise<Map<string, CascadeLayer[]>> {
	if (kitIds.length === 0) return new Map();

	const layers = await db
		.selectFrom('layers')
		.where('layers.kit_id', 'in', kitIds)
		.select(['layers.id', 'layers.kit_id'])
		.execute();

	if (layers.length === 0) return new Map(kitIds.map((id) => [id, []]));

	const [conditions, entries] = await fetchLayerData(db, layers.map((l) => l.id));
	const kitLayerDataMaps = buildKitLayerDataMaps(kitIds, layers, conditions, entries);

	const results = new Map<string, CascadeLayer[]>();
	for (const kitId of kitIds) {
		results.set(kitId, matchLayersCascade(kitLayerDataMaps.get(kitId)!, argsByKit.get(kitId) ?? {}));
	}
	return results;
}

// SLOW PATH (per-view, on demand -- NOT the live-query loop). Returns the full resolution cascade
// for one view: every composed kit with its matched-layer stack, most-specific first. Feeds the
// Layers inspector so it can render override chains (struck-through beaten entries). Parallel to
// resolveManySlowPath but skips token scope/substitution -- see CascadeEntry.value's note.
export async function resolveViewCascade(db: SchemaDialect, viewId: string): Promise<CascadeKit[]> {
	const compositions = await db
		.selectFrom('compositions')
		.innerJoin('kits', 'kits.id', 'compositions.kit_id')
		.where('compositions.view_id', '=', viewId)
		.orderBy('compositions.priority_index', 'asc')
		.select(['compositions.kit_id', 'kits.name as kit_name'])
		.execute();

	const allKitIds = compositions.map((c) => c.kit_id);
	if (allKitIds.length === 0) return [];

	const axisArgsRows = await db
		.selectFrom('axis_args')
		.where('axis_args.view_id', '=', viewId)
		.select(['axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
		.execute();

	const argsByKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgsRows) {
		if (!arg.value) continue;
		if (!argsByKit.has(arg.kit_id)) argsByKit.set(arg.kit_id, {});
		argsByKit.get(arg.kit_id)![arg.axis_id] = arg.value as ArgValue;
	}

	const cascadeByKit = await resolveAllCascade(db, allKitIds, argsByKit);

	return compositions.map((comp) => ({
		kitId: comp.kit_id,
		kitName: comp.kit_name,
		layers: cascadeByKit.get(comp.kit_id) ?? []
	}));
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

// A stable string derived from every column of every rowset in ResolutionRows.
// Used for input-level dedup: if two fetches produce the same key, `resolveViewsFromRows`
// (a pure function) is guaranteed to produce identical output, so the editor can skip
// the resolve + serialize + plugin call entirely. Unlike an output fingerprint, this
// cannot omit a field -- it serializes the raw rows, so any column change (including
// ones no output fingerprint enumerated) is detected.
//
// Row order sensitivity: rowsets without an explicit ORDER BY could in principle return
// in different order across fetches of identical data, producing a different key and a
// false-positive re-resolve. That's safe (just a redundant resolve, no worse than today's
// behavior of always re-resolving) and PGlite returns stable order in practice. Sorting
// each rowset would make the key fully order-independent at the cost of extra work per
// fetch; deferred until profiling shows false positives are common.
export function rowsKey(rows: ResolutionRows): string {
	return JSON.stringify([
		rows.viewRows,
		rows.compositions,
		rows.axisArgsRows,
		rows.projectTokens,
		rows.viewTokenRows,
		rows.kitTokenRows,
		rows.layers,
		rows.conditions,
		rows.entries
	]);
}

// The raw rowsets `resolveViewsFromRows` consumes. Every table in
// RESOLUTION_RELEVANT_TABLES is represented here -- a row-level dedup that compares
// these rowsets (or a key derived from all of them) is therefore immune to the
// field-omission class of bug an output fingerprint has: if any column of any row
// changes, the dedup sees it, regardless of which ResolvedProperty fields some
// downstream fingerprint happened to enumerate.
export interface ResolutionRows {
	viewRows: ViewRow[];
	compositions: CompositionRow[];
	axisArgsRows: AxisArgRow[];
	projectTokens: ProjectTokenRow[];
	viewTokenRows: ViewTokenRow[];
	kitTokenRows: KitTokenRow[];
	layers: LayerRow[];
	conditions: ConditionRow[];
	entries: EntryRow[];
}

// These row interfaces describe the exact jsonb the batched fetch emits per branch.
// They're exported so `fetch-keyset.test.ts` can assert the SQL's key set still matches
// each interface -- the one drift an output-parity test can miss (a field read with a
// `?? default` fallback stays green even when its key silently disappears).
export interface ViewRow {
	id: string;
	name: string;
	hints: unknown;
}
export interface CompositionRow {
	view_id: string;
	kit_id: string;
	priority_index: number;
	kit_name: string;
}
export interface AxisArgRow {
	view_id: string;
	kit_id: string;
	axis_id: string;
	value: unknown;
}
export interface ProjectTokenRow {
	alias: string | null;
	value: TokenValue | null;
}
export interface ViewTokenRow {
	view_id: string | null;
	alias: string | null;
	value: TokenValue | null;
}
export interface KitTokenRow {
	alias: string | null;
	value: TokenValue | null;
	kit_id: string | null;
}
export interface LayerRow {
	id: string;
	kit_id: string;
}
export interface ConditionRow {
	layer_id: string;
	value: unknown;
	axis_id: string;
	priority_index: number;
}
export interface EntryRow {
	layer_id: string;
	property: string;
	literal_value: string | null;
	token_id: string | null;
	token_alias: string | null;
	token_value: TokenValue | null;
}

// Fetches every rowset resolution needs in a SINGLE IPC crossing into the PGlite
// worker. One UNION ALL query returns all 9 rowsets tagged, replacing the 4 sequential
// await groups (RT1→RT2→RT3→RT4) the original resolveManyViews used. Two CTEs
// (project_view_ids, project_kit_ids) compute the viewIds/kitIds filters once and every
// branch references them, so no intermediate round-trip is needed to learn them and the
// dependency-derivation isn't copy-pasted per branch.
//
// Row shapes: `to_jsonb(table)` subqueries (views, axis_args, layers) return every
// column of the row -- extra columns are ignored by resolveViewsFromRows. The joined
// rowsets (compositions, tokens, conditions, entries) use jsonb_build_object to emit
// exactly the fields the resolver reads, matching the ResolutionRows interfaces.
//
// The empty-view and no-kit short-circuits the 4-await version had are handled
// naturally: if there are no views, every subquery returns 0 rows (they all join/subquery
// on views); if there are no compositions, kit_tokens/layers/conditions/entries return
// 0 rows while project/view tokens still return -- resolveViewsFromRows handles both.
export async function fetchResolutionRows(
	db: SchemaDialect,
	projectId: string
): Promise<ResolutionRows> {
	mark('resolve:fetch:start');
	// Two CTEs hoist the WHERE filters every branch needs -- the project's view ids, and
	// the kit ids composed into any of those views -- so each branch references them by
	// name instead of repeating the `compositions JOIN views WHERE project_id` subquery
	// (which appeared 4× before). `${projectId}` is now bound twice (the view-id CTE and
	// the project-tokens branch) instead of seven times.
	const result = await sql`
		WITH project_view_ids AS (
			SELECT id FROM views WHERE project_id = ${projectId}
		),
		project_kit_ids AS (
			SELECT DISTINCT c.kit_id
			FROM compositions c
			WHERE c.view_id IN (SELECT id FROM project_view_ids)
		)
		SELECT 'views' AS tag, to_jsonb(v) AS data
		FROM views v WHERE v.id IN (SELECT id FROM project_view_ids)
		UNION ALL
		SELECT 'compositions' AS tag, jsonb_build_object(
			'view_id', c.view_id, 'kit_id', c.kit_id,
			'priority_index', c.priority_index, 'kit_name', k.name
		) AS data
		FROM compositions c
		JOIN kits k ON k.id = c.kit_id
		WHERE c.view_id IN (SELECT id FROM project_view_ids)
		UNION ALL
		SELECT 'axis_args' AS tag, to_jsonb(aa) AS data
		FROM axis_args aa
		WHERE aa.view_id IN (SELECT id FROM project_view_ids)
		UNION ALL
		SELECT 'project_tokens' AS tag, jsonb_build_object('alias', t.alias, 'value', t.value) AS data
		FROM tokens t
		WHERE t.project_id = ${projectId}
			AND t.kit_id IS NULL
			AND t.view_id IS NULL
			AND t.alias IS NOT NULL
		UNION ALL
		SELECT 'view_tokens' AS tag, jsonb_build_object(
			'view_id', t.view_id, 'alias', t.alias, 'value', t.value
		) AS data
		FROM tokens t
		WHERE t.view_id IN (SELECT id FROM project_view_ids)
			AND t.alias IS NOT NULL
		UNION ALL
		SELECT 'kit_tokens' AS tag, jsonb_build_object(
			'alias', t.alias, 'value', t.value, 'kit_id', t.kit_id
		) AS data
		FROM tokens t
		WHERE t.kit_id IN (SELECT kit_id FROM project_kit_ids)
			AND t.alias IS NOT NULL
		UNION ALL
		SELECT 'layers' AS tag, to_jsonb(l) AS data
		FROM layers l
		WHERE l.kit_id IN (SELECT kit_id FROM project_kit_ids)
		UNION ALL
		SELECT 'conditions' AS tag, jsonb_build_object(
			'layer_id', lav.layer_id, 'value', axv.value,
			'axis_id', axv.axis_id, 'priority_index', ac.priority_index
		) AS data
		FROM layers l
		JOIN layer_axis_values lav ON lav.layer_id = l.id
		JOIN axis_values axv ON axv.id = lav.axis_value_id
		JOIN axes_consumed ac ON ac.axis_id = axv.axis_id AND ac.kit_id = l.kit_id
		WHERE l.kit_id IN (SELECT kit_id FROM project_kit_ids)
		UNION ALL
		SELECT 'entries' AS tag, jsonb_build_object(
			'layer_id', l.id, 'property', re.property, 'literal_value', re.value,
			'token_id', re.token_id, 'token_alias', t.alias, 'token_value', t.value
		) AS data
		FROM render_entries re
		JOIN render_snippets rs ON rs.id = re.snippet_id
		JOIN layers l ON l.id = rs.layer_id
		LEFT JOIN tokens t ON t.id = re.token_id
		WHERE l.kit_id IN (SELECT kit_id FROM project_kit_ids)
	`.execute(db);
	mark('resolve:fetch:end');
	measure('resolve:fetch:start', 'resolve:fetch:end', 'fetch (single crossing)');

	// Bucket the tagged rows. The tag is exactly the bucket key, so a direct index
	// replaces the former per-tag switch. The jsonb payload's shape is asserted by the
	// `${tag}Row` interfaces (the array element types below), guarded by the batched-fetch
	// parity test rather than the compiler -- the same trust boundary the switch had.
	const grouped = {
		views: [] as ViewRow[],
		compositions: [] as CompositionRow[],
		axis_args: [] as AxisArgRow[],
		project_tokens: [] as ProjectTokenRow[],
		view_tokens: [] as ViewTokenRow[],
		kit_tokens: [] as KitTokenRow[],
		layers: [] as LayerRow[],
		conditions: [] as ConditionRow[],
		entries: [] as EntryRow[]
	};
	for (const row of result.rows as { tag: keyof typeof grouped; data: unknown }[]) {
		(grouped[row.tag] as unknown[] | undefined)?.push(row.data);
	}

	// Compositions must be ordered by priority_index (the resolver builds compsByView in
	// array order, and kit priority determines which kit wins contested properties).
	// UNION ALL doesn't preserve per-branch ORDER BY, so sort here.
	grouped.compositions.sort((a, b) => a.priority_index - b.priority_index);

	return {
		viewRows: grouped.views,
		compositions: grouped.compositions,
		axisArgsRows: grouped.axis_args,
		projectTokens: grouped.project_tokens,
		viewTokenRows: grouped.view_tokens,
		kitTokenRows: grouped.kit_tokens,
		layers: grouped.layers,
		conditions: grouped.conditions,
		entries: grouped.entries
	};
}

// Pure in-memory resolution: a function of the fetched rows only. No db, no await.
// Split out from the fetch so the editor can dedup on the rows (input) before paying
// for the resolve + serialize + plugin call (output) when nothing actually changed.
export function resolveViewsFromRows(rows: ResolutionRows): ResolvedViewData[] {
	if (rows.viewRows.length === 0) return [];

	const allKitIds = [...new Set(rows.compositions.map((c) => c.kit_id))];

	if (allKitIds.length === 0) {
		return rows.viewRows.map((v) => ({
			viewId: v.id,
			viewName: v.name,
			hints: (v.hints ?? null) as Record<string, unknown> | null,
			resolvedKits: []
		}));
	}

	// Build per-kit LayerData maps
	const layerKitMap = new Map<string, string>(rows.layers.map((l) => [l.id, l.kit_id]));
	const kitLayerDataMaps = new Map<string, Map<string, LayerData>>(
		allKitIds.map((id) => [id, new Map()])
	);
	for (const layer of rows.layers) {
		kitLayerDataMaps
			.get(layer.kit_id)!
			.set(layer.id, { id: layer.id, conditions: [], entries: [] });
	}
	for (const c of rows.conditions) {
		const kitId = layerKitMap.get(c.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(c.layer_id);
		if (data && c.value) {
			data.conditions.push({
				axisId: c.axis_id,
				axisValue: c.value as any as AxisValueType,
				priorityIndex: c.priority_index
			});
		}
	}
	for (const e of rows.entries) {
		const kitId = layerKitMap.get(e.layer_id);
		if (!kitId) continue;
		const data = kitLayerDataMaps.get(kitId)?.get(e.layer_id);
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

	// Build token maps
	const baseTokenMap = new Map<string, string>();
	const baseViewListMap = new Map<string, string[]>();
	for (const t of rows.projectTokens) {
		if (!t.alias || !t.value) continue;
		if (t.value.type === 'scalar') baseTokenMap.set(t.alias, t.value.value);
		else if (t.value.type === 'view-list') baseViewListMap.set(t.alias, t.value.view_ids);
	}
	const tokensByKit = new Map<string, KitTokenRow[]>();
	for (const t of rows.kitTokenRows) {
		if (!t.kit_id) continue;
		if (!tokensByKit.has(t.kit_id)) tokensByKit.set(t.kit_id, []);
		tokensByKit.get(t.kit_id)!.push(t);
	}
	const tokensByView = new Map<string, ViewTokenRow[]>();
	for (const t of rows.viewTokenRows) {
		if (!t.view_id) continue;
		if (!tokensByView.has(t.view_id)) tokensByView.set(t.view_id, []);
		tokensByView.get(t.view_id)!.push(t);
	}

	const compsByView = new Map<string, CompositionRow[]>();
	for (const c of rows.compositions) {
		if (!compsByView.has(c.view_id)) compsByView.set(c.view_id, []);
		compsByView.get(c.view_id)!.push(c);
	}

	const argsByViewKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of rows.axisArgsRows) {
		if (!arg.value) continue;
		const key = `${arg.view_id}::${arg.kit_id}`;
		if (!argsByViewKit.has(key)) argsByViewKit.set(key, {});
		argsByViewKit.get(key)![arg.axis_id] = arg.value as ArgValue;
	}

	mark('resolve:match:start');
	const result: ResolvedViewData[] = rows.viewRows.map((v) => {
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
				args
			);
			substituteTokens(properties, { scalarMap: tokenMap, viewListMap: viewListTokenMap });
			return {
				kitId: comp.kit_id,
				kitName: comp.kit_name,
				properties
			};
		});

		applySelfDeclaredViewRefs(resolvedKits, tokensByView.get(v.id) ?? []);

		return {
			viewId: v.id,
			viewName: v.name,
			hints: (v.hints ?? null) as Record<string, unknown> | null,
			resolvedKits
		};
	});
	mark('resolve:match:end');
	measure('resolve:match:start', 'resolve:match:end', 'match+assemble (pure)');

	return result;
}

// Convenience wrapper: fetch + resolve in one call. The editor's live-query loop uses
// fetchResolutionRows + resolveViewsFromRows separately so it can dedup on the rows
// before resolving. This wrapper exists for callers that don't need the dedup
// (tests, single-shot resolve, future export plugins).
export async function resolveManyViews(
	db: SchemaDialect,
	projectId: string
): Promise<ResolvedViewData[]> {
	const rows = await fetchResolutionRows(db, projectId);
	return resolveViewsFromRows(rows);
}

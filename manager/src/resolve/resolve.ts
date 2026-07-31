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
	'token_axis_overrides',
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
	// Views this property's value references, when its declaring alias has one or more `view`-typed
	// token rows -- otherwise null. Each entry carries the referencing token's own id (`tokenId`,
	// distinct from the ResolvedProperty's own top-level `tokenId` above, which is the winning
	// render entry's token) so a caller can target a SPECIFIC reference for remove/reorder even when
	// two entries share a `viewId` (the same view referenced twice). Purely a function of the value
	// TYPE (a native token-value kind), NOT the property name: the resolver assigns no meaning to
	// any particular name like "children". A consumer that wants to treat some property as nested
	// composition (Charter's `children`, the editor's Views tree) identifies it by its own
	// field-kind convention, not here.
	viewRefs: { viewId: string; tokenId: string }[] | null;
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
			} else if (arg.type === 'range') {
				if (arg.min === null && arg.max === null) return true;
				argLo = arg.min ?? -Infinity;
				argHi = arg.max ?? Infinity;
				argOpenLo = arg.min === null;
				argOpenHi = arg.max === null;
			} else {
				// A 'linked' ArgValue must never reach here -- resolveAllLinkedArgs resolves every raw
				// axis_args/override entry to its concrete literal/range value (or omits the key
				// entirely) at every call site that builds an args map, before matchLayers ever runs.
				// If one slips through anyway, treat it as no match rather than crashing on the
				// missing min/max.
				return false;
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
			const resolvedValue = tv ? (tv.type === 'scalar' ? tv.value : tv.view_id) : (entry.literalValue ?? '');
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
				// A render-entry-anchored `view` token is a single reference. Multi-ref aggregation
				// (N `view` tokens sharing one alias) happens in gatherScopedTokens/resolveViewsFromRows,
				// consulted post-hoc by substituteTokens -- this stays null here regardless.
				viewRefs: null
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
				// The alias a property should substitute BY -- for a `view`-typed token that's its
				// composition_alias (see TokensTable's doc comment in schema.ts), for anything else
				// (scalar, or no token at all) it's the plain alias. Must match exactly what
				// applyScopeTokenRows groups viewRefMap/scalarMap by, or substituteTokens can never
				// find the entry it just read.
				sql<string | null>`CASE WHEN tokens.value ->> 'type' = 'view' THEN tokens.composition_alias ELSE tokens.alias END`.as(
					'token_alias'
				),
				'tokens.value as token_value'
			])
			.execute()
	]);
}

// No caller anywhere in the app today (only resolve.test.ts's own fixtures, always plain literal/
// range values) -- it takes a bare axisArgs record with no view/project context, so it structurally
// cannot walk a 'linked' chain itself. This is a documented invariant, not an active gap: a future
// real caller must pre-resolve any 'linked' entries (e.g. via resolveAllLinkedArgs) before calling.
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

// DO NOT make this alias-cascade token_id-authoritative (i.e. "an entry's value only ever comes
// from the exact token row its own token_id names") without re-reading this comment first -- that
// change was tried and reverted (see git history) because it silently breaks the codebase's actual
// primary authoring pattern for per-view content: `seed.ts`'s `textKit`/`textView` and
// `imageKit`/`imageView` declare a render entry whose token_id points at a KIT-scope placeholder
// (e.g. `content`, value `''`), and every VIEW composing that kit supplies its own real text/src
// via a SEPARATE, same-alias VIEW-scope token -- relying on exactly this cascade to override the
// kit's placeholder. Making resolution token_id-authoritative makes every such view render the
// kit's empty placeholder instead of its own content: every text label and every image in the demo
// project goes blank. The narrower-scope-by-alias cascade below is that "view overrides kit
// default" mechanism, not an accidental side effect -- see the regression tests in
// `resolve.test.ts`'s `describe('kit-default + view-override authoring pattern', ...)`.
export interface ScopedTokenMaps {
	// alias -> scalar string value, narrowest scope (project -> kit -> view) wins.
	scalarMap: Map<string, string>;
	// alias -> ordered list of view refs, same scope-precedence rule: a narrower scope's `view`
	// rows for an alias fully replace a wider scope's (not merge with it). Separate map rather than
	// widening scalarMap's value type -- keeps the existing scalar substitution path untouched, and
	// a property only ever wants one kind or the other, never both.
	viewRefMap: Map<string, { viewId: string; tokenId: string }[]>;
}

// A token row shape shared by the project/kit/view token queries below -- enough to accumulate
// same-scope `view` rows (in `priority_index` order) into one alias's viewRefMap entry, or set a
// `scalar` row into scalarMap. Called once per SCOPE UNIT (the whole project rowset, one kit's
// rowset, or the whole view rowset) so a narrower scope's commit replaces rather than merges with
// a wider scope's, exactly mirroring the scalar map's existing last-writer-wins semantics.
interface ScopableTokenRow {
	id: string;
	alias: string | null;
	// Drives viewRefMap grouping for `type: 'view'` rows -- `alias` is unused for those rows (see
	// TokensTable's doc comment in schema.ts). Scalar rows still key off `alias`.
	composition_alias: string | null;
	value: TokenValue | null;
	priority_index: number;
}

function applyScopeTokenRows(
	rows: ScopableTokenRow[],
	scalarMap: Map<string, string>,
	viewRefMap: Map<string, { viewId: string; tokenId: string }[]>
): void {
	const viewAcc = new Map<string, ScopableTokenRow[]>();
	for (const t of rows) {
		if (!t.value) continue;
		if (t.value.type === 'scalar') {
			if (t.alias) scalarMap.set(t.alias, t.value.value);
		} else if (t.value.type === 'view') {
			if (!t.composition_alias) continue;
			const arr = viewAcc.get(t.composition_alias) ?? [];
			arr.push(t);
			viewAcc.set(t.composition_alias, arr);
		}
	}
	for (const [compositionAlias, rowsForAlias] of viewAcc) {
		rowsForAlias.sort((a, b) => a.priority_index - b.priority_index || a.id.localeCompare(b.id));
		viewRefMap.set(
			compositionAlias,
			rowsForAlias.map((r) => ({ viewId: (r.value as { view_id: string }).view_id, tokenId: r.id }))
		);
	}
}

async function gatherScopedTokens(
	db: SchemaDialect,
	projectId: string | undefined,
	// ordered by kit priority_index ASC — determines which kit wins alias conflicts
	kitIds: string[],
	viewId: string
): Promise<ScopedTokenMaps & { viewTokens: ScopableTokenRow[] }> {
	const scalarMap = new Map<string, string>();
	const viewRefMap = new Map<string, { viewId: string; tokenId: string }[]>();

	if (!projectId) return { scalarMap, viewRefMap, viewTokens: [] };

	const [projectTokens, kitTokenRows, viewTokens] = await Promise.all([
		db
			.selectFrom('tokens')
			.where('tokens.project_id', '=', projectId)
			.where('tokens.kit_id', 'is', null)
			.where('tokens.view_id', 'is', null)
			.where((eb) => eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)]))
			.orderBy('tokens.priority_index', 'asc')
			.orderBy('tokens.id', 'asc')
			.select(['tokens.id', 'tokens.alias', 'tokens.composition_alias', 'tokens.value', 'tokens.priority_index'])
			.execute(),

		kitIds.length > 0
			? db
					.selectFrom('tokens')
					.where('tokens.kit_id', 'in', kitIds)
					.where((eb) =>
						eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)])
					)
					.orderBy('tokens.priority_index', 'asc')
					.orderBy('tokens.id', 'asc')
					.select([
						'tokens.id',
						'tokens.alias',
						'tokens.composition_alias',
						'tokens.value',
						'tokens.kit_id',
						'tokens.priority_index'
					])
					.execute()
			: Promise.resolve(
					[] as (ScopableTokenRow & { kit_id: string | null })[]
				),

		db
			.selectFrom('tokens')
			.where('tokens.view_id', '=', viewId)
			.where((eb) => eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)]))
			.orderBy('tokens.priority_index', 'asc')
			.orderBy('tokens.id', 'asc')
			.select(['tokens.id', 'tokens.alias', 'tokens.composition_alias', 'tokens.value', 'tokens.priority_index'])
			.execute()
	]);

	applyScopeTokenRows(projectTokens, scalarMap, viewRefMap);

	// Group kit tokens by kit_id, then commit in kitIds order so priority is preserved.
	const tokensByKit = new Map<string, typeof kitTokenRows>();
	for (const t of kitTokenRows) {
		if (!t.kit_id) continue;
		if (!tokensByKit.has(t.kit_id)) tokensByKit.set(t.kit_id, []);
		tokensByKit.get(t.kit_id)!.push(t);
	}
	for (const kitId of kitIds) {
		applyScopeTokenRows(tokensByKit.get(kitId) ?? [], scalarMap, viewRefMap);
	}

	applyScopeTokenRows(viewTokens, scalarMap, viewRefMap);

	return { scalarMap, viewRefMap, viewTokens };
}

function substituteTokens(
	properties: Map<string, ResolvedProperty>,
	tokenMaps: ScopedTokenMaps
): void {
	for (const [, resolved] of properties) {
		if (!resolved.isToken || !resolved.tokenAlias) continue;

		// Which kind of value a given alias holds is decided by the token's own value type (i.e.
		// which map it landed in), not by the property's name. An alias with one or more `view`
		// rows sets viewRefs; a scalar alias sets the string value. No property name is special.
		const viewRefs = tokenMaps.viewRefMap.get(resolved.tokenAlias);
		if (viewRefs !== undefined) {
			resolved.viewRefs = viewRefs;
			continue;
		}

		const scalarValue = tokenMaps.scalarMap.get(resolved.tokenAlias);
		if (scalarValue !== undefined) resolved.value = scalarValue;
	}
}

/**
 * Self-declaring view-scope references: a view's OWN `view`-typed token(s) materialize a property
 * of the same name (= their shared alias) carrying their view refs, even when no kit layer
 * declares that property. This lets a per-view composition override (e.g. a view's `children`)
 * exist with no render entry anchored on a shared kit layer -- which would otherwise force the
 * property onto every view composing the kit. Only the view's own tokens self-declare; kit/
 * project-scope tokens do not. Name-neutral by construction: whatever the token is aliased, that's
 * the property name; the resolver reads no meaning into it. Groups same-alias rows (ordered by
 * priority_index) before declaring, since more than one `view` token can now share an alias.
 */
function applySelfDeclaredViewRefs(resolvedKits: ResolvedKit[], viewTokens: ScopableTokenRow[]): void {
	const target = resolvedKits[resolvedKits.length - 1];
	if (!target) return;

	const byAlias = new Map<string, ScopableTokenRow[]>();
	for (const t of viewTokens) {
		if (!t.composition_alias || t.value?.type !== 'view') continue;
		const arr = byAlias.get(t.composition_alias) ?? [];
		arr.push(t);
		byAlias.set(t.composition_alias, arr);
	}

	for (const [alias, rowsForAlias] of byAlias) {
		if (resolvedKits.some((k) => k.properties.has(alias))) continue; // a layer already declares it
		rowsForAlias.sort((a, b) => a.priority_index - b.priority_index || a.id.localeCompare(b.id));
		target.properties.set(alias, {
			property: alias,
			value: '',
			sourceLayerId: '',
			kitId: target.kitId,
			isToken: true,
			tokenAlias: alias,
			tokenId: null,
			conditionCount: 0,
			keys: [],
			conditionValues: [],
			viewRefs: rowsForAlias.map((r) => ({
				viewId: (r.value as { view_id: string }).view_id,
				tokenId: r.id
			}))
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

	// axisArgs, project-wide compositions, and token scopes are independent -- fetch in parallel.
	// axis_args and compositions are fetched PROJECT-WIDE (not scoped to `viewId` alone) since a
	// 'linked' axis_args value (drag-to-lock) can point at any other view in the project, and
	// resolveAllLinkedArgs needs the full project-wide compositions set to tell a dangling link
	// (source kit no longer composed by that view) apart from a genuinely unset one.
	const [axisArgsRows, projectCompositionsRows, tokenMap] = await Promise.all([
		projectId
			? db
					.selectFrom('axis_args')
					.innerJoin('views', 'views.id', 'axis_args.view_id')
					.where('views.project_id', '=', projectId)
					.select(['axis_args.view_id', 'axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
					.execute()
			: Promise.resolve([]),
		projectId
			? db
					.selectFrom('compositions')
					.innerJoin('views', 'views.id', 'compositions.view_id')
					.where('views.project_id', '=', projectId)
					.select(['compositions.view_id', 'compositions.kit_id'])
					.execute()
			: Promise.resolve([]),
		gatherScopedTokens(db, projectId, allKitIds, viewId)
	]);

	const argsByViewKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgsRows) {
		if (!arg.value) continue;
		const key = `${arg.view_id}::${arg.kit_id}`;
		if (!argsByViewKit.has(key)) argsByViewKit.set(key, {});
		argsByViewKit.get(key)![arg.axis_id] = arg.value as ArgValue;
	}
	const validCompositions = new Set(projectCompositionsRows.map((c) => `${c.view_id}::${c.kit_id}`));
	const resolvedArgsByViewKit = resolveAllLinkedArgs(argsByViewKit, validCompositions);

	const argsByKit = new Map<string, Record<string, ArgValue>>();
	for (const kitId of allKitIds) {
		argsByKit.set(kitId, resolvedArgsByViewKit.get(`${viewId}::${kitId}`) ?? {});
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
				const value = tv ? (tv.type === 'scalar' ? tv.value : tv.view_id) : (entry.literalValue ?? '');
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
		.select(['compositions.kit_id', 'kits.name as kit_name', 'kits.project_id'])
		.execute();

	const allKitIds = compositions.map((c) => c.kit_id);
	if (allKitIds.length === 0) return [];

	const projectId = compositions[0]?.project_id;

	// Project-wide for the same reason as resolveManySlowPath -- a 'linked' axis_args value can point
	// at any other view in the project, and resolveAllLinkedArgs needs the project-wide compositions
	// set to tell a dangling link apart from a genuinely unset one.
	const [axisArgsRows, projectCompositionsRows] = await Promise.all([
		projectId
			? db
					.selectFrom('axis_args')
					.innerJoin('views', 'views.id', 'axis_args.view_id')
					.where('views.project_id', '=', projectId)
					.select(['axis_args.view_id', 'axis_args.kit_id', 'axis_args.axis_id', 'axis_args.value'])
					.execute()
			: Promise.resolve([]),
		projectId
			? db
					.selectFrom('compositions')
					.innerJoin('views', 'views.id', 'compositions.view_id')
					.where('views.project_id', '=', projectId)
					.select(['compositions.view_id', 'compositions.kit_id'])
					.execute()
			: Promise.resolve([])
	]);

	const argsByViewKit = new Map<string, Record<string, ArgValue>>();
	for (const arg of axisArgsRows) {
		if (!arg.value) continue;
		const key = `${arg.view_id}::${arg.kit_id}`;
		if (!argsByViewKit.has(key)) argsByViewKit.set(key, {});
		argsByViewKit.get(key)![arg.axis_id] = arg.value as ArgValue;
	}
	const validCompositions = new Set(projectCompositionsRows.map((c) => `${c.view_id}::${c.kit_id}`));
	const resolvedArgsByViewKit = resolveAllLinkedArgs(argsByViewKit, validCompositions);

	const argsByKit = new Map<string, Record<string, ArgValue>>();
	for (const kitId of allKitIds) {
		argsByKit.set(kitId, resolvedArgsByViewKit.get(`${viewId}::${kitId}`) ?? {});
	}

	const cascadeByKit = await resolveAllCascade(db, allKitIds, argsByKit);

	return compositions.map((comp) => ({
		kitId: comp.kit_id,
		kitName: comp.kit_name,
		layers: cascadeByKit.get(comp.kit_id) ?? []
	}));
}

// Cross-kit merge: for each property key, the kit with the SINGLE MOST SPECIFIC matching layer
// wins outright, regardless of kit composition order -- kit order only breaks a tie between two
// equally-specific candidates (in which case the later/higher-priority kit wins, preserving the
// old plain-overwrite behavior for the by-far-most-common case: an uncontested property, or two
// null/unconditioned layers). Before this, kit order alone decided every contested property, full
// stop, so a lower-priority kit's real, correctly-conditioned layer could never show through once
// ANY higher-priority kit defined that property at all -- even from that kit's own unconditioned
// null layer (conditionCount 0). A user painting a conditional variant onto a kit that wasn't on
// top of the composition would see a real DB write (a real layer, a real dot) with zero visible
// effect: the write was never wrong, only invisible. `conditionCount` alone (not the full
// [count, ...axisPriorities] specificity `computeSpecificity` uses within one kit) is the
// cross-kit signal -- two DIFFERENT kits' layers tying on conditionCount but differing by axis
// priority fall back to kit order, a deliberate, documented scope cut (rare in practice: it only
// matters when two different kits both condition the SAME property on the same number of axes).
// Mirrored exactly in Charter's merge_kits (plugins/charter/src/lib.rs) -- the two must never
// disagree, since this function only ever feeds the editor's Render-panel inspector while
// merge_kits feeds what actually renders/exports. Keep them in lockstep.
export function flattenKitResults(kits: ResolvedKit[]): Map<string, ResolvedProperty> {
	const merged = new Map<string, ResolvedProperty>();
	for (const kit of kits) {
		for (const [prop, resolved] of kit.properties) {
			const existing = merged.get(prop);
			if (existing && existing.conditionCount > resolved.conditionCount) continue;
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
		rows.tokenAxisOverrides,
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
	tokenAxisOverrides: TokenAxisOverrideRow[];
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
	id: string;
	alias: string | null;
	composition_alias: string | null;
	value: TokenValue | null;
	priority_index: number;
}
export interface ViewTokenRow {
	id: string;
	view_id: string | null;
	alias: string | null;
	composition_alias: string | null;
	value: TokenValue | null;
	priority_index: number;
}
export interface KitTokenRow {
	id: string;
	alias: string | null;
	composition_alias: string | null;
	value: TokenValue | null;
	kit_id: string | null;
	priority_index: number;
}
export interface TokenAxisOverrideRow {
	token_id: string;
	axis_id: string;
	value: unknown;
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
		SELECT 'project_tokens' AS tag, jsonb_build_object(
			'id', t.id, 'alias', t.alias, 'composition_alias', t.composition_alias, 'value', t.value,
			'priority_index', t.priority_index
		) AS data
		FROM tokens t
		WHERE t.project_id = ${projectId}
			AND t.kit_id IS NULL
			AND t.view_id IS NULL
			AND (t.alias IS NOT NULL OR t.composition_alias IS NOT NULL)
		UNION ALL
		SELECT 'view_tokens' AS tag, jsonb_build_object(
			'id', t.id, 'view_id', t.view_id, 'alias', t.alias, 'composition_alias', t.composition_alias,
			'value', t.value, 'priority_index', t.priority_index
		) AS data
		FROM tokens t
		WHERE t.view_id IN (SELECT id FROM project_view_ids)
			AND (t.alias IS NOT NULL OR t.composition_alias IS NOT NULL)
		UNION ALL
		SELECT 'kit_tokens' AS tag, jsonb_build_object(
			'id', t.id, 'alias', t.alias, 'composition_alias', t.composition_alias, 'value', t.value,
			'kit_id', t.kit_id, 'priority_index', t.priority_index
		) AS data
		FROM tokens t
		WHERE t.kit_id IN (SELECT kit_id FROM project_kit_ids)
			AND (t.alias IS NOT NULL OR t.composition_alias IS NOT NULL)
		UNION ALL
		SELECT 'token_axis_overrides' AS tag, jsonb_build_object(
			'token_id', tao.token_id, 'axis_id', tao.axis_id, 'value', tao.value
		) AS data
		FROM token_axis_overrides tao
		JOIN tokens t ON t.id = tao.token_id
		WHERE t.project_id = ${projectId}
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
			'token_id', re.token_id,
			'token_alias', CASE WHEN t.value ->> 'type' = 'view' THEN t.composition_alias ELSE t.alias END,
			'token_value', t.value
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
		token_axis_overrides: [] as TokenAxisOverrideRow[],
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
		tokenAxisOverrides: grouped.token_axis_overrides,
		layers: grouped.layers,
		conditions: grouped.conditions,
		entries: grouped.entries
	};
}

// One occurrence whose reference (a specific `view`-typed token row) carries ≥1 row in
// token_axis_overrides -- i.e. a per-instance variant pick that diverges from the referenced
// view's own stored axis_args. `occurrenceKey` is the referencing token's own id: stable, unique,
// and (via one more join) resolvable back to "which alias, which parent, which override rows."
// This is additive -- computed only for overridden references, alongside (never replacing) each
// view's single project-wide `ResolvedViewData` entry in `views`, which keeps reflecting that
// view's own stored axis_args unchanged for every non-overriding use (its own direct display, or
// any other reference that doesn't override). A project with zero overrides anywhere produces
// `overriddenOccurrences: []` and costs nothing extra.
//
// Consumed by Charter's `occurrence_map` (see plugins/charter/src/lib.rs's OverriddenOccurrence
// struct) and by the Editor's occurrence-aware selection/drag/navigation (view-tree.ts) -- both
// keyed by `occurrenceKey`, not just `viewId`, per CLAUDE.md's occurrence-key architecture.
export interface OverriddenOccurrence {
	occurrenceKey: string;
	viewId: string;
	resolvedKits: ResolvedKit[];
}

// The one place in this file that walks a 'linked' chain -- a view's own axis_args cell (drag-to-
// lock, "parent view becomes source of truth for a child's axis") or a token_axis_overrides entry
// (the separate per-occurrence override mechanism) can both be 'linked', and either can point at a
// cell that is ITSELF linked, so a single-hop lookup is not enough once a view's own axis_args can
// hold this shape. Cycle safety mirrors Views.svelte's isDescendant (a flat visited `seen` set), not
// cloneViewSubtreeImpl's per-position ancestor chain -- a single (view,kit,axis) cell has AT MOST ONE
// link target (never multiple simultaneous paths the way composition children/diamonds do), so
// there's no diamond case to distinguish from a genuine cycle, only a linear chain that must
// terminate on first repeat. `validCompositions` (keys `${viewId}::${kitId}`) makes a link through a
// kit no longer composed by that view degrade to dangling instead of silently reading through an
// orphaned axis_args row -- detachKitFromComposition already leaves such rows behind uncleaned
// (existing, precedented behavior), so without this check a link whose source kit was later detached
// would keep resolving through the stale row instead of degrading to unset. Server/resolve call
// sites always pass it; display-only UI call sites may omit it as a stated simplification. Any
// termination case (cycle, dangling, or the axis simply never set at that cell) returns `undefined`
// -- matchLayers already treats "no arg for this axis" as "that layer's condition never matches, the
// null/unconditioned layer wins" (its `axisArgs[c.axisId]` / `!arg` check), which is exactly the
// correct "unset" behavior here too.
export function resolveLinkedArg(
	viewId: string,
	kitId: string,
	axisId: string,
	argsByViewKit: Map<string, Record<string, ArgValue>>,
	seen: Set<string> = new Set(),
	validCompositions?: Set<string>
): ArgValue | undefined {
	const cellKey = `${viewId}::${kitId}::${axisId}`;
	if (seen.has(cellKey)) return undefined; // cycle
	seen.add(cellKey);
	if (validCompositions && !validCompositions.has(`${viewId}::${kitId}`)) return undefined; // dangling: kit no longer composed here
	const value = argsByViewKit.get(`${viewId}::${kitId}`)?.[axisId];
	if (!value) return undefined; // never set at this cell
	if (value.type !== 'linked') return value;
	return resolveLinkedArg(value.view_id, value.kit_id, axisId, argsByViewKit, seen, validCompositions);
}

// Bulk convenience over resolveLinkedArg: resolves every key already present in a raw argsByViewKit
// map, dropping any axis whose chain terminates unset, so every downstream consumer (the per-view
// baseline loop below, and mergeAxisOverrides) reads an already-resolved map and never has to know
// 'linked' exists at all.
function resolveAllLinkedArgs(
	argsByViewKit: Map<string, Record<string, ArgValue>>,
	validCompositions: Set<string>
): Map<string, Record<string, ArgValue>> {
	const result = new Map<string, Record<string, ArgValue>>();
	for (const [key, raw] of argsByViewKit) {
		const [viewId, kitId] = key.split('::');
		const resolved: Record<string, ArgValue> = {};
		for (const axisId of Object.keys(raw)) {
			const v = resolveLinkedArg(viewId!, kitId!, axisId, argsByViewKit, new Set(), validCompositions);
			if (v) resolved[axisId] = v;
		}
		result.set(key, resolved);
	}
	return result;
}

// Merges a target view+kit's own axis_args (`base`) with one occurrence's per-token overrides
// (`overrides`), overrides winning key-for-key. A 'literal'/'range' override is a static snapshot.
// A 'linked' override is NOT a snapshot -- it re-reads its source (view, kit)'s CURRENT axis_args
// every time this runs, so a later change to the source (including clearAxisArg unsetting it) is
// picked up automatically on the next resolve, no invalidation logic needed. `argsByViewKit` here is
// expected to be the ALREADY-RESOLVED map (resolveAllLinkedArgs's output, never raw) -- passing it
// through resolveLinkedArg still works correctly (a resolved map has no 'linked' entries left, so it
// resolves in exactly one lookup), and this way there is exactly one resolution pass per view/kit,
// never a redundant re-walk from inside the override branch. See resolveLinkedArg's own doc comment
// for the "no entry -> delete the key" unset rule.
function mergeAxisOverrides(
	base: Record<string, ArgValue>,
	overrides: Record<string, ArgValue>,
	argsByViewKit: Map<string, Record<string, ArgValue>>
): Record<string, ArgValue> {
	const result = { ...base };
	for (const [axisId, value] of Object.entries(overrides)) {
		if (value.type === 'linked') {
			const sourceValue = resolveLinkedArg(value.view_id, value.kit_id, axisId, argsByViewKit);
			if (sourceValue) result[axisId] = sourceValue;
			else delete result[axisId];
		} else {
			result[axisId] = value;
		}
	}
	return result;
}

// Pure in-memory resolution: a function of the fetched rows only. No db, no await.
// Split out from the fetch so the editor can dedup on the rows (input) before paying
// for the resolve + serialize + plugin call (output) when nothing actually changed.
export function resolveViewsFromRows(rows: ResolutionRows): {
	views: ResolvedViewData[];
	overriddenOccurrences: OverriddenOccurrence[];
} {
	if (rows.viewRows.length === 0) return { views: [], overriddenOccurrences: [] };

	const allKitIds = [...new Set(rows.compositions.map((c) => c.kit_id))];

	if (allKitIds.length === 0) {
		return {
			views: rows.viewRows.map((v) => ({
				viewId: v.id,
				viewName: v.name,
				hints: (v.hints ?? null) as Record<string, unknown> | null,
				resolvedKits: []
			})),
			overriddenOccurrences: []
		};
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
	const baseScalarMap = new Map<string, string>();
	const baseViewRefMap = new Map<string, { viewId: string; tokenId: string }[]>();
	applyScopeTokenRows(rows.projectTokens, baseScalarMap, baseViewRefMap);

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
	// rows.compositions is already project-wide (see fetchResolutionRows), so this is exactly the
	// "which (view,kit) pairs genuinely exist" set resolveLinkedArg needs to treat a link through a
	// detached/deleted kit as dangling rather than reading through an orphaned axis_args row.
	const validCompositions = new Set(rows.compositions.map((c) => `${c.view_id}::${c.kit_id}`));
	const resolvedArgsByViewKit = resolveAllLinkedArgs(argsByViewKit, validCompositions);

	// Keeps each view's own resolved token maps around so an overriding reference INTO that view
	// can reuse its target's token-substitution scope unchanged (an axis override only changes
	// Layer matching, never which tokens win by alias).
	const tokenMapsByView = new Map<string, ScopedTokenMaps>();

	mark('resolve:match:start');
	const views: ResolvedViewData[] = rows.viewRows.map((v) => {
		const comps = compsByView.get(v.id) ?? [];

		// Token resolution order: project → kit (in composition order) → view
		const scalarMap = new Map(baseScalarMap);
		const viewRefMap = new Map(baseViewRefMap);
		for (const comp of comps) {
			applyScopeTokenRows(tokensByKit.get(comp.kit_id) ?? [], scalarMap, viewRefMap);
		}
		applyScopeTokenRows(tokensByView.get(v.id) ?? [], scalarMap, viewRefMap);
		tokenMapsByView.set(v.id, { scalarMap, viewRefMap });

		const resolvedKits: ResolvedKit[] = comps.map((comp) => {
			const args = resolvedArgsByViewKit.get(`${v.id}::${comp.kit_id}`) ?? {};
			const properties = matchLayers(
				comp.kit_id,
				kitLayerDataMaps.get(comp.kit_id) ?? new Map(),
				args
			);
			substituteTokens(properties, { scalarMap, viewRefMap });
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

	// Per-occurrence axis overrides: additive, computed only for `view`-typed token rows that have
	// ≥1 row in token_axis_overrides. Zero-override projects (the common case) skip this entirely.
	const overriddenOccurrences: OverriddenOccurrence[] = [];
	if (rows.tokenAxisOverrides.length > 0) {
		const overridesByToken = new Map<string, Record<string, ArgValue>>();
		for (const o of rows.tokenAxisOverrides) {
			if (!o.value) continue;
			if (!overridesByToken.has(o.token_id)) overridesByToken.set(o.token_id, {});
			overridesByToken.get(o.token_id)![o.axis_id] = o.value as ArgValue;
		}

		const allViewTokenRows: { id: string; value: TokenValue | null }[] = [
			...rows.projectTokens,
			...rows.kitTokenRows,
			...rows.viewTokenRows
		];
		for (const t of allViewTokenRows) {
			if (t.value?.type !== 'view') continue;
			const override = overridesByToken.get(t.id);
			if (!override) continue;

			const targetViewId = t.value.view_id;
			const targetComps = compsByView.get(targetViewId) ?? [];
			const targetTokenMaps = tokenMapsByView.get(targetViewId) ?? {
				scalarMap: baseScalarMap,
				viewRefMap: baseViewRefMap
			};
			const resolvedKits: ResolvedKit[] = targetComps.map((comp) => {
				const baseArgs = resolvedArgsByViewKit.get(`${targetViewId}::${comp.kit_id}`) ?? {};
				const args = mergeAxisOverrides(baseArgs, override, resolvedArgsByViewKit);
				const properties = matchLayers(
					comp.kit_id,
					kitLayerDataMaps.get(comp.kit_id) ?? new Map(),
					args
				);
				substituteTokens(properties, targetTokenMaps);
				return { kitId: comp.kit_id, kitName: comp.kit_name, properties };
			});
			overriddenOccurrences.push({ occurrenceKey: t.id, viewId: targetViewId, resolvedKits });
		}
	}

	return { views, overriddenOccurrences };
}

// Convenience wrapper: fetch + resolve in one call. The editor's live-query loop uses
// fetchResolutionRows + resolveViewsFromRows separately so it can dedup on the rows
// before resolving. This wrapper exists for callers that don't need the dedup
// (tests, single-shot resolve, future export plugins). Deliberately drops
// `overriddenOccurrences` to keep this convenience wrapper's long-standing `ResolvedViewData[]`
// contract unchanged -- a caller that wants per-occurrence override data should call
// fetchResolutionRows + resolveViewsFromRows directly.
export async function resolveManyViews(
	db: SchemaDialect,
	projectId: string
): Promise<ResolvedViewData[]> {
	const rows = await fetchResolutionRows(db, projectId);
	return resolveViewsFromRows(rows).views;
}

// Benchmark for the resolver-sync-fetch-row-dedup optimization.
//
// Run:  npm run bench            (from manager/)
//   or  npx vitest bench src/resolve/resolve.bench.ts
//
// What this measures
// ------------------
// The optimization changed two things and left the resolution MATH untouched:
//   1. Fetch shape: 4 sequential await-groups (RT1→RT2→RT3→RT4, ~9 queries) collapsed
//      into ONE batched UNION ALL query (1 crossing into the PGlite worker).
//   2. Dedup: an output fingerprint (kitFingerprint, run twice per view) replaced by an
//      input row-key (rowsKey, run once) that lets an unchanged fetch skip resolve entirely.
//
// So the honest comparison is old-fetch vs new-fetch feeding the SAME pure resolver
// (`resolveViewsFromRows`). `fetchResolutionRowsLegacy` below is the exact 4-RT query
// sequence lifted from `main`'s `resolveManyViews`, returning the same `ResolutionRows`
// the new path produces. `beforeAll` asserts both fetches resolve to byte-identical
// output (parity gate) and reports the query-count delta.
//
// IMPORTANT caveat on the numbers
// -------------------------------
// This runs PGlite IN-PROCESS (node), with no Web Worker boundary. In the real app PGlite
// lives in a worker, so every round-trip pays postMessage serialization both ways -- a cost
// this environment does NOT have. The query-COUNT reduction (9 → 1) is environment-independent
// and is the core structural win; the wall-TIME reduction shown here is a conservative LOWER
// BOUND on the browser win, where each of the 8 eliminated crossings also drops a worker hop.

import { bench, describe } from 'vitest';
import { sql } from 'kysely';
import { createTestDb, type TestContext } from '../test-helpers.js';
import {
	fetchResolutionRows,
	resolveViewsFromRows,
	rowsKey,
	type ResolutionRows,
	type ResolvedViewData
} from './resolve.js';
import type { SchemaDialect, TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

// ---------------------------------------------------------------------------
// Legacy fetch: the exact 4-round-trip sequence from main's resolveManyViews,
// returning the same ResolutionRows the batched path produces. Only the FETCH is
// reproduced -- the compute half is the shared, unchanged resolveViewsFromRows.
// ---------------------------------------------------------------------------
async function fetchResolutionRowsLegacy(
	db: SchemaDialect,
	projectId: string
): Promise<ResolutionRows> {
	const empty: ResolutionRows = {
		viewRows: [],
		compositions: [],
		axisArgsRows: [],
		projectTokens: [],
		viewTokenRows: [],
		kitTokenRows: [],
		tokenAxisOverrides: [],
		layers: [],
		conditions: [],
		entries: []
	};

	// RT1: views
	const viewRows = await db
		.selectFrom('views')
		.selectAll()
		.where('views.project_id', '=', projectId)
		.execute();
	if (viewRows.length === 0) return empty;
	const viewIds = viewRows.map((v) => v.id);

	// RT2: compositions + axis_args + project tokens + view tokens (parallel group)
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
				'kits.name as kit_name'
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
			.where((eb) => eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)]))
			.select(['tokens.id', 'tokens.alias', 'tokens.composition_alias', 'tokens.value', 'tokens.priority_index'])
			.execute(),
		db
			.selectFrom('tokens')
			.where('tokens.view_id', 'in', viewIds)
			.where((eb) => eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)]))
			.select([
				'tokens.id',
				'tokens.view_id',
				'tokens.alias',
				'tokens.composition_alias',
				'tokens.value',
				'tokens.priority_index'
			])
			.execute()
	]);

	const allKitIds = [...new Set(compositions.map((c) => c.kit_id))];
	if (allKitIds.length === 0) {
		return {
			...empty,
			viewRows: viewRows as ResolutionRows['viewRows'],
			compositions,
			axisArgsRows,
			projectTokens,
			viewTokenRows
		};
	}

	// RT3: kit tokens + layers + token axis overrides (parallel group)
	const [kitTokenRows, layers, tokenAxisOverrides] = await Promise.all([
		db
			.selectFrom('tokens')
			.where('tokens.kit_id', 'in', allKitIds)
			.where((eb) => eb.or([eb('tokens.alias', 'is not', null), eb('tokens.composition_alias', 'is not', null)]))
			.select([
				'tokens.id',
				'tokens.alias',
				'tokens.composition_alias',
				'tokens.value',
				'tokens.kit_id',
				'tokens.priority_index'
			])
			.execute(),
		db
			.selectFrom('layers')
			.where('layers.kit_id', 'in', allKitIds)
			.select(['layers.id', 'layers.kit_id'])
			.execute(),
		db
			.selectFrom('token_axis_overrides')
			.innerJoin('tokens', 'tokens.id', 'token_axis_overrides.token_id')
			.where('tokens.project_id', '=', projectId)
			.select([
				'token_axis_overrides.token_id',
				'token_axis_overrides.axis_id',
				'token_axis_overrides.value'
			])
			.execute()
	]);

	// RT4: layer conditions + entries (parallel group)
	const layerIds = layers.map((l) => l.id);
	const [conditions, entries] =
		layerIds.length > 0
			? await Promise.all([
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
							sql<string | null>`CASE WHEN tokens.value ->> 'type' = 'view' THEN tokens.composition_alias ELSE tokens.alias END`.as(
								'token_alias'
							),
							'tokens.value as token_value'
						])
						.execute()
				])
			: [[], []];

	return {
		viewRows: viewRows as ResolutionRows['viewRows'],
		compositions,
		axisArgsRows: axisArgsRows as ResolutionRows['axisArgsRows'],
		projectTokens: projectTokens as ResolutionRows['projectTokens'],
		viewTokenRows: viewTokenRows as ResolutionRows['viewTokenRows'],
		kitTokenRows: kitTokenRows as ResolutionRows['kitTokenRows'],
		tokenAxisOverrides: tokenAxisOverrides as ResolutionRows['tokenAxisOverrides'],
		layers,
		conditions: conditions as ResolutionRows['conditions'],
		entries: entries as ResolutionRows['entries']
	};
}

// ---------------------------------------------------------------------------
// Scalable seed: builds a project with a configurable number of axes/kits/layers/
// views so the benchmark stresses fetch volume the way a real design system would.
// ---------------------------------------------------------------------------
interface SeedShape {
	axes: number;
	valuesPerAxis: number;
	projectTokens: number;
	kits: number;
	layersPerKit: number; // conditioned layers (a null baseline layer is added on top)
	entriesPerLayer: number;
	views: number;
	kitsPerView: number;
}

async function seedScaled(ctx: TestContext, shape: SeedShape): Promise<string> {
	const { api } = ctx;
	const ws = (await api.getAllWorkspaces().execute())[0]!;
	const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'Bench Project'))!;

	// Axes + values
	const axisValueIds: string[][] = [];
	const axisIds: string[] = [];
	for (let a = 0; a < shape.axes; a++) {
		const axis = (await api.createAxis(
			proj.id,
			`axis${a}`,
			'',
			'categorical',
			Array.from({ length: shape.valuesPerAxis }, (_, i) => `v${a}_${i}`)
		))!;
		axisIds.push(axis.id);
		const vids: string[] = [];
		for (let i = 0; i < shape.valuesPerAxis; i++) {
			const av = (await api.createAxisValue(axis.id, { type: 'literal', value: `v${a}_${i}` }))!;
			vids.push(av.id);
		}
		axisValueIds.push(vids);
	}

	// Project tokens (some layers reference these)
	const tokenIds: string[] = [];
	for (let t = 0; t < shape.projectTokens; t++) {
		const tok = (await api.createToken(proj.id, `token.${t}`, s(`#${(t * 111111) % 1000000}`)))!;
		tokenIds.push(tok.id);
	}

	// Kits, each consuming all axes, with a null layer + conditioned layers + entries
	const kitIds: string[] = [];
	for (let k = 0; k < shape.kits; k++) {
		const kit = (await api.createKitInProject(proj.id, `kit${k}`))!;
		kitIds.push(kit.id);
		for (let a = 0; a < shape.axes; a++) {
			await api.consumeAxis(kit.id, axisIds[a]!);
			await api.reorderAxesInKit(kit.id, axisIds[a]!, (a + 1) * 1000);
		}

		// Null baseline layer
		const nullLayer = (await api.createLayer(kit.id))!;
		const nullSnippet = (await api.createRenderSnippet(nullLayer.id))!;
		for (let e = 0; e < shape.entriesPerLayer; e++) {
			// Every 3rd entry is token-backed to exercise token substitution.
			if (e % 3 === 0 && tokenIds.length > 0) {
				await api.createRenderEntry(nullSnippet.id, `prop${e}`, null, tokenIds[e % tokenIds.length]!);
			} else {
				await api.createRenderEntry(nullSnippet.id, `prop${e}`, `#${(e * 12345) % 1000000}`);
			}
		}

		// Conditioned layers: each pins 1-2 axis values.
		for (let l = 0; l < shape.layersPerKit; l++) {
			const layer = (await api.createLayer(kit.id))!;
			const a1 = l % shape.axes;
			await api.addAxisValueToLayer(layer.id, axisValueIds[a1]![l % shape.valuesPerAxis]!);
			if (l % 2 === 0 && shape.axes > 1) {
				const a2 = (a1 + 1) % shape.axes;
				await api.addAxisValueToLayer(layer.id, axisValueIds[a2]![l % shape.valuesPerAxis]!);
			}
			const snippet = (await api.createRenderSnippet(layer.id))!;
			for (let e = 0; e < shape.entriesPerLayer; e++) {
				await api.createRenderEntry(snippet.id, `prop${e}`, `#${(l * e * 999) % 1000000}`);
			}
		}
	}

	// Views, each composing a rotating window of kits with axis args set.
	for (let vw = 0; vw < shape.views; vw++) {
		const view = (await api.createViewInProject(proj.id, `view${vw}`))!;
		for (let c = 0; c < shape.kitsPerView; c++) {
			const kitId = kitIds[(vw + c) % kitIds.length]!;
			await api.attachKitToComposition(kitId, view.id);
			for (let a = 0; a < shape.axes; a++) {
				await api.setAxisArg(view.id, kitId, axisIds[a]!, {
					type: 'literal',
					value: `v${a}_${vw % shape.valuesPerAxis}`
				});
			}
		}
	}

	return proj.id;
}

// Stable serialization for the parity gate (Maps don't deep-compare natively).
function comparable(views: ResolvedViewData[]): string {
	return JSON.stringify(
		[...views]
			.sort((a, b) => a.viewId.localeCompare(b.viewId))
			.map((v) => ({
				viewId: v.viewId,
				viewName: v.viewName,
				kits: v.resolvedKits.map((k) => ({
					kitId: k.kitId,
					kitName: k.kitName,
					viewRefs: [...(k.properties.get('children')?.viewRefs ?? [])]
						.map((r) => r.viewId)
						.sort(),
					properties: Object.fromEntries(
						[...k.properties.entries()]
							.sort(([a], [b]) => a.localeCompare(b))
							.map(([p, r]) => [p, r.value])
					)
				}))
			}))
	);
}

// Counts how many queries each fetch path issues against PGlite. The kysely
// PgliteDialect calls `pg.query`/`pg.exec`; wrapping both gives a faithful crossing count.
function instrumentQueries(pg: TestContext['pg']) {
	let count = 0;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const anyPg = pg as any;
	const origQuery = anyPg.query?.bind(pg);
	const origExec = anyPg.exec?.bind(pg);
	if (origQuery) anyPg.query = (...args: unknown[]) => (count++, origQuery(...args));
	if (origExec) anyPg.exec = (...args: unknown[]) => (count++, origExec(...args));
	return {
		get count() {
			return count;
		},
		reset() {
			count = 0;
		},
		restore() {
			if (origQuery) anyPg.query = origQuery;
			if (origExec) anyPg.exec = origExec;
		}
	};
}

// ---------------------------------------------------------------------------

const SHAPE: SeedShape = {
	axes: 5,
	valuesPerAxis: 4,
	projectTokens: 24,
	kits: 12,
	layersPerKit: 8,
	entriesPerLayer: 6,
	views: 30,
	kitsPerView: 3
};

// --- Setup runs at module-evaluation time (top-level await). vitest awaits module
// import before executing any bench, so ctx/rows are guaranteed populated -- more robust
// than beforeAll under the experimental bench runner. ---
const ctx: TestContext = await createTestDb();
const t0 = performance.now();
const projectId: string = await seedScaled(ctx, SHAPE);
const seedMs = performance.now() - t0;

// Parity gate: legacy fetch and batched fetch must resolve identically.
const legacyRows = await fetchResolutionRowsLegacy(ctx.db, projectId);
const batchedRows = await fetchResolutionRows(ctx.db, projectId);
const seededRows: ResolutionRows = batchedRows; // reused for pure-compute + dedup benches
const seededKey: string = rowsKey(batchedRows);

if (
	comparable(resolveViewsFromRows(legacyRows).views) !==
	comparable(resolveViewsFromRows(batchedRows).views)
) {
	throw new Error('PARITY FAILURE: batched fetch resolves differently than the legacy 4-RT fetch');
}

// Query-count report (environment-independent structural win).
{
	const q = instrumentQueries(ctx.pg);
	q.reset();
	await fetchResolutionRowsLegacy(ctx.db, projectId);
	const legacyQueries = q.count;
	q.reset();
	await fetchResolutionRows(ctx.db, projectId);
	const batchedQueries = q.count;
	q.restore();

	const rowTotal =
		batchedRows.viewRows.length +
		batchedRows.compositions.length +
		batchedRows.axisArgsRows.length +
		batchedRows.projectTokens.length +
		batchedRows.viewTokenRows.length +
		batchedRows.kitTokenRows.length +
		batchedRows.layers.length +
		batchedRows.conditions.length +
		batchedRows.entries.length;

	/* eslint-disable no-console */
	console.log('\n──────────────── resolve benchmark: project shape ────────────────');
	console.log(
		`  seeded in ${seedMs.toFixed(0)}ms · ${SHAPE.kits} kits · ${SHAPE.views} views · ` +
			`${batchedRows.layers.length} layers · ${batchedRows.entries.length} entries · ` +
			`${rowTotal} resolution rows total`
	);
	console.log('──────────────── query count (structural, env-independent) ───────');
	console.log(`  legacy fetch (4 round-trip groups): ${legacyQueries} queries`);
	console.log(`  batched fetch (single UNION ALL):   ${batchedQueries} queries`);
	// The 9 queries are NOT 9 sequential stalls. They form a DEPENDENCY WATERFALL of 4
	// barriers (RT1 views → RT2 needs viewIds → RT3 needs kitIds → RT4 needs layerIds),
	// with Promise.all pipelining the queries WITHIN each barrier. So the wall-time cost
	// is ~4 round-trip latencies, not 9. The batched query dissolves the waterfall by
	// expressing each dependency as a SQL subquery -> 1 barrier. (9→1 messages still cuts
	// per-message main-thread serialize/dispatch CPU, a smaller, separate component.)
	const LEGACY_BARRIERS = 4;
	const BATCHED_BARRIERS = 1;
	console.log(
		`  message count:   9 → 1  (per-message dispatch/serialize CPU on the main thread)`
	);
	console.log(
		`  dependency depth: ${LEGACY_BARRIERS} → ${BATCHED_BARRIERS}  ` +
			`(sequential round-trip stalls - the wall-time-relevant one)`
	);

	// --- In-process CPU baseline (quick median) ---
	const median = async (fn: () => Promise<unknown>, iters = 15): Promise<number> => {
		for (let i = 0; i < 3; i++) await fn(); // warmup
		const times: number[] = [];
		for (let i = 0; i < iters; i++) {
			const a = performance.now();
			await fn();
			times.push(performance.now() - a);
		}
		times.sort((x, y) => x - y);
		return times[Math.floor(times.length / 2)]!;
	};
	const legacyCpu = await median(() => fetchResolutionRowsLegacy(ctx.db, projectId));
	const batchedCpu = await median(() => fetchResolutionRows(ctx.db, projectId));

	console.log('──────────────── in-process CPU (no worker boundary) ─────────────');
	console.log(
		`  legacy fetch: ${legacyCpu.toFixed(2)}ms   batched fetch: ${batchedCpu.toFixed(2)}ms   ` +
			`(≈ equal - node has no IPC to save; batched query is marginally heavier CPU)`
	);

	// --- Browser projection: the win node can't measure is the worker round-trip stalls.
	// Model wall = exec_cpu + barriers × L, where L is one worker round-trip latency. This
	// is the KEY point: exec_cpu is a FLOOR the batching does not move (PGlite is single-
	// threaded - the same rows get computed either way, batched is even slightly more CPU).
	// Only the (barriers × L) term shrinks (4L → 1L). So it's "substantially cheaper" ONLY
	// when 3×L is large relative to the ~14ms execution floor - i.e. when round-trips are
	// slow (contended main thread, slow OPFS), not on an idle worker. ---
	console.log('──────────────── projected browser fetch (exec_cpu + barriers×L) ──');
	console.log('  round-trip L │  legacy (4 barriers) │  batched (1) │  speedup');
	for (const L of [0.5, 1.0, 3.0, 6.0]) {
		const legacyMs = legacyCpu + LEGACY_BARRIERS * L;
		const batchedMs = batchedCpu + BATCHED_BARRIERS * L;
		console.log(
			`    ${L.toFixed(1)}ms      │  ${legacyMs.toFixed(2)}ms`.padEnd(38) +
				`│  ${batchedMs.toFixed(2)}ms`.padEnd(15) +
				`│  ${(legacyMs / batchedMs).toFixed(2)}×`
		);
	}
	console.log(
		'  (exec_cpu is measured; L is the assumption. Execution dominates on an idle\n' +
			'   worker → modest win; the waterfall dominates under latency → substantial.)'
	);
	console.log('──────────────── per-op stats (vitest bench, below) ──────────────');
	console.log('  Read the `legacy` vs `batched` rows pairwise - the auto-Summary ranks all');
	console.log('  benches against the single fastest (compute), which is not the comparison.\n');
	/* eslint-enable no-console */
}

describe('resolver optimization benchmark', () => {
	// Fetch only: the half that actually changed.
	bench('fetch: legacy 4 round-trips', async () => {
		await fetchResolutionRowsLegacy(ctx.db, projectId);
	});

	bench('fetch: batched single query', async () => {
		await fetchResolutionRows(ctx.db, projectId);
	});

	// Full cycle: fetch + pure resolve, both feeding the same resolver.
	bench('cycle: legacy fetch + resolve', async () => {
		resolveViewsFromRows(await fetchResolutionRowsLegacy(ctx.db, projectId));
	});

	bench('cycle: batched fetch + resolve', async () => {
		resolveViewsFromRows(await fetchResolutionRows(ctx.db, projectId));
	});

	// Pure compute in isolation (unchanged by the optimization; shown for context).
	bench('compute: resolveViewsFromRows (pure, no db)', () => {
		resolveViewsFromRows(seededRows);
	});

	// Dedup: the cost of deciding "nothing changed, skip". This runs on EVERY live-query
	// fire; the win is skipping the whole resolve when the key matches.
	bench('dedup: rowsKey (input hash, run once per fire)', () => {
		rowsKey(seededRows);
	});

	bench('dedup: skip decision when unchanged (rowsKey + compare)', () => {
		const key = rowsKey(seededRows);
		if (key === seededKey) {
			/* skip: no resolve, no serialize, no plugin call */
		}
	});
});

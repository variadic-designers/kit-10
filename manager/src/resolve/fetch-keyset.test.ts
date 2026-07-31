import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';
import {
	fetchResolutionRows,
	type ViewRow,
	type CompositionRow,
	type AxisArgRow,
	type ProjectTokenRow,
	type ViewTokenRow,
	type KitTokenRow,
	type TokenAxisOverrideRow,
	type LayerRow,
	type ConditionRow,
	type EntryRow
} from './resolve.js';
import type { TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

// Belt-and-suspenders for the batched fetch's one weak spot: the jsonb the SQL emits per
// branch is coupled to the `${tag}Row` interfaces only by hand, and the output-parity test
// (batched-fetch.test.ts) can't catch a key that silently disappears if the resolver reads
// it with a `?? default` fallback -- the field just goes quietly missing.
//
// The `Record<keyof XRow, true>` literals below are the compile-time half: change an
// interface and the matching literal stops compiling (missing/extra key), forcing this file
// to be updated in lockstep. The runtime assertions are the SQL half: a real fetch's row
// keys are compared against those same literals. Transitively, SQL ⇄ interface stays honest.
//
// `to_jsonb(table)` branches (views, axis_args, layers) return the whole row, so extra
// columns are expected -- those are checked as a SUPERSET (interface keys all present).
// `jsonb_build_object` branches emit exactly their listed keys -- checked as EXACT.

const viewKeys: Record<keyof ViewRow, true> = { id: true, name: true, hints: true };
const compositionKeys: Record<keyof CompositionRow, true> = {
	view_id: true,
	kit_id: true,
	priority_index: true,
	kit_name: true
};
const axisArgKeys: Record<keyof AxisArgRow, true> = {
	view_id: true,
	kit_id: true,
	axis_id: true,
	value: true
};
const projectTokenKeys: Record<keyof ProjectTokenRow, true> = {
	id: true,
	alias: true,
	composition_alias: true,
	value: true,
	priority_index: true
};
const viewTokenKeys: Record<keyof ViewTokenRow, true> = {
	id: true,
	view_id: true,
	alias: true,
	composition_alias: true,
	value: true,
	priority_index: true
};
const kitTokenKeys: Record<keyof KitTokenRow, true> = {
	id: true,
	alias: true,
	composition_alias: true,
	value: true,
	kit_id: true,
	priority_index: true
};
const tokenAxisOverrideKeys: Record<keyof TokenAxisOverrideRow, true> = {
	token_id: true,
	axis_id: true,
	value: true
};
const layerKeys: Record<keyof LayerRow, true> = { id: true, kit_id: true };
const conditionKeys: Record<keyof ConditionRow, true> = {
	layer_id: true,
	value: true,
	axis_id: true,
	priority_index: true
};
const entryKeys: Record<keyof EntryRow, true> = {
	layer_id: true,
	property: true,
	literal_value: true,
	token_id: true,
	token_alias: true,
	token_value: true
};

function assertExact(row: object | undefined, keymap: Record<string, true>, label: string) {
	expect(row, `${label}: rowset is empty -- seed must populate it for this guard to work`).toBeDefined();
	expect(Object.keys(row!).sort(), `${label}: emitted jsonb keys must exactly match ${label}Row`).toEqual(
		Object.keys(keymap).sort()
	);
}

function assertSuperset(row: object | undefined, keymap: Record<string, true>, label: string) {
	expect(row, `${label}: rowset is empty -- seed must populate it for this guard to work`).toBeDefined();
	const rowKeys = new Set(Object.keys(row!));
	const missing = Object.keys(keymap).filter((k) => !rowKeys.has(k));
	expect(missing, `${label}: to_jsonb row is missing keys declared on ${label}Row`).toEqual([]);
}

describe('batched fetch key-set matches row interfaces', () => {
	let ctx: TestContext;
	beforeEach(async () => {
		ctx = await createTestDb();
	});
	afterEach(async () => {
		await ctx.pg.close();
	});

	// Seeds a project that populates every one of the 9 rowsets at least once.
	async function seedAllRowsets(): Promise<string> {
		const { api } = ctx;
		const ws = (await api.getAllWorkspaces().execute())[0]!;
		const proj = (await api.createProjectInWorkspace(ws.workspaceId, 'Keyset'))!;

		const axis = (await api.createAxis(proj.id, 'theme', '', 'categorical', ['light', 'dark']))!;
		const dark = (await api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;

		const kit = (await api.createKitInProject(proj.id, 'Button'))!;
		await api.consumeAxis(kit.id, axis.id);

		// project / kit / view scoped tokens (each needs a non-null alias to be selected)
		const projTok = (await api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;
		await api.createToken(proj.id, 'colors.kit', s('#111111'), { kitId: kit.id });

		// null baseline layer + a conditioned layer -> layers, conditions, entries
		const nullLayer = (await api.createLayer(kit.id))!;
		const nullSnippet = (await api.createRenderSnippet(nullLayer.id))!;
		await api.createRenderEntry(nullSnippet.id, 'background', null, projTok.id);
		await api.createRenderEntry(nullSnippet.id, 'color', '#ffffff');

		const darkLayer = (await api.createLayer(kit.id))!;
		await api.addAxisValueToLayer(darkLayer.id, dark.id);
		const darkSnippet = (await api.createRenderSnippet(darkLayer.id))!;
		await api.createRenderEntry(darkSnippet.id, 'background', '#1e293b');

		// view + composition + axis arg + view-scoped token
		const view = (await api.createViewInProject(proj.id, 'Dark'))!;
		await api.attachKitToComposition(kit.id, view.id);
		await api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'dark' });
		await api.createToken(proj.id, 'colors.view', s('#222222'), { viewId: view.id });

		// a `view`-typed token with an axis override, to populate token_axis_overrides
		const otherView = (await api.createViewInProject(proj.id, 'Referenced'))!;
		const viewTok = (await api.addViewRef(proj.id, view.id, 'children', otherView.id))!;
		await api.setTokenAxisOverride(viewTok.id, axis.id, { type: 'literal', value: 'dark' });

		return proj.id;
	}

	it('every jsonb branch emits exactly (or, for to_jsonb, a superset of) its row interface keys', async () => {
		const rows = await fetchResolutionRows(ctx.db, await seedAllRowsets());

		// to_jsonb(table) -> whole row, superset check
		assertSuperset(rows.viewRows[0], viewKeys, 'View');
		assertSuperset(rows.axisArgsRows[0], axisArgKeys, 'AxisArg');
		assertSuperset(rows.layers[0], layerKeys, 'Layer');

		// jsonb_build_object -> exact key set
		assertExact(rows.compositions[0], compositionKeys, 'Composition');
		assertExact(rows.projectTokens[0], projectTokenKeys, 'ProjectToken');
		assertExact(rows.viewTokenRows[0], viewTokenKeys, 'ViewToken');
		assertExact(rows.kitTokenRows[0], kitTokenKeys, 'KitToken');
		assertExact(rows.tokenAxisOverrides[0], tokenAxisOverrideKeys, 'TokenAxisOverride');
		assertExact(rows.conditions[0], conditionKeys, 'Condition');
		assertExact(rows.entries[0], entryKeys, 'Entry');
	});
});

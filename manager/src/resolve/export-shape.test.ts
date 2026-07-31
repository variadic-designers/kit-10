import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';
import { fetchKitExportShapes, fetchViewAxisArgs, fetchViewCompositions } from './export-shape.js';

describe('fetchKitExportShapes', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	async function seedButtonKit() {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Design System'))!;

		const themeAxis = (await ctx.api.createAxis(
			proj.id,
			'theme',
			'Primary or secondary look',
			'categorical',
			['primary', 'secondary']
		))!;
		const stateAxis = (await ctx.api.createAxis(
			proj.id,
			'state',
			'Interaction state',
			'categorical',
			['hover']
		))!;

		const themePrimary = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'primary'
		}))!;
		const themeSecondary = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'secondary'
		}))!;
		const stateHover = (await ctx.api.createAxisValue(stateAxis.id, {
			type: 'literal',
			value: 'hover'
		}))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		await ctx.api.consumeAxis(kit.id, themeAxis.id);
		await ctx.api.consumeAxis(kit.id, stateAxis.id);
		await ctx.api.setAxisVariantKind(stateAxis.id, 'dynamic');

		// Base layer (no conditions)
		const baseLayer = (await ctx.api.createLayer(kit.id))!;
		const baseSnippet = (await ctx.api.createRenderSnippet(baseLayer.id))!;
		await ctx.api.createRenderEntry(baseSnippet.id, 'background', 'oklab(60% 0.1 0.02 / 1)');

		// {theme: secondary} layer
		const secondaryLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(secondaryLayer.id, themeSecondary.id);
		const secondarySnippet = (await ctx.api.createRenderSnippet(secondaryLayer.id))!;
		await ctx.api.createRenderEntry(secondarySnippet.id, 'background', 'oklab(40% 0.05 -0.01 / 1)');

		// {state: hover} layer
		const hoverLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(hoverLayer.id, stateHover.id);
		const hoverSnippet = (await ctx.api.createRenderSnippet(hoverLayer.id))!;
		await ctx.api.createRenderEntry(hoverSnippet.id, 'background', 'oklab(65% 0.1 0.02 / 1)');

		return {
			proj,
			kit,
			themeAxis,
			stateAxis,
			themePrimary,
			themeSecondary,
			stateHover,
			baseLayer,
			secondaryLayer,
			hoverLayer
		};
	}

	it('returns an empty map for an empty kitIds list', async () => {
		const result = await fetchKitExportShapes(ctx.db, []);
		expect(result.size).toBe(0);
	});

	it('groups every layer/condition/entry by kit, unfiltered by any axis_args, with axis metadata', async () => {
		const s = await seedButtonKit();

		const result = await fetchKitExportShapes(ctx.db, [s.kit.id]);
		const shape = result.get(s.kit.id);
		expect(shape).toBeDefined();
		expect(shape!.kitName).toBe('Button');

		// All 3 layers present, unfiltered -- not collapsed to a single winner.
		expect(shape!.layers).toHaveLength(3);
		const base = shape!.layers.find((l) => l.conditions.length === 0)!;
		const secondary = shape!.layers.find((l) => l.conditions.some((c) => c.axisId === s.themeAxis.id))!;
		const hover = shape!.layers.find((l) => l.conditions.some((c) => c.axisId === s.stateAxis.id))!;
		expect(base).toBeDefined();
		expect(secondary).toBeDefined();
		expect(hover).toBeDefined();
		expect(base.entries[0]!.literalValue).toBe('oklab(60% 0.1 0.02 / 1)');
		expect(secondary.entries[0]!.literalValue).toBe('oklab(40% 0.05 -0.01 / 1)');
		expect(hover.entries[0]!.literalValue).toBe('oklab(65% 0.1 0.02 / 1)');
		expect(secondary.conditions[0]!.axisValueId).toBe(s.themeSecondary.id);
		expect(hover.conditions[0]!.axisValueId).toBe(s.stateHover.id);

		// Axis metadata: theme stays default 'static'/not-excluded, state was set 'dynamic'.
		expect(shape!.axes).toHaveLength(2);
		const themeMeta = shape!.axes.find((a) => a.axisId === s.themeAxis.id)!;
		const stateMeta = shape!.axes.find((a) => a.axisId === s.stateAxis.id)!;
		expect(themeMeta.variantKind).toBe('static');
		expect(themeMeta.excludedFromExport).toBe(false);
		expect(themeMeta.values.map((v) => v.value)).toEqual([
			{ type: 'literal', value: 'primary' },
			{ type: 'literal', value: 'secondary' }
		]);
		expect(stateMeta.variantKind).toBe('dynamic');
		expect(stateMeta.values.map((v) => v.value)).toEqual([{ type: 'literal', value: 'hover' }]);
	});

	it('reflects excludedFromExport once set via setAxisExcludedFromExport', async () => {
		const s = await seedButtonKit();
		await ctx.api.setAxisExcludedFromExport(s.kit.id, s.stateAxis.id, true);

		const result = await fetchKitExportShapes(ctx.db, [s.kit.id]);
		const stateMeta = result.get(s.kit.id)!.axes.find((a) => a.axisId === s.stateAxis.id)!;
		expect(stateMeta.excludedFromExport).toBe(true);
	});

	it('fetches multiple kits in one call, keeping their layers/axes separate', async () => {
		const s1 = await seedButtonKit();
		const kit2 = (await ctx.api.createKitInProject(s1.proj.id, 'Card'))!;
		const layer2 = (await ctx.api.createLayer(kit2.id))!;
		const snippet2 = (await ctx.api.createRenderSnippet(layer2.id))!;
		await ctx.api.createRenderEntry(snippet2.id, 'padding', '24px');

		const result = await fetchKitExportShapes(ctx.db, [s1.kit.id, kit2.id]);
		expect(result.size).toBe(2);
		expect(result.get(s1.kit.id)!.layers).toHaveLength(3);
		expect(result.get(kit2.id)!.layers).toHaveLength(1);
		expect(result.get(kit2.id)!.axes).toHaveLength(0);
	});
});

describe('fetchViewAxisArgs', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	async function seedViewWithAxisArg() {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Design System'))!;
		const themeAxis = (await ctx.api.createAxis(
			proj.id,
			'theme',
			'Primary or secondary look',
			'categorical',
			['primary', 'secondary']
		))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		await ctx.api.consumeAxis(kit.id, themeAxis.id);
		const view = (await ctx.api.createViewInProject(proj.id, 'Hero CTA'))!;
		await ctx.api.attachKitToComposition(kit.id, view.id);
		await ctx.api.setAxisArg(view.id, kit.id, themeAxis.id, { type: 'literal', value: 'secondary' });

		return { proj, kit, view, themeAxis };
	}

	it('returns an empty array for an empty viewIds list', async () => {
		const result = await fetchViewAxisArgs(ctx.db, []);
		expect(result).toEqual([]);
	});

	it('returns the axis args a view actually set, scoped to the requested view ids', async () => {
		const s = await seedViewWithAxisArg();
		const otherView = (await ctx.api.createViewInProject(s.proj.id, 'Unrelated'))!;

		const result = await fetchViewAxisArgs(ctx.db, [s.view.id, otherView.id]);
		expect(result).toEqual([
			{
				viewId: s.view.id,
				kitId: s.kit.id,
				axisId: s.themeAxis.id,
				value: { type: 'literal', value: 'secondary' }
			}
		]);
	});

	it('does not return args for a view outside the requested ids', async () => {
		await seedViewWithAxisArg();
		const result = await fetchViewAxisArgs(ctx.db, ['00000000-0000-0000-0000-000000000000']);
		expect(result).toEqual([]);
	});
});

describe('fetchViewCompositions', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	it('returns an empty array for an empty viewIds list', async () => {
		const result = await fetchViewCompositions(ctx.db, []);
		expect(result).toEqual([]);
	});

	it('returns every composed kit for a view, ordered by priority_index ascending', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Design System'))!;
		const density = (await ctx.api.createKitInProject(proj.id, 'Density'))!;
		const priority = (await ctx.api.createKitInProject(proj.id, 'Priority'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'Page'))!;
		await ctx.api.attachKitToComposition(density.id, view.id); // priority_index 1000
		await ctx.api.attachKitToComposition(priority.id, view.id); // priority_index 2000

		const result = await fetchViewCompositions(ctx.db, [view.id]);
		expect(result).toEqual([
			{ viewId: view.id, kitId: density.id, priorityIndex: 1000 },
			{ viewId: view.id, kitId: priority.id, priorityIndex: 2000 }
		]);
	});

	it('scopes strictly to the requested view ids', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Design System'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'Included'))!;
		const otherView = (await ctx.api.createViewInProject(proj.id, 'Excluded'))!;
		await ctx.api.attachKitToComposition(kit.id, view.id);
		await ctx.api.attachKitToComposition(kit.id, otherView.id);

		const result = await fetchViewCompositions(ctx.db, [view.id]);
		expect(result).toEqual([{ viewId: view.id, kitId: kit.id, priorityIndex: 1000 }]);
	});
});

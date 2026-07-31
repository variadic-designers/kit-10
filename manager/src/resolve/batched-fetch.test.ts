import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';
import {
	fetchResolutionRows,
	resolveViewsFromRows,
	resolveManySlowPath,
	type ResolvedKit
} from './resolve.js';
import type { TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

// Convert a ResolvedKit[] (with Map properties) into a plain-object form that can be
// deep-compared with vitest's toEqual. Maps don't serialize natively, so we stringify
// the property entries in a stable order.
function toComparable(kits: ResolvedKit[]): unknown {
	return kits.map((k) => ({
		kitId: k.kitId,
		kitName: k.kitName,
		// `properties` now carries each property's `viewRefs` (view-list values), so comparing the
		// full property map already covers what the old kit-level `childViewIds` did.
		properties: Object.fromEntries(
			[...k.properties.entries()].sort(([a], [b]) => a.localeCompare(b))
		)
	}));
}

describe('fetchResolutionRows + resolveViewsFromRows (batched fetch parity)', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});
	afterEach(async () => {
		await ctx.pg.close();
	});

	async function seedProject(): Promise<{ projectId: string; viewId: string }> {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Parity Test'))!;

		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme', '', 'categorical', [
			'light',
			'dark'
		]))!;
		const densityAxis = (await ctx.api.createAxis(proj.id, 'density', '', 'categorical', [
			'compact',
			'comfortable'
		]))!;

		const themeDark = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'dark'
		}))!;
		const densityCompact = (await ctx.api.createAxisValue(densityAxis.id, {
			type: 'literal',
			value: 'compact'
		}))!;

		const tokenPrimary = (await ctx.api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;

		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		await ctx.api.consumeAxis(kit.id, themeAxis.id);
		await ctx.api.consumeAxis(kit.id, densityAxis.id);
		await ctx.api.reorderAxesInKit(kit.id, themeAxis.id, 1000);
		await ctx.api.reorderAxesInKit(kit.id, densityAxis.id, 2000);

		// Null layer (baseline): background (token-backed), color, padding
		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'background', null, tokenPrimary.id);
		await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#ffffff');
		await ctx.api.createRenderEntry(nullSnippet.id, 'padding', '16px');

		// {theme: dark} layer: background override
		const darkLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(darkLayer.id, themeDark.id);
		const darkSnippet = (await ctx.api.createRenderSnippet(darkLayer.id))!;
		await ctx.api.createRenderEntry(darkSnippet.id, 'background', '#1e293b');

		// {theme: dark, density: compact} layer: padding override
		const darkCompactLayer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(darkCompactLayer.id, themeDark.id);
		await ctx.api.addAxisValueToLayer(darkCompactLayer.id, densityCompact.id);
		const darkCompactSnippet = (await ctx.api.createRenderSnippet(darkCompactLayer.id))!;
		await ctx.api.createRenderEntry(darkCompactSnippet.id, 'padding', '8px');

		const view = (await ctx.api.createViewInProject(proj.id, 'Dark Compact'))!;
		await ctx.api.attachKitToComposition(kit.id, view.id);
		await ctx.api.setAxisArg(view.id, kit.id, themeAxis.id, { type: 'literal', value: 'dark' });
		await ctx.api.setAxisArg(view.id, kit.id, densityAxis.id, {
			type: 'literal',
			value: 'compact'
		});

		return { projectId: proj.id, viewId: view.id };
	}

	it('produces identical resolved kits to resolveManySlowPath', async () => {
		const { projectId, viewId } = await seedProject();

		const rows = await fetchResolutionRows(ctx.db, projectId);
		const { views: batchedViews } = resolveViewsFromRows(rows);
		const batchedView = batchedViews.find((v) => v.viewId === viewId);
		expect(batchedView).toBeDefined();

		const slowPathKits = await resolveManySlowPath(ctx.db, viewId);

		expect(toComparable(batchedView!.resolvedKits)).toEqual(toComparable(slowPathKits));
	});

	it('handles a project with no views (empty rows)', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'Empty'))!;

		const rows = await fetchResolutionRows(ctx.db, proj.id);
		expect(rows.viewRows).toEqual([]);
		expect(resolveViewsFromRows(rows)).toEqual({ views: [], overriddenOccurrences: [] });
	});

	it('handles a view with no composed kits', async () => {
		const ws = (await ctx.api.getAllWorkspaces().execute())[0]!;
		const proj = (await ctx.api.createProjectInWorkspace(ws.workspaceId, 'No Kits'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'Empty View'))!;

		const rows = await fetchResolutionRows(ctx.db, proj.id);
		const { views } = resolveViewsFromRows(rows);
		expect(views).toHaveLength(1);
		expect(views[0]!.viewId).toBe(view.id);
		expect(views[0]!.resolvedKits).toEqual([]);
	});

	it('kit rename is visible in the batched fetch (kits table coverage)', async () => {
		const { projectId } = await seedProject();

		const before = await fetchResolutionRows(ctx.db, projectId);
		expect(before.compositions[0]!.kit_name).toBe('Button');

		const kitId = before.compositions[0]!.kit_id;
		await ctx.api.renameKit(kitId, 'Renamed Button');

		const after = await fetchResolutionRows(ctx.db, projectId);
		expect(after.compositions[0]!.kit_name).toBe('Renamed Button');
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../../test-helpers.js';

describe('migration 2026-04-21', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	it('creates all expected tables', async () => {
		const tables = await ctx.db.introspection.getTables();

		const tableNames = tables.map((t) => t.name).sort();
		expect(tableNames).toContain('workspaces');
		expect(tableNames).toContain('projects');
		expect(tableNames).toContain('views');
		expect(tableNames).toContain('kits');
		expect(tableNames).toContain('compositions');
		expect(tableNames).toContain('axis_values');
		expect(tableNames).toContain('axes_consumed');
		expect(tableNames).toContain('axis_args');
		expect(tableNames).toContain('render_snippets');
		expect(tableNames).toContain('render_entries');
		expect(tableNames).toContain('layers');
		expect(tableNames).toContain('layer_axis_values');
		expect(tableNames).toContain('tokens');
	});

	it('seeds a default workspace', async () => {
		const ws = await ctx.db.selectFrom('workspaces').selectAll().execute();
		expect(ws).toHaveLength(1);
		expect(ws[0]!.name).toBe('Default');
	});

	it('axes table has the correct columns', async () => {
		const cols = await ctx.db.introspection.getTables();
		const axes = cols.find((t) => t.name === 'axes');
		expect(axes).toBeDefined();
		const colNames = axes!.columns.map((c) => c.name).sort();
		expect(colNames).toEqual([
			'default_value',
			'description',
			'hint',
			'id',
			'kind',
			'name',
			'project_id'
		].sort());
	});

	it('render_snippets points to layers, not kits', async () => {
		const cols = await ctx.db.introspection.getTables();
		const snippets = cols.find((t) => t.name === 'render_snippets');
		expect(snippets).toBeDefined();
		const colNames = snippets!.columns.map((c) => c.name).sort();
		expect(colNames).toContain('layer_id');
		expect(colNames).not.toContain('kit_id');
		expect(colNames).not.toContain('style');
	});

	it('layers does not have render_snippet_id', async () => {
		const cols = await ctx.db.introspection.getTables();
		const layers = cols.find((t) => t.name === 'layers');
		expect(layers).toBeDefined();
		const colNames = layers!.columns.map((c) => c.name).sort();
		expect(colNames).not.toContain('render_snippet_id');
	});

	it('layer_axis_values has composite PK on (layer_id, axis_value_id)', async () => {
		const proj = (await ctx.api.createProjectInWorkspace(
			(await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId,
			'test'
		))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;

		await ctx.api.addAxisValueToLayer(layer.id, av.id);
		await expect(
			ctx.api.addAxisValueToLayer(layer.id, av.id)
		).resolves.toBeUndefined();
	});
});
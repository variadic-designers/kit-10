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
		expect(tableNames).toContain('plugins');
	});

	it('projects table has an interpreter_plugin_id column', async () => {
		const cols = await ctx.db.introspection.getTables();
		const projects = cols.find((t) => t.name === 'projects');
		expect(projects).toBeDefined();
		const colNames = projects!.columns.map((c) => c.name);
		expect(colNames).toContain('interpreter_plugin_id');
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
		expect(colNames).toEqual(
			[
				'default_value',
				'description',
				'hint',
				'hints',
				'id',
				'kind',
				'name',
				'project_id',
				'variant_kind'
			].sort()
		);
	});

	it('axes_consumed table has the correct columns', async () => {
		const cols = await ctx.db.introspection.getTables();
		const axesConsumed = cols.find((t) => t.name === 'axes_consumed');
		expect(axesConsumed).toBeDefined();
		const colNames = axesConsumed!.columns.map((c) => c.name).sort();
		expect(colNames).toEqual(
			['axis_id', 'excluded_from_export', 'kit_id', 'priority_index'].sort()
		);
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

	it('plugins table has a unique name constraint', async () => {
		const proj = (await ctx.api.createProjectInWorkspace(
			(await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId,
			'test-plugins'
		))!;
		void proj;

		await ctx.db
			.insertInto('plugins')
			.values({ name: 'dup', kind: 'utility', manifest: { wasm: [{ url: '/dup.wasm' }] } } as any)
			.execute();

		await expect(
			ctx.db
				.insertInto('plugins')
				.values({ name: 'dup', kind: 'utility', manifest: { wasm: [{ url: '/dup2.wasm' }] } } as any)
				.execute()
		).rejects.toThrow();
	});

	it('projects.interpreter_plugin_id is set null if the referenced plugin is deleted', async () => {
		const proj = (await ctx.api.createProjectInWorkspace(
			(await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId,
			'test-interpreter-set-null'
		))!;
		const plugin = (await ctx.api.registerPlugin({
			name: 'interp-a',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/a.wasm' }] }
		}))!;

		await ctx.api.setProjectInterpreter(proj.id, plugin.id);
		await ctx.db.deleteFrom('plugins').where('id', '=', plugin.id).execute();

		const row = await ctx.db
			.selectFrom('projects')
			.select('interpreter_plugin_id')
			.where('id', '=', proj.id)
			.executeTakeFirstOrThrow();
		expect(row.interpreter_plugin_id).toBeNull();
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
		await expect(ctx.api.addAxisValueToLayer(layer.id, av.id)).resolves.toBeUndefined();
	});
});

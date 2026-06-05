import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';

describe('api', () => {
	let ctx: TestContext;

	beforeEach(async () => {
		ctx = await createTestDb();
	});

	afterEach(async () => {
		await ctx.pg.close();
	});

	// ---- Workspaces ----

	it('creates and lists workspaces', async () => {
		const ws = await ctx.api.createWorkspace('My Workspace');
		expect(ws).toBeDefined();
		expect(ws!.name).toBe('My Workspace');

		const all = await ctx.api.getAllWorkspaces().execute();
		expect(all).toHaveLength(2); // Default + new
	});

	// ---- Projects ----

	it('creates project in workspace and lists by workspace', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;

		const proj = await ctx.api.createProjectInWorkspace(wsId, 'My Project');
		expect(proj).toBeDefined();
		expect(proj!.name).toBe('My Project');
		expect(proj!.workspace_id).toBe(wsId);

		const projects = await ctx.api.getProjectsByWorkspaceId(wsId).execute();
		expect(projects).toHaveLength(1);
		expect(projects[0]!.projectName).toBe('My Project');
	});

	it('renames a project', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'Rename Me'))!;

		await ctx.api.renameProject(proj.id, 'Renamed');
		const projects = await ctx.api.getProjectsByWorkspaceId(wsId).execute();
		expect(projects[0]!.projectName).toBe('Renamed');
	});

	it('deletes a project', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'Delete Me'))!;

		await ctx.api.deleteProject(proj.id);
		const projects = await ctx.api.getProjectsByWorkspaceId(wsId).execute();
		expect(projects).toHaveLength(0);
	});

	// ---- Views ----

	it('creates and renames views', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const view = (await ctx.api.createViewInProject(proj.id, 'My View'))!;
		expect(view.name).toBe('My View');
		expect(view.lock).toBe(false);
		expect(view.hide).toBe(false);

		await ctx.api.renameView(view.id, 'Renamed View');
		await ctx.api.toggleViewLock(view.id, true);
		await ctx.api.toggleViewHide(view.id, true);

		const views = await ctx.api.getViewsByProjectId(proj.id).execute();
		expect(views[0]!.viewName).toBe('Renamed View');
		expect(views[0]!.viewLocked).toBe(true);
		expect(views[0]!.viewHidden).toBe(true);
	});

	// ---- Kits + Composition ----

	it('creates kit, attaches to view, and detaches', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const comp = await ctx.api.attachKitToComposition(kit.id, view.id);
		expect(comp).toBeDefined();
		expect(comp!.priority_index).toBe(1000);

		const comps = await ctx.api.getKitCompositionByViewId(view.id).execute();
		expect(comps).toHaveLength(1);
		expect(comps[0]!.kitName).toBe('button');

		await ctx.api.detachKitFromComposition(kit.id, view.id);
		const after = await ctx.api.getKitCompositionByViewId(view.id).execute();
		expect(after).toHaveLength(0);
	});

	it('renames and deletes a kit', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Rename Me'))!;

		await ctx.api.renameKit(kit.id, 'Renamed Kit');

		const kits = await ctx.api.getKitsByProjectId(proj.id).execute();
		expect(kits[0]!.kitName).toBe('Renamed Kit');

		await ctx.api.deleteKit(kit.id);
		const after = await ctx.api.getKitsByProjectId(proj.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Axes ----

	it('creates and queries axes with hint and kind', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const axis = (await ctx.api.createAxis(proj.id, 'Dark Mode', 'Toggle theme', 'categorical', ['light', 'dark']))!;
		expect(axis.name).toBe('Dark Mode');
		expect(axis.kind).toBe('categorical');

		const axes = await ctx.api.getAxesByProjectId(proj.id).execute();
		expect(axes).toHaveLength(1);
		expect(axes[0]!.axisName).toBe('Dark Mode');
	});

	it('renames and deletes an axis', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'Old Name'))!;

		await ctx.api.renameAxis(axis.id, 'New Name');
		const axes = await ctx.api.getAxesByProjectId(proj.id).execute();
		expect(axes[0]!.axisName).toBe('New Name');

		await ctx.api.deleteAxis(axis.id);
		const after = await ctx.api.getAxesByProjectId(proj.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Axis Values ----

	it('creates and queries axis values', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;

		const av1 = (await ctx.api.createAxisValue(axis.id, 'light'))!;
		const av2 = (await ctx.api.createAxisValue(axis.id, 'dark'))!;

		const values = await ctx.api.getAxisValuesByAxisId(axis.id).execute();
		expect(values).toHaveLength(2);
		expect(values.map((v) => v.value).sort()).toEqual(['dark', 'light']);
	});

	it('deletes an axis value', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, 'light'))!;

		await ctx.api.deleteAxisValue(av.id);
		const values = await ctx.api.getAxisValuesByAxisId(axis.id).execute();
		expect(values).toHaveLength(0);
	});

	// ---- Axes Consumed ----

	it('consumes axis into kit with auto-priority', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'density'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const consumed = await ctx.api.consumeAxis(kit.id, axis.id);
		expect(consumed!.priority_index).toBe(1000);

		const list = await ctx.api.getConsumedAxesByKitId(kit.id).execute();
		expect(list).toHaveLength(1);
		expect(list[0]!.axisName).toBe('density');
	});

	it('reorders axes in kit', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const a1 = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const a2 = (await ctx.api.createAxis(proj.id, 'density'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		await ctx.api.consumeAxis(kit.id, a1.id);
		await ctx.api.consumeAxis(kit.id, a2.id);

		await ctx.api.reorderAxesInKit(kit.id, a1.id, 500);
		const list = await ctx.api.getConsumedAxesByKitId(kit.id).execute();
		const themeEntry = list.find((e) => e.axisName === 'theme');
		expect(themeEntry!.priorityIndex).toBe(500);
	});

	// ---- Axis Args ----

	it('sets and queries axis args per view+kit', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const arg = await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'dark' });
		expect(arg!.value).toMatchObject({ type: 'literal', value: 'dark' });

		const args = await ctx.api.getAllAxisArgs(view.id, kit.id).execute();
		expect(args).toHaveLength(1);
		expect(args[0]!.value).toMatchObject({ type: 'literal', value: 'dark' });
	});

	it('upserts axis arg on repeated sets', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'light' });
		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'dark' });

		const args = await ctx.api.getAllAxisArgs(view.id, kit.id).execute();
		expect(args).toHaveLength(1);
		expect(args[0]!.value).toMatchObject({ type: 'literal', value: 'dark' });
	});

	// ---- Render Snippets ----

	it('creates, updates, and deletes render snippets', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const snippet = (await ctx.api.createRenderSnippet(kit.id, { padding: '1rem' }))!;
		expect(snippet.style).toMatchObject({ padding: '1rem' });

		await ctx.api.updateRenderSnippetStyle(snippet.id, { padding: '2rem' });
		const list = await ctx.api.getRenderSnippetsByKitId(kit.id).execute();
		expect(list[0]!.snippetStyle).toMatchObject({ padding: '2rem' });

		await ctx.api.deleteRenderSnippet(snippet.id);
		const after = await ctx.api.getRenderSnippetsByKitId(kit.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Layers ----

	it('creates layer linking kit to render snippet', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const snippet = (await ctx.api.createRenderSnippet(kit.id, { color: 'red' }))!;

		const layer = (await ctx.api.createLayer(kit.id, snippet.id))!;
		expect(layer.render_snippet_id).toBe(snippet.id);

		const layers = await ctx.api.getLayersByKitId(kit.id).execute();
		expect(layers).toHaveLength(1);
		expect(layers[0]!.snippetStyle).toMatchObject({ color: 'red' });
	});

	it('adds and removes axis values from a layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, 'light'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const snippet = (await ctx.api.createRenderSnippet(kit.id, { background: '#FFF' }))!;
		const layer = (await ctx.api.createLayer(kit.id, snippet.id))!;

		await ctx.api.addAxisValueToLayer(layer.id, av.id);

		// Verify via DB directly
		const lav = await ctx.db
			.selectFrom('layer_axis_values')
			.selectAll()
			.where('layer_id', '=', layer.id)
			.execute();
		expect(lav).toHaveLength(1);
		expect(lav[0]!.axis_value_id).toBe(av.id);

		await ctx.api.removeAxisValueFromLayer(layer.id, av.id);
		const after = await ctx.db
			.selectFrom('layer_axis_values')
			.selectAll()
			.where('layer_id', '=', layer.id)
			.execute();
		expect(after).toHaveLength(0);
	});

	it('deletes a layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const snippet = (await ctx.api.createRenderSnippet(kit.id, {}))!;
		const layer = (await ctx.api.createLayer(kit.id, snippet.id))!;

		await ctx.api.deleteLayer(layer.id);
		const after = await ctx.api.getLayersByKitId(kit.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Tokens ----

	it('creates, updates, and deletes tokens', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const token = (await ctx.api.createToken(proj.id, 'colors.primary', '#3b82f6'))!;
		expect(token.alias).toBe('colors.primary');
		expect(token.value).toBe('#3b82f6');

		await ctx.api.updateTokenValue(token.id, '#2563eb');
		await ctx.api.updateTokenAlias(token.id, 'colors.brand');

		const tokens = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(tokens[0]!.tokenAlias).toBe('colors.brand');
		expect(tokens[0]!.tokenValue).toBe('#2563eb');

		await ctx.api.deleteToken(token.id);
		const after = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Export ----

	it('exports project with all related data', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'k'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, 'light'))!;
		const snippet = (await ctx.api.createRenderSnippet(kit.id, { color: 'red' }))!;
		const layer = (await ctx.api.createLayer(kit.id, snippet.id))!;
		await ctx.api.addAxisValueToLayer(layer.id, av.id);
		await ctx.api.consumeAxis(kit.id, axis.id);
		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'light' });
		await ctx.api.createToken(proj.id, 'primary', '#FFFFFF');
		await ctx.api.attachKitToComposition(kit.id, view.id);

		const exported = await ctx.api.exportProject(proj.id);
		expect(exported.project).toBeDefined();
		expect(exported.views).toHaveLength(1);
		expect(exported.kits).toHaveLength(1);
		expect(exported.compositions).toHaveLength(1);
		expect(exported.tokens).toHaveLength(1);
		expect(exported.axes).toHaveLength(1);
		expect(exported.axisValues).toHaveLength(1);
		expect(exported.axesConsumed).toHaveLength(1);
		expect(exported.axisArgs).toHaveLength(1);
		expect(exported.renderSnippets).toHaveLength(1);
		expect(exported.layers).toHaveLength(1);
		expect(exported.layerAxisValues).toHaveLength(1);
	});
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, type TestContext } from '../test-helpers.js';
import type { TokenValue } from '../schema.js';

const s = (value: string): TokenValue => ({ type: 'scalar', value });

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
		expect(all).toHaveLength(2);
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

	it('creates and queries axis values (literal)', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;

		const av1 = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const av2 = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;

		expect(av1.value).toMatchObject({ type: 'literal', value: 'light' });
		expect(av2.value).toMatchObject({ type: 'literal', value: 'dark' });

		const values = await ctx.api.getAxisValuesByAxisId(axis.id).execute();
		expect(values).toHaveLength(2);
	});

	it('creates and queries axis values (range boundary)', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'viewport'))!;

		const av = (await ctx.api.createAxisValue(axis.id, { type: 'range', operator: '>=', threshold: 1024 }))!;
		expect(av.value).toMatchObject({ type: 'range', operator: '>=', threshold: 1024 });
	});

	it('deletes an axis value', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;

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

	// ---- Layers ----

	it('creates and deletes a layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const layer = (await ctx.api.createLayer(kit.id))!;
		expect(layer.kit_id).toBe(kit.id);

		const layers = await ctx.api.getLayersByKitId(kit.id).execute();
		expect(layers).toHaveLength(1);

		await ctx.api.deleteLayer(layer.id);
		const after = await ctx.api.getLayersByKitId(kit.id).execute();
		expect(after).toHaveLength(0);
	});

	it('adds and removes axis values from a layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;

		await ctx.api.addAxisValueToLayer(layer.id, av.id);

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

	// ---- Render Snippets (now point to layers) ----

	it('creates and deletes render snippets on a layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;

		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
		expect(snippet.layer_id).toBe(layer.id);

		const snippets = await ctx.api.getRenderSnippetsByLayerId(layer.id).execute();
		expect(snippets).toHaveLength(1);

		await ctx.api.deleteRenderSnippet(snippet.id);
		const after = await ctx.api.getRenderSnippetsByLayerId(layer.id).execute();
		expect(after).toHaveLength(0);
	});

	// ---- Render Entries ----

it('creates, updates, and deletes render entries', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;

		const entry = (await ctx.api.createRenderEntry(snippet.id, 'background', '#333'))!;
		expect(entry.property).toBe('background');
		expect(entry.value).toBe('#333');
		expect(entry.token_id).toBeNull();

		await ctx.api.updateRenderEntryValue(entry.id, 'background', '#000');
		const entries = await ctx.api.getRenderEntriesBySnippetId(snippet.id).execute();
		expect(entries[0]!.value).toBe('#000');

		const entry2 = (await ctx.api.createRenderEntry(snippet.id, 'color', '#dedede'))!;
		const allEntries = await ctx.api.getRenderEntriesBySnippetId(snippet.id).execute();
		expect(allEntries).toHaveLength(2);

		await ctx.api.deleteRenderEntry(entry.id);
		const after = await ctx.api.getRenderEntriesBySnippetId(snippet.id).execute();
		expect(after).toHaveLength(1);
		expect(after[0]!.property).toBe('color');
	});

	it('creates render entry with token reference', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const token = (await ctx.api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;

		const entry = (await ctx.api.createRenderEntry(snippet.id, 'background', null, token.id))!;
		expect(entry.property).toBe('background');
		expect(entry.value).toBeNull();
		expect(entry.token_id).toBe(token.id);

		const entries = await ctx.api.getRenderEntriesBySnippetId(snippet.id).execute();
		expect(entries[0]!.tokenId).toBe(token.id);
	});

	it('queries render entries by layer id', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;

		await ctx.api.createRenderEntry(snippet.id, 'background', '#333');
		await ctx.api.createRenderEntry(snippet.id, 'color', '#fff');

		const entries = await ctx.api.getRenderEntriesByLayerId(layer.id).execute();
		expect(entries).toHaveLength(2);
	});

	// ---- Tokens ----

	it('creates, updates, and deletes tokens', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const token = (await ctx.api.createToken(proj.id, 'colors.primary', s('#3b82f6')))!;
		expect(token.alias).toBe('colors.primary');
		expect(token.value).toEqual(s('#3b82f6'));

		await ctx.api.updateTokenValue(token.id, s('#2563eb'));
		await ctx.api.updateTokenAlias(token.id, 'colors.brand');

		const tokens = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(tokens[0]!.tokenAlias).toBe('colors.brand');
		expect(tokens[0]!.tokenValue).toEqual(s('#2563eb'));

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
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
		await ctx.api.createRenderEntry(snippet.id, 'color', '#333');
		await ctx.api.addAxisValueToLayer(layer.id, av.id);
		await ctx.api.consumeAxis(kit.id, axis.id);
		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'light' });
		await ctx.api.createToken(proj.id, 'primary', s('#FFFFFF'));
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
		expect(exported.layers).toHaveLength(1);
		expect(exported.renderSnippets).toHaveLength(1);
		expect(exported.renderEntries).toHaveLength(1);
		expect(exported.layerAxisValues).toHaveLength(1);
	});
});
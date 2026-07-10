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

	it('updateViewHints shallow-merges into hints, preserving sibling top-level keys', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v', {
			charter: { primitive: 'box' },
			vellum: { position: [0, 0] }
		}))!;

		await ctx.api.updateViewHints(view.id, { charter: { primitive: 'text' } });

		const row = await ctx.db
			.selectFrom('views')
			.select('hints')
			.where('id', '=', view.id)
			.executeTakeFirstOrThrow();
		expect(row.hints).toEqual({
			charter: { primitive: 'text' },
			vellum: { position: [0, 0] }
		});
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

	it('bulk-reorders consumed axes without a unique-priority collision', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const a1 = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const a2 = (await ctx.api.createAxis(proj.id, 'density'))!;
		const a3 = (await ctx.api.createAxis(proj.id, 'state'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		await ctx.api.consumeAxis(kit.id, a1.id); // 1000
		await ctx.api.consumeAxis(kit.id, a2.id); // 2000
		await ctx.api.consumeAxis(kit.id, a3.id); // 3000

		// Move density (currently top) to the bottom -- the intermediate priorities it and its
		// neighbours would pass through overlap, so a per-row sequence would trip the
		// unique_priority_of_axis_per_kit constraint. The single transaction must not.
		await ctx.api.setConsumedAxesOrder(kit.id, [a1.id, a3.id, a2.id]);

		const list = await ctx.api.getConsumedAxesByKitId(kit.id).execute();
		expect(list.map((e) => e.axisName)).toEqual(['theme', 'state', 'density']);
		expect(list.map((e) => e.priorityIndex)).toEqual([3000, 2000, 1000]);
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

	it('upsertViewToken creates then updates one view-scoped token for an alias', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const childA = (await ctx.api.createViewInProject(proj.id, 'a'))!;
		const childB = (await ctx.api.createViewInProject(proj.id, 'b'))!;

		// First call creates the token, scoped to the view.
		const first = await ctx.api.upsertViewToken(proj.id, view.id, 'children', {
			type: 'view-list',
			view_ids: [childA.id]
		});
		expect(first.created).toBe(true);

		const afterCreate = await ctx.api.getTokensByViewId(view.id).execute();
		expect(afterCreate).toHaveLength(1);
		expect(afterCreate[0]!.tokenId).toBe(first.id);
		expect(afterCreate[0]!.tokenViewId).toBe(view.id);
		expect(afterCreate[0]!.tokenValue).toEqual({ type: 'view-list', view_ids: [childA.id] });

		// Second call updates the same token in place -- no duplicate row for the alias.
		const second = await ctx.api.upsertViewToken(proj.id, view.id, 'children', {
			type: 'view-list',
			view_ids: [childA.id, childB.id]
		});
		expect(second.created).toBe(false);
		expect(second.id).toBe(first.id);

		const afterUpdate = await ctx.api.getTokensByViewId(view.id).execute();
		expect(afterUpdate).toHaveLength(1);
		expect(afterUpdate[0]!.tokenValue).toEqual({
			type: 'view-list',
			view_ids: [childA.id, childB.id]
		});
	});

	const vl = (view_ids: string[]): TokenValue => ({ type: 'view-list', view_ids });

	it('instantiateKitDefaults clones the kit template into unique per-view children (recursively)', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().execute())[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const card = (await ctx.api.createKitInProject(proj.id, 'Card'))!;

		// Template subtree: Header (composes Card) -> its own child Icon (a view-scope children token).
		const icon = (await ctx.api.createViewInProject(proj.id, 'Icon'))!;
		const header = (await ctx.api.createViewInProject(proj.id, 'Header'))!;
		await ctx.api.attachKitToComposition(card.id, header.id);
		await ctx.api.upsertViewToken(proj.id, header.id, 'children', vl([icon.id]));

		// Kit default: Card's kit-scope children token names the template (Header).
		await ctx.api.createToken(proj.id, 'children', vl([header.id]), { kitId: card.id });

		// Two instances composing Card.
		const v1 = (await ctx.api.createViewInProject(proj.id, 'V1'))!;
		const v2 = (await ctx.api.createViewInProject(proj.id, 'V2'))!;
		await ctx.api.attachKitToComposition(card.id, v1.id);
		await ctx.api.attachKitToComposition(card.id, v2.id);

		await ctx.api.instantiateKitDefaults(v1.id);
		await ctx.api.instantiateKitDefaults(v2.id);

		const childrenOf = async (viewId: string) => {
			const toks = await ctx.api.getTokensByViewId(viewId).execute();
			const t = toks.find((x) => x.tokenAlias === 'children');
			return t?.tokenValue?.type === 'view-list' ? t.tokenValue.view_ids : [];
		};

		const v1kids = await childrenOf(v1.id);
		const v2kids = await childrenOf(v2.id);

		// Each instance got exactly one child, and it is a CLONE -- not the template Header, and not
		// the other instance's child (uniqueness: no shared reference).
		expect(v1kids).toHaveLength(1);
		expect(v2kids).toHaveLength(1);
		expect(v1kids[0]).not.toBe(header.id);
		expect(v2kids[0]).not.toBe(header.id);
		expect(v1kids[0]).not.toBe(v2kids[0]);

		// The clones are real views composing Card (compositions cloned too).
		for (const id of [v1kids[0]!, v2kids[0]!]) {
			const comps = await ctx.api.getKitCompositionByViewId(id).execute();
			expect(comps.map((c) => c.kitId)).toContain(card.id);
		}

		// Recursion: each cloned Header owns its OWN cloned Icon, distinct from the template Icon and
		// from each other.
		const v1grandkids = await childrenOf(v1kids[0]!);
		const v2grandkids = await childrenOf(v2kids[0]!);
		expect(v1grandkids).toHaveLength(1);
		expect(v2grandkids).toHaveLength(1);
		expect(v1grandkids[0]).not.toBe(icon.id);
		expect(v2grandkids[0]).not.toBe(icon.id);
		expect(v1grandkids[0]).not.toBe(v2grandkids[0]);

		// Idempotent: a second call is a no-op (the view already has its own token).
		await ctx.api.instantiateKitDefaults(v1.id);
		expect(await childrenOf(v1.id)).toEqual(v1kids);
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

	it('exports a brand-new project with no kits/views/axes yet without erroring', async () => {
		// Regression test: every id-list-scoped query below (compositions, axisValues,
		// axesConsumed, axisArgs, layers, renderSnippets, renderEntries, layerAxisValues) used
		// to compile straight to `IN ()` when its id list was empty -- a genuine Postgres syntax
		// error, not "matches nothing" -- so exporting a project with nothing in it yet
		// (immediately after "New Project", before adding a single kit) threw instead of
		// returning empty arrays.
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'empty'))!;

		const exported = await ctx.api.exportProject(proj.id);
		expect(exported.views).toEqual([]);
		expect(exported.kits).toEqual([]);
		expect(exported.compositions).toEqual([]);
		expect(exported.axes).toEqual([]);
		expect(exported.axisValues).toEqual([]);
		expect(exported.axesConsumed).toEqual([]);
		expect(exported.axisArgs).toEqual([]);
		expect(exported.layers).toEqual([]);
		expect(exported.renderSnippets).toEqual([]);
		expect(exported.renderEntries).toEqual([]);
		expect(exported.layerAxisValues).toEqual([]);
		expect(exported.interpreterPlugin).toBeNull();
	});

	it('imports an exported project as a brand-new project with every id remapped', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'source'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'k'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
		// Exercises the two "soft" FK cases importProjectData has to remap by hand: a view-type
		// token, and the 'children' property's JSON-array-of-view-ids.
		await ctx.api.createRenderEntry(snippet.id, 'children', JSON.stringify([view.id]));
		await ctx.api.addAxisValueToLayer(layer.id, av.id);
		await ctx.api.consumeAxis(kit.id, axis.id);
		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'light' });
		await ctx.api.createToken(proj.id, 'primary', s('#FFFFFF'));
		await ctx.api.createToken(proj.id, 'heroView', { type: 'view', view_id: view.id });
		await ctx.api.attachKitToComposition(kit.id, view.id);

		const charter = (await ctx.api.registerPlugin({
			name: 'charter',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/charter.wasm' }] }
		}))!;
		await ctx.api.setProjectInterpreter(proj.id, charter.id);

		const exported = await ctx.api.exportProject(proj.id);
		expect(exported.schemaVersion).toBeDefined();
		expect(exported.interpreterPlugin).toEqual({ name: 'charter' });

		const imported = (await ctx.api.importProjectData(wsId, exported))!;
		expect(imported.id).not.toBe(proj.id);
		expect(imported.name).toBe('source');
		expect(imported.warnings).toEqual([]);

		const importedInterpreter = await ctx.api.getProjectInterpreter(imported.id);
		expect(importedInterpreter?.name).toBe('charter');

		const reimported = await ctx.api.exportProject(imported.id);
		expect(reimported.project.id).not.toBe(exported.project.id);
		expect(reimported.views).toHaveLength(1);
		expect(reimported.kits).toHaveLength(1);
		expect(reimported.compositions).toHaveLength(1);
		expect(reimported.tokens).toHaveLength(2);
		expect(reimported.axes).toHaveLength(1);
		expect(reimported.axisValues).toHaveLength(1);
		expect(reimported.axesConsumed).toHaveLength(1);
		expect(reimported.axisArgs).toHaveLength(1);
		expect(reimported.layers).toHaveLength(1);
		expect(reimported.renderSnippets).toHaveLength(1);
		expect(reimported.renderEntries).toHaveLength(1);
		expect(reimported.layerAxisValues).toHaveLength(1);

		// Every id in the re-exported copy must be fresh, not reused from the source project.
		const newViewId = reimported.views[0]!.id;
		expect(newViewId).not.toBe(view.id);
		expect(reimported.kits[0]!.id).not.toBe(kit.id);

		// The view-type token must now point at the NEW view, not the source project's.
		const reimportedViewToken = reimported.tokens.find((t: any) => t.alias === 'heroView');
		expect(reimportedViewToken.value.view_id).toBe(newViewId);
		expect(reimportedViewToken.value.view_id).not.toBe(view.id);

		// The 'children' render entry's JSON array must reference the new view id too.
		const childrenEntry = reimported.renderEntries.find((e: any) => e.property === 'children');
		expect(JSON.parse(childrenEntry.value)).toEqual([newViewId]);

		// The source project itself must be completely untouched by the import.
		const original = await ctx.api.exportProject(proj.id);
		expect(original.views).toHaveLength(1);
		expect(original.views[0]!.id).toBe(view.id);
		const originalViewToken = original.tokens.find((t: any) => t.alias === 'heroView');
		expect(originalViewToken.value.view_id).toBe(view.id);
	});

	it('importProjectData warns instead of failing when the source interpreter is not installed', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'source'))!;
		const exported = await ctx.api.exportProject(proj.id);
		exported.interpreterPlugin = { name: 'some-uninstalled-interpreter' };

		const imported = (await ctx.api.importProjectData(wsId, exported))!;
		expect(imported.warnings).toHaveLength(1);
		expect(imported.warnings[0]).toMatch(/not installed/);

		const interpreter = await ctx.api.getProjectInterpreter(imported.id);
		expect(interpreter).toBeNull();
	});

	it('importProjectData warns on a schema version mismatch but still imports', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'source'))!;
		const exported = await ctx.api.exportProject(proj.id);
		exported.schemaVersion = '1999-01-01';

		const imported = (await ctx.api.importProjectData(wsId, exported))!;
		expect(imported.warnings.some((w: string) => w.includes('1999-01-01'))).toBe(true);
	});

	it('importProjectData rejects data that is not a valid project export', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;

		await expect(ctx.api.importProjectData(wsId, null)).rejects.toThrow(/valid KIT-10/);
		await expect(ctx.api.importProjectData(wsId, {})).rejects.toThrow(/project/);
		await expect(
			ctx.api.importProjectData(wsId, { project: { name: 'x' }, views: 'not-an-array' })
		).rejects.toThrow(/views.*array/);
	});

	// ---- Plugins ----

	it('registerPlugin upserts by name', async () => {
		const first = (await ctx.api.registerPlugin({
			name: 'charter',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/charter.wasm' }] },
			contentHash: 'abc'
		}))!;
		expect(first.content_hash).toBe('abc');
		expect(first.activation).toBeNull();

		const second = (await ctx.api.registerPlugin({
			name: 'charter',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/charter.wasm' }] },
			contentHash: 'def'
		}))!;

		expect(second.id).toBe(first.id);
		expect(second.content_hash).toBe('def');

		const all = await ctx.db.selectFrom('plugins').selectAll().execute();
		expect(all).toHaveLength(1);
	});

	it('registerPlugin records activation for utility plugins', async () => {
		const tenner = (await ctx.api.registerPlugin({
			name: 'tenner',
			kind: 'utility',
			activation: 'lazy',
			manifest: { wasm: [{ url: '/tenner.wasm' }] }
		}))!;
		expect(tenner.activation).toBe('lazy');

		const fontavious = (await ctx.api.registerPlugin({
			name: 'fontavious',
			kind: 'utility',
			activation: 'eager',
			manifest: { wasm: [{ url: '/fontavious.wasm' }] }
		}))!;
		expect(fontavious.activation).toBe('eager');
	});

	it('getProjectInterpreter returns the project\'s interpreter plugin', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const charter = (await ctx.api.registerPlugin({
			name: 'charter',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/charter.wasm' }] }
		}))!;

		expect(await ctx.api.getProjectInterpreter(proj.id)).toBeNull();

		await ctx.api.setProjectInterpreter(proj.id, charter.id);

		const interpreter = await ctx.api.getProjectInterpreter(proj.id);
		expect(interpreter?.name).toBe('charter');
	});

	it('setProjectInterpreter replaces the previous interpreter, not adds to it', async () => {
		const wsId = (await ctx.api.getAllWorkspaces().executeTakeFirstOrThrow()).workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const pluginA = (await ctx.api.registerPlugin({
			name: 'interp-a',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/a.wasm' }] }
		}))!;
		const pluginB = (await ctx.api.registerPlugin({
			name: 'interp-b',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/b.wasm' }] }
		}))!;

		await ctx.api.setProjectInterpreter(proj.id, pluginA.id);
		await ctx.api.setProjectInterpreter(proj.id, pluginB.id);

		const interpreter = await ctx.api.getProjectInterpreter(proj.id);
		expect(interpreter?.name).toBe('interp-b');
	});

	it('listPlugins returns the whole catalogue, unscoped to any project', async () => {
		await ctx.api.registerPlugin({
			name: 'charter',
			kind: 'interpreter',
			manifest: { wasm: [{ url: '/charter.wasm' }] }
		});
		await ctx.api.registerPlugin({
			name: 'fontavious',
			kind: 'utility',
			manifest: { wasm: [{ url: '/fontavious.wasm' }] }
		});

		const all = await ctx.api.listPlugins();
		expect(all.map((p) => p.name).sort()).toEqual(['charter', 'fontavious']);
	});
});
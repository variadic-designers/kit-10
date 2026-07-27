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

	it('updateProjectHints shallow-merges into hints, preserving sibling top-level keys', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		await ctx.api.updateProjectHints(proj.id, { vellum: { panned: [10, 20] } });
		await ctx.api.updateProjectHints(proj.id, { other: 'namespace' });

		const row = await ctx.db
			.selectFrom('projects')
			.select('hints')
			.where('id', '=', proj.id)
			.executeTakeFirstOrThrow();
		expect(row.hints).toEqual({
			vellum: { panned: [10, 20] },
			other: 'namespace'
		});

		await ctx.api.updateProjectHints(proj.id, { vellum: { panned: [30, 40] } });
		const row2 = await ctx.db
			.selectFrom('projects')
			.select('hints')
			.where('id', '=', proj.id)
			.executeTakeFirstOrThrow();
		expect(row2.hints).toEqual({
			vellum: { panned: [30, 40] },
			other: 'namespace'
		});
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

	it('deleteView scrubs the deleted view out of a sibling view-list token elsewhere in the project', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
		const childA = (await ctx.api.createViewInProject(proj.id, 'Child A'))!;
		const childB = (await ctx.api.createViewInProject(proj.id, 'Child B'))!;

		// A view-list token, scoped to `parent`, referencing BOTH children -- the live composition
		// mechanism (ChildViewField/Views.svelte both write through upsertViewToken).
		await ctx.api.upsertViewToken(proj.id, parent.id, 'children', vl([childA.id, childB.id]));

		await ctx.api.deleteView(childA.id);

		const parentTokens = await ctx.api.getTokensByViewId(parent.id).execute();
		const childrenToken = parentTokens.find((t) => t.tokenAlias === 'children');
		expect(childrenToken!.tokenValue).toEqual({ type: 'view-list', view_ids: [childB.id] });
	});

	it('deleteView removes a `view`-type token elsewhere in the project whose sole reference was deleted', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const target = (await ctx.api.createViewInProject(proj.id, 'Hero'))!;
		const heroTok = (await ctx.api.createToken(proj.id, 'heroView', {
			type: 'view',
			view_id: target.id
		}))!;

		await ctx.api.deleteView(target.id);

		const projectTokens = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(projectTokens.map((t) => t.tokenId)).not.toContain(heroTok.id);
	});

	it('deleteView leaves an unrelated view-list token (referencing a DIFFERENT view) untouched', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
		const untouched = (await ctx.api.createViewInProject(proj.id, 'Untouched'))!;
		const toDelete = (await ctx.api.createViewInProject(proj.id, 'ToDelete'))!;

		await ctx.api.upsertViewToken(proj.id, parent.id, 'children', vl([untouched.id]));

		await ctx.api.deleteView(toDelete.id);

		const parentTokens = await ctx.api.getTokensByViewId(parent.id).execute();
		const childrenToken = parentTokens.find((t) => t.tokenAlias === 'children');
		expect(childrenToken!.tokenValue).toEqual({ type: 'view-list', view_ids: [untouched.id] });
	});

	it('deleteViews (bulk) scrubs all deleted ids from a surviving view-list token in one pass', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
		const childA = (await ctx.api.createViewInProject(proj.id, 'Child A'))!;
		const childB = (await ctx.api.createViewInProject(proj.id, 'Child B'))!;
		const childC = (await ctx.api.createViewInProject(proj.id, 'Child C'))!;

		await ctx.api.upsertViewToken(
			proj.id,
			parent.id,
			'children',
			vl([childA.id, childB.id, childC.id])
		);

		await ctx.api.deleteViews([childA.id, childB.id]);

		const parentTokens = await ctx.api.getTokensByViewId(parent.id).execute();
		const childrenToken = parentTokens.find((t) => t.tokenAlias === 'children');
		expect(childrenToken!.tokenValue).toEqual({ type: 'view-list', view_ids: [childC.id] });
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

	// ---- Clone ----

	it('cloneViewSubtree strips the source view\'s own export flag from its hints, keeping other hint data', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v', {
			webcodium: { export: true },
			charter: { primitive: 'box' },
			view_icon: 'fa-regular fa-window-maximize'
		}))!;

		const cloneId = await ctx.api.cloneViewSubtree(view.id, 'children');
		expect(cloneId).toBeTruthy();

		const row = await ctx.db
			.selectFrom('views')
			.select('hints')
			.where('id', '=', cloneId!)
			.executeTakeFirstOrThrow();

		expect(row.hints).toEqual({
			charter: { primitive: 'box' },
			view_icon: 'fa-regular fa-window-maximize'
		});
	});

	it('cloneViewSubtree strips export flags on recursively-cloned children too, not just the top-level view', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
		const child = (await ctx.api.createViewInProject(proj.id, 'Child', {
			webcodium: { export: true }
		}))!;
		await ctx.api.upsertViewToken(proj.id, parent.id, 'children', vl([child.id]));

		const cloneId = (await ctx.api.cloneViewSubtree(parent.id, 'children'))!;

		const clonedTokens = await ctx.api.getTokensByViewId(cloneId).execute();
		const childrenToken = clonedTokens.find((t) => t.tokenAlias === 'children');
		const clonedChildId = (childrenToken!.tokenValue as { view_ids: string[] }).view_ids[0]!;

		const clonedChildRow = await ctx.db
			.selectFrom('views')
			.select('hints')
			.where('id', '=', clonedChildId)
			.executeTakeFirstOrThrow();
		expect(clonedChildRow.hints).toEqual({});
	});

	it('cloneViewSubtree clones a diamond-referenced view independently for each parent path (no shared reference)', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const root = (await ctx.api.createViewInProject(proj.id, 'Root'))!;
		const x = (await ctx.api.createViewInProject(proj.id, 'X'))!;
		const y = (await ctx.api.createViewInProject(proj.id, 'Y'))!;
		const z = (await ctx.api.createViewInProject(proj.id, 'Z'))!;
		await ctx.api.upsertViewToken(proj.id, root.id, 'children', vl([x.id, y.id]));
		await ctx.api.upsertViewToken(proj.id, x.id, 'children', vl([z.id]));
		await ctx.api.upsertViewToken(proj.id, y.id, 'children', vl([z.id]));

		const cloneRootId = (await ctx.api.cloneViewSubtree(root.id, 'children'))!;

		const childrenOf = async (viewId: string) => {
			const toks = await ctx.api.getTokensByViewId(viewId).execute();
			const t = toks.find((tok) => tok.tokenAlias === 'children');
			return t?.tokenValue?.type === 'view-list' ? t.tokenValue.view_ids : [];
		};

		const [cloneXId, cloneYId] = await childrenOf(cloneRootId);
		expect(cloneXId).toBeTruthy();
		expect(cloneYId).toBeTruthy();

		const cloneXChildren = await childrenOf(cloneXId!);
		const cloneYChildren = await childrenOf(cloneYId!);
		expect(cloneXChildren).toHaveLength(1);
		expect(cloneYChildren).toHaveLength(1);

		// Z was cloned TWICE -- once per parent path -- never shared between X's clone and Y's clone.
		expect(cloneXChildren[0]).not.toBe(z.id);
		expect(cloneYChildren[0]).not.toBe(z.id);
		expect(cloneXChildren[0]).not.toBe(cloneYChildren[0]);
	});

	it('cloneViewSubtree terminates on a genuine cycle, excluding the cycled-back id from its clone\'s children', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const a = (await ctx.api.createViewInProject(proj.id, 'A'))!;
		const b = (await ctx.api.createViewInProject(proj.id, 'B'))!;
		await ctx.api.upsertViewToken(proj.id, a.id, 'children', vl([b.id]));
		await ctx.api.upsertViewToken(proj.id, b.id, 'children', vl([a.id])); // cycle back to A

		const cloneAId = (await ctx.api.cloneViewSubtree(a.id, 'children'))!;

		const childrenOf = async (viewId: string) => {
			const toks = await ctx.api.getTokensByViewId(viewId).execute();
			const t = toks.find((tok) => tok.tokenAlias === 'children');
			return t?.tokenValue?.type === 'view-list' ? t.tokenValue.view_ids : [];
		};

		const aChildren = await childrenOf(cloneAId);
		expect(aChildren).toHaveLength(1);
		const cloneBId = aChildren[0]!;
		expect(cloneBId).not.toBe(b.id);

		// B's own clone excludes A entirely -- A is on B's own ancestor path, a real cycle, not a
		// diamond -- matching the original recursive `seen`-guard semantics exactly.
		const bChildren = await childrenOf(cloneBId);
		expect(bChildren).toHaveLength(0);
	});

	it('cloneViewSubtree inserts a non-root clone as a sibling immediately after its source view', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const parent = (await ctx.api.createViewInProject(proj.id, 'Parent'))!;
		const before = (await ctx.api.createViewInProject(proj.id, 'Before'))!;
		const target = (await ctx.api.createViewInProject(proj.id, 'Target'))!;
		const after = (await ctx.api.createViewInProject(proj.id, 'After'))!;
		await ctx.api.upsertViewToken(
			proj.id,
			parent.id,
			'children',
			vl([before.id, target.id, after.id])
		);

		const cloneId = (await ctx.api.cloneViewSubtree(target.id, 'children'))!;

		const parentTokens = await ctx.api.getTokensByViewId(parent.id).execute();
		const childrenToken = parentTokens.find((t) => t.tokenAlias === 'children');
		expect(childrenToken!.tokenValue).toEqual({
			type: 'view-list',
			view_ids: [before.id, target.id, cloneId, after.id]
		});
	});

	it('cloneViewSubtree leaves a root (unattached) view\'s clone free-floating, same as before', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const root = (await ctx.api.createViewInProject(proj.id, 'Root'))!;
		const cloneId = await ctx.api.cloneViewSubtree(root.id, 'children');
		expect(cloneId).toBeTruthy();

		// No token anywhere references either the original or the clone as a child -- nothing to
		// assert beyond "it didn't throw and produced a real clone."
		const cloneRow = await ctx.db
			.selectFrom('views')
			.select('id')
			.where('id', '=', cloneId!)
			.executeTakeFirst();
		expect(cloneRow).toBeDefined();
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

	it('bulk-reorders composed kits without a unique-priority collision', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;
		const k1 = (await ctx.api.createKitInProject(proj.id, 'base'))!;
		const k2 = (await ctx.api.createKitInProject(proj.id, 'theme'))!;
		const k3 = (await ctx.api.createKitInProject(proj.id, 'overrides'))!;
		await ctx.api.attachKitToComposition(k1.id, view.id); // 1000
		await ctx.api.attachKitToComposition(k2.id, view.id); // 2000
		await ctx.api.attachKitToComposition(k3.id, view.id); // 3000

		// Move theme (currently top, priority_index desc) to the bottom -- the intermediate
		// priorities it and its neighbours would pass through overlap, so a per-row sequence would
		// trip the unique_priority_per_view constraint. The single transaction must not.
		await ctx.api.setKitCompositionOrder(view.id, [k1.id, k3.id, k2.id]);

		const list = await ctx.api.getKitCompositionByViewId(view.id).execute();
		expect(list.map((e) => e.kitName)).toEqual(['base', 'overrides', 'theme']);
		expect(list.map((e) => e.kitIndex)).toEqual([3000, 2000, 1000]);
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

	it('defaults a new axis to static, not-excluded, and round-trips setAxisVariantKind/setAxisExcludedFromExport', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'state'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;
		await ctx.api.consumeAxis(kit.id, axis.id);

		const before = await ctx.api.getConsumedAxesByKitId(kit.id).execute();
		expect(before[0]!.variantKind).toBe('static');
		expect(before[0]!.excludedFromExport).toBe(false);

		await ctx.api.setAxisVariantKind(axis.id, 'dynamic');
		await ctx.api.setAxisExcludedFromExport(kit.id, axis.id, true);

		const after = await ctx.api.getConsumedAxesByKitId(kit.id).execute();
		expect(after[0]!.variantKind).toBe('dynamic');
		expect(after[0]!.excludedFromExport).toBe(true);
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

	it('moveRenderEntryToLayer relocates an entry to a new condition set, preserving id/token, and GCs the emptied source layer', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const dark = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;
		const light = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const token = (await ctx.api.createToken(proj.id, 'brand', s('#111111')))!;

		const sourceLayer = (await ctx.api.createLayerWithConditions(kit.id, [dark.id]))!;
		const sourceSnippets = await ctx.api.getRenderSnippetsByLayerId(sourceLayer.layerId).execute();
		const entry = (await ctx.api.createRenderEntry(
			sourceSnippets[0]!.snippetId,
			'color',
			null,
			token.id
		))!;

		const result = await ctx.api.moveRenderEntryToLayer(
			sourceLayer.layerId,
			'color',
			kit.id,
			[light.id]
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.created).toBe(true);
		expect(result.sourceLayerDeleted).toBe(true); // conditioned source layer left empty
		expect(result.layerId).not.toBe(sourceLayer.layerId);

		// Entry survived with identical id and its token intact.
		const moved = await ctx.db
			.selectFrom('render_entries')
			.selectAll()
			.where('id', '=', entry.id)
			.executeTakeFirst();
		expect(moved).toBeDefined();
		expect(moved!.token_id).toBe(token.id);

		// Source (conditioned) layer is gone.
		const remainingSourceLayer = await ctx.db
			.selectFrom('layers')
			.selectAll()
			.where('id', '=', sourceLayer.layerId)
			.executeTakeFirst();
		expect(remainingSourceLayer).toBeUndefined();

		// New layer has the light condition.
		const newConds = await ctx.db
			.selectFrom('layer_axis_values')
			.selectAll()
			.where('layer_id', '=', result.layerId)
			.execute();
		expect(newConds.map((c) => c.axis_value_id)).toEqual([light.id]);
	});

	it('moveRenderEntryToLayer rejects a move to a different kit', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kitA = (await ctx.api.createKitInProject(proj.id, 'a'))!;
		const kitB = (await ctx.api.createKitInProject(proj.id, 'b'))!;
		const layer = (await ctx.api.createLayer(kitA.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
		await ctx.api.createRenderEntry(snippet.id, 'color', '#fff');

		const result = await ctx.api.moveRenderEntryToLayer(layer.id, 'color', kitB.id, []);
		expect(result).toEqual({ ok: false, reason: 'cross-kit-not-supported' });
	});

	it('moveRenderEntryToLayer reuses an existing layer with the same target condition set', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const dark = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const existingDarkLayer = (await ctx.api.createLayerWithConditions(kit.id, [dark.id]))!;
		const nullLayer = (await ctx.api.createLayer(kit.id))!;
		const nullSnippet = (await ctx.api.createRenderSnippet(nullLayer.id))!;
		await ctx.api.createRenderEntry(nullSnippet.id, 'color', '#fff');

		const result = await ctx.api.moveRenderEntryToLayer(nullLayer.id, 'color', kit.id, [dark.id]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.created).toBe(false);
		expect(result.layerId).toBe(existingDarkLayer.layerId);
		// The null layer is never GC'd even when left empty.
		expect(result.sourceLayerDeleted).toBe(false);

		const nullLayerStillThere = await ctx.db
			.selectFrom('layers')
			.selectAll()
			.where('id', '=', nullLayer.id)
			.executeTakeFirst();
		expect(nullLayerStillThere).toBeDefined();
	});

	it('updateLayerAxisValues diffs a layer condition set in place with no collision', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const themeAxis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const dark = (await ctx.api.createAxisValue(themeAxis.id, { type: 'literal', value: 'dark' }))!;
		const light = (await ctx.api.createAxisValue(themeAxis.id, {
			type: 'literal',
			value: 'light'
		}))!;
		const densityAxis = (await ctx.api.createAxis(proj.id, 'density'))!;
		const compact = (await ctx.api.createAxisValue(densityAxis.id, {
			type: 'literal',
			value: 'compact'
		}))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		const layer = (await ctx.api.createLayer(kit.id))!;
		await ctx.api.addAxisValueToLayer(layer.id, dark.id);

		const result = await ctx.api.updateLayerAxisValues(layer.id, [light.id, compact.id]);
		expect(result).toEqual({ merged: false });

		const conds = await ctx.db
			.selectFrom('layer_axis_values')
			.select('axis_value_id')
			.where('layer_id', '=', layer.id)
			.execute();
		expect(new Set(conds.map((c) => c.axis_value_id))).toEqual(new Set([light.id, compact.id]));
	});

	it('updateLayerAxisValues merges into a sibling layer with the resulting identical condition set, edited layer wins on a property clash', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const dark = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'dark' }))!;
		const light = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'button'))!;

		// Existing dark-scoped layer with a 'color' entry.
		const darkLayer = (await ctx.api.createLayerWithConditions(kit.id, [dark.id]))!;
		const darkSnippets = await ctx.api.getRenderSnippetsByLayerId(darkLayer.layerId).execute();
		await ctx.api.createRenderEntry(darkSnippets[0]!.snippetId, 'color', '#000000');
		await ctx.api.createRenderEntry(darkSnippets[0]!.snippetId, 'padding', '4px');

		// A separate light-scoped layer, about to be re-pointed at dark -- also declares 'color'
		// (clash) plus a distinct property.
		const lightLayer = (await ctx.api.createLayerWithConditions(kit.id, [light.id]))!;
		const lightSnippets = await ctx.api.getRenderSnippetsByLayerId(lightLayer.layerId).execute();
		await ctx.api.createRenderEntry(lightSnippets[0]!.snippetId, 'color', '#ffffff');
		await ctx.api.createRenderEntry(lightSnippets[0]!.snippetId, 'gap', '8px');

		const result = await ctx.api.updateLayerAxisValues(lightLayer.layerId, [dark.id]);
		expect(result).toEqual({ merged: true, mergedIntoLayerId: darkLayer.layerId });

		// The edited (light->dark) layer is gone.
		const editedLayerStillThere = await ctx.db
			.selectFrom('layers')
			.selectAll()
			.where('id', '=', lightLayer.layerId)
			.executeTakeFirst();
		expect(editedLayerStillThere).toBeUndefined();

		// The surviving dark layer has: 'color' from the merged-in (edited) layer (#ffffff, the
		// clash winner), 'padding' from its own original entry, and 'gap' from the merged-in layer.
		const survivingSnippets = await ctx.api.getRenderSnippetsByLayerId(darkLayer.layerId).execute();
		const entries = await ctx.db
			.selectFrom('render_entries')
			.select(['property', 'value'])
			.where(
				'snippet_id',
				'in',
				survivingSnippets.map((s) => s.snippetId)
			)
			.execute();
		const byProp = Object.fromEntries(entries.map((e) => [e.property, e.value]));
		expect(byProp).toEqual({ color: '#ffffff', padding: '4px', gap: '8px' });
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

	it('moveTokenScope moves a token between scopes, preserving its id', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;
		const view = (await ctx.api.createViewInProject(proj.id, 'v'))!;

		const token = (await ctx.api.createToken(proj.id, 'brand', s('#111111')))!;
		expect(token.kit_id).toBeNull();
		expect(token.view_id).toBeNull();

		// project -> kit
		const toKit = await ctx.api.moveTokenScope(token.id, { kitId: kit.id });
		expect(toKit).toEqual({ ok: true });
		let kitTokens = await ctx.api.getTokensByKitId(kit.id).execute();
		expect(kitTokens).toHaveLength(1);
		expect(kitTokens[0]!.tokenId).toBe(token.id);

		// kit -> view
		const toView = await ctx.api.moveTokenScope(token.id, { viewId: view.id });
		expect(toView).toEqual({ ok: true });
		const viewTokens = await ctx.api.getTokensByViewId(view.id).execute();
		expect(viewTokens).toHaveLength(1);
		expect(viewTokens[0]!.tokenId).toBe(token.id);
		kitTokens = await ctx.api.getTokensByKitId(kit.id).execute();
		expect(kitTokens).toHaveLength(0);

		// view -> project
		const toProject = await ctx.api.moveTokenScope(token.id, { projectOnly: true });
		expect(toProject).toEqual({ ok: true });
		const projectTokens = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(projectTokens.map((t) => t.tokenId)).toContain(token.id);
	});

	it('moveTokenScope blocks on an alias collision at the target scope, leaving the token unmoved', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'Button'))!;

		const projectToken = (await ctx.api.createToken(proj.id, 'brand', s('#111111')))!;
		const kitToken = (await ctx.api.createToken(proj.id, 'brand', s('#222222'), {
			kitId: kit.id
		}))!;

		const result = await ctx.api.moveTokenScope(projectToken.id, { kitId: kit.id });
		expect(result).toEqual({
			ok: false,
			reason: 'alias-collision',
			collidingTokenId: kitToken.id
		});

		// Unmoved: still project-scoped.
		const projectTokens = await ctx.api.getTokensByProjectId(proj.id).execute();
		expect(projectTokens.map((t) => t.tokenId)).toContain(projectToken.id);
		const kitTokens = await ctx.api.getTokensByKitId(kit.id).execute();
		expect(kitTokens.map((t) => t.tokenId)).toEqual([kitToken.id]);
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
		const childView = (await ctx.api.createViewInProject(proj.id, 'child'))!;
		const kit = (await ctx.api.createKitInProject(proj.id, 'k'))!;
		const axis = (await ctx.api.createAxis(proj.id, 'theme'))!;
		const av = (await ctx.api.createAxisValue(axis.id, { type: 'literal', value: 'light' }))!;
		const layer = (await ctx.api.createLayer(kit.id))!;
		const snippet = (await ctx.api.createRenderSnippet(layer.id))!;
		// Exercises the "soft" FK cases importProjectData has to remap by hand: a view-type token,
		// a view-LIST-type token (the mechanism the live UI actually uses for composition/children --
		// see the remapTokenValue comment), and the legacy 'children' JSON-array-of-view-ids literal.
		await ctx.api.createRenderEntry(snippet.id, 'children', JSON.stringify([view.id]));
		await ctx.api.addAxisValueToLayer(layer.id, av.id);
		await ctx.api.consumeAxis(kit.id, axis.id);
		await ctx.api.setAxisArg(view.id, kit.id, axis.id, { type: 'literal', value: 'light' });
		await ctx.api.createToken(proj.id, 'primary', s('#FFFFFF'));
		await ctx.api.createToken(proj.id, 'heroView', { type: 'view', view_id: view.id });
		await ctx.api.createToken(
			proj.id,
			'children',
			{ type: 'view-list', view_ids: [childView.id] },
			{ viewId: view.id }
		);
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
		expect(reimported.views).toHaveLength(2);
		expect(reimported.kits).toHaveLength(1);
		expect(reimported.compositions).toHaveLength(1);
		expect(reimported.tokens).toHaveLength(3);
		expect(reimported.axes).toHaveLength(1);
		expect(reimported.axisValues).toHaveLength(1);
		expect(reimported.axesConsumed).toHaveLength(1);
		expect(reimported.axisArgs).toHaveLength(1);
		expect(reimported.layers).toHaveLength(1);
		expect(reimported.renderSnippets).toHaveLength(1);
		expect(reimported.renderEntries).toHaveLength(1);
		expect(reimported.layerAxisValues).toHaveLength(1);

		// Every id in the re-exported copy must be fresh, not reused from the source project.
		const newViewId = reimported.views.find((v: any) => v.name === 'v')!.id;
		const newChildViewId = reimported.views.find((v: any) => v.name === 'child')!.id;
		expect(newViewId).not.toBe(view.id);
		expect(newChildViewId).not.toBe(childView.id);
		expect(reimported.kits[0]!.id).not.toBe(kit.id);

		// The view-type token must now point at the NEW view, not the source project's.
		const reimportedViewToken = reimported.tokens.find((t: any) => t.alias === 'heroView');
		expect(reimportedViewToken.value.view_id).toBe(newViewId);
		expect(reimportedViewToken.value.view_id).not.toBe(view.id);

		// The view-LIST-type token (the live composition mechanism) must reference the NEW child
		// view, not the source project's -- this is the case remapTokenValue used to silently skip.
		const reimportedChildrenToken = reimported.tokens.find(
			(t: any) => t.alias === 'children' && t.value.type === 'view-list'
		);
		expect(reimportedChildrenToken.value.view_ids).toEqual([newChildViewId]);
		expect(reimportedChildrenToken.value.view_ids).not.toEqual([childView.id]);

		// The 'children' render entry's JSON array must reference the new view id too.
		const childrenEntry = reimported.renderEntries.find((e: any) => e.property === 'children');
		expect(JSON.parse(childrenEntry.value)).toEqual([newViewId]);

		// The source project itself must be completely untouched by the import.
		const original = await ctx.api.exportProject(proj.id);
		expect(original.views).toHaveLength(2);
		expect(original.views.find((v: any) => v.name === 'v')!.id).toBe(view.id);
		const originalViewToken = original.tokens.find((t: any) => t.alias === 'heroView');
		expect(originalViewToken.value.view_id).toBe(view.id);
		const originalChildrenToken = original.tokens.find(
			(t: any) => t.alias === 'children' && t.value.type === 'view-list'
		);
		expect(originalChildrenToken.value.view_ids).toEqual([childView.id]);
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

	// ---- Assets ----

	it('upserts an asset by checksum and looks it up by id', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const created = await ctx.api.upsertAsset({
			projectId: proj.id,
			name: 'favicon.png',
			mimeType: 'image/png',
			checksum: 'abc123',
			link: '/1x/favicon.png',
			width: 623,
			height: 476
		});
		expect(created.name).toBe('favicon.png');

		const again = await ctx.api.upsertAsset({
			projectId: proj.id,
			name: 'favicon.png',
			mimeType: 'image/png',
			checksum: 'abc123',
			link: '/1x/favicon.png',
			width: 623,
			height: 476
		});
		expect(again.id).toBe(created.id);

		const found = await ctx.api.getAssetById(created.id);
		expect(found?.link).toBe('/1x/favicon.png');
		expect(found?.width).toBe(623);
	});

	it('getAssetById returns undefined for an unknown id', async () => {
		const found = await ctx.api.getAssetById('00000000-0000-0000-0000-000000000000');
		expect(found).toBeUndefined();
	});

	it('getAssetsByIds batch-fetches only the requested ids, and tolerates unknown/empty input', async () => {
		const allWs = await ctx.api.getAllWorkspaces().execute();
		const wsId = allWs[0]!.workspaceId;
		const proj = (await ctx.api.createProjectInWorkspace(wsId, 'p'))!;

		const a = await ctx.api.upsertAsset({
			projectId: proj.id,
			name: 'a.png',
			mimeType: 'image/png',
			checksum: 'aaa',
			link: '/a.png',
			width: 10,
			height: 10
		});
		const b = await ctx.api.upsertAsset({
			projectId: proj.id,
			name: 'b.png',
			mimeType: 'image/png',
			checksum: 'bbb',
			link: '/b.png',
			width: 20,
			height: 20
		});
		await ctx.api.upsertAsset({
			projectId: proj.id,
			name: 'c.png',
			mimeType: 'image/png',
			checksum: 'ccc',
			link: '/c.png',
			width: 30,
			height: 30
		});

		const found = await ctx.api.getAssetsByIds([a.id, b.id, '00000000-0000-0000-0000-000000000000']);
		expect(found.map((r) => r.link).sort()).toEqual(['/a.png', '/b.png']);

		expect(await ctx.api.getAssetsByIds([])).toEqual([]);
	});
});
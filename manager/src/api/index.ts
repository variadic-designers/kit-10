import { Schema, SchemaDialect } from '../schema.js';
import { SelectQueryBuilder } from 'kysely';

export interface QueryOrdering {
	attachKitToComposition: (kitId: string, viewId: string) => Promise<{ priority_index: number; kit_id: string; view_id: string } | undefined>;
	detachKitFromComposition: (kitId: string, viewId: string) => Promise<void>;
}

export interface QueryToken {
	createToken: (projectId: string, alias?: string, value?: string) => Promise<{ id: string; project_id: string; alias: string | null; value: string | null; resolution: string | null } | undefined>;
	updateTokenValue: (tokenId: string, value: string) => Promise<void>;
	updateTokenAlias: (tokenId: string, alias: string) => Promise<void>;
	deleteToken: (tokenId: string) => Promise<void>;
	getTokensByProjectId: (projectId: string) => SelectQueryBuilder<Schema, 'tokens', { tokenId: string; tokenAlias: string | null; tokenValue: string | null; tokenResolution: string | null }>;
}

export interface QueryKit {
	renameKit: (kitId: string, newName: string) => Promise<void>;
	deleteKit: (kitId: string) => Promise<void>;
	getKitsByProjectId: (projectId: string) => SelectQueryBuilder<Schema, 'kits', { kitId: string; kitName: string }>;
}

export interface QueryView {
	renameView: (viewId: string, newName: string) => Promise<void>;
	toggleViewLock: (viewId: string, locked: boolean) => Promise<void>;
	toggleViewHide: (viewId: string, hidden: boolean) => Promise<void>;
}

export interface QueryAxis {
	createAxis: (projectId: string, name: string, description?: string, kind?: string, hint?: string[], defaultValue?: any) => Promise<{ id: string; project_id: string; name: string | null; description: string | null; kind: string | null; hint: any; default_value: any } | undefined>;
	renameAxis: (axisId: string, newName: string) => Promise<void>;
	deleteAxis: (axisId: string) => Promise<void>;
	getAxesByProjectId: (projectId: string) => SelectQueryBuilder<Schema, 'axes', { axisId: string; axisName: string | null; axisDescription: string | null; axisKind: string | null; axisHint: any; axisDefaultValue: any }>;
	getAxesByKitId: (kitId: string) => SelectQueryBuilder<Schema, 'axes' | 'axes_consumed', { axisId: string; axisName: string | null; axisDescription: string | null; axisKind: string | null; axisHint: any; priorityIndex: number }>;
}

export interface QueryAxisValue {
	createAxisValue: (axisId: string, value: any) => Promise<{ id: string; axis_id: string; value: any } | undefined>;
	deleteAxisValue: (axisValueId: string) => Promise<void>;
	getAxisValuesByAxisId: (axisId: string) => SelectQueryBuilder<Schema, 'axis_values', { axisValueId: string; value: any }>;
}

export interface QueryAxisConsumed {
	consumeAxis: (kitId: string, axisId: string) => Promise<{ kit_id: string; axis_id: string; priority_index: number } | undefined>;
	unconsumeAxis: (kitId: string, axisId: string) => Promise<void>;
	reorderAxesInKit: (kitId: string, axisId: string, newPriority: number) => Promise<void>;
	getConsumedAxesByKitId: (kitId: string) => SelectQueryBuilder<Schema, 'axes_consumed' | 'axes', { axisId: string; axisName: string | null; axisKind: string | null; priorityIndex: number }>;
}

export interface QueryAxisArgs {
	setAxisArg: (viewId: string, kitId: string, axisId: string, value: any) => Promise<{ view_id: string; kit_id: string; axis_id: string; value: any } | undefined>;
	getAllAxisArgs: (viewId: string, kitId: string) => SelectQueryBuilder<Schema, 'axis_args', { axisId: string; kitId: string; viewId: string; value: any }>;
}

export interface QueryLayer {
	createLayer: (kitId: string) => Promise<{ id: string; kit_id: string; last_modified: Date } | undefined>;
	deleteLayer: (layerId: string) => Promise<void>;
	addAxisValueToLayer: (layerId: string, axisValueId: string) => Promise<void>;
	removeAxisValueFromLayer: (layerId: string, axisValueId: string) => Promise<void>;
	getLayersByKitId: (kitId: string) => SelectQueryBuilder<Schema, 'layers', { layerId: string; kitId: string; lastModified: Date }>;
}

export interface QueryRenderSnippet {
	createRenderSnippet: (layerId: string) => Promise<{ id: string; layer_id: string; last_modified: Date } | undefined>;
	deleteRenderSnippet: (snippetId: string) => Promise<void>;
	getRenderSnippetsByLayerId: (layerId: string) => SelectQueryBuilder<Schema, 'render_snippets', { snippetId: string; layerId: string; lastModified: Date }>;
}

export interface QueryRenderEntry {
	createRenderEntry: (snippetId: string, property: string, value: string) => Promise<{ id: string; snippet_id: string; property: string; value: string } | undefined>;
	updateRenderEntry: (entryId: string, property: string, value: string) => Promise<void>;
	deleteRenderEntry: (entryId: string) => Promise<void>;
	getRenderEntriesBySnippetId: (snippetId: string) => SelectQueryBuilder<Schema, 'render_entries', { entryId: string; snippetId: string; property: string; value: string }>;
	getRenderEntriesByLayerId: (layerId: string) => SelectQueryBuilder<Schema, 'render_snippets' | 'render_entries', { entryId: string; snippetId: string; property: string; value: string }>;
}

export interface QueryAction {
	createWorkspace: (name: string) => Promise<{ id: string; name: string; description: string | null; last_active: Date } | undefined>;
	createProjectInWorkspace: (workspaceId: string, name: string) => Promise<{ id: string; name: string; description: string | null; last_modified: Date; license: string; author: string; workspace_id: string } | undefined>;
	renameProject: (projectId: string, newName: string) => Promise<void>;
	deleteProject: (projectId: string) => Promise<any>;
	createViewInProject: (projectId: string, name: string) => Promise<{ id: string; name: string; last_modified: Date; project_id: string; lock: boolean; hide: boolean } | undefined>;
	deleteView: (viewId: string) => Promise<void>;
	createKitInProject: (projectId: string, name: string) => Promise<{ id: string; project_id: string } | undefined>;
	exportProject: (projectId: string) => Promise<any | undefined>;
}

export interface QueryBuilder {
	getAllWorkspaces: () => SelectQueryBuilder<Schema, 'workspaces', { projectCount: string | number | bigint | null } & { workspaceId: string; workspaceName: string; workspaceDescription: string | null; lastActive: Date }>;
	getAllProjects: () => SelectQueryBuilder<Schema, 'workspaces' | 'projects', { workspaceName: string; projectId: string; projectName: string; projectDescription: string | null; license: string; author: string }>;
	getProjectsByWorkspaceId: (workspaceId: string) => SelectQueryBuilder<Schema, 'projects', { projectId: string; projectName: string; projectDescription: string | null; license: string; author: string }>;
	getViewsByProjectId: (projectId: string) => SelectQueryBuilder<Schema, 'views', { viewId: string; viewName: string; viewLocked: boolean; viewHidden: boolean }>;
	getKitCompositionByViewId: (viewId: string) => SelectQueryBuilder<Schema, 'kits' | 'compositions', { kitId: string; kitName: string; kitIndex: number; kitView: string }>;
	getKitsExceptFromViewId: (viewId: string) => SelectQueryBuilder<Schema, 'kits', { kitId: string; kitName: string }>;
}

export interface Api extends QueryBuilder, QueryAction, QueryOrdering, QueryToken, QueryKit, QueryView, QueryAxis, QueryAxisValue, QueryAxisConsumed, QueryAxisArgs, QueryLayer, QueryRenderSnippet, QueryRenderEntry {}

export const queryBuilder = (db: SchemaDialect): Api => ({
	createWorkspace: async (name: string) => {
		return await db.insertInto('workspaces').values([{ name }]).returningAll().executeTakeFirst();
	},

	exportProject: async (projectId: string) => {
		return await db.transaction().execute(async (trx) => {
			const project = await trx.selectFrom('projects').selectAll().where('projects.id', '=', projectId).executeTakeFirst();
			if (!project) throw 'Project does not exist';

			const views = await trx.selectFrom('views').selectAll().where('views.project_id', '=', projectId).execute();
			const kits = await trx.selectFrom('kits').selectAll().where('kits.project_id', '=', projectId).execute();
			const kitIds = kits.map((k) => k.id);
			const viewIds = views.map((v) => v.id);

			const compositions = await trx.selectFrom('compositions').selectAll().where((eb) => eb.or([eb('compositions.kit_id', 'in', kitIds), eb('compositions.view_id', 'in', viewIds)])).execute();

			const tokens = await trx.selectFrom('tokens').selectAll().where('tokens.project_id', '=', projectId).execute();
			const axes = await trx.selectFrom('axes').selectAll().where('axes.project_id', '=', projectId).execute();
			const axisValues = await trx.selectFrom('axis_values').selectAll().where('axis_values.axis_id', 'in', axes.map((a) => a.id)).execute();
			const axesConsumed = await trx.selectFrom('axes_consumed').selectAll().where('axes_consumed.kit_id', 'in', kitIds).execute();
			const axisArgs = await trx.selectFrom('axis_args').selectAll().where('axis_args.kit_id', 'in', kitIds).execute();

			const layers = await trx.selectFrom('layers').selectAll().where('layers.kit_id', 'in', kitIds).execute();
			const layerIds = layers.map((l) => l.id);

			const renderSnippets = await trx.selectFrom('render_snippets').selectAll().where('render_snippets.layer_id', 'in', layerIds).execute();
			const snippetIds = renderSnippets.map((s) => s.id);

			const renderEntries = await trx.selectFrom('render_entries').selectAll().where('render_entries.snippet_id', 'in', snippetIds).execute();
			const layerAxisValues = await trx.selectFrom('layer_axis_values').selectAll().where('layer_axis_values.layer_id', 'in', layerIds).execute();

			return { project, views, kits, compositions, tokens, axes, axisValues, axesConsumed, axisArgs, layers, renderSnippets, renderEntries, layerAxisValues };
		});
	},

	createProjectInWorkspace: async (workspaceId: string, name: string) => {
		return await db.insertInto('projects').values([{ name, workspace_id: workspaceId, description: '', author: '', license: 'mplv2' }]).returningAll().executeTakeFirst();
	},

	renameProject: async (projectId: string, newName: string) => {
		await db.updateTable('projects').set({ name: newName }).where('projects.id', '=', projectId).execute();
	},

	deleteProject: async (projectId: string) => {
		await db.deleteFrom('projects').where('projects.id', '=', projectId).execute();
	},

	createViewInProject: async (projectId: string, name: string) => {
		return await db.insertInto('views').values([{ name, project_id: projectId, lock: false, hide: false }]).returningAll().executeTakeFirst();
	},

	deleteView: async (viewId: string) => {
		await db.deleteFrom('views').where('views.id', '=', viewId).execute();
	},

	renameView: async (viewId: string, newName: string) => {
		await db.updateTable('views').set({ name: newName }).where('views.id', '=', viewId).execute();
	},

	toggleViewLock: async (viewId: string, locked: boolean) => {
		await db.updateTable('views').set({ lock: locked }).where('views.id', '=', viewId).execute();
	},

	toggleViewHide: async (viewId: string, hidden: boolean) => {
		await db.updateTable('views').set({ hide: hidden }).where('views.id', '=', viewId).execute();
	},

	createKitInProject: async (projectId: string, name: string) => {
		return await db.insertInto('kits').values([{ name, project_id: projectId }]).returning(['kits.id', 'kits.project_id']).executeTakeFirst();
	},

	renameKit: async (kitId: string, newName: string) => {
		await db.updateTable('kits').set({ name: newName }).where('kits.id', '=', kitId).execute();
	},

	deleteKit: async (kitId: string) => {
		await db.deleteFrom('kits').where('kits.id', '=', kitId).execute();
	},

	attachKitToComposition: async (kitId: string, viewId: string) => {
		return await db.transaction().execute(async (trx) => {
			const last = await trx.selectFrom('compositions').select('priority_index').where('view_id', '=', viewId).orderBy('priority_index', 'desc').executeTakeFirst();
			const idx = last ? last.priority_index + 1000 : 1000;
			return await trx.insertInto('compositions').values({ view_id: viewId, kit_id: kitId, priority_index: idx }).onConflict((oc) => oc.columns(['view_id', 'kit_id']).doNothing()).returningAll().executeTakeFirst();
		});
	},

	detachKitFromComposition: async (kitId: string, viewId: string) => {
		await db.deleteFrom('compositions').where('compositions.kit_id', '=', kitId).where('compositions.view_id', '=', viewId).execute();
	},

	createToken: async (projectId: string, alias?: string, value?: string) => {
		return await db.insertInto('tokens').values({ project_id: projectId, alias: alias ?? null, value: value ?? null }).returningAll().executeTakeFirst();
	},

	updateTokenValue: async (tokenId: string, value: string) => {
		await db.updateTable('tokens').set({ value }).where('tokens.id', '=', tokenId).execute();
	},

	updateTokenAlias: async (tokenId: string, alias: string) => {
		await db.updateTable('tokens').set({ alias }).where('tokens.id', '=', tokenId).execute();
	},

	deleteToken: async (tokenId: string) => {
		await db.deleteFrom('tokens').where('tokens.id', '=', tokenId).execute();
	},

	createAxis: async (projectId: string, name: string, description?: string, kind?: string, hint?: string[], defaultValue?: any) => {
		return await db.insertInto('axes').values({ project_id: projectId, name, description: description ?? null, kind: kind ?? null, hint: hint ?? null, default_value: defaultValue ?? null } as any).returningAll().executeTakeFirst();
	},

	renameAxis: async (axisId: string, newName: string) => {
		await db.updateTable('axes').set({ name: newName }).where('axes.id', '=', axisId).execute();
	},

	deleteAxis: async (axisId: string) => {
		await db.deleteFrom('axes').where('axes.id', '=', axisId).execute();
	},

	createAxisValue: async (axisId: string, value: any) => {
		return await db.insertInto('axis_values').values({ axis_id: axisId, value } as any).returningAll().executeTakeFirst();
	},

	deleteAxisValue: async (axisValueId: string) => {
		await db.deleteFrom('axis_values').where('axis_values.id', '=', axisValueId).execute();
	},

	getAxisValuesByAxisId: (axisId: string) => {
		return db.selectFrom('axis_values').where('axis_values.axis_id', '=', axisId)
			.select(['axis_values.id as axisValueId', 'axis_values.value']);
	},

	consumeAxis: async (kitId: string, axisId: string) => {
		return await db.transaction().execute(async (trx) => {
			const last = await trx.selectFrom('axes_consumed').select('priority_index').where('kit_id', '=', kitId).orderBy('priority_index', 'desc').executeTakeFirst();
			const idx = last ? last.priority_index + 1000 : 1000;
			return await trx.insertInto('axes_consumed').values({ kit_id: kitId, axis_id: axisId, priority_index: idx }).onConflict((oc) => oc.columns(['kit_id', 'axis_id']).doNothing()).returningAll().executeTakeFirst();
		});
	},

	unconsumeAxis: async (kitId: string, axisId: string) => {
		await db.deleteFrom('axes_consumed').where('axes_consumed.kit_id', '=', kitId).where('axes_consumed.axis_id', '=', axisId).execute();
	},

	reorderAxesInKit: async (kitId: string, axisId: string, newPriority: number) => {
		await db.updateTable('axes_consumed').set({ priority_index: newPriority }).where('axes_consumed.kit_id', '=', kitId).where('axes_consumed.axis_id', '=', axisId).execute();
	},

	setAxisArg: async (viewId: string, kitId: string, axisId: string, value: any) => {
		return await db.insertInto('axis_args').values({ view_id: viewId, kit_id: kitId, axis_id: axisId, value }).onConflict((oc) => oc.columns(['view_id', 'axis_id', 'kit_id']).doUpdateSet({ value })).returningAll().executeTakeFirst();
	},

	createLayer: async (kitId: string) => {
		return await db.insertInto('layers').values({ kit_id: kitId }).returningAll().executeTakeFirst();
	},

	deleteLayer: async (layerId: string) => {
		await db.deleteFrom('layers').where('layers.id', '=', layerId).execute();
	},

	addAxisValueToLayer: async (layerId: string, axisValueId: string) => {
		await db.insertInto('layer_axis_values').values({ layer_id: layerId, axis_value_id: axisValueId }).onConflict((oc) => oc.columns(['layer_id', 'axis_value_id']).doNothing()).execute();
	},

	removeAxisValueFromLayer: async (layerId: string, axisValueId: string) => {
		await db.deleteFrom('layer_axis_values').where('layer_axis_values.layer_id', '=', layerId).where('layer_axis_values.axis_value_id', '=', axisValueId).execute();
	},

	createRenderSnippet: async (layerId: string) => {
		return await db.insertInto('render_snippets').values({ layer_id: layerId }).returningAll().executeTakeFirst();
	},

	deleteRenderSnippet: async (snippetId: string) => {
		await db.deleteFrom('render_snippets').where('render_snippets.id', '=', snippetId).execute();
	},

	createRenderEntry: async (snippetId: string, property: string, value: string) => {
		return await db.insertInto('render_entries').values({ snippet_id: snippetId, property, value }).returning(['id', 'snippet_id', 'property', 'value']).executeTakeFirst();
	},

	updateRenderEntry: async (entryId: string, property: string, value: string) => {
		await db.updateTable('render_entries').set({ property, value }).where('render_entries.id', '=', entryId).execute();
	},

	deleteRenderEntry: async (entryId: string) => {
		await db.deleteFrom('render_entries').where('render_entries.id', '=', entryId).execute();
	},

	getAllWorkspaces: () => {
		return db.selectFrom('workspaces')
			.select((eb) => [eb.selectFrom('projects').select(eb.fn.count('id').as('project_count')).whereRef('projects.workspace_id', '=', 'workspaces.id').as('projectCount')])
			.select(['workspaces.id as workspaceId', 'workspaces.name as workspaceName', 'workspaces.description as workspaceDescription', 'last_active as lastActive'])
			.orderBy('last_active', 'desc');
	},

	getAllProjects: () => {
		return db.selectFrom('workspaces').innerJoin('projects', 'projects.workspace_id', 'workspaces.id')
			.select(['workspaces.name as workspaceName', 'projects.name as projectName', 'projects.description as projectDescription', 'projects.id as projectId', 'projects.author', 'projects.license'])
			.orderBy('last_active', 'desc');
	},

	getProjectsByWorkspaceId: (workspaceId: string) => {
		return db.selectFrom('projects').where('workspace_id', '=', workspaceId).orderBy('last_modified', 'desc')
			.select(['projects.name as projectName', 'projects.description as projectDescription', 'projects.id as projectId', 'projects.author', 'projects.license']);
	},

	getViewsByProjectId: (projectId: string) => {
		return db.selectFrom('views').where('views.project_id', '=', projectId).orderBy('views.last_modified', 'desc')
			.select(['views.id as viewId', 'views.name as viewName', 'views.lock as viewLocked', 'views.hide as viewHidden']);
	},

	getKitCompositionByViewId: (viewId: string) => {
		return db.selectFrom('compositions').innerJoin('kits', 'kits.id', 'compositions.kit_id').where('compositions.view_id', '=', viewId).orderBy('compositions.priority_index', 'desc')
			.select(['kits.id as kitId', 'kits.name as kitName', 'compositions.view_id as kitView', 'compositions.priority_index as kitIndex']);
	},

	getKitsExceptFromViewId: (viewId: string) => {
		return db.selectFrom('kits').leftJoin('compositions', 'compositions.kit_id', 'kits.id').where('compositions.view_id', '!=', viewId)
			.select(['kits.id as kitId', 'kits.name as kitName', 'compositions.priority_index']);
	},

	getKitsByProjectId: (projectId: string) => {
		return db.selectFrom('kits').where('kits.project_id', '=', projectId).orderBy('kits.last_modified', 'desc')
			.select(['kits.id as kitId', 'kits.name as kitName']);
	},

	getTokensByProjectId: (projectId: string) => {
		return db.selectFrom('tokens').where('tokens.project_id', '=', projectId).orderBy('tokens.alias')
			.select(['tokens.id as tokenId', 'tokens.alias as tokenAlias', 'tokens.value as tokenValue', 'tokens.resolution as tokenResolution']);
	},

	getAxesByProjectId: (projectId: string) => {
		return db.selectFrom('axes').where('axes.project_id', '=', projectId)
			.select(['axes.id as axisId', 'axes.name as axisName', 'axes.description as axisDescription', 'axes.kind as axisKind', 'axes.hint as axisHint', 'axes.default_value as axisDefaultValue']);
	},

	getAxesByKitId: (kitId: string) => {
		return db.selectFrom('axes_consumed').innerJoin('axes', 'axes.id', 'axes_consumed.axis_id').where('axes_consumed.kit_id', '=', kitId).orderBy('axes_consumed.priority_index', 'desc')
			.select(['axes.id as axisId', 'axes.name as axisName', 'axes.description as axisDescription', 'axes.kind as axisKind', 'axes.hint as axisHint', 'axes_consumed.priority_index as priorityIndex']);
	},

	getConsumedAxesByKitId: (kitId: string) => {
		return db.selectFrom('axes_consumed').innerJoin('axes', 'axes.id', 'axes_consumed.axis_id').where('axes_consumed.kit_id', '=', kitId).orderBy('axes_consumed.priority_index', 'desc')
			.select(['axes.id as axisId', 'axes.name as axisName', 'axes.kind as axisKind', 'axes_consumed.priority_index as priorityIndex']);
	},

	getAllAxisArgs: (viewId: string, kitId: string) => {
		return db.selectFrom('axis_args').where('axis_args.view_id', '=', viewId).where('axis_args.kit_id', '=', kitId)
			.select(['axis_args.axis_id as axisId', 'axis_args.kit_id as kitId', 'axis_args.view_id as viewId', 'axis_args.value']);
	},

	getLayersByKitId: (kitId: string) => {
		return db.selectFrom('layers').where('layers.kit_id', '=', kitId).orderBy('layers.last_modified', 'desc')
			.select(['layers.id as layerId', 'layers.kit_id as kitId', 'layers.last_modified as lastModified']);
	},

	getRenderSnippetsByLayerId: (layerId: string) => {
		return db.selectFrom('render_snippets').where('render_snippets.layer_id', '=', layerId).orderBy('render_snippets.last_modified', 'desc')
			.select(['render_snippets.id as snippetId', 'render_snippets.layer_id as layerId', 'render_snippets.last_modified as lastModified']);
	},

	getRenderEntriesBySnippetId: (snippetId: string) => {
		return db.selectFrom('render_entries').where('render_entries.snippet_id', '=', snippetId)
			.select(['render_entries.id as entryId', 'render_entries.snippet_id as snippetId', 'render_entries.property', 'render_entries.value']);
	},

	getRenderEntriesByLayerId: (layerId: string) => {
		return db.selectFrom('render_entries').innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id').where('render_snippets.layer_id', '=', layerId)
			.select(['render_entries.id as entryId', 'render_entries.snippet_id as snippetId', 'render_entries.property', 'render_entries.value']);
	}
});
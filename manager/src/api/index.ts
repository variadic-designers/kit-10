import { Schema, SchemaDialect } from '../schema.js';
import { SelectQueryBuilder } from 'kysely';

export interface QueryOrdering {
	attachKitToComposition: (
		kitId: string,
		viewId: string
	) => Promise<
		| {
				priority_index: number;
				kit_id: string;
				view_id: string;
		  }
		| undefined
	>;

	detachKitFromComposition: (kitId: string, viewId: string) => Promise<void>;
}

export interface QueryAction {
	createWorkspace: (name: string) => Promise<
		| {
				id: string;
				name: string;
				description: string | null;
				last_active: Date;
		  }
		| undefined
	>;

	/*
  renameWorkspace: (workspaceId: string, newName: string) => Promise<any>;
  deleteWorkspace: (workspaceId: string) => Promise<any>;
  */

	createProjectInWorkspace: (
		workspaceId: string,
		name: string
	) => Promise<
		| {
				id: string;
				name: string;
				description: string | null;
				last_modified: Date;
				license: string;
				author: string;
				workspace_id: string;
		  }
		| undefined
	>;

	renameProject: (projectId: string, newName: string) => Promise<void>;
	deleteProject: (projectId: string) => Promise<any>;

	createViewInProject: (
		projectId: string,
		name: string
	) => Promise<
		| {
				id: string;
				name: string;
				last_modified: Date;
				project_id: string;
				lock: boolean;
				hide: boolean;
		  }
		| undefined
	>;

	deleteView: (viewId: string) => Promise<void>;

	createKitInProject: (
		projectId: string,
		name: string
	) => Promise<
		| {
				id: string;
				project_id: string;
		  }
		| undefined
	>;

	/*
  renameView: (viewId: string, newName: string) => Promise<any>;

  renameKit: (kitId: string, newName: string) => Promise<any>;
  deleteKit: (kitId: string) => Promise<any>;

  createRenderLayerInKit: (kitId: string) => Promise<any>;
  deleteRenderLayer: (kitId: string) => Promise<any>;

  createRenderRuleInSnippet: (snippetId: string) => Promise<any>;
  updateRenderRule: (ruleId: string, newValue: string) => Promise<any>;
  deleteRenderRule: (ruleId: string) => Promise<any>;

  createAxisInSet: (axisSetId: string, axisId: string, value: string) => Promise<any>;
  updateAxis: (axisId: string, newValue: string) => Promise<any>;
  deleteAxis: (axistId: string) => Promise<any>;

  // Instances
  setAxisInViewByKit: (viewId: string, kitId: string, axisId: string, value: string) => Promise<any>;
  */
}

export interface QueryBuilder {
	getAllWorkspaces: () => SelectQueryBuilder<
		Schema,
		'workspaces',
		{
			projectCount: string | number | bigint | null;
		} & {
			workspaceId: string;
			workspaceName: string;
			workspaceDescription: string | null;
			lastActive: Date;
		}
	>;

	getAllProjects: () => SelectQueryBuilder<
		Schema,
		'workspaces' | 'projects',
		{
			workspaceName: string;
			projectId: string;
			projectName: string;

			projectDescription: string | null;
			license: string;
			author: string;
		}
	>;

	getProjectsByWorkspaceId: (workspaceId: string) => SelectQueryBuilder<
		Schema,
		'projects',
		{
			projectId: string;
			projectName: string;

			projectDescription: string | null;
			license: string;
			author: string;
		}
	>;

	getViewsByProjectId: (projectId: string) => SelectQueryBuilder<
		Schema,
		'views',
		{
			viewId: string;
			viewName: string;
		}
	>;

	getKitCompositionByViewId: (viewId: string) => SelectQueryBuilder<
		Schema,
		'kits' | 'compositions',
		{
			kitId: string;
			kitName: string;
			kitIndex: number;
			kitView: string;
		}
	>;

	getKitsExceptFromViewId: (viewId: string) => SelectQueryBuilder<
		Schema,
		'kits',
		{
			kitId: string;
			kitName: string;
		}
	>;
}

export interface Api extends QueryBuilder, QueryAction, QueryOrdering {}

export const queryBuilder = (db: SchemaDialect): Api => ({
	createWorkspace: async (name: string) => {
		return await db.insertInto('workspaces').values([{ name }]).returningAll().executeTakeFirst();
	},

	createProjectInWorkspace: async (workspaceId: string, name: string) => {
		return await db
			.insertInto('projects')
			.values([
				{
					name,
					workspace_id: workspaceId,
					description: '',
					author: '',
					license: 'mplv2'
				}
			])
			.returningAll()
			.executeTakeFirst();
	},

	createViewInProject: async (projectId: string, name: string) => {
		return await db
			.insertInto('views')
			.values([
				{
					name,
					project_id: projectId,
					lock: false,
					hide: false
				}
			])
			.returningAll()
			.executeTakeFirst();
	},

	createKitInProject: async (projectId: string, name: string) => {
		return await db
			.insertInto('kits')
			.values([
				{
					name,
					project_id: projectId
				}
			])
			.returning(['kits.id', 'kits.project_id'])
			.executeTakeFirst();
	},

	attachKitToComposition: async (kitId: string, viewId: string) => {
		return await db.transaction().execute(async (trx) => {
			// 1. Get the current highest priority for this specific view
			const lastComposition = await trx
				.selectFrom('compositions')
				.select('priority_index')
				.where('view_id', '=', viewId)
				.orderBy('priority_index', 'desc')
				.executeTakeFirst();

			const newIndex = lastComposition ? lastComposition.priority_index + 1000 : 1000;

			// 2. Insert and join with Kit metadata for the UI
			return await trx
				.insertInto('compositions')
				.values({
					view_id: viewId,
					kit_id: kitId,
					priority_index: newIndex
				})
				.onConflict((oc) => oc.columns(['view_id', 'kit_id']).doNothing())
				.returningAll()
				.executeTakeFirst();
		});
	},

	detachKitFromComposition: async (kitId: string, viewId: string) => {
		await db
			.deleteFrom('compositions')
			.where('compositions.kit_id', '=', kitId)
			.where('compositions.view_id', '=', viewId)
			.execute();
	},

	deleteView: async (viewId: string) => {
		await db.deleteFrom('views').where('views.id', '=', viewId).execute();
	},

	renameProject: async (projectId: string, newName: string) => {
		await db
			.updateTable('projects')
			.set({ name: newName })
			.where('projects.id', '=', projectId)
			.execute();
	},

	deleteProject: async (projectId: string) => {
		await db.deleteFrom('projects').where('projects.id', '=', projectId).execute();
	},

	getAllWorkspaces: () => {
		return db
			.selectFrom('workspaces')
			.select((eb) => [
				eb
					.selectFrom('projects')
					.select(eb.fn.count('id').as('project_count'))
					.whereRef('projects.workspace_id', '=', 'workspaces.id')
					.as('projectCount')
			])
			.select([
				'workspaces.id as workspaceId',
				'workspaces.name as workspaceName',
				'workspaces.description as workspaceDescription',
				'last_active as lastActive'
			])
			.orderBy('last_active', 'desc');
	},

	getAllProjects: () => {
		return db
			.selectFrom('workspaces')
			.innerJoin('projects', 'projects.workspace_id', 'workspaces.id')
			.select([
				'workspaces.name as workspaceName',
				'projects.name as projectName',
				'projects.description as projectDescription',
				'projects.id as projectId',
				'projects.author',
				'projects.license'
			])
			.orderBy('last_active', 'desc');
	},

	getProjectsByWorkspaceId: (workspaceId: string) => {
		let query = db
			.selectFrom('projects')
			.where('workspace_id', '=', workspaceId)
			.orderBy('last_modified', 'desc')
			.select([
				'projects.name as projectName',
				'projects.description as projectDescription',
				'projects.id as projectId',
				'projects.author',
				'projects.license'
			]);

		return query;
	},

	getViewsByProjectId: (projectId: string) => {
		let query = db
			.selectFrom('views')
			.where('views.project_id', '=', projectId)
			.orderBy('views.last_modified', 'desc')
			.select([
				'views.id as viewId',
				'views.name as viewName',
				'views.lock as viewLocked',
				'views.hide as viewHidden'
			]);

		return query;
	},

	getKitCompositionByViewId: (viewId) => {
		const query = db
			.selectFrom('compositions')
			.innerJoin('kits', 'kits.id', 'compositions.kit_id')
			.where('compositions.view_id', '=', viewId)
			.orderBy('compositions.priority_index', 'desc')
			.select([
				'kits.id as kitId',
				'kits.name as kitName',
				'compositions.view_id as kitView',
				'compositions.priority_index as kitIndex'
			]);

		return query;
	},

	getKitsExceptFromViewId: (viewId) => {
		const query = db
			.selectFrom('compositions')
			.innerJoin('kits', 'kits.id', 'compositions.kit_id')
			.where('compositions.view_id', '!=', viewId)
			.select(['kits.id as kitId', 'kits.name as kitName']);

		return query;
	}
});

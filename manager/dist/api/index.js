export const queryBuilder = (db) => ({
    createWorkspace: async (name) => {
        return await db.insertInto('workspaces').values([{ name }]).returningAll().executeTakeFirst();
    },
    createProjectInWorkspace: async (workspaceId, name) => {
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
    createViewInProject: async (projectId, name) => {
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
    createKitInProject: async (projectId, name) => {
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
    attachKitToComposition: async (kitId, viewId) => {
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
    detachKitFromComposition: async (kitId, viewId) => {
        await db
            .deleteFrom('compositions')
            .where('compositions.kit_id', '=', kitId)
            .where('compositions.view_id', '=', viewId)
            .execute();
    },
    deleteView: async (viewId) => {
        await db.deleteFrom('views').where('views.id', '=', viewId).execute();
    },
    renameProject: async (projectId, newName) => {
        await db
            .updateTable('projects')
            .set({ name: newName })
            .where('projects.id', '=', projectId)
            .execute();
    },
    deleteProject: async (projectId) => {
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
    getProjectsByWorkspaceId: (workspaceId) => {
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
    getViewsByProjectId: (projectId) => {
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
            .select([
            'kits.id as kitId',
            'kits.name as kitName',
        ]);
        return query;
    }
});

import { Schema, SchemaDialect } from '../schema.js';
import { SelectQueryBuilder } from 'kysely';
export interface QueryOrdering {
    attachKitToComposition: (kitId: string, viewId: string) => Promise<{
        priority_index: number;
        kit_id: string;
        view_id: string;
    } | undefined>;
    detachKitFromComposition: (kitId: string, viewId: string) => Promise<void>;
}
export interface QueryAction {
    createWorkspace: (name: string) => Promise<{
        id: string;
        name: string;
        description: string | null;
        last_active: Date;
    } | undefined>;
    createProjectInWorkspace: (workspaceId: string, name: string) => Promise<{
        id: string;
        name: string;
        description: string | null;
        last_modified: Date;
        license: string;
        author: string;
        workspace_id: string;
    } | undefined>;
    renameProject: (projectId: string, newName: string) => Promise<void>;
    deleteProject: (projectId: string) => Promise<any>;
    createViewInProject: (projectId: string, name: string) => Promise<{
        id: string;
        name: string;
        last_modified: Date;
        project_id: string;
        lock: boolean;
        hide: boolean;
    } | undefined>;
    deleteView: (viewId: string) => Promise<void>;
    createKitInProject: (projectId: string, name: string) => Promise<{
        id: string;
        project_id: string;
    } | undefined>;
}
export interface QueryBuilder {
    getAllWorkspaces: () => SelectQueryBuilder<Schema, 'workspaces', {
        projectCount: string | number | bigint | null;
    } & {
        workspaceId: string;
        workspaceName: string;
        workspaceDescription: string | null;
        lastActive: Date;
    }>;
    getAllProjects: () => SelectQueryBuilder<Schema, 'workspaces' | 'projects', {
        workspaceName: string;
        projectId: string;
        projectName: string;
        projectDescription: string | null;
        license: string;
        author: string;
    }>;
    getProjectsByWorkspaceId: (workspaceId: string) => SelectQueryBuilder<Schema, 'projects', {
        projectId: string;
        projectName: string;
        projectDescription: string | null;
        license: string;
        author: string;
    }>;
    getViewsByProjectId: (projectId: string) => SelectQueryBuilder<Schema, 'views', {
        viewId: string;
        viewName: string;
    }>;
    getKitCompositionByViewId: (viewId: string) => SelectQueryBuilder<Schema, 'kits' | 'compositions', {
        kitId: string;
        kitName: string;
        kitIndex: number;
        kitView: string;
    }>;
    getKitsExceptFromViewId: (viewId: string) => SelectQueryBuilder<Schema, 'kits', {
        kitId: string;
        kitName: string;
    }>;
}
export interface Api extends QueryBuilder, QueryAction, QueryOrdering {
}
export declare const queryBuilder: (db: SchemaDialect) => Api;

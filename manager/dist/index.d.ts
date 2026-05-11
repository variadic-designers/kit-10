import type { PGliteInterfaceExtensions } from '@electric-sql/pglite';
import { PGliteWorker } from '@electric-sql/pglite/worker';
import { live } from '@electric-sql/pglite/live';
import { Kysely, type SelectQueryBuilder, type Transaction } from 'kysely';
import { type ProjectsTable } from './projects.js';
import { type CompositionsTable } from './compositions.js';
import { type ViewsTable } from './views.js';
import { type WorkspacesTable } from './workspace.js';
export type { SelectQueryBuilder } from 'kysely';
export type { Schema, SchemaDialect } from './schema.js';
export { queryBuilder } from './api/index.js';
export { type Api } from './api/index.js';
export interface EditorState {
    core: EditorCore;
    dialect: D2026_04_21;
}
export { createWorkspace, renameWorkspace, touchWorkspace } from './workspace.js';
export { createProjectByWorkspace, renameProject, deleteProject } from './projects.js';
export { createViewByProject } from './views.js';
export type EditorCore = PGliteWorker & PGliteInterfaceExtensions<{
    live: typeof live;
}>;
export type EditorDialect = Kysely<Kit10Project>;
export type EditorTransaction = Transaction<Kit10Project>;
export interface Kit10Project {
    workspaces: WorkspacesTable;
    projects: ProjectsTable;
    compositions: CompositionsTable;
    views: ViewsTable;
}
export type EditorQueryBuilder<O, Tb extends keyof Kit10Project = keyof Kit10Project> = SelectQueryBuilder<Kit10Project, Tb, O>;
export declare const indexDBPath = "idb://my-projects-kit10";
export declare const initializeEditorState: () => Promise<EditorState | undefined>;
import type { D2026_04_21 } from './migrations/2026-04-21/index.js';
export declare const initEditorDB: (dialect: D2026_04_21) => Promise<void>;
export { jsonArrayFrom } from 'kysely/helpers/postgres';
export declare const server: () => void;

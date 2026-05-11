import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';
export type Project = Selectable<ProjectsTable>;
export type NewProject = Insertable<ProjectsTable>;
export type ProjectUpdate = Updateable<ProjectsTable>;
export interface ProjectsTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    last_modified: Generated<Date>;
    license: Generated<string>;
    author: string;
    workspace_id: Generated<string>;
}
export declare const createProjectsTable: (db: EditorDialect) => Promise<void>;
export declare const deleteProject: (db: EditorDialect, id: string) => Promise<{
    id: string;
} | undefined>;
export declare const renameProject: (db: EditorDialect, project_id: string, newName: string) => Promise<{
    id: string;
    name: string;
    description: string | null;
    last_modified: Date;
    license: string;
    author: string;
    workspace_id: string;
} | undefined>;
export declare const createProjectByWorkspace: (db: EditorDialect, workspaceId: string, name: string, author: string, description: string | null) => Promise<{
    id: string;
    name: string;
    description: string | null;
    last_modified: Date;
    license: string;
    author: string;
    workspace_id: string;
} | undefined>;

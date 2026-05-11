import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';
export type Workspace = Selectable<WorkspacesTable>;
export type NewWorkspace = Insertable<WorkspacesTable>;
export type WorkspaceUpdate = Updateable<WorkspacesTable>;
export interface WorkspacesTable {
    id: Generated<string>;
    name: string;
    description: string | null;
    last_active: Generated<Date>;
}
export declare const createWorkspacesTable: (db: EditorDialect) => Promise<void>;
export declare const touchWorkspace: (db: EditorDialect, id: string) => Promise<{
    id: string;
    name: string;
    description: string | null;
    last_active: Date;
} | undefined>;
export declare const renameWorkspace: (db: EditorDialect, workspace_id: string, newName: string) => Promise<{
    id: string;
    name: string;
    description: string | null;
    last_active: Date;
} | undefined>;
export declare const createWorkspace: (db: EditorDialect, name: string, description: string) => Promise<{
    id: string;
    name: string;
    description: string | null;
    last_active: Date;
} | undefined>;

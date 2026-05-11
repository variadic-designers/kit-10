import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect, Kit10Project } from './index.js';
export type Directory = Selectable<DirectoriesTable>;
export type NewDirectory = Insertable<DirectoriesTable>;
export type DirectoryUpdate = Updateable<DirectoriesTable>;
export interface DirectoriesTable {
    id: Generated<string>;
    parent_id: string | null;
    parent_index: Generated<number>;
    forbid_children: boolean;
}
export declare const createDirectoriesTable: (db: EditorDialect) => Promise<void>;
export declare const createDirectoryTriggerForTable: <TTable extends keyof Kit10Project>(tableName: TTable, options?: {
    forbidChildren?: boolean;
    forceRoot?: boolean;
}) => string[];

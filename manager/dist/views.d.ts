import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from './index.js';
export type View = Selectable<ViewsTable>;
export type NewView = Insertable<ViewsTable>;
export type UpdateView = Updateable<ViewsTable>;
export interface ViewsTable {
    id: Generated<string>;
    name: string;
    last_modified: Generated<Date>;
    project_id: string;
    lock: boolean;
    hide: boolean;
}
export declare const createViewByProject: (db: EditorDialect, project_id: string, name: string) => Promise<void>;
export declare const createViewsTable: (db: EditorDialect) => Promise<void>;

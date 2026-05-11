import { Kysely } from 'kysely';
import type { Generated, Selectable, Insertable, Updateable } from 'kysely';
import type { Kit10Project } from '../index.ts';
export type Library = Selectable<LibraryTable>;
export type NewLibrary = Insertable<LibraryTable>;
export type LibraryUpdate = Updateable<LibraryTable>;
export interface LibraryTable {
	id: Generated<string>;
	last_modified: Generated<Date>;
	name: string;
	description: string | null;
	project_id: string | null;
	library_id: string | null;
	kit_id: string | null;
	view_id: string | null;
	parent_index: number;
	directory_id: string;
}
export declare const createTokensLibraryTable: (db: Kysely<Kit10Project>) => Promise<void>;

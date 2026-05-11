import { Kysely } from 'kysely';
import { type TokenTable } from './tokens/table.js';
import { type LibraryTable } from './tokens/library.js';
import { type ProjectsTable } from './projects/index.js';
import { type CompositionsTable } from './compositions/index.js';
export interface Kit10Project {
	projects: ProjectsTable;
	token_libraries: LibraryTable;
	tokens: TokenTable;
	compositions: CompositionsTable;
}
export declare const indexDBPath = 'idb://my-projects-kit10';
export declare const dialect: Kysely<Kit10Project>;
export declare const initEditorDB: () => Promise<void>;
export declare const server: () => void;

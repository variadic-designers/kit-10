import type { Generated, Insertable, Updateable, Selectable } from 'kysely';
import type { EditorDialect } from '../index.js';
export type Token = Selectable<TokenTable>;
export type NewToken = Insertable<TokenTable>;
export type TokenUpdate = Updateable<TokenTable>;
export interface TokenTable {
	id: Generated<string>;
	name: string;
	value: string | null;
	alias_of: string | null;
	refs: string[] | null;
	resolved_value: string | null;
	last_modified: Generated<Date>;
	library_id: string | null;
	view_id: string | null;
	kit_id: string | null;
	project_id: string | null;
	is_library: string | null;
}
export declare const createTokensTable: (db: EditorDialect) => Promise<void>;

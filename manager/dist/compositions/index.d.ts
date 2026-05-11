import { Kysely, Generated } from 'kysely';
import type { Kit10Project } from '../index.ts';
export interface CompositionsTable {
	id: Generated<string>;
	name: string;
	last_modified: Generated<Date>;
	view_owner: string;
}
export declare const createCompositionsTable: (db: Kysely<Kit10Project>) => Promise<void>;

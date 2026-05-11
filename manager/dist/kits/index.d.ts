import { Kysely, Generated } from 'kysely';
import type { Kit10Project } from '../index.ts';
export interface KitsTable {
	id: Generated<string>;
	name: string;
	last_modified: Generated<Date>;
}
export declare const createKitsTable: (db: Kysely<Kit10Project>) => Promise<void>;

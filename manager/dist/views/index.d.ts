import { Kysely, Generated } from 'kysely';
import type { Kit10Project } from '../index.ts';
export interface ViewsTable {
	id: Generated<string>;
	name: string;
	last_modified: Generated<Date>;
}
export declare const createViewsTable: (db: Kysely<Kit10Project>) => Promise<void>;

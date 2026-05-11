import { type Kysely, type Generated, sql } from 'kysely';

import type { Kit10Project } from '../index.ts';

export interface CompositionsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	last_modified: Generated<Date>;
	view_owner: string;
}

export const createCompositionsTable = async (db: Kysely<Kit10Project>) => {
	// Create table
	await db.schema
		.createTable('compositions')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('view_owner', 'uuid', (col) => col.references('views.id').onDelete('restrict'))
		.execute();
};

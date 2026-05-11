import { sql } from 'kysely';
export const createViewsTable = async (db) => {
	// Create table
	await db.schema
		.createTable('views')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.execute();
};

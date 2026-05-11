import { sql } from 'kysely';
export const createKitsTable = async (db) => {
	// Create table
	await db.schema
		.createTable('kits')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
		.execute();
};

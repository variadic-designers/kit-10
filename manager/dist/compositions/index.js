import { sql } from 'kysely';
export const createCompositionsTable = async (db) => {
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

import { sql } from 'kysely';
export const createProfilesTable = async (db) => {
	await db.schema
		.createTable('directories')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('directories_id', 'uuid', (col) =>
			col.references('directories.id').onDelete('cascade')
		);
};

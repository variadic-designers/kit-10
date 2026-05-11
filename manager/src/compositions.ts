import { Generated, sql } from 'kysely';
import type { EditorDialect } from './index.js';

// describes the cascade rules between views and their kits
export interface CompositionsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	last_modified: Generated<Date>;

	kit_id: string;
	kit_index: number;
	kit_hide: boolean;
	view_id: string;
}

export const createCompositionsTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('compositions')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('view_id', 'uuid', (col) => col.references('views.id').onDelete('restrict'))
		.addColumn('kit_id', 'uuid', (col) => col.references('kits.id').onDelete('restrict'))
		.addColumn('kit_hide', 'boolean', (col) => col.notNull().defaultTo(false).onDelete('restrict'))
		.addColumn('kit_index', 'integer', (col) => col.notNull().defaultTo(0))
		.execute();
};

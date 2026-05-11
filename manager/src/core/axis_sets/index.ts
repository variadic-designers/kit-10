import { Generated, sql } from 'kysely';
import { type EditorDialect } from '../../index.js';

export interface AxisSetsTable {
	id: Generated<string>; // UUIDv7
	name: string | null;
	last_modified: Generated<Date>;
	layer_id: string;
}

export const createAxisSetsTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('axis_sets')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.defaultTo(sql`null`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('value', 'text', (col) => col.notNull())
		.addColumn('layer_id', 'uuid', (col) => col.notNull().references('axes_render_layers.id'))
		.execute();
};

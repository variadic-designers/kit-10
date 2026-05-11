import { Generated, sql } from 'kysely';
import { type EditorDialect } from '../../index.js';

export interface AxesRenderLayersTable {
	id: Generated<string>; // UUIDv7
	name: string | null;
	last_modified: Generated<Date>;
	kit_id: string;

	// Both are about the length of each, for cascading specificity
	axis_magnitude: number | null;
	render_length: number | null;
}

export const createAxesRenderLayersTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('axes_render_layers')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.defaultTo(sql`null`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id'))
		.addColumn('axis_magnitude', 'integer', (col) => col.defaultTo(sql`null`))
		.addColumn('render_length', 'integer', (col) => col.defaultTo(sql`null`))
		.execute();
};

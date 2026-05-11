import { Generated, sql } from 'kysely';
import { type EditorDialect } from '../../index.js';

export interface RenderSnippetTable {
	id: Generated<string>; // UUIDv7
	name: string | null;
	last_modified: Generated<Date>;
	layer_id: string;
}

export const createRenderSnippetTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('render_snippets')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.defaultTo(sql`null`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('layer_id', 'uuid', (col) => col.notNull().references('axis_render_layers.id'))
		.execute();
};

export interface RenderSnippetItemTable {
	id: Generated<string>; // UUIDv7
	name: string;
	value: string;
	last_modified: Generated<Date>;
	snippet_id: string;
}

export const createRenderSnippetItemTable = async (db: EditorDialect) => {
	// Create table
	await db.schema
		.createTable('render_snippet_items')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('value', 'text', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
		.addColumn('snippet_id', 'uuid', (col) => col.notNull().references('render_snippets.id'))
		.execute();
};

import { sql } from 'kysely';
export const createRenderSnippetTable = async (db) => {
    // Create table
    await db.schema
        .createTable('render_snippets')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.defaultTo(sql `null`))
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('layer_id', 'uuid', (col) => col.notNull().references('axis_render_layers.id'))
        .execute();
};
export const createRenderSnippetItemTable = async (db) => {
    // Create table
    await db.schema
        .createTable('render_snippet_items')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('value', 'text', (col) => col.notNull())
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('snippet_id', 'uuid', (col) => col.notNull().references('render_snippets.id'))
        .execute();
};

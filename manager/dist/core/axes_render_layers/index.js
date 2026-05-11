import { sql } from 'kysely';
export const createAxesRenderLayersTable = async (db) => {
    // Create table
    await db.schema
        .createTable('axes_render_layers')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.defaultTo(sql `null`))
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id'))
        .addColumn('axis_magnitude', 'integer', (col) => col.defaultTo(sql `null`))
        .addColumn('render_length', 'integer', (col) => col.defaultTo(sql `null`))
        .execute();
};

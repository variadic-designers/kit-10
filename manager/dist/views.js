import { sql } from 'kysely';
export const createViewByProject = async (db, project_id, name) => {
    await db.insertInto('views').values({ name, project_id, hide: false, lock: false }).execute();
};
export const createViewsTable = async (db) => {
    // Create table
    await db.schema
        .createTable('views')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'varchar(255)', (col) => col.notNull())
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
        .addColumn('lock', 'boolean', (col) => col.notNull().defaultTo(sql `false`))
        .addColumn('hide', 'boolean', (col) => col.notNull().defaultTo(sql `false`))
        .execute();
};

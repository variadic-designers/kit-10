import { sql } from 'kysely';
export const createAxisDefinitionsTable = async (db) => {
    await db.schema
        .createTable('axis_definitions')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('slug', 'varchar(100)', (col) => col.notNull().unique())
        .addColumn('name', 'varchar(255)', (col) => col.notNull())
        .addColumn('type', 'varchar(50)', (col) => col.notNull()) // discrete, range, etc.
        .addColumn('config', 'jsonb', (col) => col.notNull().defaultTo(sql `'{}'::jsonb`))
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addCheckConstraint('config_type_check', sql `
      (type = 'discrete' AND config ? 'options' AND config ? 'defaultValue') OR
      (type = 'range' AND config ? 'unit' AND config ? 'steps')
    `)
        .execute();
    // json search
    await db.schema
        .createIndex('axis_config_gin_idx')
        .ifNotExists()
        .on('axis_definitions')
        .using('gin')
        .column('config')
        .execute();
};

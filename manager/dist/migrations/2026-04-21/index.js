import { sql } from 'kysely';
// ------------------------------
export async function up(dialect) {
    const workspaces = dialect.schema
        .createTable('workspaces')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('description', 'text', (col) => col.defaultTo(null))
        .addColumn('last_active', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`));
    const projects = dialect.schema
        .createTable('projects')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'text', (col) => col.notNull())
        .addColumn('description', 'text')
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('license', 'text', (col) => col.notNull().defaultTo(`mplv2`))
        .addColumn('author', 'text', (col) => col.notNull())
        .addColumn('workspace_id', 'uuid', (col) => col.references('workspaces.id').onDelete('cascade').notNull());
    const views = dialect.schema
        .createTable('views')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'varchar(255)', (col) => col.notNull())
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('cascade'))
        .addColumn('lock', 'boolean', (col) => col.notNull().defaultTo(sql `false`))
        .addColumn('hide', 'boolean', (col) => col.notNull().defaultTo(sql `false`));
    const kits = dialect.schema
        .createTable('kits')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('name', 'varchar(255)', (col) => col.notNull())
        .addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql `now()`))
        .addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'));
    const composition = dialect.schema
        .createTable('compositions')
        .ifNotExists()
        .addColumn('priority_index', 'integer', (col) => col.notNull())
        .addColumn('view_id', 'uuid', (col) => col.notNull().references('views.id').onDelete('cascade'))
        .addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('no action'))
        .addUniqueConstraint('unique_priority_per_view', ['view_id', 'priority_index'])
        .addPrimaryKeyConstraint('composition_pk', ['view_id', 'kit_id']);
    const axes_consumed = dialect.schema
        .createTable('axes_consumed')
        .ifNotExists()
        .addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('cascade'))
        .addColumn('axis_id', 'uuid', (col) => col.notNull().references('axes.id').onDelete('restrict'))
        .addColumn('priority_index', 'integer', (col) => col.notNull())
        .addPrimaryKeyConstraint('axis_consumed_pk', ['kit_id', 'axis_id'])
        .addUniqueConstraint('unique_priority_of_axis_per_kit', ['kit_id', 'priority_index']);
    const axis_args = dialect.schema
        .createTable('axis_args')
        .ifNotExists()
        .addColumn('view_id', 'uuid', (col) => col.notNull().references('views.id').onDelete('cascade'))
        .addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('cascade'))
        .addColumn('axis_id', 'uuid', (col) => col.notNull().references('axes.id').onDelete('restrict'))
        .addColumn('value', 'jsonb')
        .addPrimaryKeyConstraint('axis_args_pk', ['view_id', 'axis_id', 'kit_id']);
    const axes = dialect.schema
        .createTable('axes')
        .ifNotExists()
        .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql `uuid_generate_v7()`))
        .addColumn('project_id', 'uuid', (col) => col.notNull().references('projects.id').onDelete('restrict'));
    await workspaces.execute();
    await projects.execute();
    await kits.execute();
    await views.execute();
    await axes.execute();
    await composition.execute();
    await axis_args.execute();
    await axes_consumed.execute();
}
// Back to Zero
export async function down(dialect) {
    const workspaces = dialect.schema.dropTable('workspaces');
    const projects = dialect.schema.dropTable('projects');
    const views = dialect.schema.dropTable('views');
    const kits = dialect.schema.dropTable('kits');
    const composition = dialect.schema.dropTable('compositions');
    const axis_args = dialect.schema.dropTable('axis_args');
    const axes = dialect.schema.dropTable('axis');
    const axes_consumed = dialect.schema.dropTable('axes_consumed');
    await workspaces.execute();
    await projects.execute();
    await views.execute();
    await kits.execute();
    await composition.execute();
    await axis_args.execute();
    await axes.execute();
    await axes_consumed.execute();
}

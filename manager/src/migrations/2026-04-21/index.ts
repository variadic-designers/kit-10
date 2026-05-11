import { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Generated } from 'kysely';

// when there's loose expectations during transitory migration steps
export type DAny = Kysely<any>;
export type D2026_04_21 = Kysely<DB2026_04_21>;

// Target schema
export interface DB2026_04_21 {
	// Production stack
	workspaces: WorkspacesTable;
	projects: ProjectsTable;

	// Composition stack
	views: ViewsTable;
	compositions: CompositionsTable;
	kits: KitsTable;

	// Argument stack
	axis_args: AxisArgsTable;
	axes_consumed: AxesConsumedTable;
	axes: AxisTable;

	// Resolution stack
	axis_sets: never;
	render_snippets: never;

	// Declarative stack
	design_tokens: never;
}

// ------------------------------

export interface WorkspacesTable {
	id: Generated<string>; // UUIDv7
	name: string;
	description: string | null;
	last_active: Generated<Date>;
}

export interface ProjectsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	description: string | null;
	last_modified: Generated<Date>;
	license: Generated<string>;
	author: string;

	workspace_id: Generated<string>;
}

// ------------------------------

export interface ViewsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	last_modified: Generated<Date>;
	project_id: string;

	lock: boolean;
	hide: boolean;
}

// Composition Table for kit precedence
export interface CompositionsTable {
	priority_index: number;

	kit_id: string;
	view_id: string;
}

export interface KitsTable {
	id: Generated<string>; // UUIDv7
	name: string;
	project_id: string;
	last_modified: Generated<Date>;
}

export interface AxesConsumedTable {
	kit_id: string;
	axis_id: string;
	priority_index: number;
}

// ------------------------------
import { JSONColumnType } from 'kysely';

interface ValueType {
	type: 'literal' | 'range';
}

interface Literal extends ValueType {
	type: 'literal';
	value: string;
}

interface Range extends ValueType {
	type: 'range';
	min: number;
	max: number;
}

type Value = Literal | Range;

export interface AxisArgsTable {
	value: JSONColumnType<Value> | null;

	axis_id: string;
	kit_id: string;
	view_id: string;
}

export interface AxisTable {
	id: Generated<string>; // UUIDv7
	project_id: string;
}

// ------------------------------

export async function up(dialect: D2026_04_21) {
	const workspaces = dialect.schema
		.createTable('workspaces')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text', (col) => col.defaultTo(null))
		.addColumn('last_active', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`));

	const projects = dialect.schema
		.createTable('projects')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text')
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('license', 'text', (col) => col.notNull().defaultTo(`mplv2`))
		.addColumn('author', 'text', (col) => col.notNull())
		.addColumn('workspace_id', 'uuid', (col) =>
			col.references('workspaces.id').onDelete('cascade').notNull()
		);

	const views = dialect.schema
		.createTable('views')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('cascade'))
		.addColumn('lock', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`))
		.addColumn('hide', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`));

	const kits = dialect.schema
		.createTable('kits')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
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
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('project_id', 'uuid', (col) =>
			col.notNull().references('projects.id').onDelete('restrict')
		);

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
export async function down(dialect: DAny) {
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

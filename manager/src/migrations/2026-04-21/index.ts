import type { SqlBool } from 'kysely';
import { Kysely, sql } from 'kysely';
import type { Generated, JSONColumnType } from 'kysely';

export type DAny = Kysely<any>;
export type D2026_04_21 = Kysely<DB2026_04_21>;

// --- Token value types ---

interface TokenValueScalar {
	type: 'scalar';
	value: string;
	format?: 'color' | 'size' | 'font-size' | 'font-weight' | 'text' | 'number';
}

interface TokenValueView {
	type: 'view';
	view_id: string;
}

interface TokenValueViewList {
	type: 'view-list';
	view_ids: string[];
}

type TokenValue = TokenValueScalar | TokenValueView | TokenValueViewList;

// --- Axis value types (condition side) ---

interface AxisValueLiteral {
	type: 'literal';
	value: string;
}

interface AxisValueBoundary {
	type: 'range';
	operator: '>=' | '<=' | '>' | '<' | 'between';
	threshold: number;
	threshold_high?: number;
}

interface AxisValueDiscrete {
	type: 'discrete';
	value: string;
}

type AxisValueType = AxisValueLiteral | AxisValueBoundary | AxisValueDiscrete;

// --- Axis arg types (input side) ---

interface ArgLiteral {
	type: 'literal';
	value: string;
}

interface ArgRange {
	type: 'range';
	min: number;
	max: number;
}

type ArgValue = ArgLiteral | ArgRange;

// --- Plugin registry types ---

type PluginKind = 'interpreter' | 'utility';
type PluginActivation = 'eager' | 'lazy';

interface PluginManifest {
	wasm: { url: string }[];
}

// --- Schema ---

export interface DB2026_04_21 {
	workspaces: WorkspacesTable;
	projects: ProjectsTable;

	views: ViewsTable;
	compositions: CompositionsTable;
	kits: KitsTable;

	axes: AxisTable;
	axis_values: AxisValuesTable;
	axes_consumed: AxesConsumedTable;
	axis_args: AxisArgsTable;

	render_snippets: RenderSnippetsTable;
	layers: LayersTable;
	layer_axis_values: LayerAxisValuesTable;
	render_entries: RenderEntriesTable;

	tokens: TokensTable;

	plugins: PluginsTable;
}

// ------------------------------

export interface WorkspacesTable {
	id: Generated<string>;
	name: string;
	description: string | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	last_active: Generated<Date>;
}

export interface ProjectsTable {
	id: Generated<string>;
	name: string;
	description: string | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	last_modified: Generated<Date>;
	license: Generated<string>;
	author: string;
	workspace_id: Generated<string>;
	interpreter_plugin_id: string | null;
}

export interface ViewsTable {
	id: Generated<string>;
	name: string;
	hints: JSONColumnType<Record<string, unknown>> | null;
	last_modified: Generated<Date>;
	project_id: string;
	lock: boolean;
	hide: boolean;
}

export interface CompositionsTable {
	priority_index: number;
	kit_id: string;
	view_id: string;
}

export interface KitsTable {
	id: Generated<string>;
	name: string;
	hints: JSONColumnType<Record<string, unknown>> | null;
	project_id: string;
	last_modified: Generated<Date>;
}

// ------------------------------

export interface AxisTable {
	id: Generated<string>;
	project_id: string;
	name: string | null;
	description: string | null;
	kind: string | null;
	hint: JSONColumnType<string[]> | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	default_value: JSONColumnType<ArgValue> | null;
}

export interface AxisValuesTable {
	id: Generated<string>;
	axis_id: string;
	hints: JSONColumnType<Record<string, unknown>> | null;
	value: JSONColumnType<AxisValueType>;
}

export interface AxesConsumedTable {
	kit_id: string;
	axis_id: string;
	priority_index: number;
}

// ------------------------------

export interface AxisArgsTable {
	value: JSONColumnType<ArgValue> | null;
	axis_id: string;
	kit_id: string;
	view_id: string;
}

// ------------------------------

export interface RenderSnippetsTable {
	id: Generated<string>;
	layer_id: string;
	hints: JSONColumnType<Record<string, unknown>> | null;
	last_modified: Generated<Date>;
}

export interface LayersTable {
	id: Generated<string>;
	kit_id: string;
	hints: JSONColumnType<Record<string, unknown>> | null;
	last_modified: Generated<Date>;
}

export interface LayerAxisValuesTable {
	layer_id: string;
	axis_value_id: string;
}

export interface RenderEntriesTable {
	id: Generated<string>;
	snippet_id: string;
	property: string;
	value: string | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	token_id: string | null;
}

// ------------------------------

export interface TokensTable {
	id: Generated<string>;
	project_id: string;
	alias: string | null;
	value: JSONColumnType<TokenValue> | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	kit_id: string | null;
	view_id: string | null;
}

// ------------------------------

export interface PluginsTable {
	id: Generated<string>;
	name: string;
	kind: PluginKind;
	activation: PluginActivation | null;
	manifest: JSONColumnType<PluginManifest>;
	options: JSONColumnType<Record<string, unknown>> | null;
	content_hash: string | null;
}

// ------------------------------

export async function up(dialect: DAny) {
	await dialect.schema
		.createTable('workspaces')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text', (col) => col.defaultTo(null))
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_active', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.execute();

	await dialect.schema
		.createTable('projects')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('description', 'text')
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('license', 'text', (col) => col.notNull().defaultTo(`mplv2`))
		.addColumn('author', 'text', (col) => col.notNull())
		.addColumn('workspace_id', 'uuid', (col) =>
			col.references('workspaces.id').onDelete('cascade').notNull()
		)
		// No inline FK yet -- the plugins table this references doesn't exist until later in
		// this same up(). The constraint is added via alterTable right after plugins is created.
		.addColumn('interpreter_plugin_id', 'uuid')
		.execute();

	await dialect.schema
		.createTable('axes')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('project_id', 'uuid', (col) =>
			col.notNull().references('projects.id').onDelete('restrict')
		)
		.addColumn('name', 'text')
		.addColumn('description', 'text')
		.addColumn('kind', 'text')
		.addColumn('hint', 'jsonb')
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('default_value', 'jsonb')
		.execute();

	await dialect.schema
		.createTable('axis_values')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('axis_id', 'uuid', (col) => col.notNull().references('axes.id').onDelete('cascade'))
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('value', 'jsonb', (col) => col.notNull())
		.execute();

	await dialect.schema
		.createTable('views')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('cascade'))
		.addColumn('lock', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`))
		.addColumn('hide', 'boolean', (col) => col.notNull().defaultTo(sql<boolean>`false`))
		.execute();

	await dialect.schema
		.createTable('kits')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuid_generate_v7()`))
		.addColumn('name', 'varchar(255)', (col) => col.notNull())
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addColumn('project_id', 'uuid', (col) => col.references('projects.id').onDelete('restrict'))
		.execute();

	await dialect.schema
		.createTable('compositions')
		.ifNotExists()
		.addColumn('priority_index', 'integer', (col) => col.notNull())
		.addColumn('view_id', 'uuid', (col) => col.notNull().references('views.id').onDelete('cascade'))
		.addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('no action'))
		.addUniqueConstraint('unique_priority_per_view', ['view_id', 'priority_index'])
		.addPrimaryKeyConstraint('composition_pk', ['view_id', 'kit_id'])
		.execute();

	await dialect.schema
		.createTable('axes_consumed')
		.ifNotExists()
		.addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('cascade'))
		.addColumn('axis_id', 'uuid', (col) => col.notNull().references('axes.id').onDelete('restrict'))
		.addColumn('priority_index', 'integer', (col) => col.notNull())
		.addPrimaryKeyConstraint('axis_consumed_pk', ['kit_id', 'axis_id'])
		.addUniqueConstraint('unique_priority_of_axis_per_kit', ['kit_id', 'priority_index'])
		.execute();

	await dialect.schema
		.createTable('axis_args')
		.ifNotExists()
		.addColumn('view_id', 'uuid', (col) => col.notNull().references('views.id').onDelete('cascade'))
		.addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('cascade'))
		.addColumn('axis_id', 'uuid', (col) => col.notNull().references('axes.id').onDelete('restrict'))
		.addColumn('value', 'jsonb')
		.addPrimaryKeyConstraint('axis_args_pk', ['view_id', 'axis_id', 'kit_id'])
		.execute();

	await dialect.schema
		.createTable('layers')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('kit_id', 'uuid', (col) => col.notNull().references('kits.id').onDelete('cascade'))
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.execute();

	await dialect.schema
		.createTable('tokens')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('project_id', 'uuid', (col) =>
			col.notNull().references('projects.id').onDelete('restrict')
		)
		.addColumn('alias', 'varchar(255)')
		.addColumn('value', 'jsonb')
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('kit_id', 'uuid', (col) => col.references('kits.id').onDelete('cascade'))
		.addColumn('view_id', 'uuid', (col) => col.references('views.id').onDelete('cascade'))
		.addCheckConstraint(
			'token_scope_check',
			sql`(kit_id IS NOT NULL AND view_id IS NULL) OR (view_id IS NOT NULL AND kit_id IS NULL) OR (kit_id IS NULL AND view_id IS NULL)`
		)
		.execute();

	await dialect.schema
		.createIndex('tokens_project_alias_unique')
		.ifNotExists()
		.on('tokens')
		.columns(['project_id', 'alias'])
		.where(sql<SqlBool>`kit_id IS NULL AND view_id IS NULL`)
		.execute();

	await dialect.schema
		.createIndex('tokens_kit_alias_unique')
		.ifNotExists()
		.on('tokens')
		.columns(['kit_id', 'alias'])
		.where(sql<SqlBool>`kit_id IS NOT NULL`)
		.execute();

	await dialect.schema
		.createIndex('tokens_view_alias_unique')
		.ifNotExists()
		.on('tokens')
		.columns(['view_id', 'alias'])
		.where(sql<SqlBool>`view_id IS NOT NULL`)
		.execute();

	await dialect.schema
		.createTable('render_snippets')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('layer_id', 'uuid', (col) =>
			col.notNull().references('layers.id').onDelete('cascade')
		)
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('last_modified', 'timestamptz', (col) => col.notNull().defaultTo(sql<Date>`now()`))
		.addUniqueConstraint('one_snippet_per_layer', ['layer_id'])
		.execute();

	await dialect.schema
		.createTable('layer_axis_values')
		.ifNotExists()
		.addColumn('layer_id', 'uuid', (col) =>
			col.notNull().references('layers.id').onDelete('cascade')
		)
		.addColumn('axis_value_id', 'uuid', (col) =>
			col.notNull().references('axis_values.id').onDelete('restrict')
		)
		.addPrimaryKeyConstraint('layer_axis_values_pk', ['layer_id', 'axis_value_id'])
		.execute();

	await dialect.schema
		.createTable('render_entries')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('snippet_id', 'uuid', (col) =>
			col.notNull().references('render_snippets.id').onDelete('cascade')
		)
		.addColumn('property', 'text', (col) => col.notNull())
		.addColumn('value', 'text')
		.addColumn('hints', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
		.addColumn('token_id', 'uuid', (col) => col.references('tokens.id').onDelete('set null'))
		.addCheckConstraint(
			'value_or_token_not_both',
			sql`(value IS NOT NULL) != (token_id IS NOT NULL)`
		)
		.execute();

	await dialect.schema
		.createTable('plugins')
		.ifNotExists()
		.addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql<string>`uuid_generate_v7()`))
		.addColumn('name', 'text', (col) => col.notNull())
		.addColumn('kind', 'text', (col) => col.notNull())
		// Only meaningful for kind: 'utility' ('eager' loads at editor boot regardless of
		// project, e.g. Fontavious; 'lazy' loads on first actual use, e.g. Tenner). Null for
		// interpreter-kind rows -- their loading is driven by which project is active instead.
		.addColumn('activation', 'text')
		.addColumn('manifest', 'jsonb', (col) => col.notNull())
		.addColumn('options', 'jsonb')
		.addColumn('content_hash', 'text')
		.addUniqueConstraint('plugins_name_unique', ['name'])
		.execute();

	// The project<->interpreter FK, added only now that plugins exists. Utility plugins are
	// install-level (see PluginActivation above) -- there is no equivalent join table for them,
	// they're just loaded globally, so a project only ever needs to reference its one interpreter.
	await dialect.schema
		.alterTable('projects')
		.addForeignKeyConstraint(
			'projects_interpreter_plugin_id_fkey',
			['interpreter_plugin_id'],
			'plugins',
			['id']
		)
		.onDelete('set null')
		.execute();
}

export async function down(dialect: DAny) {
	await dialect.schema.dropTable('plugins').ifExists().cascade().execute();
	await dialect.schema.dropTable('render_entries').ifExists().cascade().execute();
	await dialect.schema.dropTable('layer_axis_values').ifExists().cascade().execute();
	await dialect.schema.dropTable('render_snippets').ifExists().cascade().execute();
	await dialect.schema.dropTable('layers').ifExists().cascade().execute();
	await dialect.schema.dropTable('axis_args').ifExists().cascade().execute();
	await dialect.schema.dropTable('axes_consumed').ifExists().cascade().execute();
	await dialect.schema.dropTable('axis_values').ifExists().cascade().execute();
	await dialect.schema.dropTable('compositions').ifExists().cascade().execute();
	await dialect.schema.dropTable('tokens').ifExists().cascade().execute();
	await dialect.schema.dropTable('kits').ifExists().cascade().execute();
	await dialect.schema.dropTable('views').ifExists().cascade().execute();
	await dialect.schema.dropTable('axes').ifExists().cascade().execute();
	await dialect.schema.dropTable('projects').ifExists().cascade().execute();
	await dialect.schema.dropTable('workspaces').ifExists().cascade().execute();
}

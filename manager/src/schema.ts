import { Kysely, type SelectQueryBuilder, type Transaction } from 'kysely';
import type { JSONColumnType, Generated } from 'kysely';

// --- Axis value types ---

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

// --- Schema tables ---

export interface DB2026_06_07 {
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
}

export interface WorkspacesTable {
	id: Generated<string>;
	name: string;
	description: string | null;
	last_active: Generated<Date>;
}

export interface ProjectsTable {
	id: Generated<string>;
	name: string;
	description: string | null;
	last_modified: Generated<Date>;
	license: Generated<string>;
	author: string;
	workspace_id: Generated<string>;
}

export interface ViewsTable {
	id: Generated<string>;
	name: string;
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
	default_value: JSONColumnType<ArgValue> | null;
}

export interface AxisValuesTable {
	id: Generated<string>;
	axis_id: string;
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
	last_modified: Generated<Date>;
}

export interface LayersTable {
	id: Generated<string>;
	kit_id: string;
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
	token_id: string | null;
}

// ------------------------------

export interface TokensTable {
	id: Generated<string>;
	project_id: string;
	alias: string | null;
	value: string | null;
}

// Current version of db
export type SchemaTS = Kysely<DB2026_06_07>;
export type Schema = DB2026_06_07;
export type SchemaDialect = Kysely<Schema>;

export type SchemaQueryBuilder<O, Tb extends keyof Schema = keyof Schema> = SelectQueryBuilder<
	Schema,
	Tb,
	O
>;

export type SchemaTransaction = Transaction<Schema>;
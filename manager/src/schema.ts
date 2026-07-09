import { Kysely, type SelectQueryBuilder, type Transaction } from 'kysely';
import type { JSONColumnType, Generated } from 'kysely';

// --- Token value types ---

export interface TokenValueScalar {
	type: 'scalar';
	value: string;
	format?: 'color' | 'size' | 'font-size' | 'font-weight' | 'text' | 'number';
}

export interface TokenValueView {
	type: 'view';
	view_id: string;
}

// The list-valued counterpart to TokenValueView -- for properties whose resolved value is
// inherently a list of view references (currently just `children`), not a single one. Kept as
// its own variant rather than widening TokenValueView.view_id to string | string[], so the two
// concepts (a token that IS a view vs. a token that IS a list of views) stay unambiguous at the
// type level rather than needing runtime array-vs-string discrimination.
export interface TokenValueViewList {
	type: 'view-list';
	view_ids: string[];
}

export type TokenValue = TokenValueScalar | TokenValueView | TokenValueViewList;

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
	min: number | null;
	max: number | null;
}

export type ArgValue = ArgLiteral | ArgRange;

// --- Plugin registry types ---

export type PluginKind = 'interpreter' | 'utility';

// Only meaningful for kind: 'utility' -- 'eager' plugins (Fontavious: font fetching is needed
// the moment any project has text to render) load once, unconditionally, at editor boot.
// 'lazy' plugins (Tenner: invoked occasionally, by explicit user action) load themselves on
// first actual use instead. null for interpreter-kind rows, whose loading is driven entirely by
// which project is active, not this field.
export type PluginActivation = 'eager' | 'lazy';

export interface PluginManifest {
	wasm: { url: string }[];
}

// Stamped into exportProject's output and checked by importProjectData -- bump this whenever
// the DB2026_07_09 interface below is renamed for an actual schema change (not for every minor
// edit; this project doesn't yet have a real migration chain, see CLAUDE.md).
export const CURRENT_SCHEMA_VERSION = '2026-07-09';

// --- Schema tables ---

export interface DB2026_07_09 {
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
	// The project's single viewport interpreter (Charter today). This is the one genuinely
	// per-project plugin choice -- unlike utility plugins (install-level, see PluginActivation),
	// a project's kits really are resolved by exactly one interpreter.
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
	last_modified: Generated<Date>;
	project_id: string;
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

// Current version of db
export type SchemaTS = Kysely<DB2026_07_09>;
export type Schema = DB2026_07_09;
export type SchemaDialect = Kysely<Schema>;

export type SchemaQueryBuilder<O, Tb extends keyof Schema = keyof Schema> = SelectQueryBuilder<
	Schema,
	Tb,
	O
>;

export type SchemaTransaction = Transaction<Schema>;

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

export type AxisValueType = AxisValueLiteral | AxisValueBoundary | AxisValueDiscrete;

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

export interface ExportCapability {
	label: string;
	fn: string;
	fileExtension: string;
	mimeType: string;
	// Normalized format identifier (e.g. "yaml", "html") for recognizing that two different
	// plugins produce the same kind of output -- distinct from fileExtension/label, which a
	// plugin could vary independently of what format family it actually produces. Optional,
	// falling back to fileExtension for any manifest that predates this field (see
	// export-profile.ts's effectiveTarget) -- same additive-rollout posture as `provides`/
	// `capabilities`.
	target?: string;
	// When true, this capability's plugin function returns a JSON envelope
	// { files: [{ filename, mimeType, content }] } instead of a raw text blob -- the host
	// downloads exactly the filenames the plugin itself chose, so a multi-file output (e.g. an
	// HTML export referencing its own CSS by name) can guarantee the reference matches what's
	// actually downloaded. Absent/false = single-file behavior, unchanged (see download.ts's
	// resolveDownloadFiles).
	multiFile?: boolean;
	// When true, this capability actually filters its output by the `view_ids` it's given --
	// e.g. WebCodium exports exactly the selected views. Absent/false = the plugin dumps the
	// whole project regardless of `view_ids` (Tenner: project-basis, not view-basis -- its own
	// ExportProjectInput safely ignores the field entirely). Drives whether the per-view "Export
	// to" context-menu flag (src/lib/plugins/export-flags.ts) and the Export panel's per-view
	// readout are even offered for this provider -- flagging individual views for a
	// project-basis exporter would be misleading, since the flag would never change its output.
	viewScoped?: boolean;
}

export interface ImportCapability {
	label: string;
	fn: string;
	accept: string;
}

// What a plugin REQUESTS from the host -- the grantable surface today is host functions
// (kit10_*, see makeHostFunctions in manager.svelte.ts) and network egress (Extism's own
// allowedHosts). This is a declaration, not yet an install-time prompt/grant flow (see
// resources/plugin-store-research.md §5.2/§5.5) -- for now, an undeclared (`capabilities`
// absent) plugin still gets the full host-fn set, so this rolls out additively same as
// `provides` did; a plugin that DOES declare `hostFns` is restricted to exactly that set.
export interface PluginCapabilities {
	hostFns?: string[];
	hosts?: string[];
}

export interface PluginManifest {
	wasm: { url: string }[];
	// What this plugin can do beyond just loading -- a plugin declares its own capability here
	// instead of the editor hardcoding a specific plugin's identity into a TS const (VISION's
	// 1st Principle). `id` deliberately isn't part of either shape: a manifest has no way to
	// know its own registry `name`, that's attached at the point where a PluginRow (which does
	// carry `name`) and this `provides` block are both in scope -- see project-export-providers.ts.
	provides?: {
		exports?: ExportCapability[];
		imports?: ImportCapability[];
	};
	capabilities?: PluginCapabilities;
	// Plugin registry names this plugin declares specific compatibility with -- "WebCodium
	// supports Charter" means WebCodium's own logic was built to understand Charter's specific
	// translation opinions (its UiNode shape, composition/arrangement conventions), not just
	// "any interpreter." The reverse view ("Charter is a dependency of WebCodium") is never
	// stored -- it's derived by resolvePluginRelationships (src/lib/plugins/plugin-
	// relationships.ts) from every installed plugin's own `supports` list. Informational only:
	// nothing gates on whether a named plugin is actually installed.
	supports?: string[];
}

// Stamped into exportProject's output and checked by importProjectData -- bump this whenever
// the DB2026_07_19 interface below is renamed for an actual schema change (not for every minor
// edit; this project doesn't yet have a real migration chain, see CLAUDE.md).
export const CURRENT_SCHEMA_VERSION = '2026-07-19';

// --- Schema tables ---

export interface DB2026_07_19 {
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

	assets: AssetsTable;
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
	priority_index: Generated<number>;
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

export interface AssetsTable {
	id: Generated<string>;
	project_id: string;
	name: string;
	mime_type: string;
	checksum: string;
	link: string;
	width: number;
	height: number;
	created_at: Generated<Date>;
}

// Current version of db
export type SchemaTS = Kysely<DB2026_07_19>;
export type Schema = DB2026_07_19;
export type SchemaDialect = Kysely<Schema>;

export type SchemaQueryBuilder<O, Tb extends keyof Schema = keyof Schema> = SelectQueryBuilder<
	Schema,
	Tb,
	O
>;

export type SchemaTransaction = Transaction<Schema>;

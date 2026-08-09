import { Kysely, type SelectQueryBuilder, type Transaction } from 'kysely';
import type { JSONColumnType, Generated } from 'kysely';

// --- Token value types ---

export interface TokenValueScalar {
	type: 'scalar';
	value: string;
	format?: 'color' | 'size' | 'font-size' | 'font-weight' | 'text' | 'number';
}

// A property whose resolved value is a LIST of views (e.g. `children`) is not a distinct
// TokenValue variant -- it's composed of multiple `view`-typed token rows sharing one alias
// (and scope), aggregated into ResolvedProperty.viewRefs at resolve time. `tokens.priority_index`
// orders same-alias rows; unlike scalar tokens, `view` tokens are exempt from the per-scope
// alias-uniqueness indexes (see the migration) so more than one can share an alias, and the same
// view_id can appear under more than one row (a view referenced by two simultaneously-active
// `view` tokens, e.g. with different axis overrides via token_axis_overrides).
export interface TokenValueView {
	type: 'view';
	view_id: string;
}

export type TokenValue = TokenValueScalar | TokenValueView;

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

// A per-occurrence axis override (token_axis_overrides only -- never a plain view's own axis_args,
// which is only ever written as literal/range by the Axes panel) that tracks another (view, kit)'s
// OWN current axis pick live, re-read fresh every resolve via resolve.ts's mergeAxisOverrides +
// argsByViewKit -- never a snapshot. If the source has no axis_args entry for this axis (unset),
// the override resolves as if it didn't exist (the null/unconditioned layer wins), matching how
// matchLayers already treats "no arg for this axis" everywhere else.
interface ArgLinked {
	type: 'linked';
	view_id: string;
	kit_id: string;
}

export type ArgValue = ArgLiteral | ArgRange | ArgLinked;

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
// the DB2026_07_30 interface below is renamed for an actual schema change (not for every minor
// edit; this project doesn't yet have a real migration chain, see AGENTS.md).
export const CURRENT_SCHEMA_VERSION = '2026-07-30';

// --- Schema tables ---

export interface DB2026_07_30 {
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
	token_axis_overrides: TokenAxisOverridesTable;

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
	// Whether this axis's values compile to BEM-style static modifier classes (e.g.
	// `.button--primary`) or real dynamic selectors (a recognized CSS pseudo-class like `:hover`,
	// falling back to a `.is-{value}` JS-toggle class) in WebCodium's Kit-basis export. Explicit
	// per-axis designer choice, not inferred from axis name/semantics -- see
	// resources/webcodium-export-plan.md.
	variant_kind: Generated<'static' | 'dynamic'>;
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
	// Per-Kit export exclusion: when true, WebCodium's Kit-basis export collapses this axis to a
	// single base rule (using the axis's own default_value, or its lowest-priority value if unset)
	// instead of emitting a variant per value. Scoped to (kit, axis), not the axis globally, since
	// axes_consumed is already the exact join row for that pair -- see
	// resources/webcodium-export-plan.md.
	excluded_from_export: Generated<boolean>;
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
	// Drives composition membership for `type: 'view'` rows only (e.g. is this token one of view
	// A's `children`) -- `alias` itself is a pure display name for view-typed rows, effectively
	// vestigial since the Tokens panel shows icon+viewName. Detaching a child from a composition
	// (removeViewRef) clears this to null without touching the row, its scope, or its
	// token_axis_overrides, mirroring how unbinding a scalar/color token from a property never
	// deletes the token. Unused (stays null) for `scalar` tokens.
	composition_alias: string | null;
	value: JSONColumnType<TokenValue> | null;
	hints: JSONColumnType<Record<string, unknown>> | null;
	kit_id: string | null;
	view_id: string | null;
	// Orders same-scope `view`-typed rows sharing one alias (see TokenValue's doc comment above).
	// Meaningless (stays 0) for `scalar` tokens and for a `view` token that is the only row at its
	// alias -- ties are broken by `id`, not enforced as a uniqueness invariant, since reordering N
	// rows one at a time can transiently produce them.
	priority_index: Generated<number>;
}

// ------------------------------

// One row per axis a specific `view`-typed token reference overrides. Keyed by the REFERENCING
// token, not the referenced view -- a view's own axis pick stays in axis_args, keyed by
// (view_id, kit_id, axis_id). This table instead answers "this specific reference additionally
// forces axis X to value Y for the occurrence it creates," letting the same view_id resolve
// differently depending on which `view` token reached it. See resolve.ts's
// `OverriddenOccurrence`/`mergeAxisOverrides`.
export interface TokenAxisOverridesTable {
	token_id: string;
	axis_id: string;
	value: JSONColumnType<ArgValue> | null;
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
export type SchemaTS = Kysely<DB2026_07_30>;
export type Schema = DB2026_07_30;
export type SchemaDialect = Kysely<Schema>;

export type SchemaQueryBuilder<O, Tb extends keyof Schema = keyof Schema> = SelectQueryBuilder<
	Schema,
	Tb,
	O
>;

export type SchemaTransaction = Transaction<Schema>;

import {
	CURRENT_SCHEMA_VERSION,
	type Schema,
	type SchemaDialect,
	type TokenValue,
	type PluginKind,
	type PluginActivation,
	type PluginManifest,
	type AxisValueType
} from '../schema.js';
import { sql, type SelectQueryBuilder } from 'kysely';

// TokenValue's view_id (type: 'view') is a reference to a view row, but it lives inside a jsonb
// blob rather than a real FK column -- the schema has no way to enforce or cascade it. Importing
// a project must still remap it, or an imported view-type token would point at the *source*
// project's view (or nothing, if that project no longer exists).
function remapTokenValue(
	value: TokenValue | null,
	viewIdMap: Map<string, string>
): TokenValue | null {
	if (value && value.type === 'view') {
		return { ...value, view_id: viewIdMap.get(value.view_id) ?? value.view_id };
	}
	return value;
}

// Same situation as TokenValue.view_id, for the "children" render-entry property: its value is
// a literal JSON-array-of-view-ids string (see CLAUDE.md's render_entries note), not a real FK,
// so it needs the same manual remap. Every other property's value is passed through untouched.
function remapRenderEntryValue(
	property: string,
	value: string | null,
	viewIdMap: Map<string, string>
): string | null {
	if (property !== 'children' || !value) return value;
	try {
		const viewIds: string[] = JSON.parse(value);
		return JSON.stringify(viewIds.map((id) => viewIdMap.get(id) ?? id));
	} catch {
		return value;
	}
}

// Fails fast with a specific, readable message before importProjectData touches the DB at all --
// without this, a malformed or unrelated file (someone picks the wrong .yaml, or a hand-edited
// export with a typo) only surfaces as whatever generic error the first broken insert happens to
// throw (a raw Postgres constraint violation, or "Cannot read properties of undefined"), several
// tables into the transaction.
const EXPORTED_ARRAY_FIELDS = [
	'views',
	'kits',
	'compositions',
	'tokens',
	'axes',
	'axisValues',
	'axesConsumed',
	'axisArgs',
	'layers',
	'renderSnippets',
	'renderEntries',
	'layerAxisValues'
] as const;

// Deliberately typed as (data: any): void, not a type-narrowing assertion function -- the
// caller's `data` stays plain `any` afterward (matching exportProject's own untyped return),
// so the rest of importProjectData can keep using ordinary dot-notation property access instead
// of index-signature bracket access everywhere.
function validateExportedProjectData(data: any): void {
	if (!data || typeof data !== 'object') {
		throw new Error('Import failed: file does not contain a valid KIT-10 project export.');
	}

	if (!data.project || typeof data.project !== 'object' || typeof data.project.name !== 'string') {
		throw new Error('Import failed: missing or invalid "project" section.');
	}

	for (const field of EXPORTED_ARRAY_FIELDS) {
		if (field in data && !Array.isArray(data[field])) {
			throw new Error(`Import failed: "${field}" must be an array.`);
		}
	}

	if ('interpreterPlugin' in data && data.interpreterPlugin !== null) {
		const ip = data.interpreterPlugin;
		if (typeof ip !== 'object' || typeof ip.name !== 'string') {
			throw new Error('Import failed: "interpreterPlugin" must be null or {name: string}.');
		}
	}
}

export interface QueryOrdering {
	attachKitToComposition: (
		kitId: string,
		viewId: string
	) => Promise<{ priority_index: number; kit_id: string; view_id: string } | undefined>;
	detachKitFromComposition: (kitId: string, viewId: string) => Promise<void>;
	// Persist a full reorder of a view's composed kits in one collision-safe transaction — mirrors
	// setConsumedAxesOrder's park-then-stamp shape, since `compositions` carries the same
	// unique_priority_per_view(view_id, priority_index) constraint axes_consumed has for kit_id.
	// `orderedKitIds` is top-to-bottom as the Compose panel displays it (priority_index desc, so
	// index 0 = highest priority = last-composed/wins).
	setKitCompositionOrder: (viewId: string, orderedKitIds: string[]) => Promise<void>;
}

export interface QueryToken {
	createToken: (
		projectId: string,
		alias?: string,
		value?: TokenValue,
		scope?: { kitId?: string; viewId?: string }
	) => Promise<
		| {
				id: string;
				project_id: string;
				alias: string | null;
				value: TokenValue | null;
				kit_id: string | null;
				view_id: string | null;
		  }
		| undefined
	>;
	updateTokenValue: (tokenId: string, value: TokenValue) => Promise<void>;
	/**
	 * Set the value of the View-scoped token named `alias`, creating it if this view has none yet.
	 * A View token overrides a same-named Kit/Project token during resolution (CONCEPTS.md §Tokens),
	 * so this is the canonical write path for a per-view override (e.g. a view's `children` list) --
	 * never write through the resolved property's `tokenId`, which is the *declaring* entry's token
	 * (often a shared Kit-scoped base) rather than this view's own override. `created` is true when a
	 * new token was inserted, so the caller can attach a render entry iff nothing declares `alias`.
	 */
	upsertViewToken: (
		projectId: string,
		viewId: string,
		alias: string,
		value: TokenValue
	) => Promise<{ id: string; created: boolean }>;
	/**
	 * Deep-clone a view's subtree: the view + its compositions, axis args, and view-scoped tokens,
	 * recursively cloning the views referenced by its `view-list` token aliased `compositionKey` so
	 * every clone owns unique child views (never a shared reference). Returns the new root view's id.
	 * Pure DB op -- the clone is materialized as rows; resolution then renders it normally (never
	 * runs inside resolve.ts).
	 */
	cloneViewSubtree: (viewId: string, compositionKey: string) => Promise<string | null>;
	/**
	 * Eager clone-per-view: instantiate a view's kit-default composition. For every kit-scope
	 * `view-list` token on a kit the view composes (a composition default, keyed by its own alias),
	 * deep-clone the referenced template subtree into fresh per-instance views and write them as
	 * this view's OWN same-aliased view-scope token -- so the instance owns unique children rather
	 * than sharing the kit's template refs. Name-neutral (no hardcoded field). Idempotent: skips any
	 * alias the view already overrides; highest-priority composed kit wins per alias.
	 */
	instantiateKitDefaults: (viewId: string) => Promise<void>;
	updateTokenAlias: (tokenId: string, alias: string) => Promise<void>;
	deleteToken: (tokenId: string) => Promise<void>;
	getTokensByProjectId: (projectId: string | null) => SelectQueryBuilder<
		Schema,
		'tokens',
		{
			tokenId: string;
			tokenAlias: string | null;
			tokenValue: TokenValue | null;
			tokenKitId: string | null;
			tokenViewId: string | null;
		}
	>;
	getTokensByKitId: (kitId: string | null) => SelectQueryBuilder<
		Schema,
		'tokens',
		{
			tokenId: string;
			tokenAlias: string | null;
			tokenValue: TokenValue | null;
			tokenKitId: string | null;
			tokenViewId: string | null;
		}
	>;
	getTokensByViewId: (viewId: string | null) => SelectQueryBuilder<
		Schema,
		'tokens',
		{
			tokenId: string;
			tokenAlias: string | null;
			tokenValue: TokenValue | null;
			tokenKitId: string | null;
			tokenViewId: string | null;
		}
	>;
}

export interface QueryKit {
	renameKit: (kitId: string, newName: string) => Promise<void>;
	deleteKit: (kitId: string) => Promise<void>;
	getKitsByProjectId: (
		projectId: string
	) => SelectQueryBuilder<Schema, 'kits', { kitId: string; kitName: string }>;
}

export interface QueryView {
	renameView: (viewId: string, newName: string) => Promise<void>;
	toggleViewLock: (viewId: string, locked: boolean) => Promise<void>;
	toggleViewHide: (viewId: string, hidden: boolean) => Promise<void>;
	// Shallow top-level merge into the existing hints jsonb column (Postgres `||`) -- the
	// caller is responsible for constructing an already-merged sub-object for whichever
	// namespace it's touching (e.g. passing a full `{ charter: { ...current, primitive: 'text' } }`
	// rather than just `{ charter: { primitive: 'text' } }`, or it would clobber other keys
	// within that same namespace). Manager stays hint-shape-agnostic on purpose.
	updateViewHints: (viewId: string, hints: Record<string, unknown>) => Promise<void>;
}

export interface QueryAxis {
	createAxis: (
		projectId: string,
		name: string,
		description?: string,
		kind?: string,
		hint?: string[],
		defaultValue?: any
	) => Promise<
		| {
				id: string;
				project_id: string;
				name: string | null;
				description: string | null;
				kind: string | null;
				hint: any;
				default_value: any;
		  }
		| undefined
	>;
	// Batched axis + initial axis_values in one transaction -- avoids the N+1 write pattern of a
	// createAxis followed by N createAxisValue calls, and closes the "axis created with zero
	// values" gap createAxis alone leaves (see createNewAxis in Axes.svelte).
	createAxisWithValues: (
		projectId: string,
		name: string,
		kind: string,
		values: AxisValueType[],
		description?: string,
		hint?: string[],
		defaultValue?: any
	) => Promise<
		| {
				axis: {
					id: string;
					project_id: string;
					name: string | null;
					description: string | null;
					kind: string | null;
					hint: any;
					default_value: any;
				};
				values: { id: string; axis_id: string; value: any; priority_index: number }[];
		  }
		| undefined
	>;
	renameAxis: (axisId: string, newName: string) => Promise<void>;
	deleteAxis: (axisId: string) => Promise<void>;
	// Hard-delete an axis and everything tying it down, in one transaction. Plain deleteAxis
	// FK-fails whenever the axis is still consumed (axes_consumed / axis_args are ON DELETE
	// restrict), so this clears args, layer conditions, and consumptions first, then the axis
	// (axis_values cascade). Intended only when the axis isn't used by another kit -- see
	// getAxisIdsUsedByOtherKits, which the UI gates the "Delete Axis" action on.
	deleteAxisCascade: (axisId: string) => Promise<void>;
	getAxesByProjectId: (projectId: string) => SelectQueryBuilder<
		Schema,
		'axes',
		{
			axisId: string;
			axisName: string | null;
			axisDescription: string | null;
			axisKind: string | null;
			axisHint: any;
			axisDefaultValue: any;
		}
	>;
	getAxesByKitId: (kitId: string) => SelectQueryBuilder<
		Schema,
		'axes' | 'axes_consumed',
		{
			axisId: string;
			axisName: string | null;
			axisDescription: string | null;
			axisKind: string | null;
			axisHint: any;
			priorityIndex: number;
		}
	>;
}

export interface QueryAxisValue {
	createAxisValue: (
		axisId: string,
		value: any
	) => Promise<{ id: string; axis_id: string; value: any } | undefined>;
	// Update an existing value's content in place, propagating a literal/discrete rename into
	// any axis_args / axes.default_value rows that currently hold the old literal string --
	// axis_args stores a denormalized copy of the literal (matchesArg compares by string, not by
	// axis_value_id), so without this a rename silently orphans every view's current selection
	// for that axis. See CLAUDE.md's "in-place value editing" note for the full reasoning.
	updateAxisValue: (axisValueId: string, value: AxisValueType) => Promise<void>;
	// Count of layer_axis_values rows referencing this value -- used by the UI to warn before a
	// delete that would otherwise detach live layer conditions (see deleteAxisValueSafe).
	getAxisValueUsage: (axisValueId: string) => Promise<number>;
	deleteAxisValue: (axisValueId: string) => Promise<void>;
	// UI-facing delete: layer_axis_values -> axis_values is ON DELETE restrict, so a plain
	// deleteAxisValue throws a DB error the instant the value is referenced by any layer
	// condition. This clears those references first, in the same transaction, mirroring
	// deleteAxisCascade's per-axis version but scoped to one value. The UI must warn the user
	// (via getAxisValueUsage) BEFORE calling this, since it's destructive to those conditions.
	deleteAxisValueSafe: (axisValueId: string) => Promise<void>;
	// Renumber one axis's values to exactly `orderedValueIds` (ascending priority_index, matching
	// getAxisValuesByAxisId's own `asc` order). Unlike setConsumedAxesOrder, axis_values has no
	// unique constraint on priority_index, so a single-pass CASE update is enough -- no park phase.
	setAxisValuesOrder: (axisId: string, orderedValueIds: string[]) => Promise<void>;
	getAxisValuesByAxisId: (
		axisId: string
	) => SelectQueryBuilder<Schema, 'axis_values', { axisValueId: string; value: any }>;
}

export interface QueryAxisConsumed {
	consumeAxis: (
		kitId: string,
		axisId: string
	) => Promise<{ kit_id: string; axis_id: string; priority_index: number } | undefined>;
	unconsumeAxis: (kitId: string, axisId: string) => Promise<void>;
	reorderAxesInKit: (kitId: string, axisId: string, newPriority: number) => Promise<void>;
	setConsumedAxesOrder: (kitId: string, orderedAxisIds: string[]) => Promise<void>;
	getConsumedAxesByKitId: (
		kitId: string
	) => SelectQueryBuilder<
		Schema,
		'axes_consumed' | 'axes',
		{ axisId: string; axisName: string | null; axisKind: string | null; priorityIndex: number }
	>;
	// Unused axes for a kit: axes in the kit's project not yet consumed by it (the mirror of
	// getKitsExceptFromViewId for the Axes panel's add menu).
	getAxesExceptFromKitId: (
		kitId: string | null
	) => SelectQueryBuilder<Schema, 'axes', { axisId: string; axisName: string | null }>;
	// Axis ids consumed by kits OTHER than `kitId` -- the "used anywhere else" set the Axes panel
	// checks to decide whether an axis is safe to hard-delete vs. only removable from this kit.
	getAxisIdsUsedByOtherKits: (
		kitId: string | null
	) => SelectQueryBuilder<Schema, 'axes_consumed', { axisId: string }>;
}

export interface QueryAxisArgs {
	setAxisArg: (
		viewId: string,
		kitId: string,
		axisId: string,
		value: any
	) => Promise<{ view_id: string; kit_id: string; axis_id: string; value: any } | undefined>;
	// Clear a view+kit's selection for one axis (deselect) -- the row is dropped, so the axis reads
	// as unset and no layer conditioned on it is active.
	clearAxisArg: (viewId: string, kitId: string, axisId: string) => Promise<void>;
	getAllAxisArgs: (
		viewId: string,
		kitId: string
	) => SelectQueryBuilder<
		Schema,
		'axis_args',
		{ axisId: string; kitId: string; viewId: string; value: any }
	>;
}

export interface QueryLayer {
	createLayer: (
		kitId: string
	) => Promise<{ id: string; kit_id: string; last_modified: Date } | undefined>;
	deleteLayer: (layerId: string) => Promise<void>;
	// Find-or-create the kit's layer whose condition set is EXACTLY `axisValueIds`, guaranteeing it
	// has a render snippet (the write host-fn rejects a snippet-less layer). Duplicate-guarded: an
	// existing layer with the same exact condition set is reused, never duplicated. Backs both the
	// Axes-panel "create layer" mode and the pipette's write target. `created` distinguishes the two.
	createLayerWithConditions: (
		kitId: string,
		axisValueIds: string[]
	) => Promise<{ layerId: string; created: boolean } | undefined>;
	// Delete a property's render entry from a layer (alt-click in the Render panel). Then garbage-
	// collect: a *conditioned* layer left with no render entries is dead weight, so it's deleted
	// (cascade drops its snippet + conditions, and its dot disappears from the Axes panel). The
	// null/base layer (zero conditions) is never GC'd -- it's the fallback write target and may
	// legitimately be empty. Returns whether the layer itself was removed.
	removePropertyFromLayer: (layerId: string, property: string) => Promise<{ layerDeleted: boolean }>;
	addAxisValueToLayer: (layerId: string, axisValueId: string) => Promise<void>;
	removeAxisValueFromLayer: (layerId: string, axisValueId: string) => Promise<void>;
	getLayersByKitId: (
		kitId: string
	) => SelectQueryBuilder<Schema, 'layers', { layerId: string; kitId: string; lastModified: Date }>;
	// The layer with zero attached axis_values -- applies unconditionally, always wins lowest
	// specificity. Not a distinct flag in the schema, just a layer nobody's attached a condition
	// to (see seed.ts's `*Null` layers) -- this is the fallback write target for a property that
	// has never been given a value on any layer yet (so it doesn't show up in a resolve at all).
	getNullLayerId: (kitId: string) => Promise<string | undefined>;
	setLayerChildren: (layerId: string, viewIds: string[]) => Promise<void>;
	clearLayerChildren: (layerId: string) => Promise<void>;
}

export interface QueryRenderSnippet {
	createRenderSnippet: (
		layerId: string
	) => Promise<{ id: string; layer_id: string; last_modified: Date } | undefined>;
	deleteRenderSnippet: (snippetId: string) => Promise<void>;
	getRenderSnippetsByLayerId: (
		layerId: string
	) => SelectQueryBuilder<
		Schema,
		'render_snippets',
		{ snippetId: string; layerId: string; lastModified: Date }
	>;
}

export interface QueryRenderEntry {
	createRenderEntry: (
		snippetId: string,
		property: string,
		value?: string | null,
		tokenId?: string | null
	) => Promise<
		| {
				id: string;
				snippet_id: string;
				property: string;
				value: string | null;
				token_id: string | null;
		  }
		| undefined
	>;
	updateRenderEntryValue: (
		entryId: string,
		property: string,
		value?: string | null,
		tokenId?: string | null
	) => Promise<void>;
	deleteRenderEntry: (entryId: string) => Promise<void>;
	getRenderEntriesBySnippetId: (snippetId: string) => SelectQueryBuilder<
		Schema,
		'render_entries',
		{
			entryId: string;
			snippetId: string;
			property: string;
			value: string | null;
			tokenId: string | null;
		}
	>;
	getRenderEntriesByLayerId: (layerId: string) => SelectQueryBuilder<
		Schema,
		'render_snippets' | 'render_entries',
		{
			entryId: string;
			snippetId: string;
			property: string;
			value: string | null;
			tokenId: string | null;
		}
	>;
}

export interface QueryAction {
	createWorkspace: (
		name: string
	) => Promise<
		{ id: string; name: string; description: string | null; last_active: Date } | undefined
	>;
	renameWorkspace: (workspaceId: string, newName: string) => Promise<void>;
	deleteWorkspace: (workspaceId: string) => Promise<void>;
	createProjectInWorkspace: (
		workspaceId: string,
		name: string
	) => Promise<
		| {
				id: string;
				name: string;
				description: string | null;
				last_modified: Date;
				license: string;
				author: string;
				workspace_id: string;
		  }
		| undefined
	>;
	renameProject: (projectId: string, newName: string) => Promise<void>;
	deleteProject: (projectId: string) => Promise<any>;
	// Shallow top-level merge into the existing hints jsonb column (Postgres `||`), same contract
	// as QueryView's updateViewHints -- the caller must pass an already-merged sub-object for
	// whichever namespace it's touching (e.g. a full `{ vellum: { ...current, panned: [x, y] } }`)
	// or it will clobber other keys within that same namespace. Manager stays hint-shape-agnostic.
	updateProjectHints: (projectId: string, hints: Record<string, unknown>) => Promise<void>;
	createViewInProject: (
		projectId: string,
		name: string,
		hints?: Record<string, unknown>
	) => Promise<
		| {
				id: string;
				name: string;
				last_modified: Date;
				project_id: string;
				lock: boolean;
				hide: boolean;
		  }
		| undefined
	>;
	deleteView: (viewId: string) => Promise<void>;
	// Name-neutral bulk delete. The editor computes the subtree to remove from the manifest-driven
	// DAG it already holds (composition is Charter's opinion, surfaced via composition_field_keys),
	// so the manager never re-walks a composition token or hardcodes "children" here. Each row's
	// onDelete('cascade') still cleans its own compositions/axis_args/view-scope tokens.
	deleteViews: (viewIds: string[]) => Promise<void>;
	createKitInProject: (
		projectId: string,
		name: string
	) => Promise<{ id: string; project_id: string } | undefined>;
	exportProject: (projectId: string) => Promise<any | undefined>;
	// Inverse of exportProject -- `data` is expected to be shaped exactly like exportProject's
	// return value (validated up front; throws a specific error for anything that doesn't look
	// like a real export rather than failing deep inside the transaction). Creates a brand-new
	// project in `workspaceId` with every id (project, views, kits, axes, axis values, layers,
	// render snippets, render entries, tokens) regenerated and every reference to those ids --
	// including the two the schema doesn't enforce as real FKs, TokenValue's view_id and the
	// "children" render-entry property's JSON array of view ids -- remapped to match. Never
	// collides with the source project even if it's still in the same DB. `warnings` covers
	// non-fatal mismatches (schema version drift, a referenced interpreter plugin that isn't
	// installed here) that don't block the import but are worth surfacing.
	importProjectData: (
		workspaceId: string,
		data: any
	) => Promise<{ id: string; name: string; warnings: string[] } | undefined>;
}

export interface QueryBuilder {
	getAllWorkspaces: () => SelectQueryBuilder<
		Schema,
		'workspaces',
		{ projectCount: string | number | bigint | null } & {
			workspaceId: string;
			workspaceName: string;
			workspaceDescription: string | null;
			lastActive: Date;
		}
	>;
	getAllProjects: () => SelectQueryBuilder<
		Schema,
		'workspaces' | 'projects',
		{
			workspaceName: string;
			projectId: string;
			projectName: string;
			projectDescription: string | null;
			license: string;
			author: string;
		}
	>;
	getProjectsByWorkspaceId: (workspaceId: string | null) => SelectQueryBuilder<
		Schema,
		'projects',
		{
			projectId: string;
			projectName: string;
			projectDescription: string | null;
			license: string;
			author: string;
			hints: Record<string, unknown> | null;
		}
	>;
	getViewsByProjectId: (projectId: string | null) => SelectQueryBuilder<
		Schema,
		'views',
		{
			viewId: string;
			viewName: string;
			viewLocked: boolean;
			viewHidden: boolean;
			hints: Record<string, unknown> | null;
		}
	>;
	getKitCompositionByViewId: (
		viewId: string | null
	) => SelectQueryBuilder<
		Schema,
		'kits' | 'compositions',
		{ kitId: string; kitName: string; kitIndex: number; kitView: string }
	>;
	getKitsExceptFromViewId: (
		viewId: string | null
	) => SelectQueryBuilder<Schema, 'kits', { kitId: string; kitName: string }>;
	getAssetsByProjectId: (projectId: string | null) => SelectQueryBuilder<
		Schema,
		'assets',
		{
			assetId: string;
			assetName: string;
			assetMimeType: string;
			assetChecksum: string;
			assetLink: string;
			assetWidth: number;
			assetHeight: number;
			assetCreatedAt: Date;
		}
	>;
}

export interface PluginRow {
	id: string;
	name: string;
	kind: PluginKind;
	activation: PluginActivation | null;
	manifest: PluginManifest;
	options: Record<string, unknown> | null;
	content_hash: string | null;
}

export interface QueryPlugin {
	// Upsert-by-name -- re-registering an already-known plugin (e.g. every app boot) just
	// refreshes its manifest/options/hash/activation in place rather than creating a duplicate
	// row.
	registerPlugin: (input: {
		name: string;
		kind: PluginKind;
		activation?: PluginActivation | null;
		manifest: PluginManifest;
		options?: Record<string, unknown> | null;
		contentHash?: string | null;
	}) => Promise<PluginRow | undefined>;
	// A project's one interpreter (Charter today) -- the only genuinely per-project plugin
	// choice. Utility plugins (Fontavious, Tenner) are install-level, not project-scoped at all;
	// see listPlugins + PluginActivation for how those load instead.
	getProjectInterpreter: (projectId: string) => Promise<PluginRow | null>;
	setProjectInterpreter: (projectId: string, pluginId: string) => Promise<void>;
	// The whole catalogue, unscoped to any project -- used both to decide which import providers
	// are installed (there's no project to scope to before one exists) and to find every eager
	// utility plugin to load at editor boot.
	listPlugins: () => Promise<PluginRow[]>;
}

// ------------------------------

export interface AssetRow {
	id: string;
	project_id: string;
	name: string;
	mime_type: string;
	checksum: string;
	link: string;
	width: number;
	height: number;
	created_at: Date;
}

export interface QueryAsset {
	// Upsert an asset by checksum — if the same file (same project_id + checksum) already
	// exists, return it unchanged. Otherwise insert a new row.
	upsertAsset: (input: {
		projectId: string;
		name: string;
		mimeType: string;
		checksum: string;
		link: string;
		width: number;
		height: number;
	}) => Promise<AssetRow>;
	deleteAsset: (assetId: string) => Promise<void>;
}

export interface Api
	extends
		QueryBuilder,
		QueryAction,
		QueryOrdering,
		QueryToken,
		QueryKit,
		QueryView,
		QueryAxis,
		QueryAxisValue,
		QueryAxisConsumed,
		QueryAxisArgs,
		QueryLayer,
		QueryRenderSnippet,
		QueryRenderEntry,
		QueryPlugin,
		QueryAsset {}

// Deep-clone a view subtree: the view row + its compositions, axis args, and view-scoped tokens.
// Recurses through the view's own view-list token aliased `compositionKey`, cloning each referenced
// child so every clone owns unique children (never a shared reference). `seen` is a DFS path guard:
// a view already on the current ancestry path is a cycle -> stop (a diamond reached via a different
// path is still cloned, since it's popped on exit). Other view-list tokens (non-composition) are
// copied by value -- those are references, not owned structure.
async function cloneViewSubtreeImpl(
	db: SchemaDialect,
	viewId: string,
	compositionKey: string,
	seen: Set<string>
): Promise<string | null> {
	if (seen.has(viewId)) return null;
	seen.add(viewId);
	try {
		const src = await db
			.selectFrom('views')
			.where('id', '=', viewId)
			.select(['name', 'project_id', 'hints'])
			.executeTakeFirst();
		if (!src) return null;

		const clone = await db
			.insertInto('views')
			.values({
				name: src.name,
				project_id: src.project_id,
				lock: false,
				hide: false,
				hints: (src.hints ?? {}) as any
			} as any)
			.returning('id')
			.executeTakeFirstOrThrow();
		const cloneId = clone.id;

		const comps = await db
			.selectFrom('compositions')
			.where('view_id', '=', viewId)
			.select(['kit_id', 'priority_index'])
			.execute();
		for (const c of comps) {
			await db
				.insertInto('compositions')
				.values({ view_id: cloneId, kit_id: c.kit_id, priority_index: c.priority_index })
				.onConflict((oc) => oc.columns(['view_id', 'kit_id']).doNothing())
				.execute();
		}

		const args = await db
			.selectFrom('axis_args')
			.where('view_id', '=', viewId)
			.select(['kit_id', 'axis_id', 'value'])
			.execute();
		for (const a of args) {
			await db
				.insertInto('axis_args')
				.values({ view_id: cloneId, kit_id: a.kit_id, axis_id: a.axis_id, value: a.value } as any)
				.execute();
		}

		const tokens = await db
			.selectFrom('tokens')
			.where('view_id', '=', viewId)
			.select(['alias', 'value', 'hints'])
			.execute();
		for (const t of tokens) {
			let value = t.value as TokenValue | null;
			if (value && value.type === 'view-list' && t.alias === compositionKey) {
				const clonedIds: string[] = [];
				for (const childId of value.view_ids) {
					const cid = await cloneViewSubtreeImpl(db, childId, compositionKey, seen);
					if (cid) clonedIds.push(cid);
				}
				value = { type: 'view-list', view_ids: clonedIds };
			}
			await db
				.insertInto('tokens')
				.values({
					project_id: src.project_id,
					alias: t.alias,
					value: value as any,
					hints: (t.hints ?? null) as any,
					kit_id: null,
					view_id: cloneId
				} as any)
				.execute();
		}
		return cloneId;
	} finally {
		seen.delete(viewId);
	}
}

async function instantiateKitDefaultsImpl(db: SchemaDialect, viewId: string): Promise<void> {
	const view = await db
		.selectFrom('views')
		.where('id', '=', viewId)
		.select('project_id')
		.executeTakeFirst();
	if (!view) return;

	// Every kit-scope `view-list` token is a composition default (a view-list value is a
	// composition edge). Collect them by alias across the view's kits, highest-priority kit winning
	// per alias -- name-neutral: whatever the kit aliases its default, we clone it into a same-named
	// view token. (Which of these actually renders nested is the plugin's render-time call.)
	const comps = await db
		.selectFrom('compositions')
		.where('view_id', '=', viewId)
		.select('kit_id')
		.orderBy('priority_index', 'desc')
		.execute();
	const defaultsByAlias = new Map<string, string[]>();
	for (const c of comps) {
		const toks = await db
			.selectFrom('tokens')
			.where('kit_id', '=', c.kit_id)
			.select(['alias', 'value'])
			.execute();
		for (const t of toks) {
			const v = t.value as TokenValue | null;
			if (t.alias && v?.type === 'view-list' && !defaultsByAlias.has(t.alias)) {
				defaultsByAlias.set(t.alias, v.view_ids);
			}
		}
	}

	for (const [alias, template] of defaultsByAlias) {
		if (template.length === 0) continue;
		// Skip if this view already owns an override for the alias (idempotent).
		const own = await db
			.selectFrom('tokens')
			.where('view_id', '=', viewId)
			.where('alias', '=', alias)
			.select('id')
			.executeTakeFirst();
		if (own) continue;

		const seen = new Set<string>();
		const clonedIds: string[] = [];
		for (const tid of template) {
			const cid = await cloneViewSubtreeImpl(db, tid, alias, seen);
			if (cid) clonedIds.push(cid);
		}
		await db
			.insertInto('tokens')
			.values({
				project_id: view.project_id,
				alias,
				value: { type: 'view-list', view_ids: clonedIds } as any,
				hints: null,
				kit_id: null,
				view_id: viewId
			} as any)
			.execute();
	}
}

export const queryBuilder = (db: SchemaDialect): Api => ({
	createWorkspace: async (name: string) => {
		return await db.insertInto('workspaces').values([{ name }]).returningAll().executeTakeFirst();
	},

	renameWorkspace: async (workspaceId: string, newName: string) => {
		await db
			.updateTable('workspaces')
			.set({ name: newName })
			.where('workspaces.id', '=', workspaceId)
			.execute();
	},

	deleteWorkspace: async (workspaceId: string) => {
		await db.deleteFrom('workspaces').where('workspaces.id', '=', workspaceId).execute();
	},

	exportProject: async (projectId: string) => {
		return await db.transaction().execute(async (trx) => {
			const project = await trx
				.selectFrom('projects')
				.selectAll()
				.where('projects.id', '=', projectId)
				.executeTakeFirst();
			if (!project) throw 'Project does not exist';

			// Resolved by name, not carried as the source's raw plugin id -- ids are never
			// meaningful across a different DB (or even the same DB after a reseed), only the
			// catalogue name is. importProjectData re-resolves this name against whatever's
			// actually installed on the importing side.
			const interpreterPlugin = project.interpreter_plugin_id
				? ((await trx
						.selectFrom('plugins')
						.select('name')
						.where('id', '=', project.interpreter_plugin_id)
						.executeTakeFirst()) ?? null)
				: null;

			const views = await trx
				.selectFrom('views')
				.selectAll()
				.where('views.project_id', '=', projectId)
				.execute();
			const kits = await trx
				.selectFrom('kits')
				.selectAll()
				.where('kits.project_id', '=', projectId)
				.execute();
			const kitIds = kits.map((k) => k.id);
			const viewIds = views.map((v) => v.id);

			// `where(col, 'in', ids)` compiles straight to `IN (...)` -- with an empty ids
			// array that's `IN ()`, which Postgres rejects outright as a syntax error, not as
			// "matches nothing" the way an ORM might paper over. A brand-new project (no kits
			// or views yet) hits this on literally every query below, so each one that's keyed
			// off a possibly-empty id list short-circuits to [] instead of round-tripping.
			const compositions =
				kitIds.length === 0 && viewIds.length === 0
					? []
					: await trx
							.selectFrom('compositions')
							.selectAll()
							.where((eb) =>
								eb.or([
									eb('compositions.kit_id', 'in', kitIds),
									eb('compositions.view_id', 'in', viewIds)
								])
							)
							.execute();

			const tokens = await trx
				.selectFrom('tokens')
				.selectAll()
				.where('tokens.project_id', '=', projectId)
				.execute();
			const axes = await trx
				.selectFrom('axes')
				.selectAll()
				.where('axes.project_id', '=', projectId)
				.execute();
			const axisIds = axes.map((a) => a.id);
			const axisValues =
				axisIds.length === 0
					? []
					: await trx
							.selectFrom('axis_values')
							.selectAll()
							.where('axis_values.axis_id', 'in', axisIds)
							.execute();
			const axesConsumed =
				kitIds.length === 0
					? []
					: await trx
							.selectFrom('axes_consumed')
							.selectAll()
							.where('axes_consumed.kit_id', 'in', kitIds)
							.execute();
			const axisArgs =
				kitIds.length === 0
					? []
					: await trx
							.selectFrom('axis_args')
							.selectAll()
							.where('axis_args.kit_id', 'in', kitIds)
							.execute();

			const layers =
				kitIds.length === 0
					? []
					: await trx
							.selectFrom('layers')
							.selectAll()
							.where('layers.kit_id', 'in', kitIds)
							.execute();
			const layerIds = layers.map((l) => l.id);

			const renderSnippets =
				layerIds.length === 0
					? []
					: await trx
							.selectFrom('render_snippets')
							.selectAll()
							.where('render_snippets.layer_id', 'in', layerIds)
							.execute();
			const snippetIds = renderSnippets.map((s) => s.id);

			const renderEntries =
				snippetIds.length === 0
					? []
					: await trx
							.selectFrom('render_entries')
							.selectAll()
							.where('render_entries.snippet_id', 'in', snippetIds)
							.execute();
			const layerAxisValues =
				layerIds.length === 0
					? []
					: await trx
							.selectFrom('layer_axis_values')
							.selectAll()
							.where('layer_axis_values.layer_id', 'in', layerIds)
							.execute();

			return {
				schemaVersion: CURRENT_SCHEMA_VERSION,
				interpreterPlugin,
				project,
				views,
				kits,
				compositions,
				tokens,
				axes,
				axisValues,
				axesConsumed,
				axisArgs,
				layers,
				renderSnippets,
				renderEntries,
				layerAxisValues
			};
		});
	},

	importProjectData: async (workspaceId: string, data: any) => {
		validateExportedProjectData(data);
		const warnings: string[] = [];

		if (data.schemaVersion && data.schemaVersion !== CURRENT_SCHEMA_VERSION) {
			warnings.push(
				`Exported from schema version "${data.schemaVersion}", this app is on "${CURRENT_SCHEMA_VERSION}" -- data may not import cleanly.`
			);
		}

		return await db.transaction().execute(async (trx) => {
			const newId = () => crypto.randomUUID();
			const idMap = (rows: { id: string }[]) =>
				new Map<string, string>(rows.map((row) => [row.id, newId()]));

			const projectId = newId();
			const viewIdMap = idMap(data.views ?? []);
			const kitIdMap = idMap(data.kits ?? []);
			const axisIdMap = idMap(data.axes ?? []);
			const axisValueIdMap = idMap(data.axisValues ?? []);
			const layerIdMap = idMap(data.layers ?? []);
			const snippetIdMap = idMap(data.renderSnippets ?? []);
			const tokenIdMap = idMap(data.tokens ?? []);

			const project = data.project;

			// Re-resolved by name against THIS db's own catalogue -- the source's plugin id
			// means nothing here (see exportProject's interpreterPlugin comment). If the named
			// interpreter isn't installed on the importing system, the project just ends up
			// with no active interpreter (same as any other project created without one) rather
			// than failing the whole import over it.
			let interpreterPluginId: string | null = null;
			if (data.interpreterPlugin?.name) {
				const interpreterRow = await trx
					.selectFrom('plugins')
					.select('id')
					.where('name', '=', data.interpreterPlugin.name)
					.executeTakeFirst();
				if (interpreterRow) {
					interpreterPluginId = interpreterRow.id;
				} else {
					warnings.push(
						`Interpreter "${data.interpreterPlugin.name}" is not installed; project has no active interpreter yet.`
					);
				}
			}

			await trx
				.insertInto('projects')
				.values({
					id: projectId,
					name: project.name,
					description: project.description ?? null,
					hints: (project.hints ?? {}) as any,
					license: project.license,
					author: project.author,
					workspace_id: workspaceId,
					interpreter_plugin_id: interpreterPluginId
				})
				.execute();

			// Insertion order follows the schema's FK dependency graph (see CLAUDE.md's migration
			// for the exact references) -- every table below only ever points at ids already
			// inserted by the time it's reached.

			if (data.axes?.length) {
				await trx
					.insertInto('axes')
					.values(
						data.axes.map((a: any) => ({
							id: axisIdMap.get(a.id)!,
							project_id: projectId,
							name: a.name,
							description: a.description,
							kind: a.kind,
							hint: a.hint,
							hints: (a.hints ?? {}) as any,
							default_value: a.default_value
						}))
					)
					.execute();
			}

			if (data.axisValues?.length) {
				await trx
					.insertInto('axis_values')
					.values(
						data.axisValues.map((av: any) => ({
							id: axisValueIdMap.get(av.id)!,
							axis_id: axisIdMap.get(av.axis_id)!,
							hints: (av.hints ?? {}) as any,
							value: av.value
						}))
					)
					.execute();
			}

			if (data.views?.length) {
				await trx
					.insertInto('views')
					.values(
						data.views.map((v: any) => ({
							id: viewIdMap.get(v.id)!,
							name: v.name,
							hints: (v.hints ?? {}) as any,
							project_id: projectId,
							lock: v.lock,
							hide: v.hide
						}))
					)
					.execute();
			}

			if (data.kits?.length) {
				await trx
					.insertInto('kits')
					.values(
						data.kits.map((k: any) => ({
							id: kitIdMap.get(k.id)!,
							name: k.name,
							hints: (k.hints ?? {}) as any,
							project_id: projectId
						}))
					)
					.execute();
			}

			if (data.compositions?.length) {
				await trx
					.insertInto('compositions')
					.values(
						data.compositions.map((c: any) => ({
							priority_index: c.priority_index,
							kit_id: kitIdMap.get(c.kit_id)!,
							view_id: viewIdMap.get(c.view_id)!
						}))
					)
					.execute();
			}

			if (data.axesConsumed?.length) {
				await trx
					.insertInto('axes_consumed')
					.values(
						data.axesConsumed.map((ac: any) => ({
							kit_id: kitIdMap.get(ac.kit_id)!,
							axis_id: axisIdMap.get(ac.axis_id)!,
							priority_index: ac.priority_index
						}))
					)
					.execute();
			}

			if (data.axisArgs?.length) {
				await trx
					.insertInto('axis_args')
					.values(
						data.axisArgs.map((aa: any) => ({
							view_id: viewIdMap.get(aa.view_id)!,
							kit_id: kitIdMap.get(aa.kit_id)!,
							axis_id: axisIdMap.get(aa.axis_id)!,
							value: aa.value
						}))
					)
					.execute();
			}

			if (data.layers?.length) {
				await trx
					.insertInto('layers')
					.values(
						data.layers.map((l: any) => ({
							id: layerIdMap.get(l.id)!,
							kit_id: kitIdMap.get(l.kit_id)!,
							hints: (l.hints ?? {}) as any
						}))
					)
					.execute();
			}

			if (data.layerAxisValues?.length) {
				await trx
					.insertInto('layer_axis_values')
					.values(
						data.layerAxisValues.map((lav: any) => ({
							layer_id: layerIdMap.get(lav.layer_id)!,
							axis_value_id: axisValueIdMap.get(lav.axis_value_id)!
						}))
					)
					.execute();
			}

			if (data.renderSnippets?.length) {
				await trx
					.insertInto('render_snippets')
					.values(
						data.renderSnippets.map((s: any) => ({
							id: snippetIdMap.get(s.id)!,
							layer_id: layerIdMap.get(s.layer_id)!,
							hints: (s.hints ?? {}) as any
						}))
					)
					.execute();
			}

			if (data.tokens?.length) {
				await trx
					.insertInto('tokens')
					.values(
						data.tokens.map((t: any) => ({
							id: tokenIdMap.get(t.id)!,
							project_id: projectId,
							alias: t.alias,
							value: remapTokenValue(t.value, viewIdMap) as any,
							hints: (t.hints ?? {}) as any,
							kit_id: t.kit_id ? (kitIdMap.get(t.kit_id) ?? null) : null,
							view_id: t.view_id ? (viewIdMap.get(t.view_id) ?? null) : null
						}))
					)
					.execute();
			}

			if (data.renderEntries?.length) {
				await trx
					.insertInto('render_entries')
					.values(
						data.renderEntries.map((e: any) => ({
							id: newId(),
							snippet_id: snippetIdMap.get(e.snippet_id)!,
							property: e.property,
							value: remapRenderEntryValue(e.property, e.value, viewIdMap),
							hints: (e.hints ?? {}) as any,
							token_id: e.token_id ? (tokenIdMap.get(e.token_id) ?? null) : null
						}))
					)
					.execute();
			}

			return { id: projectId, name: project.name as string, warnings };
		});
	},

	createProjectInWorkspace: async (workspaceId: string, name: string) => {
		return await db
			.insertInto('projects')
			.values([{ name, workspace_id: workspaceId, description: '', author: '', license: 'mplv2' }])
			.returningAll()
			.executeTakeFirst();
	},

	updateProjectHints: async (projectId: string, hints: Record<string, unknown>) => {
		await db
			.updateTable('projects')
			.set({ hints: sql`hints || ${JSON.stringify(hints)}::jsonb` as any })
			.where('projects.id', '=', projectId)
			.execute();
	},

	renameProject: async (projectId: string, newName: string) => {
		await db
			.updateTable('projects')
			.set({ name: newName })
			.where('projects.id', '=', projectId)
			.execute();
	},

	deleteProject: async (projectId: string) => {
		await db.deleteFrom('projects').where('projects.id', '=', projectId).execute();
	},

	createViewInProject: async (projectId: string, name: string, hints?: Record<string, unknown>) => {
		return await db
			.insertInto('views')
			.values([
				{ name, project_id: projectId, lock: false, hide: false, hints: hints ?? {} } as any
			])
			.returningAll()
			.executeTakeFirst();
	},

	deleteView: async (viewId: string) => {
		await db.deleteFrom('views').where('views.id', '=', viewId).execute();
	},

	deleteViews: async (viewIds: string[]) => {
		if (!viewIds.length) return;
		await db.deleteFrom('views').where('views.id', 'in', viewIds).execute();
	},

	renameView: async (viewId: string, newName: string) => {
		await db.updateTable('views').set({ name: newName }).where('views.id', '=', viewId).execute();
	},

	toggleViewLock: async (viewId: string, locked: boolean) => {
		await db.updateTable('views').set({ lock: locked }).where('views.id', '=', viewId).execute();
	},

	toggleViewHide: async (viewId: string, hidden: boolean) => {
		await db.updateTable('views').set({ hide: hidden }).where('views.id', '=', viewId).execute();
	},

	updateViewHints: async (viewId: string, hints: Record<string, unknown>) => {
		await db
			.updateTable('views')
			.set({ hints: sql`hints || ${JSON.stringify(hints)}::jsonb` as any })
			.where('views.id', '=', viewId)
			.execute();
	},

	createKitInProject: async (projectId: string, name: string) => {
		return await db
			.insertInto('kits')
			.values([{ name, project_id: projectId }])
			.returning(['kits.id', 'kits.project_id'])
			.executeTakeFirst();
	},

	renameKit: async (kitId: string, newName: string) => {
		await db.updateTable('kits').set({ name: newName }).where('kits.id', '=', kitId).execute();
	},

	deleteKit: async (kitId: string) => {
		await db.deleteFrom('kits').where('kits.id', '=', kitId).execute();
	},

	attachKitToComposition: async (kitId: string, viewId: string) => {
		return await db.transaction().execute(async (trx) => {
			const last = await trx
				.selectFrom('compositions')
				.select('priority_index')
				.where('view_id', '=', viewId)
				.orderBy('priority_index', 'desc')
				.executeTakeFirst();
			const idx = last ? last.priority_index + 1000 : 1000;
			return await trx
				.insertInto('compositions')
				.values({ view_id: viewId, kit_id: kitId, priority_index: idx })
				.onConflict((oc) => oc.columns(['view_id', 'kit_id']).doNothing())
				.returningAll()
				.executeTakeFirst();
		});
	},

	detachKitFromComposition: async (kitId: string, viewId: string) => {
		await db
			.deleteFrom('compositions')
			.where('compositions.kit_id', '=', kitId)
			.where('compositions.view_id', '=', viewId)
			.execute();
	},

	setKitCompositionOrder: async (viewId: string, orderedKitIds: string[]) => {
		if (orderedKitIds.length === 0) return;
		const n = orderedKitIds.length;
		await db.transaction().execute(async (trx) => {
			const park = sql.join(
				orderedKitIds.map((kitId, i) => sql`when ${kitId} then ${-(i + 1)}`),
				sql` `
			);
			await sql`
				update compositions set priority_index = case kit_id ${park} else priority_index end
				where view_id = ${viewId} and kit_id in (${sql.join(orderedKitIds)})
			`.execute(trx);

			const finals = sql.join(
				orderedKitIds.map((kitId, i) => sql`when ${kitId} then ${(n - i) * 1000}`),
				sql` `
			);
			await sql`
				update compositions set priority_index = case kit_id ${finals} else priority_index end
				where view_id = ${viewId} and kit_id in (${sql.join(orderedKitIds)})
			`.execute(trx);
		});
	},

	createToken: async (
		projectId: string,
		alias?: string,
		value?: TokenValue,
		scope?: { kitId?: string; viewId?: string }
	) => {
		return await db
			.insertInto('tokens')
			.values({
				project_id: projectId,
				alias: alias ?? null,
				value: (value ?? null) as any,
				kit_id: scope?.kitId ?? null,
				view_id: scope?.viewId ?? null
			})
			.returningAll()
			.executeTakeFirst();
	},

	updateTokenValue: async (tokenId: string, value: TokenValue) => {
		await db
			.updateTable('tokens')
			.set({ value } as any)
			.where('tokens.id', '=', tokenId)
			.execute();
	},

	upsertViewToken: async (projectId: string, viewId: string, alias: string, value: TokenValue) => {
		// find-then-write in one transaction so two rapid upserts can't each miss and insert a
		// duplicate view token for the same alias.
		return await db.transaction().execute(async (trx) => {
			const existing = await trx
				.selectFrom('tokens')
				.where('tokens.view_id', '=', viewId)
				.where('tokens.alias', '=', alias)
				.select('tokens.id as id')
				.executeTakeFirst();
			if (existing) {
				await trx
					.updateTable('tokens')
					.set({ value } as any)
					.where('tokens.id', '=', existing.id)
					.execute();
				return { id: existing.id, created: false };
			}
			const inserted = await trx
				.insertInto('tokens')
				.values({
					project_id: projectId,
					alias,
					value: value as any,
					kit_id: null,
					view_id: viewId
				})
				.returning('id')
				.executeTakeFirstOrThrow();
			return { id: inserted.id, created: true };
		});
	},

	cloneViewSubtree: async (viewId: string, compositionKey: string) =>
		cloneViewSubtreeImpl(db, viewId, compositionKey, new Set()),

	instantiateKitDefaults: async (viewId: string) => instantiateKitDefaultsImpl(db, viewId),

	updateTokenAlias: async (tokenId: string, alias: string) => {
		await db.updateTable('tokens').set({ alias }).where('tokens.id', '=', tokenId).execute();
	},

	deleteToken: async (tokenId: string) => {
		await db.deleteFrom('tokens').where('tokens.id', '=', tokenId).execute();
	},

	createAxis: async (
		projectId: string,
		name: string,
		description?: string,
		kind?: string,
		hint?: string[],
		defaultValue?: any
	) => {
		return await db
			.insertInto('axes')
			.values({
				project_id: projectId,
				name,
				description: description ?? null,
				kind: kind ?? null,
				hint: hint ?? null,
				default_value: defaultValue ?? null
			} as any)
			.returningAll()
			.executeTakeFirst();
	},

	createAxisWithValues: async (
		projectId: string,
		name: string,
		kind: string,
		values: AxisValueType[],
		description?: string,
		hint?: string[],
		defaultValue?: any
	) => {
		return await db.transaction().execute(async (trx) => {
			const axis = await trx
				.insertInto('axes')
				.values({
					project_id: projectId,
					name,
					description: description ?? null,
					kind,
					hint: hint ?? null,
					default_value: defaultValue ?? null
				} as any)
				.returningAll()
				.executeTakeFirst();
			if (!axis) return undefined;

			if (values.length === 0) {
				return { axis, values: [] };
			}

			const inserted = await trx
				.insertInto('axis_values')
				.values(
					values.map((value, i) => ({
						axis_id: axis.id,
						value,
						priority_index: (i + 1) * 1000
					})) as any
				)
				.returningAll()
				.execute();

			return { axis, values: inserted };
		});
	},

	renameAxis: async (axisId: string, newName: string) => {
		await db.updateTable('axes').set({ name: newName }).where('axes.id', '=', axisId).execute();
	},

	deleteAxis: async (axisId: string) => {
		await db.deleteFrom('axes').where('axes.id', '=', axisId).execute();
	},

	deleteAxisCascade: async (axisId: string) => {
		await db.transaction().execute(async (trx) => {
			// axis_args -> axes is ON DELETE restrict: clear the axis's args first.
			await trx.deleteFrom('axis_args').where('axis_args.axis_id', '=', axisId).execute();
			// layer_axis_values -> axis_values is ON DELETE restrict, and axis_values -> axes is
			// cascade; so remove layer conditions on this axis's values before the axis delete
			// triggers the axis_values cascade, or that cascade would be blocked.
			const values = await trx
				.selectFrom('axis_values')
				.select('id')
				.where('axis_id', '=', axisId)
				.execute();
			const valueIds = values.map((v) => v.id);
			if (valueIds.length > 0) {
				await trx
					.deleteFrom('layer_axis_values')
					.where('layer_axis_values.axis_value_id', 'in', valueIds)
					.execute();
			}
			// axes_consumed -> axes is ON DELETE restrict: drop consumptions before the axis.
			await trx.deleteFrom('axes_consumed').where('axes_consumed.axis_id', '=', axisId).execute();
			// Finally the axis; axis_values cascade-delete with it.
			await trx.deleteFrom('axes').where('axes.id', '=', axisId).execute();
		});
	},

	createAxisValue: async (axisId: string, value: any) => {
		return await db.transaction().execute(async (trx) => {
			const last = await trx
				.selectFrom('axis_values')
				.select('priority_index')
				.where('axis_id', '=', axisId)
				.orderBy('priority_index', 'desc')
				.executeTakeFirst();
			const idx = last ? last.priority_index + 1000 : 1000;
			return await trx
				.insertInto('axis_values')
				.values({ axis_id: axisId, value, priority_index: idx } as any)
				.returningAll()
				.executeTakeFirst();
		});
	},

	updateAxisValue: async (axisValueId: string, value: AxisValueType) => {
		await db.transaction().execute(async (trx) => {
			const prev = await trx
				.selectFrom('axis_values')
				.select(['axis_id', 'value'])
				.where('id', '=', axisValueId)
				.executeTakeFirst();

			await trx
				.updateTable('axis_values')
				.set({ value } as any)
				.where('id', '=', axisValueId)
				.execute();

			if (!prev) return;
			const prevValue = prev.value as AxisValueType;
			const nextValue = value as AxisValueType;
			// Only literal/discrete values are ever matched by a denormalized string in axis_args
			// (see matchesArg) -- a range value's identity isn't stored that way, so there's
			// nothing to propagate for it.
			const oldLiteral =
				prevValue.type === 'literal' || prevValue.type === 'discrete' ? prevValue.value : null;
			const newLiteral =
				nextValue.type === 'literal' || nextValue.type === 'discrete' ? nextValue.value : null;
			if (oldLiteral === null || newLiteral === null || oldLiteral === newLiteral) return;

			const newArg = { type: 'literal', value: newLiteral };
			await trx
				.updateTable('axis_args')
				.set({ value: newArg } as any)
				.where('axis_id', '=', prev.axis_id)
				.where(sql`axis_args.value ->> 'value'`, '=', oldLiteral)
				.execute();
			await trx
				.updateTable('axes')
				.set({ default_value: newArg } as any)
				.where('id', '=', prev.axis_id)
				.where(sql`axes.default_value ->> 'value'`, '=', oldLiteral)
				.execute();
		});
	},

	getAxisValueUsage: async (axisValueId: string) => {
		const row = await db
			.selectFrom('layer_axis_values')
			.select(({ fn }) => fn.countAll<number>().as('count'))
			.where('axis_value_id', '=', axisValueId)
			.executeTakeFirst();
		return Number(row?.count ?? 0);
	},

	deleteAxisValue: async (axisValueId: string) => {
		await db.deleteFrom('axis_values').where('axis_values.id', '=', axisValueId).execute();
	},

	deleteAxisValueSafe: async (axisValueId: string) => {
		await db.transaction().execute(async (trx) => {
			await trx
				.deleteFrom('layer_axis_values')
				.where('layer_axis_values.axis_value_id', '=', axisValueId)
				.execute();
			await trx.deleteFrom('axis_values').where('axis_values.id', '=', axisValueId).execute();
		});
	},

	setAxisValuesOrder: async (axisId: string, orderedValueIds: string[]) => {
		if (orderedValueIds.length === 0) return;
		const finals = sql.join(
			orderedValueIds.map((id, i) => sql`when ${id} then ${(i + 1) * 1000}`),
			sql` `
		);
		await sql`
			update axis_values set priority_index = case id ${finals} else priority_index end
			where axis_id = ${axisId} and id in (${sql.join(orderedValueIds)})
		`.execute(db);
	},

	getAxisValuesByAxisId: (axisId: string) => {
		return db
			.selectFrom('axis_values')
			.where('axis_values.axis_id', '=', axisId)
			.orderBy('axis_values.priority_index', 'asc')
			.select(['axis_values.id as axisValueId', 'axis_values.value']);
	},

	consumeAxis: async (kitId: string, axisId: string) => {
		return await db.transaction().execute(async (trx) => {
			const last = await trx
				.selectFrom('axes_consumed')
				.select('priority_index')
				.where('kit_id', '=', kitId)
				.orderBy('priority_index', 'desc')
				.executeTakeFirst();
			const idx = last ? last.priority_index + 1000 : 1000;
			return await trx
				.insertInto('axes_consumed')
				.values({ kit_id: kitId, axis_id: axisId, priority_index: idx })
				.onConflict((oc) => oc.columns(['kit_id', 'axis_id']).doNothing())
				.returningAll()
				.executeTakeFirst();
		});
	},

	unconsumeAxis: async (kitId: string, axisId: string) => {
		await db
			.deleteFrom('axes_consumed')
			.where('axes_consumed.kit_id', '=', kitId)
			.where('axes_consumed.axis_id', '=', axisId)
			.execute();
	},

	reorderAxesInKit: async (kitId: string, axisId: string, newPriority: number) => {
		await db
			.updateTable('axes_consumed')
			.set({ priority_index: newPriority })
			.where('axes_consumed.kit_id', '=', kitId)
			.where('axes_consumed.axis_id', '=', axisId)
			.execute();
	},

	// Renumber a kit's consumed axes to exactly `orderedAxisIds` (top-of-panel first). `axes_consumed`
	// has a unique-per-kit constraint on priority_index that Postgres checks per-row *within* a
	// statement (it's not DEFERRABLE), so a reorder that has any axis pass through a priority another
	// axis still holds collides -- true even for a single CASE update. Hence two phases in one
	// transaction: first park every listed axis at a distinct *negative* temp (can't clash with the
	// existing positive priorities, nor with each other), then stamp the final positive priorities
	// (can't clash with the now-negative rows, nor with each other). `orderedAxisIds` must be the
	// kit's complete consumed-axis set. Priorities descend (getConsumedAxesByKitId orders
	// `priority_index desc`) so index 0 lands highest and stays at the top.
	setConsumedAxesOrder: async (kitId: string, orderedAxisIds: string[]) => {
		if (orderedAxisIds.length === 0) return;
		const n = orderedAxisIds.length;
		await db.transaction().execute(async (trx) => {
			const park = sql.join(
				orderedAxisIds.map((axisId, i) => sql`when ${axisId} then ${-(i + 1)}`),
				sql` `
			);
			await sql`
				update axes_consumed set priority_index = case axis_id ${park} else priority_index end
				where kit_id = ${kitId} and axis_id in (${sql.join(orderedAxisIds)})
			`.execute(trx);

			const finals = sql.join(
				orderedAxisIds.map((axisId, i) => sql`when ${axisId} then ${(n - i) * 1000}`),
				sql` `
			);
			await sql`
				update axes_consumed set priority_index = case axis_id ${finals} else priority_index end
				where kit_id = ${kitId} and axis_id in (${sql.join(orderedAxisIds)})
			`.execute(trx);
		});
	},

	setAxisArg: async (viewId: string, kitId: string, axisId: string, value: any) => {
		return await db
			.insertInto('axis_args')
			.values({ view_id: viewId, kit_id: kitId, axis_id: axisId, value })
			.onConflict((oc) => oc.columns(['view_id', 'axis_id', 'kit_id']).doUpdateSet({ value }))
			.returningAll()
			.executeTakeFirst();
	},

	clearAxisArg: async (viewId: string, kitId: string, axisId: string) => {
		await db
			.deleteFrom('axis_args')
			.where('view_id', '=', viewId)
			.where('kit_id', '=', kitId)
			.where('axis_id', '=', axisId)
			.execute();
	},

	createLayer: async (kitId: string) => {
		return await db
			.insertInto('layers')
			.values({ kit_id: kitId })
			.returningAll()
			.executeTakeFirst();
	},

	deleteLayer: async (layerId: string) => {
		await db.deleteFrom('layers').where('layers.id', '=', layerId).execute();
	},

	removePropertyFromLayer: async (layerId: string, property: string) => {
		return await db.transaction().execute(async (trx) => {
			// Drop the entry(ies) for this property on the layer's snippet(s).
			const entries = await trx
				.selectFrom('render_entries')
				.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
				.where('render_snippets.layer_id', '=', layerId)
				.where('render_entries.property', '=', property)
				.select('render_entries.id as id')
				.execute();
			if (entries.length > 0) {
				await trx
					.deleteFrom('render_entries')
					.where(
						'id',
						'in',
						entries.map((e) => e.id)
					)
					.execute();
			}

			// GC only conditioned layers -- the null/base layer (0 conditions) stays even when empty.
			const conds = await trx
				.selectFrom('layer_axis_values')
				.select('axis_value_id')
				.where('layer_id', '=', layerId)
				.limit(1)
				.execute();
			if (conds.length === 0) return { layerDeleted: false };

			const remaining = await trx
				.selectFrom('render_entries')
				.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
				.where('render_snippets.layer_id', '=', layerId)
				.select('render_entries.id')
				.limit(1)
				.execute();
			if (remaining.length > 0) return { layerDeleted: false };

			await trx.deleteFrom('layers').where('id', '=', layerId).execute();
			return { layerDeleted: true };
		});
	},

	createLayerWithConditions: async (kitId: string, axisValueIds: string[]) => {
		const target = new Set(axisValueIds);
		return await db.transaction().execute(async (trx) => {
			// Existing layers of this kit + their condition sets, to reuse an exact match.
			const layers = await trx
				.selectFrom('layers')
				.select('id')
				.where('kit_id', '=', kitId)
				.execute();
			const conds = await trx
				.selectFrom('layer_axis_values')
				.select(['layer_id', 'axis_value_id'])
				.where(
					'layer_id',
					'in',
					layers.map((l) => l.id)
				)
				.execute();
			const byLayer = new Map<string, Set<string>>();
			for (const l of layers) byLayer.set(l.id, new Set());
			for (const c of conds) byLayer.get(c.layer_id)?.add(c.axis_value_id);

			let layerId: string | undefined;
			let created = false;
			for (const [id, set] of byLayer) {
				if (set.size === target.size && [...target].every((v) => set.has(v))) {
					layerId = id;
					break;
				}
			}

			if (!layerId) {
				const layer = await trx
					.insertInto('layers')
					.values({ kit_id: kitId })
					.returningAll()
					.executeTakeFirst();
				if (!layer) return undefined;
				layerId = layer.id;
				created = true;
				if (axisValueIds.length > 0) {
					await trx
						.insertInto('layer_axis_values')
						.values(axisValueIds.map((axis_value_id) => ({ layer_id: layerId!, axis_value_id })))
						.execute();
				}
			}

			// The write host-fn needs a snippet to exist; ensure one whether reused or fresh.
			const snippet = await trx
				.selectFrom('render_snippets')
				.select('id')
				.where('layer_id', '=', layerId)
				.executeTakeFirst();
			if (!snippet) {
				await trx.insertInto('render_snippets').values({ layer_id: layerId }).execute();
			}

			return { layerId, created };
		});
	},

	setLayerChildren: async (layerId: string, viewIds: string[]) => {
		await db.transaction().execute(async (trx) => {
			let snippet = await trx
				.selectFrom('render_snippets')
				.where('render_snippets.layer_id', '=', layerId)
				.select('render_snippets.id')
				.orderBy('render_snippets.last_modified', 'asc')
				.executeTakeFirst();

			if (!snippet) {
				snippet = await trx
					.insertInto('render_snippets')
					.values({ layer_id: layerId })
					.returning('id')
					.executeTakeFirst();
			}

			if (!snippet) return;

			const existing = await trx
				.selectFrom('render_entries')
				.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
				.where('render_snippets.layer_id', '=', layerId)
				.where('render_entries.property', '=', 'children')
				.select('render_entries.id')
				.executeTakeFirst();

			const value = JSON.stringify(viewIds);

			if (existing) {
				await trx
					.updateTable('render_entries')
					.set({ value } as any)
					.where('render_entries.id', '=', existing.id)
					.execute();
			} else {
				await trx
					.insertInto('render_entries')
					.values({ snippet_id: snippet.id, property: 'children', value, token_id: null } as any)
					.execute();
			}
		});
	},

	clearLayerChildren: async (layerId: string) => {
		const snippets = await db
			.selectFrom('render_snippets')
			.where('render_snippets.layer_id', '=', layerId)
			.select('render_snippets.id')
			.execute();

		if (snippets.length === 0) return;

		await db
			.deleteFrom('render_entries')
			.where('render_entries.property', '=', 'children')
			.where(
				'render_entries.snippet_id',
				'in',
				snippets.map((s) => s.id)
			)
			.execute();
	},

	addAxisValueToLayer: async (layerId: string, axisValueId: string) => {
		await db
			.insertInto('layer_axis_values')
			.values({ layer_id: layerId, axis_value_id: axisValueId })
			.onConflict((oc) => oc.columns(['layer_id', 'axis_value_id']).doNothing())
			.execute();
	},

	removeAxisValueFromLayer: async (layerId: string, axisValueId: string) => {
		await db
			.deleteFrom('layer_axis_values')
			.where('layer_axis_values.layer_id', '=', layerId)
			.where('layer_axis_values.axis_value_id', '=', axisValueId)
			.execute();
	},

	createRenderSnippet: async (layerId: string) => {
		return await db
			.insertInto('render_snippets')
			.values({ layer_id: layerId })
			.returningAll()
			.executeTakeFirst();
	},

	deleteRenderSnippet: async (snippetId: string) => {
		await db.deleteFrom('render_snippets').where('render_snippets.id', '=', snippetId).execute();
	},

	createRenderEntry: async (
		snippetId: string,
		property: string,
		value?: string | null,
		tokenId?: string | null
	) => {
		return await db
			.insertInto('render_entries')
			.values({
				snippet_id: snippetId,
				property,
				value: value ?? null,
				token_id: tokenId ?? null
			} as any)
			.returning(['id', 'snippet_id', 'property', 'value', 'token_id'])
			.executeTakeFirst();
	},

	updateRenderEntryValue: async (
		entryId: string,
		property: string,
		value?: string | null,
		tokenId?: string | null
	) => {
		await db
			.updateTable('render_entries')
			.set({ property, value: value ?? null, token_id: tokenId ?? null } as any)
			.where('render_entries.id', '=', entryId)
			.execute();
	},

	deleteRenderEntry: async (entryId: string) => {
		await db.deleteFrom('render_entries').where('render_entries.id', '=', entryId).execute();
	},

	getAllWorkspaces: () => {
		return db
			.selectFrom('workspaces')
			.select((eb) => [
				eb
					.selectFrom('projects')
					.select(eb.fn.count('id').as('project_count'))
					.whereRef('projects.workspace_id', '=', 'workspaces.id')
					.as('projectCount')
			])
			.select([
				'workspaces.id as workspaceId',
				'workspaces.name as workspaceName',
				'workspaces.description as workspaceDescription',
				'last_active as lastActive'
			])
			.orderBy('last_active', 'desc');
	},

	getAllProjects: () => {
		return db
			.selectFrom('workspaces')
			.innerJoin('projects', 'projects.workspace_id', 'workspaces.id')
			.select([
				'workspaces.name as workspaceName',
				'projects.name as projectName',
				'projects.description as projectDescription',
				'projects.id as projectId',
				'projects.author',
				'projects.license'
			])
			.orderBy('last_active', 'desc');
	},

	getProjectsByWorkspaceId: (workspaceId: string | null) => {
		if (!workspaceId)
			return db
				.selectFrom('projects')
				.where('projects.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'projects.id as projectId',
					'projects.name as projectName',
					'projects.description as projectDescription',
					'projects.author',
					'projects.license',
					'projects.hints'
				]);
		return db
			.selectFrom('projects')
			.where('workspace_id', '=', workspaceId)
			.orderBy('last_modified', 'desc')
			.select([
				'projects.name as projectName',
				'projects.description as projectDescription',
				'projects.id as projectId',
				'projects.author',
				'projects.license',
				'projects.hints'
			]);
	},

	getViewsByProjectId: (projectId: string | null) => {
		if (!projectId)
			return db
				.selectFrom('views')
				.where('views.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'views.id as viewId',
					'views.name as viewName',
					'views.lock as viewLocked',
					'views.hide as viewHidden',
					'views.hints as hints'
				]);
		return db
			.selectFrom('views')
			.where('views.project_id', '=', projectId)
			.orderBy('views.last_modified', 'desc')
			.select([
				'views.id as viewId',
				'views.name as viewName',
				'views.lock as viewLocked',
				'views.hide as viewHidden',
				'views.hints as hints'
			]);
	},

	getKitCompositionByViewId: (viewId: string | null) => {
		if (!viewId)
			return db
				.selectFrom('compositions')
				.where('compositions.view_id', '=', '00000000-0000-0000-0000-000000000000')
				.innerJoin('kits', 'kits.id', 'compositions.kit_id')
				.select([
					'kits.id as kitId',
					'kits.name as kitName',
					'compositions.view_id as kitView',
					'compositions.priority_index as kitIndex'
				]);
		return db
			.selectFrom('compositions')
			.innerJoin('kits', 'kits.id', 'compositions.kit_id')
			.where('compositions.view_id', '=', viewId)
			.orderBy('compositions.priority_index', 'desc')
			.select([
				'kits.id as kitId',
				'kits.name as kitName',
				'compositions.view_id as kitView',
				'compositions.priority_index as kitIndex'
			]);
	},

	getKitsExceptFromViewId: (viewId: string | null) => {
		if (!viewId)
			return db
				.selectFrom('kits')
				.where('kits.id', '=', '00000000-0000-0000-0000-000000000000')
				.select(['kits.id as kitId', 'kits.name as kitName']);
		// Unused kits = kits in the view's own project that are NOT already composed into this view.
		// The old leftJoin + `view_id != viewId` was wrong three ways: it fanned out to one row per
		// composition (duplicates in the menu), dropped kits composed nowhere (NULL join row fails
		// `!=`), and still listed a kit that's in THIS view if it was also in another. Subqueries
		// keep it one row per kit with no join fan-out.
		return db
			.selectFrom('kits')
			.where(
				'kits.project_id',
				'=',
				db.selectFrom('views').select('views.project_id').where('views.id', '=', viewId)
			)
			.where(
				'kits.id',
				'not in',
				db
					.selectFrom('compositions')
					.select('compositions.kit_id')
					.where('compositions.view_id', '=', viewId)
			)
			.orderBy('kits.last_modified', 'desc')
			.select(['kits.id as kitId', 'kits.name as kitName']);
	},

	getKitsByProjectId: (projectId: string) => {
		return db
			.selectFrom('kits')
			.where('kits.project_id', '=', projectId)
			.orderBy('kits.last_modified', 'desc')
			.select(['kits.id as kitId', 'kits.name as kitName']);
	},

	getAssetsByProjectId: (projectId: string | null) => {
		if (!projectId)
			return db
				.selectFrom('assets')
				.where('assets.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'assets.id as assetId',
					'assets.name as assetName',
					'assets.mime_type as assetMimeType',
					'assets.checksum as assetChecksum',
					'assets.link as assetLink',
					'assets.width as assetWidth',
					'assets.height as assetHeight',
					'assets.created_at as assetCreatedAt'
				]);
		return db
			.selectFrom('assets')
			.where('assets.project_id', '=', projectId)
			.orderBy('assets.created_at', 'desc')
			.select([
				'assets.id as assetId',
				'assets.name as assetName',
				'assets.mime_type as assetMimeType',
				'assets.checksum as assetChecksum',
				'assets.link as assetLink',
				'assets.width as assetWidth',
				'assets.height as assetHeight',
				'assets.created_at as assetCreatedAt'
			]);
	},

	getTokensByProjectId: (projectId: string | null) => {
		if (!projectId)
			return db
				.selectFrom('tokens')
				.where('tokens.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'tokens.id as tokenId',
					'tokens.alias as tokenAlias',
					'tokens.value as tokenValue',
					'tokens.kit_id as tokenKitId',
					'tokens.view_id as tokenViewId'
				]);
		return db
			.selectFrom('tokens')
			.where('tokens.project_id', '=', projectId)
			.where('tokens.kit_id', 'is', null)
			.where('tokens.view_id', 'is', null)
			.orderBy('tokens.alias')
			.select([
				'tokens.id as tokenId',
				'tokens.alias as tokenAlias',
				'tokens.value as tokenValue',
				'tokens.kit_id as tokenKitId',
				'tokens.view_id as tokenViewId'
			]);
	},

	getTokensByKitId: (kitId: string | null) => {
		if (!kitId)
			return db
				.selectFrom('tokens')
				.where('tokens.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'tokens.id as tokenId',
					'tokens.alias as tokenAlias',
					'tokens.value as tokenValue',
					'tokens.kit_id as tokenKitId',
					'tokens.view_id as tokenViewId'
				]);
		return db
			.selectFrom('tokens')
			.where('tokens.kit_id', '=', kitId)
			.orderBy('tokens.alias')
			.select([
				'tokens.id as tokenId',
				'tokens.alias as tokenAlias',
				'tokens.value as tokenValue',
				'tokens.kit_id as tokenKitId',
				'tokens.view_id as tokenViewId'
			]);
	},

	getTokensByViewId: (viewId: string | null) => {
		if (!viewId)
			return db
				.selectFrom('tokens')
				.where('tokens.id', '=', '00000000-0000-0000-0000-000000000000')
				.select([
					'tokens.id as tokenId',
					'tokens.alias as tokenAlias',
					'tokens.value as tokenValue',
					'tokens.kit_id as tokenKitId',
					'tokens.view_id as tokenViewId'
				]);
		return db
			.selectFrom('tokens')
			.where('tokens.view_id', '=', viewId)
			.orderBy('tokens.alias')
			.select([
				'tokens.id as tokenId',
				'tokens.alias as tokenAlias',
				'tokens.value as tokenValue',
				'tokens.kit_id as tokenKitId',
				'tokens.view_id as tokenViewId'
			]);
	},

	getAxesByProjectId: (projectId: string) => {
		return db
			.selectFrom('axes')
			.where('axes.project_id', '=', projectId)
			.select([
				'axes.id as axisId',
				'axes.name as axisName',
				'axes.description as axisDescription',
				'axes.kind as axisKind',
				'axes.hint as axisHint',
				'axes.default_value as axisDefaultValue'
			]);
	},

	getAxesByKitId: (kitId: string) => {
		return db
			.selectFrom('axes_consumed')
			.innerJoin('axes', 'axes.id', 'axes_consumed.axis_id')
			.where('axes_consumed.kit_id', '=', kitId)
			.orderBy('axes_consumed.priority_index', 'desc')
			.select([
				'axes.id as axisId',
				'axes.name as axisName',
				'axes.description as axisDescription',
				'axes.kind as axisKind',
				'axes.hint as axisHint',
				'axes_consumed.priority_index as priorityIndex'
			]);
	},

	getConsumedAxesByKitId: (kitId: string) => {
		return db
			.selectFrom('axes_consumed')
			.innerJoin('axes', 'axes.id', 'axes_consumed.axis_id')
			.where('axes_consumed.kit_id', '=', kitId)
			.orderBy('axes_consumed.priority_index', 'desc')
			.select([
				'axes.id as axisId',
				'axes.name as axisName',
				'axes.kind as axisKind',
				'axes_consumed.priority_index as priorityIndex'
			]);
	},

	getAxesExceptFromKitId: (kitId: string | null) => {
		if (!kitId)
			return db
				.selectFrom('axes')
				.where('axes.id', '=', '00000000-0000-0000-0000-000000000000')
				.select(['axes.id as axisId', 'axes.name as axisName']);
		// Unused axes = axes in the kit's own project not already consumed by this kit. Subqueries
		// (no join) so it stays one row per axis -- same shape/rationale as getKitsExceptFromViewId.
		return db
			.selectFrom('axes')
			.where(
				'axes.project_id',
				'=',
				db.selectFrom('kits').select('kits.project_id').where('kits.id', '=', kitId)
			)
			.where(
				'axes.id',
				'not in',
				db
					.selectFrom('axes_consumed')
					.select('axes_consumed.axis_id')
					.where('axes_consumed.kit_id', '=', kitId)
			)
			.orderBy('axes.name', 'asc')
			.select(['axes.id as axisId', 'axes.name as axisName']);
	},

	getAxisIdsUsedByOtherKits: (kitId: string | null) => {
		if (!kitId)
			return db
				.selectFrom('axes_consumed')
				.where('axes_consumed.kit_id', '=', '00000000-0000-0000-0000-000000000000')
				.select('axes_consumed.axis_id as axisId');
		return db
			.selectFrom('axes_consumed')
			.where('axes_consumed.kit_id', '!=', kitId)
			.select('axes_consumed.axis_id as axisId')
			.distinct();
	},

	getAllAxisArgs: (viewId: string, kitId: string) => {
		return db
			.selectFrom('axis_args')
			.where('axis_args.view_id', '=', viewId)
			.where('axis_args.kit_id', '=', kitId)
			.select([
				'axis_args.axis_id as axisId',
				'axis_args.kit_id as kitId',
				'axis_args.view_id as viewId',
				'axis_args.value'
			]);
	},

	getLayersByKitId: (kitId: string) => {
		return db
			.selectFrom('layers')
			.where('layers.kit_id', '=', kitId)
			.orderBy('layers.last_modified', 'desc')
			.select([
				'layers.id as layerId',
				'layers.kit_id as kitId',
				'layers.last_modified as lastModified'
			]);
	},

	getNullLayerId: async (kitId: string) => {
		const layers = await db
			.selectFrom('layers')
			.where('layers.kit_id', '=', kitId)
			.select(['layers.id'])
			.execute();
		if (layers.length === 0) return undefined;

		const conditioned = await db
			.selectFrom('layer_axis_values')
			.where(
				'layer_axis_values.layer_id',
				'in',
				layers.map((l) => l.id)
			)
			.select(['layer_axis_values.layer_id'])
			.distinct()
			.execute();
		const conditionedIds = new Set(conditioned.map((c) => c.layer_id));

		return layers.find((l) => !conditionedIds.has(l.id))?.id;
	},

	getRenderSnippetsByLayerId: (layerId: string) => {
		return db
			.selectFrom('render_snippets')
			.where('render_snippets.layer_id', '=', layerId)
			.orderBy('render_snippets.last_modified', 'desc')
			.select([
				'render_snippets.id as snippetId',
				'render_snippets.layer_id as layerId',
				'render_snippets.last_modified as lastModified'
			]);
	},

	getRenderEntriesBySnippetId: (snippetId: string) => {
		return db
			.selectFrom('render_entries')
			.where('render_entries.snippet_id', '=', snippetId)
			.select([
				'render_entries.id as entryId',
				'render_entries.snippet_id as snippetId',
				'render_entries.property',
				'render_entries.value',
				'render_entries.token_id as tokenId'
			]);
	},

	getRenderEntriesByLayerId: (layerId: string) => {
		return db
			.selectFrom('render_entries')
			.innerJoin('render_snippets', 'render_snippets.id', 'render_entries.snippet_id')
			.where('render_snippets.layer_id', '=', layerId)
			.select([
				'render_entries.id as entryId',
				'render_entries.snippet_id as snippetId',
				'render_entries.property',
				'render_entries.value',
				'render_entries.token_id as tokenId'
			]);
	},

	registerPlugin: async (input) => {
		return await db
			.insertInto('plugins')
			.values({
				name: input.name,
				kind: input.kind,
				activation: input.activation ?? null,
				manifest: input.manifest as any,
				options: (input.options ?? null) as any,
				content_hash: input.contentHash ?? null
			})
			.onConflict((oc) =>
				oc.column('name').doUpdateSet({
					kind: input.kind,
					activation: input.activation ?? null,
					manifest: input.manifest as any,
					options: (input.options ?? null) as any,
					content_hash: input.contentHash ?? null
				})
			)
			.returningAll()
			.executeTakeFirst();
	},

	getProjectInterpreter: async (projectId: string) => {
		const row = await db
			.selectFrom('projects')
			.innerJoin('plugins', 'plugins.id', 'projects.interpreter_plugin_id')
			.select([
				'plugins.id as id',
				'plugins.name as name',
				'plugins.kind as kind',
				'plugins.activation as activation',
				'plugins.manifest as manifest',
				'plugins.options as options',
				'plugins.content_hash as content_hash'
			])
			.where('projects.id', '=', projectId)
			.executeTakeFirst();

		return row ?? null;
	},

	setProjectInterpreter: async (projectId: string, pluginId: string) => {
		await db
			.updateTable('projects')
			.set({ interpreter_plugin_id: pluginId })
			.where('projects.id', '=', projectId)
			.execute();
	},

	listPlugins: async () => {
		return await db.selectFrom('plugins').selectAll().execute();
	},

	upsertAsset: async (input) => {
		const existing = await db
			.selectFrom('assets')
			.where('assets.project_id', '=', input.projectId)
			.where('assets.checksum', '=', input.checksum)
			.selectAll()
			.executeTakeFirst();
		if (existing) return existing;

		return await db
			.insertInto('assets')
			.values({
				project_id: input.projectId,
				name: input.name,
				mime_type: input.mimeType,
				checksum: input.checksum,
				link: input.link,
				width: input.width,
				height: input.height
			})
			.returningAll()
			.executeTakeFirstOrThrow();
	},

	deleteAsset: async (assetId: string) => {
		await db.deleteFrom('assets').where('assets.id', '=', assetId).execute();
	}
});

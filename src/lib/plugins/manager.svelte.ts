import createPlugin, {
	type ExtismPluginOptions,
	type ManifestLike,
	type Plugin
} from '@extism/extism';
import type { Api, ResolvedKit, OverriddenOccurrence } from 'manager';
import type {
	FamilyFacts,
	FieldCategory,
	FieldUpdate,
	FontRequest,
	LoadedPlugin,
	OnResolveResult,
	PanelManifest,
	PluginContext,
	ResolvedView,
	UiNode,
	WriteRenderEntryInput,
	WriteRenderEntryResult
} from './types.js';
import { mark, measure } from '../editor/profile.js';
import { getCachedFont, putCachedFont } from './font-cache.js';
import { buildInterpreterOutputPayload } from './interpreter-output.js';
import { get } from 'svelte/store';
import {
	type CollectedPreference,
	parsePreferenceDefsExport,
	pluginPreferenceValues
} from './preferences.js';

function serializeResolvedKits(kits: ResolvedKit[] | null) {
	if (!kits) return null;
	return kits.map((k) => ({
		kitId: k.kitId,
		kitName: k.kitName,
		// Each property carries its own `viewRefs` (view refs from one or more `view`-typed
		// tokens). There's no kit-level child list anymore -- a consumer that treats some property
		// as nested composition (Charter's `children`) reads that property's viewRefs itself.
		//
		// Sent as-is: `{viewId, tokenId}[]` per property, matching Charter's Rust `ResolvedProperty
		// .view_refs: Option<Vec<ViewRef>>` (plugins/charter/src/lib.rs) -- `tokenId` is what makes
		// Charter's rendering/selection occurrence-aware (two different tokens referencing the
		// same view are two independent rendered instances). Do not flatten this back down to
		// plain view-id strings; that was a temporary posture before Charter's struct grew a
		// `token_id` per ref.
		properties: Object.fromEntries(k.properties)
	}));
}

function serializeResolvedViews(views: ResolvedView[] | null) {
	if (!views) return null;
	return views.map((v) => ({
		viewId: v.viewId,
		viewName: v.viewName,
		hints: v.hints ?? {},
		resolvedKits: serializeResolvedKits(v.resolvedKits) ?? []
	}));
}

// One entry per `view`-typed token reference whose axis override changed its own resolution --
// see resolve.ts's OverriddenOccurrence / Charter's matching Rust struct. Additive: empty for the
// common (no overrides anywhere) case.
function serializeOverriddenOccurrences(occurrences: OverriddenOccurrence[]) {
	return occurrences.map((o) => ({
		occurrenceKey: o.occurrenceKey,
		viewId: o.viewId,
		resolvedKits: serializeResolvedKits(o.resolvedKits) ?? []
	}));
}

function base64ToBytes(b64: string): Uint8Array {
	const binaryStr = atob(b64);
	const bytes = new Uint8Array(binaryStr.length);
	for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
	return bytes;
}

// A stored asset `link` may be a plain relative static path (manager/src/seed.ts's
// registerBundledAsset, e.g. "/1x/favicon.png") or a future cloud-hosted absolute URL. The
// in-editor asset-reload scan (Editor.svelte's fetch(asset.link)) works fine with either as-is --
// it's always same-origin. WebCodium's export is different: the exported HTML is a standalone
// file that may be opened from anywhere, so a relative path would only ever resolve back to
// wherever the file happens to be opened from, not this app's own deployment. Resolving against
// `window.location.origin` at the moment of EXPORT (not baked in at seed time, which would freeze
// in whatever origin was active the one time a project was first seeded) is exactly the correct
// domain to embed -- the user is exporting assets that live on THIS deployment. `new URL(url,
// base)` ignores `base` when `url` is already absolute, per the URL spec, so this is a safe no-op
// for a future cloud-hosted link -- no branching needed to detect "already absolute."
export function resolveAbsoluteAssetLink(link: string): string {
	return new URL(link, window.location.origin).href;
}

export function createPluginManager(api: Api) {
	let plugins = $state<LoadedPlugin[]>([]);
	let fieldCategories = $state<FieldCategory[]>([]);
	// Panel manifests published by plugins via `kit10_panel_publish`. Replaces the old
	// `compositionFieldKeys` / `viewIcons` flat state (Charter now bundles topology + icon +
	// write-alias into one PanelManifest per panel-id, so the editor's panel can render purely
	// off this map instead of re-deriving topology client-side). Keyed by panel_id ("views"
	// today; additive for future plugin-driven panels - see AGENTS.md's panel-manifest section).
	let panelManifests = $state<Map<string, PanelManifest>>(new Map());
	let viewportData = $state<string>('[]');
	// MessagePack-binary path: when Charter emits viewport_data_binary, this is the
	// base64-decoded bytes ready for vellum.set_data_binary(). Avoids the 47ms JSON
	// parse wall on Vellum's side by skipping serde_json entirely.
	let viewportDataBinary = $state<Uint8Array | null>(null);
	// Parallel to viewportData (same length/order) -- see OnResolveResult.node_view_ids.
	let nodeViewIds = $state<string[]>([]);
	// Parallel to viewportData/nodeViewIds (same length/order) -- see OnResolveResult.node_kit_ids.
	let nodeKitIds = $state<string[]>([]);
	// Parallel to viewportData/nodeViewIds (same length/order) -- this node's OCCURRENCE key (the
	// referencing token's own id for a nested child, or the view's own id for a root -- see
	// view-tree.ts's ViewOccurrence / OnResolveResult.node_occurrence_ids). Lets the editor
	// disambiguate a click/hover/selection to the specific rendered instance, not just the view.
	let nodeOccurrenceIds = $state<string[]>([]);
	// The concrete (family, weight, style) set the current viewport renders, post Charter
	// weight-snapping. Editor.svelte's font scan fetches exactly these -- never re-deriving
	// weights from raw kit properties (single decision point: Charter's resolve_font_weight).
	let fontRequests = $state<FontRequest[]>([]);
	let context: PluginContext = { resolvedKits: null };

	let activePlugin: Plugin | null = null;
	// Name of the active interpreter plugin (Charter). Tracked so collectPreferences can attribute
	// the interpreter's declared preferences and tell it apart from the utility plugins.
	let activePluginName: string | null = null;

	// Utility plugins (e.g. Fontavious) never join the viewport/resolve lifecycle above --
	// they're called on demand, by name, whenever something needs them. Kept as a separate
	// map so loading one can never evict `activePlugin` the way a second loadPlugin call would.
	const utilityPlugins = new Map<string, Plugin>();
	// Per-plugin serial chain -- Extism plugin instances are not re-entrant (same reason
	// `pluginQueue` exists below for the viewport-interpreter plugin). Without this, e.g.
	// search-as-you-type firing one callUtilityPlugin per keystroke sends overlapping calls
	// into the same plugin instance, which corrupts its state after a few calls and makes it
	// stop responding. Keyed per plugin name so multiple utility plugins don't serialize
	// against each other, only against their own prior calls.
	const utilityQueues = new Map<string, Promise<unknown>>();

	// Latest state - always reflects the most recent setter call
	let _kits: ResolvedKit[] | null = null;
	let _hints: Record<string, unknown> | null = null;
	let _viewId: string | null = null;
	let _projectViews: ResolvedView[] = [];
	let _overriddenOccurrences: OverriddenOccurrence[] = [];
	// Occurrence keys (not view ids) -- see EditorSelection.selectedOccurrencePrimary/Secondary.
	let _selPrimary: string | null = null;
	let _selSecondary: (string | null)[] = [];
	let _hoveredOccurrenceKey: string | null = null;
	let _fontFacts: Record<string, FamilyFacts> = {};

	// Debounce timers
	let dataTimer: ReturnType<typeof setTimeout> | null = null;
	let selectionTimer: ReturnType<typeof setTimeout> | null = null;

	// Incremented on every setData call. Any runSelectionChange captured before
	// the increment was enqueued while data was stale - skip it.
	let selectionGen = 0;

	// True from beginPendingResolve() until the next runResolve actually completes. Guards a
	// DIFFERENT staleness window than selectionGen: a caller can know synchronously that a
	// resolve-triggering write is about to happen (e.g. persisting a dragged view's new
	// position) well before that write's own resolve reaches pluginQueue -- the write has to
	// round-trip through the DB + a live query + fetchResolutionRows first, while a hover-
	// triggered on_selection_change only needs one 0ms timer to reach the same queue. Since
	// pluginQueue is FIFO, the selection-change call is therefore reliably enqueued AND EXECUTED
	// (its pre-await selectionGen check passes -- nothing has bumped selectionGen yet) before the
	// resolve even arrives, applying a result built from last_resolve_input that still predates
	// the write. Bumping selectionGen at that point doesn't help (nothing later invalidates a
	// call that already ran to completion); resolvePending blocks it outright, regardless of
	// timing, until an actual resolve has landed.
	let resolvePending = false;

	// Serial queue - all plugin calls are chained so they never run concurrently
	let pluginQueue: Promise<void> = Promise.resolve();

	function enqueue(fn: () => Promise<void>): void {
		pluginQueue = pluginQueue.then(() =>
			fn().catch((err) => {
				console.error('[plugin] call failed:', err);
			})
		);
	}

	// Per-plugin KV maps, hoisted out of makeHostFunctions' closure so the host can seed a plugin's
	// stored preference values into its KV before a call (see seedPluginPreferences). Keyed by
	// plugin name; each plugin's kit10_kv_get/set read+write its own map.
	const kvStores = new Map<string, Map<string, string>>();
	function kvStoreFor(pluginName: string): Map<string, string> {
		let store = kvStores.get(pluginName);
		if (!store) {
			store = new Map<string, string>();
			kvStores.set(pluginName, store);
		}
		return store;
	}

	// Copies a plugin's persisted preference values (stored host-side as `<plugin>:<id>`) into its KV
	// as `pref:<id>`, so the plugin can read its own preferences via kit10_kv_get without the host
	// changing any function signature. This is the generic "host owns storage, feeds values back"
	// half of the plugin-preferences contract (see preferences.ts / PLUGINS.md).
	function seedPluginPreferences(pluginName: string): void {
		const store = kvStoreFor(pluginName);
		const prefix = `${pluginName}:`;
		for (const [key, value] of Object.entries(get(pluginPreferenceValues))) {
			if (key.startsWith(prefix)) store.set(`pref:${key.slice(prefix.length)}`, value);
		}
	}

	// `grantedHostFns`, when provided (a plugin's manifest declared `capabilities.hostFns`),
	// restricts the returned function set to exactly that list -- everything else silently
	// isn't present in `functions`, so a call to an undeclared kit10_* fn fails the same way a
	// call to a nonexistent one always has (Extism's own "function not found"), no separate
	// permission-denied path needed. `undefined` (a plugin with no `capabilities` declared at
	// all) keeps the full set -- additive rollout, same posture as `provides` (see schema.ts's
	// PluginCapabilities doc comment): this is a declaration+filter today, not yet an
	// install-time grant UI (resources/plugin-store-research.md §5.2/§5.5).
	function makeHostFunctions(pluginName: string, grantedHostFns?: string[]) {
		const localKV = kvStoreFor(pluginName);

		const allFunctions = {
				kit10_log(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { level, message }: { level: string; message: string } = JSON.parse(rawJson);

					const colors: Record<string, string> = {
						debug: 'color: oklch(55.1% 0.0234 264.4);',
						info: 'color: oklch(62.3% 0.188 259.8);',
						warn: 'color: oklch(76.9% 0.1647 70.1);',
						error: 'color: oklch(63.7% 0.2078 25.3);'
					};

					const color = colors[level] ?? colors.info;
					const now = new Date();
					const timestamp = `${now.getHours()}:${now.getMinutes()}:${now.getSeconds()}.${now.getMilliseconds()}`;

					console.log(
						`%c[${level.toUpperCase().padEnd(5)} ${pluginName}]%c ${timestamp} -> ${message}`,
						`${color}; font-weight: bold;`,
						'color:inherit'
					);
				},

				kit10_kv_get(cp: any, keyOffs: bigint) {
					const key = cp.read(keyOffs).text();
					const value = localKV.get(key) || '';
					return cp.store(value);
				},

				kit10_kv_set(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { key, value } = JSON.parse(rawJson);
					localKV.set(key, value);
					return cp.store(JSON.stringify(true));
				},

				// Persistent font-byte cache (IndexedDB). A plugin (Fontavious's fetch_font) checks
				// this before hitting a vendor CDN, and stores after a miss, so reloads are
				// network-free/offline. Safe for all tiers -- a private per-user cache, same as the
				// browser's HTTP cache (see font-cache.ts + resources/nature-of-fonts.md §7).
				// GET: url in -> bytes out (empty Uint8Array on miss).
				async kit10_font_cache_get(cp: any, urlOffs: bigint) {
					const url = cp.read(urlOffs).text();
					const bytes = await getCachedFont(url);
					return cp.store(bytes ?? new Uint8Array(0));
				},

				// PUT: (metaJson, bytes) -> void. metaJson carries url + licenseTier + family etc.
				// (the licenseTier is stored for a future export-only-OFL guard, §7.3). Bytes are
				// the raw WOFF2 the plugin just fetched.
				async kit10_font_cache_put(cp: any, metaOffs: bigint, bytesOffs: bigint) {
					try {
						const meta = JSON.parse(cp.read(metaOffs).text());
						const bytes = cp.read(bytesOffs).bytes();
						await putCachedFont(meta, bytes);
					} catch {
						/* best-effort: a cache-write fault must never break font fetching */
					}
				},

				kit10_get_resolution(cp: any, _inputOffs: bigint) {
					const data = serializeResolvedKits(context.resolvedKits);
					return cp.store(JSON.stringify(data));
				},

				// Public access to the active interpreter's last resolved output (post-translation --
				// viewport data/categories/font requests, not just resolved kit properties like
				// kit10_get_resolution above). Any plugin can request this via capabilities.hostFns;
				// this is the concrete channel PluginManifest.supports was built toward (e.g. a future
				// WebCodium declaring `supports: ['charter']` documents intent, this host fn is what
				// actually lets it read Charter's output).
				kit10_get_interpreter_output(cp: any, _inputOffs: bigint) {
					return cp.store(
						JSON.stringify(
							buildInterpreterOutputPayload(
								viewportData,
								nodeViewIds,
								nodeKitIds,
								nodeOccurrenceIds,
								fieldCategories,
								fontRequests
							)
						)
					);
				},

				// Exposes Manager's exportProject (a full project data dump -- views, kits, axes,
				// layers, render entries, tokens, etc.) to any plugin that wants it, rather than the
				// host pre-marshaling it into a call's input. Lets multiple export-target plugins
				// (Tenner today, others later) all pull the same data on demand without the host
				// needing a per-plugin-shaped payload.
				// Unresolved, axis-args-independent per-Kit export shape (every layer's full
				// condition set/entries + axis metadata), for WebCodium's Kit-basis export -- see
				// manager's resolve/export-shape.ts. Distinct from kit10_get_resolution, which only
				// ever exposes the winner-only, current-view-scoped resolved properties.
				async kit10_get_kit_export_shape(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { kit_ids } = JSON.parse(rawJson) as { kit_ids: string[] };

					try {
						const shapes = await api.getKitExportShapes(kit_ids);
						return cp.store(
							JSON.stringify({ success: true, kits: Object.fromEntries(shapes) })
						);
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				// Per-VIEW-INSTANCE axis args (which axis value a given view actually resolved to per
				// composed kit), a different question from kit10_get_kit_export_shape's per-Kit CSS
				// rules -- WebCodium needs both to know which of a Kit's variant rules a given exported
				// element should actually carry as classes (see plugins/webcodium/src/variants.rs's
				// rule_matches_args).
				async kit10_get_view_axis_args(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { view_ids } = JSON.parse(rawJson) as { view_ids: string[] };

					try {
						const rows = await api.getViewAxisArgs(view_ids);
						const outRows: { view_id: string; kit_id: string; axis_id: string; value: string }[] =
							[];
						for (const r of rows) {
							// Drops 'range' (existing, deliberate) and now also 'linked' (post drag-to-lock
							// axis feature) the same way -- a LOCKED axis has an effective, currently-
							// resolved value that this filter silently treats as if it doesn't exist,
							// exporting the default/unconditioned variant instead. Safe (no panic, same
							// degrade-gracefully posture already documented for 'range'), but it IS a real
							// static-export correctness gap specifically for locked axes -- resolving
							// 'linked' before this filter (host-fn or Rust side) is real, separable
							// follow-up work, not done here.
							if (r.value.type !== 'literal') continue;
							outRows.push({
								view_id: r.viewId,
								kit_id: r.kitId,
								axis_id: r.axisId,
								value: r.value.value
							});
						}
						return cp.store(JSON.stringify({ success: true, rows: outRows }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				// Resolves a batch of Img `src` asset ids to their `link` (a real URL, e.g. a static
				// path or a future cloud-hosted link) for WebCodium's Img export support -- a plugin
				// otherwise has no way to turn an opaque asset id (ImageSource::Ref) into something
				// usable outside the app. Assets with no link (bytes-only, uploaded and never given
				// one) are simply absent from the response map; the plugin treats a missing entry
				// the same as "no known URL for this image" and skips it.
				// Full, ordered composition list per requested view id -- {view_id, kit_id,
				// priority_index}[], ascending priority_index (lowest first, matching resolve.ts's own
				// composition-order convention). Charter's node_kit_ids collapses to a single "winning"
				// kit per node, so this is the only way WebCodium learns a view composes more than one
				// kit at all, and in what order -- backs multi-kit class emission and cross-kit
				// contested-property disambiguation.
				async kit10_get_view_compositions(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { view_ids } = JSON.parse(rawJson) as { view_ids: string[] };

					try {
						const rows = await api.getViewCompositions(view_ids);
						const outRows = rows.map((r) => ({
							view_id: r.viewId,
							kit_id: r.kitId,
							priority_index: r.priorityIndex
						}));
						return cp.store(JSON.stringify({ success: true, rows: outRows }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				async kit10_get_asset_links(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { asset_ids } = JSON.parse(rawJson) as { asset_ids: string[] };

					try {
						const assets = await api.getAssetsByIds(asset_ids);
						const links: Record<string, string> = {};
						for (const asset of assets) {
							if (asset.link) links[asset.id] = resolveAbsoluteAssetLink(asset.link);
						}
						return cp.store(JSON.stringify({ success: true, links }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				// Resolves a batch of (family, weight, style) font requests to the real URL Fontavious
				// would fetch for each -- the same no-hardcoded-provider mechanism as
				// kit10_get_asset_links, just routed through Fontavious's own catalogue instead of the
				// assets table. Calls the SAME `variant_url` export the editor's own font-fetch scan
				// already uses (Editor.svelte's loadVariant), so a WebCodium export can never disagree
				// with what the live editor would actually load for a given (family, weight, style).
				// callUtilityPlugin('fontavious', ...) queues on its OWN per-plugin-name chain
				// (utilityQueues), never `pluginQueue` or webcodium's own utility queue entry, so
				// calling it from inside a host fn that's itself running as part of webcodium's
				// export_html_css call cannot deadlock. Best-effort per request: a catalogue miss or
				// plugin-load failure just omits that one entry from `links`, never fails the batch.
				async kit10_get_font_links(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { requests } = JSON.parse(rawJson) as {
						requests: { family: string; weight: number; style: string }[];
					};

					const links: { family: string; weight: number; style: string; url: string }[] = [];
					for (const req of requests) {
						try {
							const result = await callUtilityPlugin(
								'fontavious',
								'variant_url',
								JSON.stringify({ value: req.family, weight: req.weight, style: req.style })
							);
							const { url } = JSON.parse((result as { text(): string }).text()) as {
								url: string;
							};
							if (url) links.push({ ...req, url });
						} catch {
							// best-effort -- a catalogue miss or uncatalogued family just omits this
							// one (family, weight, style) from the response, same tolerance as the
							// editor's own font-fetch scan.
						}
					}
					return cp.store(JSON.stringify({ success: true, links }));
				},

				// Resolves the exporting project's own PROJECT-scope tokens (kit_id AND view_id both
				// null -- api.getTokensByProjectId already filters to exactly this scope) to their
				// alias/resolved-value/format, for WebCodium's `:root` CSS custom-property export
				// (variants::render_root_variables + var(--alias) substitution at usage sites). Only
				// scalar tokens carry a CSS-representable value -- a `view`-typed token has no CSS
				// meaning and is silently excluded, same posture as "no known URL" for an unresolved
				// asset link. Keyed by token id (not alias) so the Rust side can look an entry's own
				// tokenId straight up without a second alias-based pass.
				async kit10_get_project_tokens(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { project_id } = JSON.parse(rawJson) as { project_id: string };

					try {
						const rows = await api.getTokensByProjectId(project_id).execute();
						const tokens: Record<string, { alias: string; value: string; format?: string }> = {};
						for (const row of rows) {
							const tv = row.tokenValue;
							if (!row.tokenAlias || !tv || tv.type !== 'scalar') continue;
							tokens[row.tokenId] = {
								alias: row.tokenAlias,
								value: tv.value,
								format: tv.format
							};
						}
						return cp.store(JSON.stringify({ success: true, tokens }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				async kit10_get_project_export(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { project_id } = JSON.parse(rawJson) as { project_id: string };

					try {
						const data = await api.exportProject(project_id);
						return cp.store(JSON.stringify({ success: true, data }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				// Inverse of kit10_get_project_export -- wraps Manager's importProjectData, which
				// creates a brand-new project (fresh ids throughout) from an exportProject-shaped
				// payload. The plugin (Tenner) only ever hands this a parsed data blob; all id
				// generation and remapping happens in Manager, never here.
				async kit10_import_project_data(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const { workspace_id, data } = JSON.parse(rawJson) as {
						workspace_id: string;
						data: unknown;
					};

					try {
						const project = await api.importProjectData(workspace_id, data);
						return cp.store(JSON.stringify({ success: true, project }));
					} catch (err) {
						return cp.store(JSON.stringify({ success: false, error: String(err) }));
					}
				},

				async kit10_write_render_entry_to_layer(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const input: WriteRenderEntryInput = JSON.parse(rawJson);

					try {
						const snippets = await api.getRenderSnippetsByLayerId(input.layer_id).execute();

						if (!snippets || snippets.length === 0) {
							const result: WriteRenderEntryResult = {
								success: false,
								error: 'No render snippet found for layer'
							};
							return cp.store(JSON.stringify(result));
						}

						const snippetId = snippets[0]!.snippetId;
						const existing = await api.getRenderEntriesBySnippetId(snippetId).execute();
						const match = existing.find((e: any) => e.property === input.property);

						if (match) {
							await api.updateRenderEntryValue(
								match.entryId,
								input.property,
								input.value ?? null,
								input.token_id ?? null
							);
							const result: WriteRenderEntryResult = {
								success: true,
								entry_id: match.entryId
							};
							return cp.store(JSON.stringify(result));
						} else {
							const created = await api.createRenderEntry(
								snippetId,
								input.property,
								input.value ?? null,
								input.token_id ?? null
							);
							const result: WriteRenderEntryResult = {
								success: true,
								entry_id: created?.id
							};
							return cp.store(JSON.stringify(result));
						}
					} catch (err) {
						const result: WriteRenderEntryResult = {
							success: false,
							error: String(err)
						};
						return cp.store(JSON.stringify(result));
					}
				},

				kit10_set_viewport_data(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					viewportData = rawJson;
					return cp.store(JSON.stringify(true));
				},

				// Plugin publishes a panel manifest. The manifest lands in the `panelManifests` $state
				// map keyed by `panel_id`, so any editor panel that derives off `pluginManager.panelManifest(id)`
				// re-renders the moment a plugin (e.g. Charter, from inside `on_resolve`) writes a new
				// manifest. Decoupled from `OnResolveResult`'s return shape on purpose: see AGENTS.md's
				// panel-manifest section - a future plugin refreshing its own panel doesn't need a full
				// resolve cycle, and `OnResolveResult` stays focused on viewport data + categories.
				kit10_panel_publish(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const input = JSON.parse(rawJson) as { panel_id: string; manifest: PanelManifest };
					panelManifests = new Map(panelManifests).set(input.panel_id, input.manifest);
					return cp.store(JSON.stringify(true));
				}
		};

		const grantedFunctions = grantedHostFns
			? Object.fromEntries(
					Object.entries(allFunctions).filter(([fnName]) => grantedHostFns.includes(fnName))
				)
			: allFunctions;

		return { 'extism:host/user': grantedFunctions };
	}

	async function runResolve(): Promise<void> {
		if (!activePlugin) return;
		mark('resolve:serialize:start');
		const payload = JSON.stringify({
			activeViewId: _viewId,
			resolvedKits: serializeResolvedKits(_kits) ?? [],
			viewHints: _hints ?? {},
			projectViews: serializeResolvedViews(_projectViews) ?? [],
			overriddenOccurrences: serializeOverriddenOccurrences(_overriddenOccurrences),
			selectedOccurrencePrimary: _selPrimary,
			selectedOccurrenceSecondary: _selSecondary.filter((s): s is string => s !== null),
			fontFacts: _fontFacts
		});
		mark('resolve:serialize:end');

		mark('resolve:plugin:start');
		const result = await activePlugin.call('on_resolve', payload);
		mark('resolve:plugin:end');
		// A real resolve has now landed -- last_resolve_input (Charter-side) reflects whatever
		// write beginPendingResolve was guarding against, so the selection-change fast path is
		// safe to trust again.
		resolvePending = false;

		measure('resolve:serialize:start', 'resolve:serialize:end', 'serialize payload');
		measure('resolve:plugin:start', 'resolve:plugin:end', 'plugin.call(on_resolve)');

		if (result) {
			const parsed: OnResolveResult = JSON.parse(result.text());
			fieldCategories = parsed.categories ?? [];
			fontRequests = parsed.font_requests ?? [];
			// Charter's viewport_data is a required field -- always present alongside
			// viewport_data_binary, never replaced by it. The two used to be handled as
			// mutually exclusive (binary preferred, JSON left stale/unset otherwise), which broke
			// kit10_get_interpreter_output for every consumer other than Vellum: any non-empty
			// scene always carries binary too, so the JSON output was effectively never fresh. Keep
			// both in sync independently -- Vellum still gets the binary fast path via
			// viewportDataBinary (see Viewport.svelte's dataBinary ?? data), and any plugin reading
			// viewportData now sees current data instead of "binary-only".
			if (parsed.viewport_data) {
				viewportData = JSON.stringify(parsed.viewport_data);
			}
			viewportDataBinary = parsed.viewport_data_binary
				? base64ToBytes(parsed.viewport_data_binary)
				: null;
			nodeViewIds = parsed.node_view_ids ?? [];
			nodeKitIds = parsed.node_kit_ids ?? [];
			nodeOccurrenceIds = parsed.node_occurrence_ids ?? [];
			// Panel manifests are NOT read here - they're published via the `kit10_panel_publish`
			// host fn, which Charter calls from inside `on_resolve`'s body (see lib.rs). That write
			// lands directly in the `panelManifests` $state map, so this function's `$state` writes
			// and the host fn's writes both happen before any panel subtends. Decoupled on
			// purpose: see AGENTS.md - "Charter owns panel manifests."
		}
	}

	function makeSelectionChangeRunner(capturedGen: number): () => Promise<void> {
		return async () => {
			// If setData fired between enqueue and execution, our project_views
			// are stale - runResolve will produce a correct viewport instead.
			// resolvePending additionally blocks a call that hasn't even started yet when a
			// caller already knows (via beginPendingResolve) a resolve is on its way but hasn't
			// reached pluginQueue -- see resolvePending's own doc above.
			if (capturedGen !== selectionGen || !activePlugin || resolvePending) return;

			const payload = JSON.stringify({
				primary: _selPrimary,
				secondary: _selSecondary.filter((s): s is string => s !== null),
				activeViewId: _viewId,
				hoveredOccurrenceId: _hoveredOccurrenceKey
			});

			const result = await activePlugin.call('on_selection_change', payload);
			// Re-check after the await, not just before it: setData can fire (and bump
			// selectionGen) WHILE this WASM call is in flight -- pluginQueue is FIFO/serialized,
			// so a hover-triggered call enqueued just before a fast DB-backed edit (e.g. dropping
			// a dragged view) can still be mid-`await` when the edit's own runResolve gets queued
			// behind it. The pre-await check alone let that stale result through: it still carries
			// last_resolve_input's pre-edit data, so applying it here would visibly snap the
			// viewport back to the old state for one frame before the queued runResolve corrects
			// it right after. Discarding here (not just skipping future runs) closes that window.
			if (capturedGen !== selectionGen || resolvePending) return;
			if (result) {
				const parsed = JSON.parse(result.text()) as {
					viewport_data?: UiNode[];
					node_view_ids?: string[];
					node_kit_ids?: string[];
					node_occurrence_ids?: string[];
					viewport_data_binary?: string;
				};
				// Same fix as runResolve above -- viewport_data and viewport_data_binary aren't
				// mutually exclusive, keep both in sync independently.
				if (parsed.viewport_data) {
					viewportData = JSON.stringify(parsed.viewport_data);
				}
				viewportDataBinary = parsed.viewport_data_binary
					? base64ToBytes(parsed.viewport_data_binary)
					: null;
				nodeViewIds = parsed.node_view_ids ?? [];
				nodeKitIds = parsed.node_kit_ids ?? [];
				nodeOccurrenceIds = parsed.node_occurrence_ids ?? [];
			}
		};
	}

	async function loadPlugin(
		manifest: ManifestLike | PromiseLike<ManifestLike>,
		name: string,
		grantedHostFns?: string[]
	) {
		plugins = [...plugins.filter((p) => p.name !== name), { name, status: 'loading' }];

		try {
			const plugin = await createPlugin(manifest, {
				runInWorker: true,
				useWasi: true,
				functions: makeHostFunctions(name, grantedHostFns)
			});

			activePlugin = plugin;
			activePluginName = name;
			await plugin.call('on_init', JSON.stringify({ name }));
			plugins = plugins.map((p) => (p.name === name ? { name, status: 'ready' } : p));

			if (_kits !== null) {
				enqueue(runResolve);
			}
		} catch (err) {
			plugins = plugins.map((p) =>
				p.name === name ? { name, status: 'error', error: String(err) } : p
			);
		}
	}

	// Loads a plugin that is only ever called on demand (by name, via callUtilityPlugin) --
	// never wired into the on_resolve/on_selection_change/on_field_update lifecycle above, so
	// it can coexist with the viewport-interpreter plugin (Charter) without disturbing it.
	async function loadUtilityPlugin(
		manifest: ManifestLike | PromiseLike<ManifestLike>,
		name: string,
		options?: Partial<ExtismPluginOptions>,
		grantedHostFns?: string[]
	) {
		plugins = [...plugins.filter((p) => p.name !== name), { name, status: 'loading' }];

		try {
			const plugin = await createPlugin(manifest, {
				runInWorker: true,
				useWasi: true,
				functions: makeHostFunctions(name, grantedHostFns),
				...options
			});

			utilityPlugins.set(name, plugin);
			await plugin.call('on_init', JSON.stringify({ name }));
			plugins = plugins.map((p) => (p.name === name ? { name, status: 'ready' } : p));
		} catch (err) {
			plugins = plugins.map((p) =>
				p.name === name ? { name, status: 'error', error: String(err) } : p
			);
		}
	}

	// 'lazy'-activation utility plugins (e.g. Tenner -- an occasional, explicit user action,
	// not core to using the editor) never get an eager loadUtilityPlugin call at boot; they
	// load themselves here, on first actual invocation. 'eager' ones (e.g. Fontavious) are
	// already loaded by the time anything calls them, so this is a no-op for those (the
	// utilityPlugins.has check short-circuits before the catalogue round-trip).
	async function ensureUtilityPluginLoaded(name: string): Promise<void> {
		if (utilityPlugins.has(name)) return;

		const catalogue = await api.listPlugins();
		const row = catalogue.find((p) => p.name === name && p.kind === 'utility');
		if (!row) throw new Error(`utility plugin "${name}" is not registered`);

		await loadUtilityPlugin(
			row.manifest,
			row.name,
			(row.options ?? undefined) as Partial<ExtismPluginOptions> | undefined,
			row.manifest.capabilities?.hostFns
		);
	}

	// Aggregates every loaded plugin's optional `preferences` export into one flat list for the
	// Settings menu. The interpreter (Charter) is called on the same serial queue as resolve (Extism
	// isn't re-entrant); already-ready utility plugins go through callUtilityPlugin. A plugin without
	// a `preferences` export just contributes nothing -- its call rejects and is swallowed per-plugin.
	async function collectPreferences(): Promise<CollectedPreference[]> {
		const out: CollectedPreference[] = [];

		if (activePlugin && activePluginName) {
			const plugin = activePlugin;
			const name = activePluginName;
			const raw = await new Promise<unknown>((resolve) => {
				pluginQueue = pluginQueue.then(async () => {
					try {
						resolve(await plugin.call('preferences', '{}'));
					} catch {
						resolve(null);
					}
				});
			});
			for (const def of parsePreferenceDefsExport(raw)) out.push({ plugin: name, def });
		}

		// Utility plugins that are actually loaded (skip lazy ones not yet instantiated -- asking for
		// preferences shouldn't force-load a plugin the user hasn't invoked).
		const utilityNames = plugins
			.filter((p) => p.status === 'ready' && utilityPlugins.has(p.name))
			.map((p) => p.name);
		await Promise.all(
			utilityNames.map(async (n) => {
				try {
					const raw = await callUtilityPlugin(n, 'preferences', '{}');
					for (const def of parsePreferenceDefsExport(raw)) out.push({ plugin: n, def });
				} catch {
					// no `preferences` export
				}
			})
		);

		return out;
	}

	function callUtilityPlugin(name: string, fn: string, payload: string): Promise<unknown> {
		const prior = utilityQueues.get(name) ?? Promise.resolve();
		const next = prior
			.catch(() => {})
			.then(async () => {
				await ensureUtilityPluginLoaded(name);
				const plugin = utilityPlugins.get(name);
				if (!plugin) throw new Error(`utility plugin "${name}" failed to load`);
				// Make the plugin's current preference values readable via kit10_kv_get during the call.
				seedPluginPreferences(name);
				return plugin.call(fn, payload);
			});
		utilityQueues.set(name, next);
		return next;
	}

	function setData(
		kits: ResolvedKit[] | null,
		hints: Record<string, unknown> | null,
		viewId: string | null,
		projectViews: ResolvedView[],
		fontFacts: Record<string, FamilyFacts> = {},
		overriddenOccurrences: OverriddenOccurrence[] = []
	) {
		_kits = kits;
		_hints = hints;
		_viewId = viewId;
		_projectViews = projectViews;
		_fontFacts = fontFacts;
		_overriddenOccurrences = overriddenOccurrences;
		context = { resolvedKits: kits };

		// Invalidate any already-queued runSelectionChange - its last_resolve_input is stale.
		// Even if selectionTimer already fired (null) the generation mismatch will skip it.
		selectionGen++;

		if (selectionTimer !== null) {
			clearTimeout(selectionTimer);
			selectionTimer = null;
		}

		if (dataTimer !== null) clearTimeout(dataTimer);
		dataTimer = setTimeout(() => {
			dataTimer = null;
			enqueue(runResolve);
		}, 0);
	}

	// Call synchronously, BEFORE issuing a write whose live-query-triggered resolve will take a
	// real DB round-trip to reach pluginQueue (e.g. persisting a dragged view's dropped
	// position). Without this, a hover/selection-change call that only needs one 0ms timer to
	// reach the same FIFO queue is reliably dequeued and fully executed first, applying a result
	// built from last_resolve_input that still predates the write -- a deterministic, always-
	// reproducing "snaps to the old state, then the new one" flash, not a rare race. See
	// resolvePending's own doc for why bumping selectionGen alone doesn't cover this window.
	function beginPendingResolve() {
		resolvePending = true;
	}

	// Shared by setSelection and setHover -- both just mutate a piece of interaction state and
	// then need the same debounced on_selection_change call carrying ALL current state
	// (primary/secondary/activeViewId/hoveredViewId), not just the field that changed.
	function scheduleSelectionChange() {
		// Data resolve already pending - it will send the updated state, skip separate update
		if (dataTimer !== null) return;

		const gen = selectionGen;
		if (selectionTimer !== null) clearTimeout(selectionTimer);
		selectionTimer = setTimeout(() => {
			selectionTimer = null;
			enqueue(makeSelectionChangeRunner(gen));
		}, 0);
	}

	// primaryOccurrenceKey/secondaryOccurrenceKeys identify SPECIFIC rendered instances (see
	// view-tree.ts's ViewOccurrence), not just views -- see EditorSelection.selectedOccurrencePrimary.
	function setSelection(primaryOccurrenceKey: string | null, secondaryOccurrenceKeys: (string | null)[]) {
		_selPrimary = primaryOccurrenceKey;
		_selSecondary = secondaryOccurrenceKeys;
		scheduleSelectionChange();
	}

	// Hover is independent from selection -- an occurrence can be hovered while a different one
	// stays selected -- but shares the same wire call (on_selection_change) and debounce/generation
	// plumbing, since the host always sends the full current interaction state together.
	function setHover(occurrenceKey: string | null) {
		if (_hoveredOccurrenceKey === occurrenceKey) return;
		_hoveredOccurrenceKey = occurrenceKey;
		scheduleSelectionChange();
	}

	async function fieldUpdate(update: FieldUpdate) {
		if (!activePlugin) return;
		enqueue(async () => {
			if (!activePlugin) return;
			await activePlugin.call('on_field_update', JSON.stringify(update));
		});
	}

	function disablePlugin(name: string) {
		plugins = plugins.map((p) => (p.name === name ? { ...p, status: 'disabled' } : p));
		if (activePlugin) {
			activePlugin.close();
			activePlugin = null;
		}
		fieldCategories = [];
		panelManifests = new Map();
		viewportData = '[]';
		viewportDataBinary = null;
		nodeViewIds = [];
		nodeKitIds = [];
		nodeOccurrenceIds = [];
	}

	return {
		get plugins() {
			return plugins;
		},
		get fieldCategories() {
			return fieldCategories;
		},
		// Look up a published panel manifest by id. Returns undefined when the plugin hasn't
		// published one yet (e.g. before the first resolve fires). Panels derive off this -
		// Svelte 5 reactivity fires when the underlying `panelManifests` $state is reassigned
		// (the kit10_panel_publish host fn always writes a new Map instance, never mutates in
		// place, so the assignment triggers subscribers).
		panelManifest: (panelId: string) => panelManifests.get(panelId),
		get panelManifests() {
			return panelManifests;
		},
		get viewportData() {
			return viewportData;
		},
		get viewportDataBinary() {
			return viewportDataBinary;
		},
		get nodeViewIds() {
			return nodeViewIds;
		},
		get nodeKitIds() {
			return nodeKitIds;
		},
		get nodeOccurrenceIds() {
			return nodeOccurrenceIds;
		},
		get fontRequests() {
			return fontRequests;
		},
		loadPlugin,
		loadUtilityPlugin,
		callUtilityPlugin,
		collectPreferences,
		setData,
		setSelection,
		setHover,
		beginPendingResolve,
		fieldUpdate,
		disablePlugin
	};
}

export type PluginManager = ReturnType<typeof createPluginManager>;

import createPlugin, {
	type ExtismPluginOptions,
	type ManifestLike,
	type Plugin
} from '@extism/extism';
import type { Api, ResolvedKit } from 'manager';
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

function serializeResolvedKits(kits: ResolvedKit[] | null) {
	if (!kits) return null;
	return kits.map((k) => ({
		kitId: k.kitId,
		kitName: k.kitName,
		// Each property carries its own `viewRefs` (view-list values). There's no kit-level child
		// list anymore -- a consumer that treats some property as nested composition (Charter's
		// `children`) reads that property's viewRefs itself.
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

export function createPluginManager(api: Api) {
	let plugins = $state<LoadedPlugin[]>([]);
	let fieldCategories = $state<FieldCategory[]>([]);
	// Panel manifests published by plugins via `kit10_panel_publish`. Replaces the old
	// `compositionFieldKeys` / `viewIcons` flat state (Charter now bundles topology + icon +
	// write-alias into one PanelManifest per panel-id, so the editor's panel can render purely
	// off this map instead of re-deriving topology client-side). Keyed by panel_id ("views"
	// today; additive for future plugin-driven panels — see CLAUDE.md's panel-manifest section).
	let panelManifests = $state<Map<string, PanelManifest>>(new Map());
	let viewportData = $state<string>('[]');
	// MessagePack-binary path: when Charter emits viewport_data_binary, this is the
	// base64-decoded bytes ready for vellum.set_data_binary(). Avoids the 47ms JSON
	// parse wall on Vellum's side by skipping serde_json entirely.
	let viewportDataBinary = $state<Uint8Array | null>(null);
	// Parallel to viewportData (same length/order) -- see OnResolveResult.node_view_ids.
	let nodeViewIds = $state<string[]>([]);
	// The concrete (family, weight, style) set the current viewport renders, post Charter
	// weight-snapping. Editor.svelte's font scan fetches exactly these -- never re-deriving
	// weights from raw kit properties (single decision point: Charter's resolve_font_weight).
	let fontRequests = $state<FontRequest[]>([]);
	let context: PluginContext = { resolvedKits: null };

	let activePlugin: Plugin | null = null;

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

	// Latest state — always reflects the most recent setter call
	let _kits: ResolvedKit[] | null = null;
	let _hints: Record<string, unknown> | null = null;
	let _viewId: string | null = null;
	let _projectViews: ResolvedView[] = [];
	let _selPrimary: string | null = null;
	let _selSecondary: string[] = [];
	let _hoveredViewId: string | null = null;
	let _fontFacts: Record<string, FamilyFacts> = {};

	// Debounce timers
	let dataTimer: ReturnType<typeof setTimeout> | null = null;
	let selectionTimer: ReturnType<typeof setTimeout> | null = null;

	// Incremented on every setData call. Any runSelectionChange captured before
	// the increment was enqueued while data was stale — skip it.
	let selectionGen = 0;

	// Serial queue — all plugin calls are chained so they never run concurrently
	let pluginQueue: Promise<void> = Promise.resolve();

	function enqueue(fn: () => Promise<void>): void {
		pluginQueue = pluginQueue.then(() =>
			fn().catch((err) => {
				console.error('[plugin] call failed:', err);
			})
		);
	}

	function makeHostFunctions(pluginName: string) {
		const localKV = new Map<string, string>();

		return {
			'extism:host/user': {
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

				kit10_get_resolution(cp: any, _inputOffs: bigint) {
					const data = serializeResolvedKits(context.resolvedKits);
					return cp.store(JSON.stringify(data));
				},

				// Exposes Manager's exportProject (a full project data dump -- views, kits, axes,
				// layers, render entries, tokens, etc.) to any plugin that wants it, rather than the
				// host pre-marshaling it into a call's input. Lets multiple export-target plugins
				// (Tenner today, others later) all pull the same data on demand without the host
				// needing a per-plugin-shaped payload.
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
				// manifest. Decoupled from `OnResolveResult`'s return shape on purpose: see CLAUDE.md's
				// panel-manifest section — a future plugin refreshing its own panel doesn't need a full
				// resolve cycle, and `OnResolveResult` stays focused on viewport data + categories.
				kit10_panel_publish(cp: any, inputOffs: bigint) {
					const rawJson = cp.read(inputOffs).text();
					const input = JSON.parse(rawJson) as { panel_id: string; manifest: PanelManifest };
					panelManifests = new Map(panelManifests).set(input.panel_id, input.manifest);
					return cp.store(JSON.stringify(true));
				}
			}
		};
	}

	async function runResolve(): Promise<void> {
		if (!activePlugin) return;
		mark('resolve:serialize:start');
		const payload = JSON.stringify({
			activeViewId: _viewId,
			resolvedKits: serializeResolvedKits(_kits) ?? [],
			viewHints: _hints ?? {},
			projectViews: serializeResolvedViews(_projectViews) ?? [],
			selectedViewPrimary: _selPrimary,
			selectedViewSecondary: _selSecondary,
			fontFacts: _fontFacts
		});
		mark('resolve:serialize:end');

		mark('resolve:plugin:start');
		const result = await activePlugin.call('on_resolve', payload);
		mark('resolve:plugin:end');

		measure('resolve:serialize:start', 'resolve:serialize:end', 'serialize payload');
		measure('resolve:plugin:start', 'resolve:plugin:end', 'plugin.call(on_resolve)');

		if (result) {
			const parsed: OnResolveResult = JSON.parse(result.text());
			fieldCategories = parsed.categories ?? [];
			fontRequests = parsed.font_requests ?? [];
			if (parsed.viewport_data_binary) {
				const binaryStr = atob(parsed.viewport_data_binary);
				const bytes = new Uint8Array(binaryStr.length);
				for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
				viewportDataBinary = bytes;
				nodeViewIds = parsed.node_view_ids ?? [];
			} else if (parsed.viewport_data) {
				viewportData = JSON.stringify(parsed.viewport_data);
				viewportDataBinary = null;
				nodeViewIds = parsed.node_view_ids ?? [];
			}
			// Panel manifests are NOT read here — they're published via the `kit10_panel_publish`
			// host fn, which Charter calls from inside `on_resolve`'s body (see lib.rs). That write
			// lands directly in the `panelManifests` $state map, so this function's `$state` writes
			// and the host fn's writes both happen before any panel subtends. Decoupled on
			// purpose: see CLAUDE.md — "Charter owns panel manifests."
		}
	}

	function makeSelectionChangeRunner(capturedGen: number): () => Promise<void> {
		return async () => {
			// If setData fired between enqueue and execution, our project_views
			// are stale — runResolve will produce a correct viewport instead.
			if (capturedGen !== selectionGen || !activePlugin) return;

			const payload = JSON.stringify({
				primary: _selPrimary,
				secondary: _selSecondary,
				activeViewId: _viewId,
				hoveredViewId: _hoveredViewId
			});

			const result = await activePlugin.call('on_selection_change', payload);
			if (result) {
				const parsed = JSON.parse(result.text()) as {
					viewport_data?: UiNode[];
					node_view_ids?: string[];
					viewport_data_binary?: string;
				};
				if (parsed.viewport_data_binary) {
					const binaryStr = atob(parsed.viewport_data_binary);
					const bytes = new Uint8Array(binaryStr.length);
					for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
					viewportDataBinary = bytes;
					nodeViewIds = parsed.node_view_ids ?? [];
				} else if (parsed.viewport_data?.length) {
					viewportData = JSON.stringify(parsed.viewport_data);
					viewportDataBinary = null;
					nodeViewIds = parsed.node_view_ids ?? [];
				}
			}
		};
	}

	async function loadPlugin(manifest: ManifestLike | PromiseLike<ManifestLike>, name: string) {
		plugins = [...plugins, { name, status: 'loading' }];

		try {
			const plugin = await createPlugin(manifest, {
				runInWorker: true,
				useWasi: true,
				functions: makeHostFunctions(name)
			});

			activePlugin = plugin;
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
		options?: Partial<ExtismPluginOptions>
	) {
		plugins = [...plugins, { name, status: 'loading' }];

		try {
			const plugin = await createPlugin(manifest, {
				runInWorker: true,
				useWasi: true,
				functions: makeHostFunctions(name),
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
			(row.options ?? undefined) as Partial<ExtismPluginOptions> | undefined
		);
	}

	function callUtilityPlugin(name: string, fn: string, payload: string): Promise<unknown> {
		const prior = utilityQueues.get(name) ?? Promise.resolve();
		const next = prior
			.catch(() => {})
			.then(async () => {
				await ensureUtilityPluginLoaded(name);
				const plugin = utilityPlugins.get(name);
				if (!plugin) throw new Error(`utility plugin "${name}" failed to load`);
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
		fontFacts: Record<string, FamilyFacts> = {}
	) {
		_kits = kits;
		_hints = hints;
		_viewId = viewId;
		_projectViews = projectViews;
		_fontFacts = fontFacts;
		context = { resolvedKits: kits };

		// Invalidate any already-queued runSelectionChange — its last_resolve_input is stale.
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

	// Shared by setSelection and setHover -- both just mutate a piece of interaction state and
	// then need the same debounced on_selection_change call carrying ALL current state
	// (primary/secondary/activeViewId/hoveredViewId), not just the field that changed.
	function scheduleSelectionChange() {
		// Data resolve already pending — it will send the updated state, skip separate update
		if (dataTimer !== null) return;

		const gen = selectionGen;
		if (selectionTimer !== null) clearTimeout(selectionTimer);
		selectionTimer = setTimeout(() => {
			selectionTimer = null;
			enqueue(makeSelectionChangeRunner(gen));
		}, 0);
	}

	function setSelection(primary: string | null, secondary: string[]) {
		_selPrimary = primary;
		_selSecondary = secondary;
		scheduleSelectionChange();
	}

	// Hover is independent from selection -- a view can be hovered while a different view stays
	// selected -- but shares the same wire call (on_selection_change) and debounce/generation
	// plumbing, since the host always sends the full current interaction state together.
	function setHover(viewId: string | null) {
		if (_hoveredViewId === viewId) return;
		_hoveredViewId = viewId;
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
	}

	return {
		get plugins() {
			return plugins;
		},
		get fieldCategories() {
			return fieldCategories;
		},
		// Look up a published panel manifest by id. Returns undefined when the plugin hasn't
		// published one yet (e.g. before the first resolve fires). Panels derive off this —
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
		get fontRequests() {
			return fontRequests;
		},
		loadPlugin,
		loadUtilityPlugin,
		callUtilityPlugin,
		setData,
		setSelection,
		setHover,
		fieldUpdate,
		disablePlugin
	};
}

export type PluginManager = ReturnType<typeof createPluginManager>;

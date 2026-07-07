import createPlugin, { type ExtismPluginOptions, type ManifestLike, type Plugin } from '@extism/extism';
import type { Api, ResolvedKit } from 'manager';
import type {
	FieldCategory,
	FieldUpdate,
	LoadedPlugin,
	OnResolveResult,
	PluginContext,
	ResolvedView,
	UiNode,
	WriteRenderEntryInput,
	WriteRenderEntryResult
} from './types.js';

function serializeResolvedKits(kits: ResolvedKit[] | null) {
	if (!kits) return null;
	return kits.map((k) => ({
		kitId: k.kitId,
		kitName: k.kitName,
		properties: Object.fromEntries(k.properties),
		childViewIds: k.childViewIds
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
	let viewportData = $state<string>('[]');
	// Parallel to viewportData (same length/order) -- see OnResolveResult.node_view_ids.
	let nodeViewIds = $state<string[]>([]);
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
						debug: 'color: #6b7280;',
						info: 'color: #3b82f6;',
						warn: 'color: #f59e0b;',
						error: 'color: #ef4444;'
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
				}
			}
		};
	}

	async function runResolve(): Promise<void> {
		if (!activePlugin) return;
		const payload = JSON.stringify({
			activeViewId: _viewId,
			resolvedKits: serializeResolvedKits(_kits),
			viewHints: _hints ?? {},
			projectViews: serializeResolvedViews(_projectViews) ?? [],
			selectedViewPrimary: _selPrimary,
			selectedViewSecondary: _selSecondary
		});

		const result = await activePlugin.call('on_resolve', payload);
		if (result) {
			const parsed: OnResolveResult = JSON.parse(result.text());
			fieldCategories = parsed.categories ?? [];
			if (parsed.viewport_data) {
				viewportData = JSON.stringify(parsed.viewport_data);
				nodeViewIds = parsed.node_view_ids ?? [];
			}
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
				};
				if (parsed.viewport_data?.length) {
					viewportData = JSON.stringify(parsed.viewport_data);
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

	function callUtilityPlugin(name: string, fn: string, payload: string): Promise<unknown> {
		const plugin = utilityPlugins.get(name);
		if (!plugin) return Promise.reject(new Error(`utility plugin "${name}" not loaded`));

		const prior = utilityQueues.get(name) ?? Promise.resolve();
		const next = prior.catch(() => {}).then(() => plugin.call(fn, payload));
		utilityQueues.set(name, next);
		return next;
	}

	function setData(
		kits: ResolvedKit[] | null,
		hints: Record<string, unknown> | null,
		viewId: string | null,
		projectViews: ResolvedView[]
	) {
		_kits = kits;
		_hints = hints;
		_viewId = viewId;
		_projectViews = projectViews;
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
		viewportData = '[]';
		nodeViewIds = [];
	}

	return {
		get plugins() {
			return plugins;
		},
		get fieldCategories() {
			return fieldCategories;
		},
		get viewportData() {
			return viewportData;
		},
		get nodeViewIds() {
			return nodeViewIds;
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

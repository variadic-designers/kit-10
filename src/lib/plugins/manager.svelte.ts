import createPlugin, { type ManifestLike, type Plugin } from '@extism/extism';
import type { Api, EditorState, ResolvedKit } from 'manager';
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
		childViewIds: k.childViewIds,
	}));
}

function serializeResolvedViews(views: ResolvedView[] | null) {
	if (!views) return null;
	return views.map((v) => ({
		viewId: v.viewId,
		viewName: v.viewName,
		hints: v.hints ?? {},
		resolvedKits: serializeResolvedKits(v.resolvedKits)
	}));
}

export function createPluginManager(editor: EditorState, api: Api) {
	let plugins = $state<LoadedPlugin[]>([]);
	let fieldCategories = $state<FieldCategory[]>([]);
	let viewportData = $state<string>('[]');
	let context = $state<PluginContext>({ resolvedKits: null });

	let activePlugin: Plugin | null = null;
	const kvStores = new Map<string, Map<string, string>>();

	function makeHostFunctions(pluginName: string) {
		const localKV = new Map<string, string>();
		kvStores.set(pluginName, localKV);

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

			if (context.resolvedKits) {
				await resolve(context.resolvedKits);
			}
		} catch (err) {
			plugins = plugins.map((p) =>
				p.name === name ? { name, status: 'error', error: String(err) } : p
			);
		}
	}

	async function resolve(
		resolvedKits: ResolvedKit[] | null,
		viewHints?: Record<string, unknown> | null,
		allViews?: ResolvedView[] | null,
		activeViewId?: string | null
	) {
		context = { resolvedKits };

		if (!activePlugin) {
			fieldCategories = [];
			viewportData = '[]';
			return;
		}

		try {
			const payload = JSON.stringify({
				activeViewId: activeViewId ?? null,
				resolvedKits: serializeResolvedKits(resolvedKits),
				viewHints: viewHints ?? {},
				allViews: serializeResolvedViews(allViews ?? null)
			});
			const result = await activePlugin.call('on_resolve', payload);
			if (result) {
				const parsed: OnResolveResult = JSON.parse(result.text());
				fieldCategories = parsed.categories ?? [];
				if (parsed.viewport_data) {
					viewportData = JSON.stringify(parsed.viewport_data);
				}
			}
		} catch (err) {
			console.error(`[plugin] on_resolve failed:`, err);
		}
	}

	async function fieldUpdate(update: FieldUpdate) {
		if (!activePlugin) return;
		try {
			await activePlugin.call('on_field_update', JSON.stringify(update));
		} catch (err) {
			console.error(`[plugin] on_field_update failed:`, err);
		}
	}

	function disablePlugin(name: string) {
		plugins = plugins.map((p) => (p.name === name ? { ...p, status: 'disabled' } : p));
		if (activePlugin) {
			activePlugin.close();
			activePlugin = null;
		}
		fieldCategories = [];
		viewportData = '[]';
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
		loadPlugin,
		resolve,
		fieldUpdate,
		disablePlugin
	};
}

export type PluginManager = ReturnType<typeof createPluginManager>;

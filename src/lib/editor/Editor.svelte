<script lang="ts" module>
	export interface EditorSelection {
		selectedViewPrimary: string | null;
		selectedViewSecondary: string[];

		selectedKitIndex: number | null;
	}

	export interface EditorActivity {
		activeWorkspaceId: string | null;
		activeWorkspaceName: string | null;
		activeProjectId: string | null;
		activeProjectName: string | null;
		activeViewId: string | null;
		activeKitId: string | null;
	}

	export const query = async <O,>(
		editor: EditorState,
		qb: EditorQueryBuilder<O>,
		set: (rows: O[]) => void
	) => {
		const { sql, parameters } = qb.compile();

		const liveQuery = await editor.core.live.query(sql, parameters as unknown[], (res) => {
			set(res.rows as O[]);
		});

		liveQuery.unsubscribe();
	};

	let editorLoading: undefined | EditorState = $state();

	let editorActivity: EditorActivity = $state({
		activeWorkspaceId: null,
		activeWorkspaceName: null,
		activeProjectId: null,
		activeProjectName: null,
		activeViewId: null,
		activeKitId: null
	});

	import { queryBuilder } from 'manager';

	export function liveQuery<T>(
		query: (api: Api, activity: EditorActivity) => EditorQueryBuilder<T>
	) {
		let rows = $state<T[]>([]);
		let isFetching = $state(true);
		let error = $state<Error | null>(null);

		$effect(() => {
			let unsubscribe: (() => Promise<void>) | null = null;
			const editor = editorLoading;
			const activity = editorActivity;

			if (!editor) {
				return;
			}

			isFetching = true;

			const initLiveQuery = async () => {
				try {
					const { sql, parameters } = query(queryBuilder(editor.dialect), activity).compile();

					const live = await editor.core.live.query<T>(sql, parameters as unknown[], (res) => {
						rows = res.rows;
						isFetching = false;
					});
					unsubscribe = live.unsubscribe;
				} catch (err) {
					error = err as Error;
					isFetching = false;
				}
			};

			initLiveQuery();

			return () => {
				if (unsubscribe) {
					unsubscribe();
				}
			};
		});

		return {
			get rows() {
				return rows;
			},
			get isFetching() {
				return isFetching;
			},
			get error() {
				return error;
			}
		};
	}
</script>

<script lang="ts">
	let offsetX = $state(0);
	let offsetY = $state(0);

	let selection: EditorSelection = $state({
		selectedViewPrimary: null,
		selectedViewSecondary: [],
		selectedKitIndex: null
	});

	// Shared between the Views panel (row mouseenter/leave) and the Viewport (pointermove +
	// vellum.get_selection hit-test) -- either source updates the same piece of state, so
	// hovering one highlights the other for free.
	let hoveredViewId: string | null = $state(null);

	let resolvedViews = $state<ResolvedView[]>([]);
	const resolvedKits = $derived(
		resolvedViews.find((v) => v.viewId === editorActivity.activeViewId)?.resolvedKits ?? null
	);
	const viewHints = $derived(
		(resolvedViews.find((v) => v.viewId === editorActivity.activeViewId)?.hints ?? null) as Record<
			string,
			unknown
		> | null
	);


	$effect(() => {
		const projectId = editorActivity.activeProjectId;
		const editor = editorLoading;
		if (!projectId || !editor) {
			resolvedViews = [];
			return;
		}

		let cancelled = false;
		let reResolveVersion = 0;
		let reResolveTimer: ReturnType<typeof setTimeout> | null = null;
		let liveUnsubscribe: (() => Promise<void>) | null = null;
		// Input-level dedup: the key of the last rows we actually resolved from. When a
		// fetch returns rows with the same key, `resolveViewsFromRows` (pure) would
		// produce identical output, so we skip the resolve + serialize + plugin call
		// entirely. This replaces the old output fingerprint -- it cannot omit a field
		// because it serializes the raw rows, not a hand-picked subset of output fields.
		let lastRowsKey: string | null = null;

		const reResolve = async () => {
			const version = ++reResolveVersion;
			mark('resolve:cycle:start');
			// Single IPC crossing (the batched UNION ALL fetch). The version counter guards
			// this one async window: if a newer reResolve is issued before this fetch
			// completes, the version check below discards this result (latest-wins) without
			// paying for the sync resolve -- strictly better than the old 4-crossing layout,
			// where stale results were discarded only after all 4 RTs had run.
			const rows = await fetchResolutionRows(editor.dialect, projectId);
			if (cancelled || version !== reResolveVersion) return;

			mark('resolve:dedup:start');
			const key = rowsKey(rows);
			mark('resolve:dedup:end');
			measure('resolve:dedup:start', 'resolve:dedup:end', 'rowsKey');
			if (lastRowsKey === key) {
				// Rows unchanged -- skip resolve + downstream. The live query fired but the
				// data it triggered on didn't actually change resolution-relevant rows (e.g.
				// a write to a non-resolution column, or a no-op update). Downstream effects
				// (setData → on_resolve) are not re-fired, exactly as the old fingerprint
				// intended -- but the skip now happens at the input, before the resolve work.
				measure(
					'resolve:cycle:start',
					'resolve:dedup:end',
					'reResolve total (skipped, rows unchanged)'
				);
				return;
			}
			lastRowsKey = key;

			// resolveViewsFromRows is pure and synchronous -- no second async window to guard.
			// The version check above is sufficient; no re-check needed here.
			const allResolved = resolveViewsFromRowsManager(rows);

			// Svelte 5 reactivity is reference-based on $state: reassigning resolvedViews
			// with a new array reference fires the downstream $effect (→ setData → on_resolve).
			// The row-key dedup above is what prevents that reassignment when nothing changed
			// -- Svelte cannot do content-based dedup on its own.
			resolvedViews = allResolved as ResolvedView[];
			measure('resolve:cycle:start', 'resolve:dedup:end', 'reResolve total (fetch + dedup)');
		};

		const scheduleReResolve = () => {
			if (reResolveTimer !== null) clearTimeout(reResolveTimer);
			reResolveTimer = setTimeout(() => {
				reResolveTimer = null;
				reResolve();
			}, 0);
		};

		const init = async () => {
			// Single live query touching all resolution-relevant tables.
			// PGlite tracks table access from the query plan — this reliably fires
			// on any write to views, compositions, kits, layers, axis_args, render_entries, or tokens.
			// The SQL + its table-coverage assertion live in resolve-live-query.ts.
			const live = await editor.core.live.query(
				RESOLVE_LIVE_QUERY_SQL,
				[projectId],
				scheduleReResolve
			);
			liveUnsubscribe = live.unsubscribe;
			await reResolve();
		};

		init();

		return () => {
			cancelled = true;
			if (reResolveTimer !== null) clearTimeout(reResolveTimer);
			if (liveUnsubscribe) liveUnsubscribe();
		};
	});

	import ViewsPanel from './panels/Views.svelte';
	import { selectView as selectViewShared } from './selection.js';
	import StylesPanel from './panels/Styles.svelte';
	import TokensPanel from './panels/Variables.svelte';
	import AxesPanel from './panels/Axes.svelte';
	import ProjectPanel from './panels/Project.svelte';
	import ComposePanel from './panels/Compose.svelte';
	import PluginsPanel from './panels/Plugins.svelte';

	import Nav from './Nav.svelte';
	import Viewport from './Viewport.svelte';
	import {
		fetchResolutionRows,
		resolveViewsFromRows as resolveViewsFromRowsManager,
		rowsKey
	} from 'manager';
	import { mark, measure } from './profile.js';
	import { RESOLVE_LIVE_QUERY_SQL } from './resolve-live-query.js';

	import type { ResolvedView } from '$lib/plugins/types.js';
	import type { FontFetchPayload } from '$lib/plugins/suggestion-providers.js';
	import { onMount } from 'svelte';

	import type { EditorState, EditorQueryBuilder, Api } from 'manager';
	import { initializeEditorState } from 'manager';
	import { createPluginManager, type PluginManager } from '$lib/plugins/manager.svelte.js';
	import { getVellumInstance, requestVellumRender } from './vellum-instance.js';
	import type { ExtismPluginOptions } from '@extism/extism';

	let pluginManager = $state<PluginManager | null>(null);

	// Which resolved-property keys the active plugin declares as view-composition fields (a field
	// kind, not a hardcoded name): the Views panel nests off these. The resolver stays name-neutral
	// -- it only knows a property resolved to a view-list; the plugin decides which of its fields
	// means "compose these as children" via `inputType: 'children'`, the same field-kind indirection
	// suggestion-providers.ts uses for fonts. Empty until the plugin has declared its categories.
	const viewCompositionKeys = $derived(
		(pluginManager?.fieldCategories ?? [])
			.flatMap((c) => c.fields)
			.filter((f) => f.inputType === 'children')
			.map((f) => f.key)
	);

	onMount(async () => {
		await initializeEditorState().then(async (e) => {
			if (e) {
				editorLoading = e;
				pluginManager = createPluginManager(queryBuilder(e.dialect));

				// Eager utility plugins (Fontavious: font fetching is needed the moment any
				// project has text to render) are install-level, not a per-project choice --
				// loaded once here, unconditionally, before any project is even selected.
				// 'lazy' utility plugins (Tenner) deliberately aren't loaded here; they load
				// themselves on first actual use (see callUtilityPlugin in manager.svelte.ts).
				const bootApi = queryBuilder(e.dialect);
				const catalogue = await bootApi.listPlugins();
				for (const plugin of catalogue) {
					if (plugin.kind === 'utility' && plugin.activation === 'eager') {
						await pluginManager.loadUtilityPlugin(
							plugin.manifest,
							plugin.name,
							(plugin.options ?? undefined) as Partial<ExtismPluginOptions> | undefined
						);
					}
				}
			}
		});
	});

	// The interpreter is the one genuinely per-project plugin choice (see PluginActivation in
	// schema.ts) -- reacts to the active project changing, skips reloading if it's already the
	// currently-loaded interpreter.
	let loadedInterpreterName: string | null = null;

	$effect(() => {
		const projectId = editorActivity.activeProjectId;
		const manager = pluginManager;
		const editor = editorLoading;
		if (!manager || !editor || !projectId) return;

		const api = queryBuilder(editor.dialect);
		api.getProjectInterpreter(projectId).then((interpreter) => {
			if (interpreter && interpreter.name !== loadedInterpreterName) {
				loadedInterpreterName = interpreter.name;
				manager.loadPlugin(interpreter.manifest, interpreter.name);
			}
		});
	});

	import Layout from './Layout.svelte';

	$effect(() => {
		const activity = {
			activeWorkspaceId: editorActivity.activeWorkspaceId,
			activeProjectId: editorActivity.activeProjectId,
			activeViewId: editorActivity.activeViewId,
			activeKitId: editorActivity.activeKitId
		};

		console.table(activity);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setData(resolvedKits, viewHints, editorActivity.activeViewId, resolvedViews);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setSelection(selection.selectedViewPrimary, selection.selectedViewSecondary);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setHover(hoveredViewId);
	});

	// Resolve-time fallback: catches font-family/font-weight values that were typed/imported
	// directly, or edited independently after a font was already picked, rather than fetched via
	// SuggestField (which only ever fetches the family at weight 400 when a font is first
	// picked). Best-effort only -- a catalogue miss or fetch failure just leaves that weight
	// falling back to whatever's already loaded, exactly as it already does today; never
	// surfaced as an error to the user.
	//
	// Tracks (family, weight) PAIRS, not just families: a fetched static Google Font file is a
	// single fixed weight, unlike a variable font (one file, any weight in its range via
	// interpolation) -- "Inter at 400 is loaded" says nothing on its own about whether "Inter at
	// 700" needs a separate fetch.
	//
	// Deliberately does NOT ask Vellum "is this weight loaded" -- that would mean Vellum has to
	// learn to introspect a loaded font's actual variable-axis range (it used to, via `swash`;
	// removed). Fontavious's catalogue already knows whether a given (family, weight) maps to
	// the same URL as another weight (that's exactly what its weightMin/weightMax entries
	// encode) -- so instead we ask Fontavious's cheap, no-HTTP `variant_url` which URL a request
	// would resolve to, and keep our own plain set of URLs already fetched+loaded. Same URL as
	// something already loaded -> skip. Different URL -> fetch. Vellum never needs to know
	// anything about variable fonts to answer "should I fetch again"; it only ever loads bytes
	// it's handed and renders them, which cosmic-text already does correctly regardless.
	const attemptedVariants = new Set<string>();
	const loadedFontUrls = new Set<string>();

	$effect(() => {
		if (!pluginManager) return;

		const variants = new Map<string, { family: string; weight: number }>();
		for (const view of resolvedViews) {
			for (const kit of view.resolvedKits) {
				const family = kit.properties.get('font-family')?.value;
				if (!family) continue;
				const weightStr = kit.properties.get('font-weight')?.value;
				const weight = weightStr ? parseInt(weightStr, 10) : 400;
				variants.set(`${family}::${weight}`, { family, weight: weight > 0 ? weight : 400 });
			}
		}

		for (const [key, { family, weight }] of variants) {
			if (attemptedVariants.has(key)) continue;
			attemptedVariants.add(key);

			const vellum = getVellumInstance();
			if (!vellum) continue;

			const payload: FontFetchPayload = { value: family, weight, style: 'normal' };
			pluginManager
				.callUtilityPlugin('fontavious', 'variant_url', JSON.stringify(payload))
				.then((result) => {
					const { url } = JSON.parse((result as { text(): string }).text()) as { url: string };
					if (loadedFontUrls.has(url)) return; // same file already fetched+loaded

					return pluginManager
						?.callUtilityPlugin('fontavious', 'fetch_font', JSON.stringify(payload))
						.then((fetchResult) => {
							const bytes = (fetchResult as { bytes(): Uint8Array } | undefined)?.bytes();
							if (bytes) {
								vellum.load_font(bytes);
								loadedFontUrls.add(url);
								requestVellumRender();
							}
						});
				})
				.catch((err) => {
					// Not in Fontavious's catalogue, or the fetch failed -- this is expected/fine
					// for a genuinely uncatalogued family/weight (falls back to whatever's
					// already loaded, same as always), so never surfaced as a user-facing error.
					// But warn to the console rather than swallowing it outright -- a real bug
					// here (a bad payload shape, an unreachable host) previously looked identical
					// to "just not catalogued" and cost real time to track down by hand.
					console.warn(`[fontavious] variant_url/fetch_font failed for ${key}:`, err);
				});
		}
	});
</script>

<svelte:head>
	{#if editorActivity.activeProjectName}
		<title>{editorActivity.activeProjectName} — KIT•10</title>
	{:else}
		<title>KIT•10 — New</title>
	{/if}

	<meta name="description" content="Yor Designs Editor Superpowered" />
</svelte:head>

<Layout state={editorLoading}>
	{#snippet nav(editorLoading)}
		<Nav {editorLoading} bind:editorActivity />
	{/snippet}

	{#snippet unloadedDash()}{/snippet}

	{#snippet management(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<ProjectPanel
			{api}
			{editorReady}
			bind:editorActivity
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
		/>

		<ViewsPanel
			{api}
			{editorReady}
			{resolvedViews}
			{viewCompositionKeys}
			bind:editorActivity
			bind:selection
			bind:hoveredViewId
		/>

		<ComposePanel {api} bind:editorActivity {editorReady} bind:selection />

		<AxesPanel {api} {editorReady} bind:editorActivity />
	{/snippet}

	{#snippet dash(editorReady)}
		<Viewport
			data={pluginManager?.viewportData ?? '[]'}
			nodeViewIds={pluginManager?.nodeViewIds ?? []}
			bind:editorActivity
			bind:selection
			bind:hoveredViewId
		/>
	{/snippet}

	{#snippet configurable(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<StylesPanel
			{api}
			{resolvedKits}
			{selection}
			fieldCategories={pluginManager?.fieldCategories}
			activeProjectId={editorActivity.activeProjectId}
			onFieldUpdate={pluginManager?.fieldUpdate}
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
			onSelectView={(id) => selectViewShared(editorActivity, selection, id)}
		/>

		<TokensPanel {api} {editorReady} bind:editorActivity />

		<PluginsPanel manager={pluginManager} />

		<!--
      <pre style="max-height: 20rem; overflow-y: auto;">{JSON.stringify(selection, null, 2)}</pre>
    -->
	{/snippet}
</Layout>

<style lang="scss">
	@use '_index' as *;
</style>

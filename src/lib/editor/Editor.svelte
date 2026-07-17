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
	import AssetsPanel from './panels/Assets.svelte';

	import Nav from './Nav.svelte';
	import Viewport from './Viewport.svelte';
	import {
		fetchResolutionRows,
		resolveViewsFromRows as resolveViewsFromRowsManager,
		rowsKey
	} from 'manager';
	import { mark, measure } from './profile.js';
	import { RESOLVE_LIVE_QUERY_SQL } from './resolve-live-query.js';

	import type { FamilyFacts, ResolvedView } from '$lib/plugins/types.js';
	import type { FontFetchPayload } from '$lib/plugins/suggestion-providers.js';
	import { onMount } from 'svelte';

	import type { EditorState, EditorQueryBuilder, Api } from 'manager';
	import { initializeEditorState } from 'manager';
	import { createPluginManager, type PluginManager } from '$lib/plugins/manager.svelte.js';
	import { getVellumInstance, requestVellumRender } from './vellum-instance.js';
	import type { ExtismPluginOptions } from '@extism/extism';

	let pluginManager = $state<PluginManager | null>(null);

	// Loading watchdog: if `initializeEditorState` hasn't produced an editor after this long,
	// offer to purge IndexedDB. The usual cause is an incompatible persisted database -- e.g.
	// after the PGlite 0.4 (Postgres 17) -> 0.5 (Postgres 18) bump, an existing data dir can't
	// be opened by the newer Postgres and init hangs/throws. Purging is the escape hatch.
	const LOADING_WATCHDOG_MS = 10_000;
	let showPurgePrompt = $state(false);
	let purging = $state(false);

	// Delete every IndexedDB database for this origin (PGlite's data dir + the asset blob store),
	// then hard-reload so the app re-seeds from scratch. Deliberately blunt -- this is the "my
	// local db is wedged" button, safe to nuke since projects can be re-imported from an export.
	async function purgeAndReload() {
		if (purging) return;
		purging = true;
		try {
			// Close our own connection first so it doesn't block the delete; ignore if we never
			// got a handle (the hung-init case).
			try {
				await editorLoading?.core.close();
			} catch {
				// no-op: best effort
			}
			const dbs = (await indexedDB.databases?.()) ?? [];
			await Promise.all(
				dbs
					.map((d) => d.name)
					.filter((name): name is string => !!name)
					.map(
						(name) =>
							new Promise<void>((resolve) => {
								const req = indexedDB.deleteDatabase(name);
								// Resolve on any terminal state -- onblocked included, so a stuck
								// connection can't wedge the purge itself.
								req.onsuccess = req.onerror = req.onblocked = () => resolve();
							})
					)
			);
		} finally {
			location.reload();
		}
	}

	// Panel manifests published by the active plugin via `kit10_panel_publish`. Today only Charter
	// publishes one, keyed "views": it carries the Views panel's full tree topology (parent/child
	// ids, root set, per-view icon, write-alias for DnD) bundled into one PanelManifest. The editor
	// reads `pluginManager.panelManifest('views')` and renders a tree from that -- instead of the
	// old pairing of `compositionFieldKeys` + `viewIcons` + client-side DAG re-derivation. See
	// CLAUDE.md's panel-manifest section: Charter owns panel contents, the editor's panels are
	// generic renderers over the manifest shape.
	const viewsPanelManifest = $derived(pluginManager?.panelManifest('views'));

	onMount(async () => {
		const watchdog = setTimeout(() => {
			if (!editorLoading) showPurgePrompt = true;
		}, LOADING_WATCHDOG_MS);

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

		clearTimeout(watchdog);
		// initializeEditorState swallows init errors and returns undefined; if we settled
		// without an editor it failed outright (not merely slow), so surface the purge
		// prompt immediately rather than waiting on a watchdog that already fired or won't.
		if (!editorLoading) showPurgePrompt = true;
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
		if (!pluginManager) return;
		pluginManager.setData(
			resolvedKits,
			viewHints,
			editorActivity.activeViewId,
			resolvedViews,
			fontFacts
		);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setSelection(selection.selectedViewPrimary, selection.selectedViewSecondary);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setHover(hoveredViewId);
	});

	// Font facts (text-affordances Phase 1): for every family the resolved data names, ask
	// Fontavious's `family_facts` which weight ranges actually exist, and hand the assembled
	// map to Charter via setData -> on_resolve's `fontFacts`. Charter's resolve_font_weight
	// snaps requested weights to what the family can really render (e.g. Lato has no 600 ->
	// renders 700), so panel-requested weights that don't exist stop silently falling through
	// to cosmic-text's nearest-loaded guess. Facts are static catalogue data, fetched once per
	// family; an uncatalogued family simply has no entry and its weights pass through
	// untouched. Reassigned (never mutated) so the setData $effect below re-fires and
	// re-resolves once facts land -- facts aren't DB rows, so the live-query dedup never sees
	// them.
	const attemptedFactsFamilies = new Set<string>();
	let fontFacts = $state<Record<string, FamilyFacts>>({});

	$effect(() => {
		if (!pluginManager) return;

		const families = new Set<string>();
		for (const view of resolvedViews) {
			for (const kit of view.resolvedKits) {
				const family = kit.properties.get('font-family')?.value;
				if (family) families.add(family);
			}
		}

		for (const family of families) {
			const key = family.toLowerCase();
			if (attemptedFactsFamilies.has(key)) continue;
			attemptedFactsFamilies.add(key);

			pluginManager
				.callUtilityPlugin('fontavious', 'family_facts', JSON.stringify({ value: family }))
				.then((result) => {
					const facts = JSON.parse((result as { text(): string }).text()) as FamilyFacts;
					fontFacts = { ...fontFacts, [family]: facts };
				})
				.catch(() => {
					// Not in the catalogue -- expected for a genuinely unknown family. No facts
					// means no snapping opinion; the weight passes through as typed.
				});
		}
	});

	// Font fetching: driven by Charter's `font_requests` -- the concrete (family, weight,
	// style) set the viewport actually renders, POST weight-snapping -- so this scan fetches
	// exactly the files Charter decided on instead of re-deriving weights from raw kit
	// properties (single decision point: Charter's resolve_font_weight; this is just its
	// supply chain). Best-effort only -- a catalogue miss or fetch failure leaves that variant
	// falling back to whatever's already loaded; never surfaced as a user-facing error.
	//
	// Tracks (family, weight, style) TRIPLES, not just families: a fetched static Google Font
	// file is a single fixed weight, unlike a variable font (one file, any weight in its range
	// via interpolation) -- "Inter at 400 is loaded" says nothing on its own about whether
	// "Inter at 700" needs a separate fetch.
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
	// URLs with a fetch already in flight. Several variants can resolve to the SAME file (every
	// weight of a variable font) in the same resolve burst -- without this, each launches its
	// own duplicate download before the first ever lands in loadedFontUrls.
	const pendingFontUrls = new Set<string>();

	$effect(() => {
		if (!pluginManager) return;

		for (const req of pluginManager.fontRequests) {
			const key = `${req.family}::${req.weight}::${req.style}`;
			if (attemptedVariants.has(key)) continue;

			const vellum = getVellumInstance();
			if (!vellum) continue;
			attemptedVariants.add(key);

			const payload: FontFetchPayload = { value: req.family, weight: req.weight, style: req.style };
			pluginManager
				.callUtilityPlugin('fontavious', 'variant_url', JSON.stringify(payload))
				.then((result) => {
					const { url } = JSON.parse((result as { text(): string }).text()) as { url: string };
					if (loadedFontUrls.has(url) || pendingFontUrls.has(url)) return; // fetched or in flight
					pendingFontUrls.add(url);

					return pluginManager
						?.callUtilityPlugin('fontavious', 'fetch_font', JSON.stringify(payload))
						.then((fetchResult) => {
							const bytes = (fetchResult as { bytes(): Uint8Array } | undefined)?.bytes();
							if (bytes) {
								vellum.load_font(bytes);
								loadedFontUrls.add(url);
								requestVellumRender();
							}
						})
						.finally(() => pendingFontUrls.delete(url));
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
			{viewsPanelManifest}
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
			dataBinary={pluginManager?.viewportDataBinary ?? null}
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
			{fontFacts}
			onFieldUpdate={pluginManager?.fieldUpdate}
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
			onSelectView={(id) => selectViewShared(editorActivity, selection, id)}
		/>

		<TokensPanel {api} {editorReady} bind:editorActivity />

		<PluginsPanel manager={pluginManager} />

		<AssetsPanel {api} {editorReady} bind:editorActivity />

		<!--
      <pre style="max-height: 20rem; overflow-y: auto;">{JSON.stringify(selection, null, 2)}</pre>
    -->
	{/snippet}
</Layout>

{#if showPurgePrompt && !editorLoading}
	<div class="purge-overlay" role="dialog" aria-modal="true" aria-labelledby="purge-title">
		<div class="purge-card">
			<h2 id="purge-title">Still loading…</h2>
			<p>
				The local database is taking too long to open. This usually means the stored data is from an
				older, incompatible version of the engine. Purging clears the in-browser database and
				reloads with a fresh demo project.
			</p>
			<p class="purge-warn">
				This permanently deletes all locally-stored projects and assets. Export anything you want to
				keep first (if you can reach it).
			</p>
			<div class="purge-actions">
				<button
					class="purge-btn secondary"
					onclick={() => (showPurgePrompt = false)}
					disabled={purging}
				>
					Keep waiting
				</button>
				<button class="purge-btn danger" onclick={purgeAndReload} disabled={purging}>
					{purging ? 'Purging…' : 'Purge database & reload'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style lang="scss">
	@use '_index' as *;

	.purge-overlay {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		background: oklch(0% 0 0 / 0.55);
		backdrop-filter: blur(2px);
	}

	.purge-card {
		max-width: 30rem;
		width: 100%;
		padding: 1.5rem;
		border-radius: 12px;
		background: var(--color-surface, oklch(23.9% 0 0));
		color: var(--color-text, oklch(89.4% 0 0));
		border: 1px solid var(--color-bg, oklch(18.2% 0 0));
		box-shadow: 0 12px 40px oklch(0% 0 0 / 0.45);
		font-family: sans-serif;
		letter-spacing: 0.3px;

		h2 {
			margin: 0 0 0.75rem;
			font-size: 1.15rem;
		}

		p {
			margin: 0 0 0.75rem;
			line-height: 1.5;
			font-size: 0.9rem;
		}

		.purge-warn {
			color: var(--color-danger, oklch(66.1% 0.1627 26.9));
			font-weight: 600;
		}
	}

	.purge-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		margin-top: 1rem;
	}

	.purge-btn {
		padding: 0.5rem 0.9rem;
		border-radius: 8px;
		font-size: 0.85rem;
		cursor: pointer;
		border: 1px solid transparent;

		&:disabled {
			opacity: 0.6;
			cursor: default;
		}

		&.secondary {
			background: transparent;
			color: var(--color-text, oklch(89.4% 0 0));
			border-color: var(--color-text-muted, oklch(52.1% 0.0253 256.8));
		}

		&.danger {
			background: var(--color-danger, oklch(66.1% 0.1627 26.9));
			color: oklch(100% 0 0);
		}
	}
</style>

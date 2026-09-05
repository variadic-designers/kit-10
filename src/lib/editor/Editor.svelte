<script lang="ts" module>
	export interface EditorSelection {
		selectedViewPrimary: string | null;
		// Which specific rendered INSTANCE was clicked -- the referencing token's own id for a
		// nested view, or the view's own id for a root (see view-tree.ts's ViewOccurrence). null
		// means "not yet occurrence-qualified" -- callers fall back to the first matching node,
		// same as before occurrence-awareness existed.
		selectedOccurrencePrimary: string | null;
		selectedViewSecondary: string[];
		// Parallel array to selectedViewSecondary. Secondary (multi-)selection has no real UI
		// consumer yet -- kept parallel for type consistency, not because anything reads it today.
		selectedOccurrenceSecondary: (string | null)[];

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
		selectedOccurrencePrimary: null,
		selectedViewSecondary: [],
		selectedOccurrenceSecondary: [],
		selectedKitIndex: null
	});

	// Shared between the Views panel (row mouseenter/leave) and the Viewport (pointermove +
	// vellum.get_selection hit-test) -- either source updates the same piece of state, so
	// hovering one highlights the other for free.
	let hoveredViewId: string | null = $state(null);
	// Which specific occurrence is hovered (see EditorSelection.selectedOccurrencePrimary) --
	// null means "not occurrence-qualified", same fallback posture as selection.
	let hoveredOccurrenceKey: string | null = $state(null);

	let resolvedViews = $state<ResolvedView[]>([]);
	// Per-reference axis-override resolutions (see resolve.ts's OverriddenOccurrence) -- additive,
	// empty for the common (no overrides anywhere) case. Threaded into buildViewTree (occurrence-
	// aware tree walk) and pluginManager.setData (so Charter can render each occurrence correctly).
	let overriddenOccurrences = $state<OverriddenOccurrence[]>([]);
	// Set to the project id the moment a switch begins (including the very first auto-select),
	// cleared the moment that project's first fetchResolutionRows lands -- lets the Projects panel
	// disable other rows + show a throbber while a switch is in flight. See the resolve $effect
	// below for where each transition happens.
	let resolvingProjectId: string | null = $state(null);
	const resolvedKits = $derived(
		resolvedViews.find((v) => v.viewId === editorActivity.activeViewId)?.resolvedKits ?? null
	);
	const viewHints = $derived(
		(resolvedViews.find((v) => v.viewId === editorActivity.activeViewId)?.hints ?? null) as Record<
			string,
			unknown
		> | null
	);

	// Camera pan memory (Viewport.svelte): needs the active project's own hints row, which
	// resolvedViews/viewHints above don't carry (those are per-view). A small dedicated live
	// query rather than routing through Project.svelte's own -- that one is scoped to rendering
	// the project list, not reactively exposing the active row's hints to a sibling panel.
	const projectsWithHintsQuery = liveQuery((api, activity) =>
		api.getProjectsByWorkspaceId(activity.activeWorkspaceId)
	);
	const activeProjectRow = $derived(
		projectsWithHintsQuery.rows.find((p) => p.projectId === editorActivity.activeProjectId)
	);

	// Auto-selects the active view's first composed kit as editorActivity.activeKitId - moved here
	// (from Compose.svelte) because Editor is always mounted, unlike a collapsible panel. Other
	// panels (e.g. the Tokens panel's Kit Tokens section, gated on activeKitId) must be able to
	// rely on this running regardless of whether Compose has ever rendered for the current view -
	// same "lives in Editor because it's always mounted" reasoning as onNavKey below.
	const activeKitQuery = liveQuery((api, activity) => api.getKitCompositionByViewId(activity.activeViewId));
	$effect(() => {
		const viewId = editorActivity.activeViewId;
		const rows = activeKitQuery.rows;

		if (!viewId) {
			editorActivity.activeKitId = null;
			return;
		}

		if (activeKitQuery.isFetching) return;

		if (!rows.some((k) => k.kitId === editorActivity.activeKitId)) {
			editorActivity.activeKitId = rows[0]?.kitId ?? null;
		}
	});

	$effect(() => {
		const projectId = editorActivity.activeProjectId;
		const editor = editorLoading;
		if (!projectId || !editor) {
			resolvedViews = [];
			resolvingProjectId = null;
			return;
		}
		resolvingProjectId = projectId;

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
			// This project's freshest fetch has landed -- loading is done regardless of whether
			// the rows-unchanged dedup skip below fires next. Gated on the same cancelled/version
			// check above, so a superseded switch can never clear a newer project's loading flag.
			resolvingProjectId = null;

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
			const { views: allResolved, overriddenOccurrences: newOverriddenOccurrences } =
				resolveViewsFromRowsManager(rows);
			overriddenOccurrences = newOverriddenOccurrences;

			// Svelte 5 reactivity is reference-based on $state: reassigning resolvedViews
			// with a new array reference fires the downstream $effect (→ setData → on_resolve).
			// The row-key dedup above is what prevents that reassignment when nothing changed
			// -- Svelte cannot do content-based dedup on its own.
			// No cast: ResolvedView is now a re-export of manager's ResolvedViewData (the exact
			// element type of resolveViewsFromRows' `views` array), so this is a plain assignment.
			// See types.ts.
			resolvedViews = allResolved;
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
			// PGlite tracks table access from the query plan - this reliably fires
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

	// Full resolution cascade (matched-layer stack, most-specific first) for the active view --
	// feeds the Layers inspector's override chains. SLOW PATH: a per-view fetch, deliberately
	// outside the render live-query loop above. Re-runs when the active view changes OR when
	// resolvedViews changes (an edit re-resolved), so the inspector tracks live edits. The cleanup
	// flag gives latest-wins: a superseded run's async result is dropped, never overwriting fresh.
	let cascades = $state<CascadeKit[]>([]);
	$effect(() => {
		const viewId = editorActivity.activeViewId;
		const editor = editorLoading;
		void resolvedViews; // dependency: refetch the cascade after any re-resolve
		if (!viewId || !editor) {
			cascades = [];
			return;
		}
		let cancelled = false;
		resolveViewCascade(editor.dialect, viewId).then((result) => {
			if (!cancelled) cascades = result;
		});
		return () => {
			cancelled = true;
		};
	});

	import ViewsPanel from './panels/Views.svelte';
	import { selectView as selectViewShared } from './selection.js';
	import { keybinds, matchKey, isTextEntryTarget } from './keybinds.js';
	import { panelVisibility, updatePanelVisibility } from './panel-visibility.js';
	import { buildViewTree, navigate, parentOf, type NavDirection, type ViewOccurrence } from './view-tree.js';
	import { areaNamesFromParentMap } from './panels/grid-areas.js';
	import StylesPanel from './panels/Styles.svelte';
	import TokensPanel from './panels/Variables.svelte';
	import AxesPanel from './panels/Axes.svelte';
	import ProjectPanel from './panels/Project.svelte';
	import ComposePanel from './panels/Compose.svelte';
	import PluginsPanel from './panels/Plugins.svelte';
	import ExportPanel from './panels/Export.svelte';
	import AssetsPanel from './panels/Assets.svelte';
	import LayersPanel from './panels/Layers.svelte';

	import Nav from './Nav.svelte';
	import Viewport from './Viewport.svelte';
	import {
		fetchResolutionRows,
		resolveViewsFromRows as resolveViewsFromRowsManager,
		resolveViewCascade,
		rowsKey,
		flattenKitResults,
		type CascadeKit,
		type OverriddenOccurrence
	} from 'manager';
	import { mark, measure } from './profile.js';
	import { RESOLVE_LIVE_QUERY_SQL } from './resolve-live-query.js';

	import type { FamilyFacts, FontLoadStatus, FontRequest, ResolvedView } from '$lib/plugins/types.js';
	import type { FontFetchPayload } from '$lib/plugins/suggestion-providers.js';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';

	import type { EditorState, EditorQueryBuilder, Api, PluginActivation, PluginKind, PluginManifest } from 'manager';
	import { initializeEditorState } from 'manager';
	import { createPluginManager, type PluginManager } from '$lib/plugins/manager.svelte.js';
	import { getVellumInstance, requestVellumRender } from './vellum-instance.js';
	import { assetBytes } from './asset-bytes.js';
	import { STORE_CATALOGUE } from '$lib/plugin-catalogue.js';
	import type { ExtismPluginOptions } from '@extism/extism';

	let pluginManager = $state<PluginManager | null>(null);

	// /store's Install button hands off here as `?install=<name>&kind=<kind>` rather than
	// performing the registration itself -- /store is a public, server-rendered marketing page
	// with no PGlite access (deliberately kept out of that bundle, see the recent /edit
	// server-chunk-splitting commits), so the actual registerPlugin call has to happen where the
	// DB already lives. PluginsPanel consumes this once (pre-filling its install form) and clears
	// it via onInstallHandled so a later reload of the same URL doesn't re-trigger it.
	// If the installed id has a real `manifest` in the shared STORE_CATALOGUE (see
	// $lib/plugin-catalogue.ts), it's carried along too so the install form opens fully
	// pre-filled instead of just name+kind -- looked up here, not serialized into the URL, since
	// both /store and /edit import the same catalogue module.
	let pendingInstall = $state<{
		name: string;
		kind: PluginKind;
		manifest?: PluginManifest;
		activation?: PluginActivation;
	} | null>(null);

	// Bumped by PluginsPanel after a successful registerPlugin call. Export.svelte/Project.svelte
	// each fetch the install-level plugin catalogue once on mount (no live query on that table
	// yet) on the assumption it only changes at app bootstrap -- true before /store's install
	// handoff existed, false now that registering a plugin mid-session and immediately wanting to
	// export/import with it is the normal path. Threaded into both as a prop so reading it inside
	// their existing fetch effects forces a refetch when it changes.
	let pluginRegistryVersion = $state(0);

	// Appends the registered content hash as a `?v=` query to each wasm URL so a rebuilt plugin is
	// never served stale from the browser/Extism cache (the hash is computed no-store at
	// registration, so it tracks the actually-deployed bytes). No hash → manifest unchanged.
	function versionedManifest(
		manifest: { wasm: { url: string }[] },
		hash: string | null
	): { wasm: { url: string }[] } {
		if (!hash) return manifest;
		return {
			...manifest,
			wasm: manifest.wasm.map((w) => ({
				...w,
				url: `${w.url}${w.url.includes('?') ? '&' : '?'}v=${hash}`
			}))
		};
	}

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
	// AGENTS.md's panel-manifest section: Charter owns panel contents, the editor's panels are
	// generic renderers over the manifest shape.
	const viewsPanelManifest = $derived(pluginManager?.panelManifest('views'));
	// Charter's own nesting opinion (which resolved-property keys carry child viewRefs) -- the
	// one piece Viewport.svelte needs to derive its own root-view set locally (see its
	// rootViewIds), so drag eligibility doesn't require yet another editor-computed prop.
	const compositionKeys = $derived(viewsPanelManifest?.composition_field_keys ?? []);

	// Hoisted so both the keyboard-nav handler below and parentGridAreaNames (Render panel's
	// grid-placement "Position in parent" UI) share one tree build per reactive tick instead of
	// each recomputing their own full walk of the composition graph.
	const viewTree = $derived(buildViewTree(resolvedViews, compositionKeys, overriddenOccurrences));

	// Which named grid areas the ACTIVE selection's PARENT occurrence offers, or null if that
	// parent isn't a Grid (or there is no parent) - lets the Render panel surface "Position in
	// parent" placement UI regardless of what the child's OWN arrange tab is set to, closing the
	// gap `resources/grid-child-placement-plan.md` documents (the grid-area field otherwise only
	// renders when the CHILD itself is arranged as Grid, which is a different, unrelated axis).
	const parentGridAreaNames = $derived.by(() => {
		if (!editorActivity.activeViewId) return null;
		const current: ViewOccurrence = {
			viewId: editorActivity.activeViewId,
			occurrenceKey: selection.selectedOccurrencePrimary ?? editorActivity.activeViewId
		};
		const parentOcc = parentOf(current, viewTree);
		if (!parentOcc) return null;
		const parentView = resolvedViews.find((v) => v.viewId === parentOcc.viewId);
		if (!parentView) return null;
		return areaNamesFromParentMap(flattenKitResults(parentView.resolvedKits));
	});

	// Arrow-key nudge for the active selection, but ONLY when it's out of normal document flow --
	// Nudge/Anchor mode or a root view already drag-placed out of flow (Absolute). A plain flow
	// child has nothing here to move (its position is entirely derived from layout), so
	// viewportRef.nudgeSelection returns false and onNavKey falls through to sibling-nav instead -
	// same key, contextually different action.
	//
	// The actual move (decision details, instant dynamic-layer preview, debounced persist) lives in
	// Viewport.svelte's own `nudgeSelection` (bound below via viewportRef) - only that component
	// has the `vellum` instance a smooth keyboard nudge needs. The NAV-VS-NUDGE claim still has to
	// happen here though: this is the first `keydown` listener registered on `window` (Viewport
	// registers its own imperatively, inside an async onMount, strictly later), so if the decision
	// lived downstream instead, sibling-nav would already have claimed the arrow key by the time
	// Viewport's own listener ever saw it.
	const NUDGE_STEP = 4;
	let viewportRef: Viewport | undefined = $state();

	// Keyboard navigation of the View composition tree ([ parent, ] child, ↑/↓ siblings). Lives here
	// (Editor is always mounted) rather than in the Views panel (which can be collapsed), and reuses
	// the same `buildViewTree` graph math the panel uses + the shared `selectView` funnel, so the
	// Viewport auto-pans to the new selection via its existing ensure_index_visible effect. Guarded on
	// isTextEntryTarget so `[`/`]`/arrows never fire while typing in a field.
	//
	// Also handles panel.toggleLayers: unrelated to view-tree nav, but Svelte allows only one
	// <svelte:window> per component, and this handler is already the global always-mounted keydown
	// listener, so a second panel-visibility bind rides the same guard instead of adding another one.
	function onNavKey(e: KeyboardEvent) {
		if (isTextEntryTarget(e.target)) return;
		const binds = $keybinds;

		if (matchKey(e, binds['panel.toggleLayers'])) {
			e.preventDefault();
			updatePanelVisibility({ showLayersPanel: !$panelVisibility.showLayersPanel });
			return;
		}

		let nudgeDx = 0;
		let nudgeDy = 0;
		if (matchKey(e, binds['view.nudgeUp'])) nudgeDy = -NUDGE_STEP;
		else if (matchKey(e, binds['view.nudgeDown'])) nudgeDy = NUDGE_STEP;
		else if (matchKey(e, binds['view.nudgeLeft'])) nudgeDx = -NUDGE_STEP;
		else if (matchKey(e, binds['view.nudgeRight'])) nudgeDx = NUDGE_STEP;
		if ((nudgeDx !== 0 || nudgeDy !== 0) && viewportRef?.nudgeSelection(nudgeDx, nudgeDy)) {
			e.preventDefault();
			return;
		}

		let dir: NavDirection | null = null;
		if (matchKey(e, binds['nav.parent'])) dir = 'parent';
		else if (matchKey(e, binds['nav.child'])) dir = 'child';
		else if (matchKey(e, binds['nav.prevSibling'])) dir = 'prev';
		else if (matchKey(e, binds['nav.nextSibling'])) dir = 'next';
		if (!dir) return;

		const roots: ViewOccurrence[] = resolvedViews
			.filter((v) => !viewTree.referencedViewIds.has(v.viewId))
			.map((v) => ({ viewId: v.viewId, occurrenceKey: v.viewId }));
		const current: ViewOccurrence | null = editorActivity.activeViewId
			? {
					viewId: editorActivity.activeViewId,
					occurrenceKey: selection.selectedOccurrencePrimary ?? editorActivity.activeViewId
				}
			: null;
		const target = navigate(current, dir, viewTree, roots);
		if (!target) return;
		e.preventDefault();
		selectViewShared(editorActivity, selection, target.viewId, target.occurrenceKey);
	}

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
							versionedManifest(plugin.manifest, plugin.content_hash),
							plugin.name,
							(plugin.options ?? undefined) as Partial<ExtismPluginOptions> | undefined,
							plugin.manifest.capabilities?.hostFns
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

		const installName = page.url.searchParams.get('install');
		if (installName) {
			const rawKind = page.url.searchParams.get('kind');
			const catalogueEntry = STORE_CATALOGUE.find((p) => p.id === installName);
			pendingInstall = {
				name: installName,
				kind: rawKind === 'interpreter' ? 'interpreter' : 'utility',
				manifest: catalogueEntry?.manifest,
				activation: catalogueEntry?.activation
			};
			// Strip the params so a refresh (or the user just bookmarking this URL) doesn't
			// re-open the install form every time -- PluginsPanel has already captured what it
			// needs into pendingInstall by the time this runs.
			goto(page.url.pathname, { replaceState: true, noScroll: true, keepFocus: true });
		}
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
				manager.loadPlugin(
					versionedManifest(interpreter.manifest, interpreter.content_hash),
					interpreter.name,
					interpreter.manifest.capabilities?.hostFns
				);
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
			fontFacts,
			overriddenOccurrences
		);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setSelection(
			selection.selectedOccurrencePrimary,
			selection.selectedOccurrenceSecondary
		);
	});

	$effect(() => {
		if (!pluginManager) return;
		pluginManager.setHover(hoveredOccurrenceKey);
	});

	// Passed to Viewport.svelte so it can flag "a resolve is coming" synchronously, before
	// persisting a dragged view's dropped position -- see beginPendingResolve's doc in
	// manager.svelte.ts for why this can't just be selectionGen bumping on its own.
	function beginPendingResolve() {
		pluginManager?.beginPendingResolve();
	}

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

	// Only these two failure shapes are the documented, expected, permanent kind (an
	// uncatalogued family, or a weight/style this family genuinely doesn't ship) -- see
	// find_entry/find_matching_variant in plugins/fontavious/src/lib.rs. Retrying either of
	// those forever would just spam the catalogue lookup for something that will never change.
	// Anything else (a worker call rejecting, an unreachable CDN, a transient network blip) is
	// exactly the "real bug that looks identical to a catalogue miss" case -- those ARE worth
	// retrying, because they very plausibly succeed a moment later on their own (see AGENTS.md's
	// "self-correcting on the facts re-resolve" note for the specific resolve-racing-ahead case).
	// Shared by BOTH the facts scan and the fetch scan below.
	function isPermanentFontFailure(err: unknown): boolean {
		const msg = String(err);
		return msg.includes('not in catalogue') || msg.includes('no variant');
	}

	const FONT_FETCH_MAX_RETRIES = 2;
	const FONT_FETCH_RETRY_DELAY_MS = 600;

	const attemptedFactsFamilies = new Set<string>();
	let fontFacts = $state<Record<string, FamilyFacts>>({});

	// Facts are the master switch for the whole font pipeline: without them Charter can't snap a
	// requested weight to one the family actually ships, so it emits the raw weight, the fetch
	// scan below asks variant_url for a weight that doesn't exist ("no variant" -> a PERMANENT
	// failure, correctly), nothing ever loads, and cosmic-text silently substitutes some other
	// loaded family (the "falls back to the default font" bug). So a transient family_facts
	// failure (a worker/plugin-load race on the shared utility queue) must NOT be treated as
	// final -- it used to mark the family attempted forever and swallow the error, permanently
	// starving that family of facts. Retry everything except a genuine catalogue miss.
	async function loadFamilyFacts(family: string, attempt = 0): Promise<void> {
		if (!pluginManager) return;
		try {
			const result = await pluginManager.callUtilityPlugin(
				'fontavious',
				'family_facts',
				JSON.stringify({ value: family })
			);
			const facts = JSON.parse((result as { text(): string }).text()) as FamilyFacts;
			fontFacts = { ...fontFacts, [family]: facts }; // reassign (never mutate) -> re-resolve
		} catch (err) {
			// A genuine catalogue miss is expected and permanent -- an uncatalogued family simply
			// has no snapping opinion and its weights pass through untouched. Anything else is a
			// transient plumbing failure worth retrying.
			if (isPermanentFontFailure(err)) return;
			if (attempt < FONT_FETCH_MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, FONT_FETCH_RETRY_DELAY_MS * (attempt + 1)));
				return loadFamilyFacts(family, attempt + 1);
			}
			console.warn(`[fontavious] family_facts failed for ${family}:`, err);
		}
	}

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
			loadFamilyFacts(family);
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
	// Keys with a fetch either underway or permanently given up on -- see `loadVariant`'s retry
	// loop for why a transient failure does NOT end up in here until retries are exhausted (a
	// permanently-blocked key used to be exactly what made "pick a family" silently never work
	// until some unrelated later action -- e.g. clicking a font-weight button -- happened to
	// mint a fresh, never-attempted key and got a second chance by accident).
	const attemptedVariants = new Set<string>();
	const loadedFontUrls = new Set<string>();
	// URLs with a fetch already in flight. Several variants can resolve to the SAME file (every
	// weight of a variable font) in the same resolve burst -- without this, each launches its
	// own duplicate download before the first ever lands in loadedFontUrls.
	const pendingFontUrls = new Set<string>();

	// Per-family visibility into this scan (see FontLoadStatus's doc comment) -- StyleField's
	// font-family field renders this so a total failure (bad catalogue entry, unreachable CDN,
	// cache fault) is visible in the panel instead of only in the console / IndexedDB devtools.
	// A single missing weight of an otherwise-loaded family is NOT an error (documented,
	// expected behavior -- see AGENTS.md's "not every font has every weight" note): `ready` is
	// sticky and a later per-weight miss never downgrades it back to `error`.
	let fontStatus = $state<Record<string, FontLoadStatus>>({});

	function setFontStatus(family: string, status: FontLoadStatus) {
		if (fontStatus[family]?.state === 'ready' && status.state !== 'ready') return;
		fontStatus = { ...fontStatus, [family]: status };
	}

	async function loadVariant(req: FontRequest, key: string, attempt = 0): Promise<void> {
		if (!pluginManager) return;
		const vellum = getVellumInstance();
		if (!vellum) {
			attemptedVariants.delete(key); // retry once Vellum itself has initialized
			return;
		}

		const payload: FontFetchPayload = { value: req.family, weight: req.weight, style: req.style };
		try {
			const result = await pluginManager.callUtilityPlugin(
				'fontavious',
				'variant_url',
				JSON.stringify(payload)
			);
			const { url } = JSON.parse((result as { text(): string }).text()) as { url: string };
			if (loadedFontUrls.has(url) || pendingFontUrls.has(url)) {
				setFontStatus(req.family, { state: 'ready' });
				return;
			}
			pendingFontUrls.add(url);
			try {
				const fetchResult = await pluginManager.callUtilityPlugin(
					'fontavious',
					'fetch_font',
					JSON.stringify(payload)
				);
				const bytes = (fetchResult as { bytes(): Uint8Array } | undefined)?.bytes();
				if (bytes) {
					vellum.load_font(bytes);
					loadedFontUrls.add(url);
					requestVellumRender();
					setFontStatus(req.family, { state: 'ready' });
				}
			} finally {
				pendingFontUrls.delete(url);
			}
		} catch (err) {
			console.warn(`[fontavious] variant_url/fetch_font failed for ${key}:`, err);
			// "no variant" is NOT a family-level error: it's either the brief pre-facts window
			// (Charter emitted the raw weight before family_facts landed -- the facts re-resolve
			// will produce a real weight that loads and flips this family to `ready`) or a weight
			// this family genuinely doesn't ship (a different, real weight covers it). Leave the
			// status as-is (`loading` until a real weight lands) rather than flashing a red badge
			// that self-clears a beat later. Only a genuine catalogue miss, or an exhausted
			// transient failure, is a real "this family won't load" error.
			if (String(err).includes('no variant')) return;
			if (!isPermanentFontFailure(err) && attempt < FONT_FETCH_MAX_RETRIES) {
				await new Promise((r) => setTimeout(r, FONT_FETCH_RETRY_DELAY_MS * (attempt + 1)));
				return loadVariant(req, key, attempt + 1);
			}
			setFontStatus(req.family, { state: 'error', detail: String(err) });
		}
	}

	// Font fetching: driven by Charter's `font_requests` -- the concrete (family, weight,
	// style) set the viewport actually renders, POST weight-snapping -- so this scan fetches
	// exactly the files Charter decided on instead of re-deriving weights from raw kit
	// properties (single decision point: Charter's resolve_font_weight; this is just its
	// supply chain).
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
	$effect(() => {
		if (!pluginManager) return;

		for (const req of pluginManager.fontRequests) {
			const key = `${req.family}::${req.weight}::${req.style}`;
			if (attemptedVariants.has(key)) continue;
			attemptedVariants.add(key);

			if (fontStatus[req.family]?.state !== 'ready' && fontStatus[req.family]?.state !== 'loading') {
				setFontStatus(req.family, { state: 'loading' });
			}

			loadVariant(req, key);
		}
	});

	// Image reload scan -- mirrors the font-fetch scan above, but for `src` (asset-id) properties
	// on Image kits. Vellum's `load_image`/`ImageCache` is purely push-based and has no persisted
	// state of its own: bytes live in PGlite (the `assets` row) + the browser's IndexedDB
	// (`assetBytes`), but Vellum's GPU texture cache is memory-only and resets on every page
	// load. Without this scan, an asset uploaded in a PAST session (its row + IndexedDB bytes
	// both still there) would never make it back into Vellum on a fresh reload -- it would just
	// render blank until re-uploaded. `load_image` itself is idempotent (a pinned id is a no-op
	// on a repeat call), so this only needs to dedupe which ids it's ALREADY ATTEMPTED this
	// session (avoiding a redundant IndexedDB round-trip every resolve), not which ones actually
	// succeeded.
	const attemptedImageIds = new Set<string>();

	async function loadImageAsset(assetId: string): Promise<void> {
		const vellum = getVellumInstance();
		const editor = editorLoading;
		if (!vellum || !editor) {
			attemptedImageIds.delete(assetId); // retry once Vellum/the DB itself has initialized
			return;
		}
		try {
			let bytes = await assetBytes.get(assetId);
			if (!bytes) {
				// Not cached locally yet -- e.g. a seeded asset that ships with a bundled `link`
				// instead of ever going through the manual-upload byte-caching path (see
				// manager/src/seed.ts's registerBundledAsset). Fetch it once and cache it in
				// IndexedDB so this fallback only ever runs once per asset per browser.
				const api = queryBuilder(editor.dialect);
				const asset = await api.getAssetById(assetId);
				if (!asset?.link) return; // genuinely missing/orphaned asset -- nothing to load
				const res = await fetch(asset.link);
				if (!res.ok) return;
				bytes = new Uint8Array(await res.arrayBuffer());
				await assetBytes.put(assetId, bytes);
			}
			vellum.load_image(assetId, bytes);
			requestVellumRender();
		} catch (err) {
			console.warn(`[assets] failed to load image ${assetId} into vellum:`, err);
		}
	}

	$effect(() => {
		if (!pluginManager) return;

		const ids = new Set<string>();
		for (const view of resolvedViews) {
			for (const kit of view.resolvedKits) {
				const src = kit.properties.get('src')?.value;
				if (src) ids.add(src);
			}
		}

		for (const id of ids) {
			if (attemptedImageIds.has(id)) continue;
			attemptedImageIds.add(id);
			loadImageAsset(id);
		}
	});

	// Sprite reload scan -- same structural shape as the image-reload scan above (Vellum's
	// SpriteAtlas is just as push-based and just as memory-only-reset-on-reload as ImageCache),
	// but with one real difference: `src` is a single asset id per kit, while `sprites` is a JSON
	// array (a SpriteBatch's whole instance list) that can reference MANY distinct asset ids per
	// kit, not a 1:1 property-to-asset-id mapping. A `sprite_id` is an ordinary `assets` row, same
	// table/IndexedDB-cache/`assets.link` fallback mechanism images already use - no new
	// resource-loading concept, per resources/vellum-sprite-batch-plan.md.
	const attemptedSpriteIds = new Set<string>();

	async function loadSpriteAsset(assetId: string): Promise<void> {
		const vellum = getVellumInstance();
		const editor = editorLoading;
		if (!vellum || !editor) {
			attemptedSpriteIds.delete(assetId); // retry once Vellum/the DB itself has initialized
			return;
		}
		try {
			let bytes = await assetBytes.get(assetId);
			if (!bytes) {
				const api = queryBuilder(editor.dialect);
				const asset = await api.getAssetById(assetId);
				if (!asset?.link) return; // genuinely missing/orphaned asset -- nothing to load
				const res = await fetch(asset.link);
				if (!res.ok) return;
				bytes = new Uint8Array(await res.arrayBuffer());
				await assetBytes.put(assetId, bytes);
			}
			vellum.load_sprite(assetId, bytes);
			requestVellumRender();
		} catch (err) {
			console.warn(`[assets] failed to load sprite ${assetId} into vellum:`, err);
		}
	}

	$effect(() => {
		if (!pluginManager) return;

		const ids = new Set<string>();
		for (const view of resolvedViews) {
			for (const kit of view.resolvedKits) {
				const spritesRaw = kit.properties.get('sprites')?.value;
				if (!spritesRaw) continue;
				try {
					const sprites = JSON.parse(spritesRaw) as Array<{ sprite_id?: string }>;
					for (const s of sprites) {
						if (s.sprite_id) ids.add(s.sprite_id);
					}
				} catch {
					// Malformed JSON -- nothing to load, same "degrade silently" posture Charter's
					// own build_sprite_batch_node already has for this property.
				}
			}
		}

		for (const id of ids) {
			if (attemptedSpriteIds.has(id)) continue;
			attemptedSpriteIds.add(id);
			loadSpriteAsset(id);
		}
	});
</script>

<svelte:window onkeydown={onNavKey} />

<svelte:head>
	{#if editorActivity.activeProjectName}
		<title>{editorActivity.activeProjectName} - KIT•10</title>
	{:else}
		<title>KIT•10 - New</title>
	{/if}

	<meta name="description" content="Yor Designs Editor Superpowered" />
</svelte:head>

<Layout state={editorLoading} consoleExpanded={$panelVisibility.showLayersPanel}>
	{#snippet nav(editorLoading)}
		<Nav {editorLoading} bind:editorActivity {pluginManager} />
	{/snippet}

	{#snippet unloadedDash()}{/snippet}

	{#snippet management(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<ProjectPanel
			{api}
			{editorReady}
			bind:editorActivity
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
			{pluginRegistryVersion}
			{resolvingProjectId}
		/>

		<ViewsPanel
			{api}
			{editorReady}
			{resolvedViews}
			{overriddenOccurrences}
			{viewsPanelManifest}
			{pluginRegistryVersion}
			bind:editorActivity
			bind:selection
			bind:hoveredViewId
			bind:hoveredOccurrenceKey
		/>

		<ComposePanel {api} bind:editorActivity {editorReady} bind:selection />

		<AxesPanel {api} {editorReady} bind:editorActivity />
	{/snippet}

	{#snippet console(editorReady)}
		{#if $panelVisibility.showLayersPanel}
			<LayersPanel {cascades} />
		{/if}
	{/snippet}

	{#snippet dash(editorReady)}
		{@const api = editorReady ? queryBuilder(editorReady.dialect) : null}

		<Viewport
			bind:this={viewportRef}
			data={pluginManager?.viewportData ?? '[]'}
			dataBinary={pluginManager?.viewportDataBinary ?? null}
			nodeViewIds={pluginManager?.nodeViewIds ?? []}
			nodeOccurrenceIds={pluginManager?.nodeOccurrenceIds ?? []}
			{api}
			projectHints={activeProjectRow?.hints ?? null}
			projectHintsReady={activeProjectRow !== undefined}
			{resolvedViews}
			{overriddenOccurrences}
			{compositionKeys}
			{beginPendingResolve}
			onFieldUpdate={pluginManager?.fieldUpdate}
			bind:editorActivity
			bind:selection
			bind:hoveredViewId
			bind:hoveredOccurrenceKey
		/>
	{/snippet}

	{#snippet configurable(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<StylesPanel
			{api}
			{resolvedKits}
			{parentGridAreaNames}
			{selection}
			editorActiveKitId={editorActivity.activeKitId}
			fieldCategories={pluginManager?.fieldCategories}
			activeProjectId={editorActivity.activeProjectId}
			{fontFacts}
			{fontStatus}
			onFieldUpdate={pluginManager?.fieldUpdate}
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
			onSelectView={(id) => selectViewShared(editorActivity, selection, id)}
		/>

		<TokensPanel {api} {editorReady} bind:editorActivity />

		<PluginsPanel
			manager={pluginManager}
			{api}
			{pendingInstall}
			onInstallHandled={() => (pendingInstall = null)}
			onPluginRegistered={() => pluginRegistryVersion++}
		/>

		<ExportPanel
			{api}
			projectId={editorActivity.activeProjectId}
			projectName={editorActivity.activeProjectName}
			projectHints={activeProjectRow?.hints ?? null}
			callUtilityPlugin={pluginManager?.callUtilityPlugin}
			{pluginRegistryVersion}
		/>

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

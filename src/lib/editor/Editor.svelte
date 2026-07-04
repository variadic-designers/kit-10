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

	let resolvedKits: ResolvedKit[] | null = $state(null);
	let viewHints = $state<Record<string, unknown> | null>(null);
	let projectViews = $state<{ viewId: string; viewName: string; hints: Record<string, unknown> }[]>([]);

	$effect(() => {
		const projectId = editorActivity.activeProjectId;
		const activeViewId = editorActivity.activeViewId;
		const editor = editorLoading;
		if (!projectId || !editor) {
			resolvedKits = null;
			viewHints = null;
			projectViews = [];
			return;
		}

		let unsubscribes: (() => Promise<void>)[] = [];

		const init = async () => {
			const reResolve = async () => {
				// Fetch all view metadata in one cheap query — no resolution yet.
				const allViewMeta = await editor.dialect
					.selectFrom('views')
					.selectAll()
					.where('views.project_id', '=', projectId)
					.execute();

				projectViews = allViewMeta.map((v) => ({
					viewId: v.id,
					viewName: v.name,
					hints: ((v as any).hints ?? {}) as Record<string, unknown>,
				}));

				if (!activeViewId) {
					resolvedKits = null;
					viewHints = null;
					return;
				}

				const activeView = allViewMeta.find((v) => v.id === activeViewId);
				if (!activeView) {
					resolvedKits = null;
					viewHints = null;
					return;
				}

				resolvedKits = await resolveManyManager(editor.dialect, activeViewId);
				viewHints = (activeView as any).hints ?? null;
			};

			const watchTables = [
				'compositions',
				'axis_args',
				'layers',
				'layer_axis_values',
				'axis_values',
				'axes_consumed',
				'render_entries',
				'render_snippets',
				'tokens',
				'views'
			];

			for (const table of watchTables) {
				const live = await editor.core.live.query(`SELECT 1 FROM ${table} LIMIT 0`, [], reResolve);
				unsubscribes.push(live.unsubscribe);
			}

			await reResolve();
		};

		init();

		return () => {
			for (const u of unsubscribes) u();
		};
	});

	import ViewsPanel from './panels/Views.svelte';
	import StylesPanel from './panels/Styles.svelte';
	import TokensPanel from './panels/Variables.svelte';
	import AxesPanel from './panels/Axes.svelte';
	import ProjectPanel from './panels/Project.svelte';
	import ComposePanel from './panels/Compose.svelte';
	import PluginsPanel from './panels/Plugins.svelte';

	import Nav from './Nav.svelte';
	import Viewport from './Viewport.svelte';
	import { resolveMany as resolveManyManager, type ResolvedKit } from 'manager';
	import { onMount } from 'svelte';

	import type { EditorState, EditorQueryBuilder, Api } from 'manager';
	import { initializeEditorState } from 'manager';
	import { createPluginManager, type PluginManager } from '$lib/plugins/manager.svelte.js';

	let pluginManager = $state<PluginManager | null>(null);

	onMount(async () => {
		await initializeEditorState().then(async (e) => {
			if (e) {
				editorLoading = e;
				pluginManager = createPluginManager(e, queryBuilder(e.dialect));
				await pluginManager.loadPlugin({ wasm: [{ url: '/charter.wasm' }] }, 'charter');
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
		if (pluginManager) {
			pluginManager.resolve(resolvedKits, viewHints, editorActivity.activeViewId, projectViews);
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

		<ProjectPanel {api} {editorReady} bind:editorActivity />

		<ViewsPanel {api} {editorReady} bind:editorActivity bind:selection />

		<ComposePanel {api} bind:editorActivity {editorReady} bind:selection />

		<AxesPanel {api} {editorReady} bind:editorActivity />
	{/snippet}

	{#snippet dash(editorReady)}
		<Viewport data={pluginManager?.viewportData ?? '[]'} />
	{/snippet}

	{#snippet configurable(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<StylesPanel {resolvedKits} {selection} fieldCategories={pluginManager?.fieldCategories} />

		<TokensPanel {api} {editorReady} bind:editorActivity />

		<PluginsPanel manager={pluginManager} />

		<pre style="max-height: 20rem; overflow-y: auto;">{JSON.stringify(selection, null, 2)}</pre>
	{/snippet}
</Layout>

<style lang="scss">
	@use '_index' as *;
</style>

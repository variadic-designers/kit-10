<script lang="ts" module>
	export interface EditorSelection {
		selectedViewPrimary: string | null;
		selectedViewSecondary: string[];

		selectedKitIndex: number | null;

		selectedViewCascadeResult: MultiCascadeResult | null;
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
		qb: EditorQueryBuilder<any, O>,
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
		// Internal reactive state
		let rows = $state<T[]>([]);
		let isFetching = $state(true);
		let error = $state<Error | null>(null);

		$effect(() => {
			// Track the query and params defensively
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
						// Update state whenever the DB changes
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

			// Cleanup function runs when the component unmounts OR when dependencies (sql/params) change
			return () => {
				if (unsubscribe) {
					unsubscribe();
				}
			};
		});

		// Expose as read-only getters so consumers can't accidentally mutate the state
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
	import { writable } from 'svelte/store';
	import type { ContextMenuContentGenerator } from './contextMenuStore.ts';
	import type { Kit10ProjectEditor, Kit10Project } from '$lib/types.js';

	const project: Kit10ProjectEditor = $props();

	// svelte-ignore state_referenced_locally
	let {
		title,
		description,
		kits,
		kitsPool,
		views,
		viewsPool,
		tokens,
		tokenLibraries,
		selectedLayer,
		viewPortFocus
	}: Kit10ProjectEditor = $state({ ...project });

	let offsetX = writable(viewPortFocus?.x ?? 0);
	let offsetY = writable(viewPortFocus?.y ?? 0);

	$effect(() => {
		const viewport = document.getElementById('canvas');

		if (viewport && !viewPortFocus) {
			offsetX.set(viewport.clientWidth / 2);
			offsetY.set(viewport.clientHeight / 2);
		}
	});

	let selection: EditorSelection = $state({
		selectedViewPrimary: null,
		selectedViewSecondary: [],
		selectedKitIndex: null,
		selectedViewCascadeResult: null
	});

	$effect(() => {
		if (
			selection.selectedViewPrimary &&
			viewsPool[selection.selectedViewPrimary] &&
			viewsPool[selection.selectedViewPrimary].resolve.length > 0
		) {
			const view = viewsPool[selection.selectedViewPrimary];

			const sets = view.resolve.map((r) => kitsPool[r.source_uuid].sets);
			const params = view.resolve.map((r) => r.params);

			selection.selectedViewCascadeResult = resolveMany(sets, params);
		} else {
			selection.selectedViewCascadeResult = null;
		}
	});

	import Viewport from './Viewport.svelte';

	const navContextMenu: ContextMenuContentGenerator = () => {
		return [
			{
				name: 'donation',
				displayText: 'Donate',
				icon: 'fa-solid fa-gift',
				onClick: () => ({
					link: 'https://ko-fi.com/yorqat',
					tab: '_blank'
				})
			}
		];
	};

	import ViewsPanel from './panels/Views.svelte';
	import StylesPanel from './panels/Styles.svelte';
	import TokensPanel from './panels/Variables.svelte';
	import AxesPanel from './panels/Axes.svelte';
	import ProjectPanel from './panels/Project.svelte';
	import ComposePanel from './panels/Compose.svelte';
	import Nav from './Nav.svelte';
	import { resolveMany, type MultiCascadeResult } from '$lib/cascadeAxesMap.js';
	import { onMount } from 'svelte';

	import type { EditorState, EditorQueryBuilder, EditorCore, Api, EditorDialect } from 'manager';
	import { initializeEditorState } from 'manager';

	onMount(async () => {
		await initializeEditorState().then((e) => {
			if (e) {
				editorLoading = e;
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

	{#snippet unloadedDash()}
		<div class="loading">
			<div class="logo">
				<svg width="0" height="0" style="position:absolute">
					<defs>
						<clipPath id="myClip" clipPathUnits="objectBoundingBox">
							<path d="M1,0.5c0,0.276-0.171,0.5-0.382,0.5V0.934C0.618,0.694,0.766,0.5,0.95,0.5Z" />
							<path
								d="M0.618,0.934V1c-0.211,0-0.382-0.224-0.382-0.5h0.05C0.469,0.5,0.618,0.694,0.618,0.934Z"
							/>
							<path
								d="M0.618,0V0.065C0.618,0.305,0.469,0.5,0.285,0.5H0.235C0.235,0.224,0.406,0,0.618,0Z"
							/>
							<path d="M1,0.5H0.95C0.766,0.5,0.618,0.305,0.618,0.065V0C0.829,0,1,0.224,1,0.5Z" />
							<path d="M0.236,0V0.691A0.236,0.309,0,0,1,0,1V0.309A0.236,0.309,0,0,1,0.236,0Z" />
						</clipPath>
					</defs>
				</svg>
			</div>
		</div>
	{/snippet}

	{#snippet management(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<ProjectPanel {api} {editorReady} bind:editorActivity />

		<ViewsPanel {api} {editorReady} bind:editorActivity {views} {viewsPool} bind:selection />

		<ComposePanel {api} bind:editorActivity {editorReady} {viewsPool} {kitsPool} bind:selection />

		<AxesPanel {api} {kits} {views} {kitsPool} bind:viewsPool {selection} />
	{/snippet}

	{#snippet configurable(editorReady)}
		{@const api = queryBuilder(editorReady.dialect)}

		<StylesPanel tokens={tokenLibraries} {kits} {kitsPool} {views} {viewsPool} {selection} />

		<TokensPanel {editorReady} bind:tokens bind:tokenLibraries />

		<pre style="max-height: 20rem; overflow-y: auto;">{JSON.stringify(selection, null, 2)}</pre>
	{/snippet}
</Layout>

<style lang="scss">
	@use '_index' as *;

	.loading {
		position: relative;
		height: 100%;

		display: grid;
		place-items: center;

		.logo {
			clip-path: url(#myClip);
			height: calc($x-font-size-2xl * 8);
			aspect-ratio: 622.31 / 476;
			fill: white;
			background: radial-gradient(
				circle,
				#93c5fd 30%,
				#3b82f6 65%,
				var(--color-bg) 10% // rgba(240, 225, 83, 1) 65%,
			);
			/*
			background: radial-gradient(
				circle,
				var(--color-success) 30%,
				var(--color-primary-hover) 65%,
				var(--color-primary) 25%,
			);
      */

			background-size: 200% 200%; /* important */
			animation: walk-background 5s ease-in-out infinite;
		}
	}

	@keyframes walk-background {
		0% {
			background-position: -140% 0%;
		} /* top-right */

		25% {
			background-position: -150% 60%;
		} /* drifting down right */
		50% {
			background-position: 80% 150%;
		} /* bottom-right (overshoot) */

		75% {
			background-position: -80% 150%;
		} /* bottom-left */

		88% {
			background-position: -100% -100%;
		} /* back up to top-left-ish */

		100% {
			background-position: -140% 0%;
		} /* top-right */
	}
</style>

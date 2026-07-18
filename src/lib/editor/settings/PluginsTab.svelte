<script lang="ts">
	import type { SettingsContext } from './context.js';
	import {
		pluginPreferenceBindings,
		type CollectedPreference,
		type PreferenceBinding
	} from '$lib/plugins/preferences.js';
	import PreferenceList from './PreferenceList.svelte';

	let { ctx }: { ctx: SettingsContext } = $props();

	interface PluginRowLike {
		name: string;
		kind: string;
		activation: string | null;
	}

	let rows = $state<PluginRowLike[]>([]);
	let collected = $state<CollectedPreference[]>([]);
	let loading = $state(true);

	// Load the full catalogue (every registered plugin, loaded or not) plus the preferences the
	// loaded plugins declare. Listing catalogue rows -- not just what declared prefs -- is what makes
	// a plugin visible even when it exposes nothing, so a missing `preferences` export shows as
	// "No settings" rather than the plugin silently vanishing.
	$effect(() => {
		let cancelled = false;
		loading = true;
		Promise.all([
			ctx.api.listPlugins(),
			ctx.pluginManager ? ctx.pluginManager.collectPreferences() : Promise.resolve([])
		])
			.then(([catalogue, prefs]) => {
				if (cancelled) return;
				rows = catalogue as unknown as PluginRowLike[];
				collected = prefs;
				loading = false;
			})
			.catch(() => {
				if (cancelled) return;
				loading = false;
			});
		return () => {
			cancelled = true;
		};
	});

	// Live status by plugin name, from the manager's loaded set.
	const statusByName = $derived.by(() => {
		const map = new Map<string, string>();
		for (const p of ctx.pluginManager?.plugins ?? []) map.set(p.name, p.status);
		return map;
	});

	function bindingsFor(pluginName: string): PreferenceBinding[] {
		return pluginPreferenceBindings(collected.filter((c) => c.plugin === pluginName));
	}

	function kindIcon(kind: string): string {
		return kind === 'interpreter' ? 'fa-solid fa-diagram-project' : 'fa-solid fa-plug';
	}

	function statusLabel(name: string): string {
		return statusByName.get(name) ?? 'not loaded';
	}
</script>

<div class="tab">
	{#if loading}
		<p class="muted">Loading plugins…</p>
	{:else if rows.length === 0}
		<p class="muted">No plugins registered.</p>
	{:else}
		{#each rows as row (row.name)}
			<article class="plugin">
				<header>
					<i class={kindIcon(row.kind)}></i>
					<div class="meta">
						<span class="name">{row.name}</span>
						<span class="sub">{row.kind}{row.activation ? ` · ${row.activation}` : ''}</span>
					</div>
					<span class="status" class:ready={statusLabel(row.name) === 'ready'}>
						{statusLabel(row.name)}
					</span>
				</header>
				<div class="prefs">
					<PreferenceList
						bindings={bindingsFor(row.name)}
						showGroupHeaders={true}
						emptyLabel="No settings."
					/>
				</div>
			</article>
		{/each}
	{/if}
</div>

<style lang="scss">
	@use '_index' as *;

	.tab {
		@include layout-flex-column();
		gap: $x-space-sm;
	}

	.muted {
		color: var(--color-text-muted);
		font-size: $x-font-size-md;
		padding: $x-space-xs;
		@include fonts-stack('Satoshi-Regular', sans);
	}

	.plugin {
		border: 1px solid var(--color-bg);
		border-radius: calc($x-space-xs / 2);
		background: var(--color-surface);

		header {
			display: flex;
			align-items: center;
			gap: $x-space-sm;
			padding: $x-space-xs $x-space-sm;
			border-bottom: 1px solid var(--color-bg);

			i {
				color: var(--color-text-muted);
			}

			.meta {
				display: flex;
				flex-direction: column;
				flex: 1;

				.name {
					@include fonts-stack('Satoshi-Regular', sans);
					font-weight: 600;
					color: var(--color-text);
					text-transform: capitalize;
				}
				.sub {
					font-size: $x-font-size-sm;
					color: var(--color-text-muted);
					text-transform: capitalize;
				}
			}

			.status {
				font-size: $x-font-size-sm;
				color: var(--color-text-muted);
				text-transform: uppercase;
				letter-spacing: 1px;

				&.ready {
					color: var(--color-primary);
				}
			}
		}

		.prefs {
			padding: calc($x-space-xs / 2) $x-space-xs $x-space-xs;
		}
	}
</style>

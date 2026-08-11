<script lang="ts">
	import type { ContextMenuContentGenerator } from '$lib/components/contextMenu.js';
	import Panel from '../Panel.svelte';
	import type { Api } from 'manager';
	import { downloadExportResult } from '$lib/download.js';
	import { liveQuery } from '../Editor.svelte';
	import {
		resolveExportProviders,
		type ProjectExportProvider
	} from '$lib/plugins/project-export-providers.js';
	import {
		resolveExportProfile,
		buildExportProfileHints,
		type ExportProfile,
		type ExportTargetGroup
	} from '$lib/plugins/export-profile.js';
	import { isFlaggedForExport } from '$lib/plugins/export-flags.js';

	const {
		api,
		projectId,
		projectName,
		projectHints,
		callUtilityPlugin,
		pluginRegistryVersion = 0
	}: {
		api: Api;
		projectId: string | null;
		projectName: string | null;
		projectHints: Record<string, unknown> | null;
		callUtilityPlugin?: (name: string, fn: string, payload: string) => Promise<unknown>;
		// Bumped by Editor.svelte after PluginsPanel registers a new plugin -- read below purely to
		// re-trigger the fetch, since there's no live query on the plugin catalogue table yet.
		pluginRegistryVersion?: number;
	} = $props();

	// Install-level fetch -- same posture as Project.svelte/Plugins.svelte (no live query exists
	// for the plugin catalogue yet). Re-fetches whenever pluginRegistryVersion changes, not just
	// on mount, so a plugin registered mid-session (e.g. via /store's install handoff) shows up
	// here without a full reload.
	let availableExportProviders: ProjectExportProvider[] = $state([]);

	$effect(() => {
		void pluginRegistryVersion;
		api.listPlugins().then((plugins) => {
			availableExportProviders = resolveExportProviders(plugins);
		});
	});

	// Which views a run actually exports is controlled per-provider by hints.<providerId>.export
	// (see export-flags.ts) -- set from the Views panel's per-view "Export to" context-menu
	// submenu, not from this panel. A live query (not a one-shot fetch) so flagging/unflagging a
	// view while this panel is open is reflected immediately, same pattern as Views.svelte's own
	// viewsQuery.
	const viewsQuery = liveQuery((api, activity) => {
		return api.getViewsByProjectId(activity.activeProjectId);
	});

	// The views flagged for a given target's effective provider -- empty (not "everything") when
	// nothing's been flagged yet, when the target is still ambiguous (no effective provider), or
	// when the provider isn't view-scoped at all (Tenner: project-basis, ignores view_ids --
	// "flagged views" isn't a concept that applies to it, see schema.ts's viewScoped doc comment).
	function flaggedViewsFor(group: ExportTargetGroup) {
		const provider = group.effective;
		if (!provider?.viewScoped) return [];
		return viewsQuery.rows.filter((v) => isFlaggedForExport(v.hints, provider.id));
	}

	const exportProfile = $derived(projectHints?.exportProfile as ExportProfile | undefined);
	const groups = $derived(resolveExportProfile(availableExportProviders, exportProfile));

	function chooseProvider(target: string, provider: ProjectExportProvider) {
		if (!projectId) return;
		api.updateProjectHints(projectId, {
			exportProfile: buildExportProfileHints(exportProfile, target, provider.id)
		});
	}

	// Per-target "Compressed" checkbox state (see ExportCapability.compressedVariant) -- keyed by
	// target rather than provider id, matching how `groups`/`chooseProvider` are already keyed;
	// unset/false is the common case (today, only Tenner's `yaml` target declares a variant at
	// all), so a plain object default is enough, no need to seed every known target up front.
	let compressed: Record<string, boolean> = $state({});

	// Per-target, per-option current value (string-encoded, same convention preferences.ts's
	// value map uses) -- keyed by target like `compressed` above. Export.svelte never knows what
	// any of these options MEAN (page size, DPI, ...); it only knows `ExportCapability.options`'
	// generic id/kind/default/options shape (schema.ts), the same "plugin declares a capability
	// as data, host renders it generically" idiom the Settings-menu's PreferenceDef already uses
	// (src/lib/plugins/preferences.ts) -- see that file's module doc comment.
	let optionValues: Record<string, Record<string, string>> = $state({});

	function optionValue(target: string, opt: { id: string; default: string }): string {
		return optionValues[target]?.[opt.id] ?? opt.default;
	}

	function setOptionValue(target: string, optId: string, value: string) {
		optionValues[target] = { ...optionValues[target], [optId]: value };
	}

	function collectedOptions(group: ExportTargetGroup): Record<string, string> {
		const defs = group.effective?.options ?? [];
		const out: Record<string, string> = {};
		for (const def of defs) out[def.id] = optionValue(group.target, def);
		return out;
	}

	function runExport(group: ExportTargetGroup) {
		const provider = group.effective;
		if (!provider || !projectId) return;
		const useCompressed = compressed[group.target] && !!provider.compressedVariant;
		const variant = useCompressed ? provider.compressedVariant! : provider;
		const name = projectName ?? 'export';
		const viewIds = flaggedViewsFor(group).map((v) => v.viewId);
		const payload = {
			project_id: projectId,
			view_ids: viewIds,
			options: collectedOptions(group)
		};
		// compressedVariant is ALWAYS base64 regardless of the primary capability's own `binary`
		// flag (see ExportCapability.compressedVariant's doc comment); otherwise fall back to the
		// primary `fn`'s own declared encoding (`binary` -- e.g. PDF's export_pdf, whose only
		// output IS binary with no plain-text variant, see ExportCapability.binary's doc comment).
		const encoding = useCompressed || provider.binary ? 'base64' : 'text';
		callUtilityPlugin
			?.(provider.id, variant.fn, JSON.stringify(payload))
			.then((result) => {
				const text = (result as { text(): string }).text();
				return downloadExportResult(
					text,
					provider.multiFile,
					`${name}.${variant.fileExtension}`,
					variant.mimeType,
					encoding
				);
			})
			.catch((err) => console.error(`[${provider.id}] ${variant.fn} failed:`, err));
	}

	// This panel doesn't create/delete anything of its own (unlike Project/Plugins) -- its
	// context menu only ever needs the same disabled "check the store" placeholder shown when
	// there are no export providers installed at all yet.
	const exportPanelContextMenu: ContextMenuContentGenerator = () => {
		if (availableExportProviders.length > 0) return [];
		return [
			{
				name: 'check_store_for_export_options',
				displayText: 'Check Store for Options',
				icon: 'fa-solid fa-store',
				disabled: true,
				description: 'No export plugins are available yet.'
			}
		];
	};
</script>

<Panel name="Export" tooltip="Export Profile" contextMenuContent={exportPanelContextMenu}>
	{#snippet content()}
		{#if !projectId}
			<p class="empty">No project selected</p>
		{:else if groups.length === 0}
			<p class="empty">No export plugins are available yet</p>
		{:else}
			<ul class="export-target-list">
				{#each groups as group (group.target)}
					{@const flagged = flaggedViewsFor(group)}
					<li class="export-target">
						<span class="export-target__name">{group.target}</span>

						{#if group.providers.length === 1}
							<span class="export-target__provider">{group.providers[0]!.label}</span>
						{:else}
							<div class="export-target__choices">
								{#each group.providers as provider (provider.id)}
									<label>
										<input
											type="radio"
											name={`export-profile-${group.target}`}
											checked={group.effective?.id === provider.id}
											onchange={() => chooseProvider(group.target, provider)}
										/>
										{provider.label}
									</label>
								{/each}
							</div>
						{/if}

						{#if group.effective?.compressedVariant}
							<label class="export-target__compressed">
								<input type="checkbox" bind:checked={compressed[group.target]} />
								Compressed
							</label>
						{/if}

						{#if group.effective?.options?.length}
							<div class="export-target__options">
								{#each group.effective.options as opt (opt.id)}
									{@const current = optionValue(group.target, opt)}
									<label class="export-target__option">
										<span>{opt.label}</span>
										{#if opt.kind === 'toggle'}
											<input
												type="checkbox"
												checked={current === 'true'}
												onchange={(e) =>
													setOptionValue(group.target, opt.id, String(e.currentTarget.checked))}
											/>
										{:else if opt.kind === 'select'}
											<select
												value={current}
												onchange={(e) => setOptionValue(group.target, opt.id, e.currentTarget.value)}
											>
												{#each opt.options ?? [] as choice (choice.value)}
													<option value={choice.value}>{choice.label}</option>
												{/each}
											</select>
										{:else}
											<input
												type="number"
												value={current}
												min={opt.min}
												max={opt.max}
												onchange={(e) => setOptionValue(group.target, opt.id, e.currentTarget.value)}
											/>
										{/if}
									</label>
								{/each}
							</div>
						{/if}

						<button
							type="button"
							class="export-target__run"
							disabled={!group.effective}
							onclick={() => runExport(group)}
						>
							Export
						</button>

						{#if group.effective?.viewScoped}
							<span class="export-target__views">
								{#if flagged.length > 0}
									Views: {flagged.map((v) => v.viewName).join(', ')}
								{:else}
									No views flagged - right-click a view in the Views panel → Export to → {group
										.effective.label}
								{/if}
							</span>
						{:else if group.effective}
							<span class="export-target__views">Exports the whole project</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</Panel>

<style lang="scss">
	@use '_index' as *;

	.empty {
		padding: $x-space-sm;
		color: var(--color-text-muted);
		@include fonts-stack('Satoshi-Light', sans);
		font-size: $x-font-size-xs;
	}

	.export-target-list {
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.export-target {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: $x-space-xs;
		padding: $x-space-xs $x-space-sm;

		&__name {
			@include fonts-stack('Satoshi-Regular', sans);
			font-size: $x-font-size-xs;
			text-transform: uppercase;
			color: var(--color-text);
		}

		&__provider {
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}

		&__choices {
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-xs;
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}

		&__compressed {
			display: flex;
			align-items: center;
			gap: 4px;
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
			cursor: pointer;
		}

		&__options {
			flex-basis: 100%;
			display: flex;
			flex-wrap: wrap;
			gap: $x-space-xs $x-space-sm;
		}

		&__option {
			display: flex;
			align-items: center;
			gap: 4px;
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);

			select,
			input[type='number'] {
				background: var(--color-surface);
				color: var(--color-text);
				border: 1px solid var(--color-bg);
				border-radius: calc($x-space-xs / 2);
				padding: calc($x-space-xs / 4) $x-space-xs;
				font-size: $x-font-size-xs;
			}
		}

		&__run {
			margin-left: auto;
			font-size: $x-font-size-xs;
			padding: 2px 6px;
			border: 1px solid var(--color-text-muted);
			background: var(--color-pure);
			color: var(--color-text);
			cursor: pointer;

			&:disabled {
				opacity: 0.5;
				cursor: not-allowed;
			}
		}

		&__views {
			flex-basis: 100%;
			@include fonts-stack('Satoshi-Light', sans);
			font-size: $x-font-size-xs;
			color: var(--color-text-muted);
		}
	}
</style>
